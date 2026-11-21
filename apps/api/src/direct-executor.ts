import {
  DEFAULT_ROUTING,
  MODEL_MAX_ATTEMPTS,
  MODEL_MAX_OUTPUT_TOKENS,
  MODEL_TIMEOUT_MS,
  modelRequestRefusal,
  type ModelGateway,
  type ModelMessage,
  type ModelUsage,
  type Route,
  type RoutingConfigStore,
  type Run,
  type RunStep,
  type RunStore,
  type RunUsage,
  type TierKey,
} from "@andy/contracts";
import {
  DomainError,
  effectiveRouting,
  reserveFor,
  resolveRoute,
  settleFor,
  type PricedModel,
  type SpendGate,
  type SpendPrices,
} from "@andy/domain";
import type { z } from "zod";

/**
 * The in-process `direct` executor (AI-258: M10.11, ADR-0129). A single-call step (one prompt,
 * one structured answer; never refine, plan or build) whose resolved route uses the `direct`
 * harness runs here: create a run, reserve its spend (M10.7), call `ModelGateway` (M10.10) with
 * an output cap that fits the reservation, check the answer against the step's schema, and settle.
 *
 * Any other route returns `not_direct` and the gateway is never called: the caller keeps its own
 * path. No tier routes `direct` by default, no step calls this yet (AI-258's question for Andy),
 * and the OpenRouter key doesn't exist until AI-266: M10.15.
 *
 * Fails closed: a refused reservation, no price, or a cap too small for the call fails the run
 * (its `error` names the cap) before any call. The answer is untrusted model output: it is parsed
 * as JSON and schema-checked, never logged, and only the parsed value is returned.
 */

/** Steps that need an agent harness (tools, turns, a repo): never a single call. */
export const AGENTIC_STEPS: readonly RunStep[] = ["refine", "plan", "build", "sync"];
/** The smallest output cap worth a call; a reservation that affords less fails the run. */
export const DIRECT_MIN_OUTPUT_TOKENS = 256;
/** Per-message token overhead (role and separators) in the input estimate. */
export const DIRECT_MESSAGE_OVERHEAD_TOKENS = 16;
/** A direct run's deadline past the gateway's own timeout. */
const DEADLINE_MARGIN_MS = 60_000;
/** How much of a validation error is kept on the run. */
const ERROR_DETAIL_MAX = 500;

export interface DirectCall<T> {
  projectId: string;
  /** The ticket it is for; null for project-wide steps (the scout). */
  ticketId: string | null;
  step: RunStep;
  /** The ticket's tier, for a step routed `by_size`; default `fast`. */
  ticketTier?: TierKey;
  messages: ModelMessage[];
  /** The step's answer schema; the reply must be JSON that parses with it. */
  schema: z.ZodType<T>;
  /** The step's own output ceiling; the reservation may lower it. */
  maxOutputTokens: number;
}

export type DirectOutcome<T> =
  /** The step's route isn't `direct` (or none is usable): nothing ran, nothing was reserved. */
  | { kind: "not_direct"; route: Route | null }
  | { kind: "done"; run: Run; output: T }
  | { kind: "failed"; run: Run; reason: string };

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "direct-executor", ...fields }));
}

/**
 * An upper bound on the input tokens: UTF-8 bytes (no tokenizer emits more tokens than bytes)
 * plus a per-message overhead.
 */
export function inputTokenBound(messages: ModelMessage[]): number {
  return messages.reduce(
    (n, m) => n + Buffer.byteLength(m.content, "utf8") + DIRECT_MESSAGE_OVERHEAD_TOKENS,
    0,
  );
}

/**
 * The largest output cap (at most `ceiling`) whose worst case fits the reservation for every
 * attempt the gateway may make (a retried call may be billed twice: `MODEL_MAX_ATTEMPTS`).
 * 0 when not even one output token fits or the model has no price.
 */
export function affordableOutputTokens(
  model: PricedModel,
  inputTokens: number,
  budgetMicroUsd: number,
  ceiling: number,
): number {
  const perAttempt = Math.floor(budgetMicroUsd / MODEL_MAX_ATTEMPTS);
  const fits = (out: number) => {
    const cost = reserveFor(model, { kind: "call", inputTokens, maxOutputTokens: out });
    return cost !== null && cost <= perAttempt;
  };
  if (ceiling < 1 || !fits(1)) return 0;
  if (fits(ceiling)) return ceiling;
  // Cost grows with output tokens: the largest n with fits(n), between 1 (fits) and ceiling (doesn't).
  let lo = 1;
  let hi = ceiling;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The gateway's usage as a run's: cached tokens are part of the input count there. */
export function runUsageOf(usage: ModelUsage, wallMs: number): RunUsage {
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  return {
    inputTokens: usage.inputTokens - cached,
    outputTokens: usage.outputTokens,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
    turns: 1,
    wallMs,
  };
}

/** The reply as the step's value, or why it isn't one. A single ```json fence is allowed. */
export function parseAnswer<T>(
  text: string,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; reason: string } {
  const fenced = /^```(?:json)?\s*\n([\s\S]*)\n```$/.exec(text.trim());
  let json: unknown;
  try {
    json = JSON.parse(fenced ? fenced[1]! : text.trim());
  } catch {
    return { ok: false, reason: "the answer is not JSON" };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return {
    ok: false,
    reason: `the answer fails the step's schema: ${issues}`.slice(0, ERROR_DETAIL_MAX),
  };
}

export class DirectExecutor {
  constructor(
    private readonly runs: RunStore,
    private readonly gateway: ModelGateway,
    private readonly gate: SpendGate,
    /** The same price source as the gate's: sizes the output cap to the reservation. */
    private readonly prices: SpendPrices,
    /** Null: `DEFAULT_ROUTING`, which routes nothing to `direct`. */
    private readonly routing: Pick<RoutingConfigStore, "getGlobal" | "getProject"> | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run<T>(call: DirectCall<T>): Promise<DirectOutcome<T>> {
    if (AGENTIC_STEPS.includes(call.step)) {
      throw new DomainError(
        "invalid_step",
        `${call.step} is agentic: it never runs as a direct call`,
      );
    }
    const resolved = resolveRoute(
      call.step,
      call.ticketTier ?? "fast",
      await this.routingOf(call.projectId),
    );
    if (!resolved.route || resolved.route.harness !== "direct") {
      return { kind: "not_direct", route: resolved.route };
    }
    const route = resolved.route;
    const request = {
      model: route.model,
      messages: call.messages,
      maxOutputTokens: Math.min(call.maxOutputTokens, MODEL_MAX_OUTPUT_TOKENS),
    };
    const refused = modelRequestRefusal(request);
    if (refused) throw new DomainError("invalid_field", `direct ${call.step} call: ${refused}`);

    const run = await this.runs.create({
      projectId: call.projectId,
      ticketId: call.ticketId,
      step: call.step,
      route,
      tier: resolved.tier,
      deadline: new Date(
        this.now().getTime() + MODEL_TIMEOUT_MS + DEADLINE_MARGIN_MS,
      ).toISOString(),
      prompt: null,
      maxTurns: 1,
      attempt: 1,
      retryOf: null,
    });

    let budget: number;
    try {
      budget = (await this.gate.reserve(run)).budgetMicroUsd;
    } catch (err) {
      // The gate leaves nothing reserved when it refuses; the run's error names the cap.
      const reason = err instanceof Error ? err.message : String(err);
      return this.fail(run, reason);
    }

    const model = await this.prices(route).catch(() => null);
    const maxOutputTokens = model
      ? affordableOutputTokens(
          model,
          inputTokenBound(call.messages),
          budget,
          request.maxOutputTokens,
        )
      : 0;
    if (maxOutputTokens < Math.min(DIRECT_MIN_OUTPUT_TOKENS, request.maxOutputTokens)) {
      const reason = model
        ? `no paid call: the per-task cap affords ${maxOutputTokens} output tokens for this input`
        : `no paid call: no price for ${route.provider}/${route.model}`;
      return this.fail(run, reason);
    }

    await this.runs.update(run.id, { status: "running" }, ["queued"]);
    const sentAt = this.now();
    const result = await this.gateway.complete({ ...request, maxOutputTokens });
    const wallMs = Math.max(0, this.now().getTime() - sentAt.getTime());

    if (result.outcome === "off") {
      // Nothing was sent: startedAt stays null, so the reservation is released.
      return this.fail(run, "no paid call: the model gateway has no key", ["running"]);
    }
    const startedAt = sentAt.toISOString();
    if (result.outcome === "error") {
      // Usage unknown: the reservation is kept in full.
      return this.fail(
        run,
        `the model call failed: ${result.reason}`,
        ["running"],
        { startedAt },
        null,
      );
    }

    const usage = result.usage ? runUsageOf(result.usage, wallMs) : null;
    const costed = {
      startedAt,
      usage,
      tokensIn: result.usage?.inputTokens ?? null,
      tokensOut: result.usage?.outputTokens ?? null,
      ...this.costOf(result.usage, model, usage),
    };
    const answer = parseAnswer(result.text, call.schema);
    if (!answer.ok) return this.fail(run, answer.reason, ["running"], costed, usage);

    const done = await this.runs.update(
      run.id,
      { status: "succeeded", endedAt: this.now().toISOString(), ...costed },
      ["running"],
    );
    await this.gate.close(run.id, done, usage);
    log("INFO", "direct call done", { runId: run.id, step: call.step, model: route.model });
    return { kind: "done", run: done, output: answer.value };
  }

  /** Reported cost when the provider gave one, else usage at our prices (an estimate). */
  private costOf(
    reported: ModelUsage | null,
    model: PricedModel | null,
    usage: RunUsage | null,
  ): { costUsd: number | null; costIsEstimate: boolean } {
    if (reported?.costUsd != null) return { costUsd: reported.costUsd, costIsEstimate: false };
    const micro = model && usage ? settleFor(model, usage) : null;
    return { costUsd: micro === null ? null : micro / 1_000_000, costIsEstimate: true };
  }

  /**
   * Fails the run, then closes its spend: `usage` undefined releases it when nothing was sent
   * (startedAt null), null keeps it in full, else it settles at the usage.
   */
  private async fail(
    run: Run,
    reason: string,
    from: Run["status"][] = ["queued"],
    patch: object = {},
    usage?: RunUsage | null,
  ): Promise<DirectOutcome<never>> {
    log("WARNING", "direct call failed", { runId: run.id, step: run.step, reason });
    let ended: Run | null = null;
    try {
      ended = await this.runs.update(
        run.id,
        {
          status: "failed",
          endedAt: this.now().toISOString(),
          error: reason.slice(0, 2000),
          ...patch,
        },
        from,
      );
    } catch (err) {
      log("ERROR", "direct run unwritable; its spend stays reserved", {
        runId: run.id,
        error: String(err),
      });
    }
    await this.gate.close(run.id, ended, usage);
    return { kind: "failed", run: ended ?? run, reason };
  }

  private async routingOf(projectId: string) {
    if (!this.routing) return effectiveRouting(DEFAULT_ROUTING, null);
    const [global, project] = await Promise.all([
      this.routing.getGlobal(),
      this.routing.getProject(projectId),
    ]);
    return effectiveRouting(global, project);
  }
}
