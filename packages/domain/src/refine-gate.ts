import {
  REFINE_LIMITS,
  RefineOutput,
  WorkTrackerError,
  runQuestionId,
  type Assumption,
  type EventActor,
  type NewQuestion,
  type Question,
  type RefineGap,
  type Run,
  type Ticket,
  type TicketFields,
  type WorkTracker,
} from "@andy/contracts";
import { checkDor, heldGaps } from "./dor";

function log(severity: "INFO" | "WARNING", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "refine-gate", ...fields }));
}

/** Open questions a ticket may have at once (ADR-0075). */
export const MAX_OPEN_QUESTIONS_PER_TICKET = 3;

/** The window a project's `dailyQuestionCap` counts over. */
export const QUESTION_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The measured rule (ADR-0075): sure and cheap to reverse is an assumption; the rest is asked. */
export function shouldAsk(gap: Pick<RefineGap, "cost" | "confidence">): boolean {
  return gap.cost !== "reversible" || gap.confidence === "unsure";
}

export interface CapRoom {
  /** Open questions on the ticket already. */
  openOnTicket: number;
  /** Refine questions the project opened inside the window. */
  openedToday: number;
  dailyCap: number;
}

export type DemotedBy = "ticket_cap" | "daily_cap";

export interface GapPlan {
  questions: RefineGap[];
  assumptions: { gap: RefineGap; demotedBy: DemotedBy | null }[];
}

/**
 * Sorts each gap into a question or an assumption. Costly gaps take the question slots first; the
 * model's ordering only breaks ties. Gaps past either cap become assumptions marked with the cap
 * that stopped them.
 */
export function planGaps(gaps: readonly RefineGap[], room: CapRoom): GapPlan {
  const plan: GapPlan = { questions: [], assumptions: [] };
  const asked = gaps.filter(shouldAsk);
  const costly = asked.filter((g) => g.cost !== "reversible");
  const unsure = asked.filter((g) => g.cost === "reversible");
  for (const gap of gaps) {
    if (!shouldAsk(gap)) plan.assumptions.push({ gap, demotedBy: null });
  }
  for (const gap of [...costly, ...unsure]) {
    const ticketFull = room.openOnTicket + plan.questions.length >= MAX_OPEN_QUESTIONS_PER_TICKET;
    const dayFull = room.openedToday + plan.questions.length >= room.dailyCap;
    if (ticketFull) plan.assumptions.push({ gap, demotedBy: "ticket_cap" });
    else if (dayFull) plan.assumptions.push({ gap, demotedBy: "daily_cap" });
    else plan.questions.push(gap);
  }
  return plan;
}

/**
 * The fields refine fills: only those the ticket has empty, so a value Andy set is never
 * overwritten; to change one, refine asks (ADR-0058). Each reason goes with the score it explains.
 */
export function refineFills(ticket: Ticket, output: RefineOutput): TicketFields {
  return {
    ...(ticket.type === null ? { type: output.type } : {}),
    ...(ticket.size === null ? { size: output.size, sizeReason: output.sizeReason } : {}),
    ...(ticket.risk === null ? { risk: output.risk, riskReason: output.riskReason } : {}),
    ...(ticket.confidence === null
      ? { confidence: output.confidence, confidenceReason: output.confidenceReason }
      : {}),
    ...(ticket.outOfScope.length === 0 ? { outOfScope: output.outOfScope } : {}),
    ...(ticket.touches.length === 0 ? { touches: output.touches } : {}),
    ...(ticket.body.trim() === "" && output.body ? { body: output.body } : {}),
    ...(ticket.acceptanceCriteria.length === 0
      ? { acceptanceCriteria: output.acceptanceCriteria }
      : {}),
  };
}

/** Gaps Andy answered before this run was created; a later answer waits for its own run. */
export function answeredGaps(ticket: Ticket, run: Pick<Run, "createdAt">): Assumption[] {
  return ticket.refineAssumptions.filter(
    (a) =>
      a.status === "answered" &&
      (run.createdAt === null || (a.answeredAt !== null && a.answeredAt <= run.createdAt)),
  );
}

export type RefineApplied = { summary: string; asked: number; notice?: string } | { error: string };

/** The question line, context, choices and recommendation (AI-73); old readers keep `options`. */
const formatOf = (gap: RefineGap) => ({
  context: gap.context,
  choices: gap.options,
  recommendation: gap.recommendation,
});

const toQuestion = (gap: RefineGap): NewQuestion => ({
  text: gap.question,
  options: gap.options.map((o) => o.label),
  suggestedAnswer: gap.recommendation.answer,
  assumptions: [gap.assumption],
  urgency: gap.urgency,
  ...formatOf(gap),
});

/** Checks a refine run's result and applies its outcome to the ticket (ADR-0075). */
export class RefineGate {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly now: () => Date,
  ) {}

  /**
   * Safe to replay after a crash: question and assumption ids derive from the run and children
   * are matched by title. Nothing is written for a malformed result, or for a ticket that left
   * Up next while the run was going (ADR-0073).
   */
  async apply(run: Run, raw: unknown): Promise<RefineApplied> {
    const parsed = RefineOutput.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "result"}: ${i.message}`);
      log("WARNING", "refine result rejected", { runId: run.id, issues });
      return { error: `Its result was rejected (${issues.join("; ")}); nothing was written.` };
    }
    const output = parsed.data;
    const ticket = run.ticketId ? await this.tracker.getTicket(run.projectId, run.ticketId) : null;
    if (!ticket) return { error: "The ticket is gone; nothing was written." };

    const written = (await this.tracker.listQuestions({ ticketId: ticket.id })).filter(
      (q) => q.runId === run.id,
    );
    const stillOpen = written.some(isOpen);
    // A replay after a crash. With questions still open it finishes the write below; once Andy
    // has answered them, or the last write already landed, there is nothing left to do.
    const finished =
      written.length > 0 ? !stillOpen : ticket.refineAssumptions.some((a) => a.runId === run.id);
    if (finished) {
      log("INFO", "refine result replayed", { runId: run.id, ticket: ticket.key });
      return { summary: output.summary, asked: written.length };
    }
    if (!stillOpen && (ticket.stage !== "backlog" || ticket.upNextRank === null)) {
      return this.late(run, ticket, output);
    }

    const focused = answeredGaps(ticket, run);
    if (focused.length > 0) return this.applyGaps(run, ticket, output, focused);
    if (output.outcome === "send_back") return this.sendBack(ticket, output);
    if (output.outcome === "split") return this.split(run, ticket, output);
    return this.applyGaps(run, ticket, output, []);
  }

  private late(run: Run, ticket: Ticket, output: RefineOutput): RefineApplied {
    const where = ticket.stage === "backlog" ? "Ideas" : ticket.stage;
    log("INFO", "refine finished after its ticket left Up next", {
      runId: run.id,
      where,
      dropped: output.gaps.length,
    });
    const unasked = output.gaps.map((g) => `- ${g.question}`).join("\n");
    return {
      summary: output.summary,
      asked: 0,
      notice: `The ticket moved to ${where} before refine finished, so its result was not applied.${unasked ? `\nGaps it found:\n${unasked}` : ""}`,
    };
  }

  /** Too vague: back to Ideas with the reason, and nothing else changes. */
  private async sendBack(ticket: Ticket, output: RefineOutput): Promise<RefineApplied> {
    await this.toIdeas(ticket, output.reason);
    return { summary: output.summary, asked: 0, notice: `Back to Ideas: ${output.reason}` };
  }

  /**
   * Too big: children land in Ideas under the same epic; the parent goes back with the links.
   * An epic's children land under the epic itself, with `touches` and with `blockedBy` naming
   * the sibling keys its indexes point at (AI-115); a non-epic's ignore both fields.
   */
  private async split(run: Run, ticket: Ticket, output: RefineOutput): Promise<RefineApplied> {
    const epic = ticket.type === "epic";
    const parentId = epic ? ticket.id : ticket.parentId;
    const since = run.createdAt ?? ticket.createdAt;
    const existing = (await this.tracker.listTickets(ticket.projectId)).filter(
      (t) => t.createdAt >= since && t.parentId === parentId,
    );
    const actor = `agent:${run.id}`;
    // A replay finds what this run already created, by its own `created` event; a same-titled
    // ticket Andy made meanwhile isn't adopted. Taken from the pool so duplicate titles both stay.
    const pool: Ticket[] = [];
    for (const t of existing) {
      const [created] = await this.tracker.listEvents(t.projectId, t.id);
      if (created?.actor === actor) pool.push(t);
    }
    const made: Ticket[] = [];
    for (const child of output.children) {
      const at = pool.findIndex((t) => t.title === child.title);
      made.push(
        (at >= 0 ? pool.splice(at, 1)[0] : undefined) ??
          (await this.tracker.createTicket(
            ticket.projectId,
            {
              title: child.title,
              body: child.body,
              parentId,
              ...(epic ? { touches: child.touches } : {}),
            },
            actor,
          )),
      );
    }
    const keys = made.map((t) => t.key);
    if (epic) await this.linkSiblings(output, made, actor);
    await this.toIdeas(ticket, epic ? null : output.reason);
    log("INFO", "refine split a ticket", { ticket: ticket.key, children: keys, epic });
    return {
      summary: output.summary,
      asked: 0,
      notice: `Split into ${keys.join(", ")}; back to Ideas: ${output.reason}`,
    };
  }

  /**
   * Sets each child's `blockedBy` to the keys of the siblings its indexes name. After every
   * child exists, since an index may point at a later one; a replay rewrites nothing that matches.
   */
  private async linkSiblings(output: RefineOutput, made: Ticket[], actor: EventActor) {
    for (const [i, child] of output.children.entries()) {
      const ticket = made[i]!;
      const blockedBy = child.blockedBy.map((b) => made[b]!.key);
      if (blockedBy.join() === ticket.blockedBy.join()) continue;
      await this.tracker.updateTicket(
        ticket.projectId,
        ticket.id,
        { fields: { blockedBy } },
        actor,
      );
    }
  }

  private async toIdeas(ticket: Ticket, sentBackReason: string | null): Promise<void> {
    await this.write(ticket, {
      upNextRank: null,
      upNextAt: null,
      needsAttention: false,
      sentBackReason,
    });
  }

  /**
   * The usual outcome: fill empty fields, record assumptions, ask what's left, and move to Ready
   * when nothing is open and the Definition of Ready is met. A re-refine (`focused` non-empty)
   * looks only at Andy's answered gaps: it fills nothing and acts on at most one new gap.
   */
  private async applyGaps(
    run: Run,
    ticket: Ticket,
    output: RefineOutput,
    focused: Assumption[],
  ): Promise<RefineApplied> {
    const refocus = focused.length > 0;
    const gaps = refocus ? output.gaps.slice(0, 1) : output.gaps;
    const plan = planGaps(gaps, await this.room(ticket, run.id));
    const at = this.now().toISOString();
    const assumptions = plan.assumptions.map(({ gap, demotedBy }, i): Assumption => ({
      id: `${run.id}-a${i + 1}`,
      text: gap.assumption,
      question: gap.question,
      options: gap.options.map((o) => o.label),
      ...formatOf(gap),
      cost: gap.cost,
      confidence: gap.confidence,
      demotedBy,
      runId: run.id,
      status: "assumed",
      questionId: null,
      answeredAt: null,
      settledBy: null,
      createdAt: at,
    }));
    const settled = new Set(focused.map((a) => a.id));
    const refineAssumptions = [
      ...ticket.refineAssumptions.map((a) =>
        settled.has(a.id) ? { ...a, status: "settled" as const, settledBy: run.id } : a,
      ),
      ...assumptions.filter((a) => !ticket.refineAssumptions.some((b) => b.id === a.id)),
    ];
    if (plan.questions.length > 0) {
      await this.tracker.askQuestions(
        ticket.projectId,
        ticket.id,
        plan.questions.map(toQuestion),
        `agent:${run.id}`,
        run.id,
      );
    }
    const fills = refocus ? {} : refineFills(ticket, output);
    const open = (await this.tracker.listQuestions({ ticketId: ticket.id, status: "open" })).length;
    const dor = checkDor({ ...ticket, ...fills, refineAssumptions }, open);
    const toReady = open === 0 && dor.met;
    // Nothing to ask and still not ready: another run would learn nothing new, so Andy decides.
    const needsAttention = open > 0 || !toReady;
    await this.tracker.updateTicket(
      ticket.projectId,
      ticket.id,
      {
        fields: {
          ...fills,
          refineAssumptions,
          needsAttention,
          dorStatus: dor.met ? "met" : "not_met",
        },
        ...(toReady
          ? {
              stage: { to: "ready" as const, forced: false, reason: "Refine found nothing to ask" },
            }
          : {}),
      },
      "system",
    );
    const notices = [capNotice(assumptions)];
    if (open === 0 && !dor.met) {
      notices.push(`The Definition of Ready still misses: ${dor.missing.join(", ")}.`);
    }
    if (assumptions.length > 0) notices.push(`Recorded ${assumptions.length} assumption(s).`);
    const notice = notices.filter(Boolean).join("\n\n");
    return { summary: output.summary, asked: plan.questions.length, ...(notice ? { notice } : {}) };
  }

  /**
   * Asks a ticket's held gaps (AI-75, ADR-0087) as far as the caps allow now; the refine
   * dispatcher calls it on every dispatch event, so there is no timer. It claims first: the
   * ticket write (with `ifUpdatedAt`) marks each gap `promoted` with a question id derived from
   * `<assumption id>-h<try>`, so of two overlapping events only one wins, and only then asks. A
   * claim whose ask was lost (a crash) is asked on the next call with the same id; asking is
   * idempotent per id. The questions count against the daily cap like refine's own. Returns how
   * many it claimed or re-asked.
   */
  async askHeld(ticket: Ticket): Promise<number> {
    if (ticket.stage !== "backlog" || ticket.upNextRank === null) return 0;
    const mine = await this.tracker.listQuestions({ ticketId: ticket.id });
    const exists = new Set(mine.map((q) => q.id));
    // Claimed earlier, never asked: re-ask with the claimed id, no new slot.
    const lost = ticket.refineAssumptions.filter(
      (a) =>
        a.status === "promoted" &&
        a.questionId !== null &&
        a.questionId.startsWith(`${a.id}-h`) &&
        !exists.has(a.questionId),
    );
    const claims = await this.claimHeld(ticket, mine, lost.length);
    const asking = [...lost, ...claims];
    for (const a of asking) {
      const runId = a.questionId!.replace(/-q1$/, "");
      await this.tracker.askQuestions(
        ticket.projectId,
        ticket.id,
        [assumptionQuestion(a)],
        "system",
        runId,
      );
    }
    if (asking.length > 0) {
      log("INFO", "held gaps asked", {
        ticket: ticket.key,
        claimed: claims.length,
        reasked: lost.length,
      });
    }
    return asking.length;
  }

  /**
   * Marks as many held gaps `promoted` as the caps allow, in one conditional write. `pending`
   * claims (asked in this call, not yet stored) take their slots first.
   */
  private async claimHeld(
    ticket: Ticket,
    mine: readonly Question[],
    pending: number,
  ): Promise<Assumption[]> {
    const held = heldGaps(ticket);
    if (held.length === 0) return [];
    const room = await this.room(ticket, null);
    const slots =
      Math.min(
        MAX_OPEN_QUESTIONS_PER_TICKET - room.openOnTicket,
        room.dailyCap - room.openedToday,
      ) - pending;
    if (slots <= 0) return [];
    const claimed = new Map<string, string>();
    for (const a of held.slice(0, slots)) {
      // Each try gets its own id: a withdrawn one (the ticket left Up next) keeps its id.
      const tries = mine.filter((q) => q.runId?.startsWith(`${a.id}-h`)).length;
      claimed.set(a.id, runQuestionId(`${a.id}-h${tries + 1}`, 0));
    }
    const refineAssumptions = ticket.refineAssumptions.map((a) =>
      claimed.has(a.id) ? { ...a, status: "promoted" as const, questionId: claimed.get(a.id)! } : a,
    );
    try {
      await this.tracker.updateTicket(
        ticket.projectId,
        ticket.id,
        {
          fields: { needsAttention: true, dorStatus: "not_met", refineAssumptions },
          ifUpdatedAt: ticket.updatedAt,
        },
        "system",
      );
    } catch (err) {
      if (!(err instanceof WorkTrackerError && err.code === "conflict")) throw err;
      // Another event or edit got there first; the next dispatch event looks again.
      log("INFO", "held gaps not claimed: the ticket changed", { ticket: ticket.key });
      return [];
    }
    return refineAssumptions.filter((a) => claimed.has(a.id));
  }

  /** How much room the caps leave, not counting this run's own questions (a replay). */
  private async room(ticket: Ticket, runId: string | null): Promise<CapRoom> {
    const [project, questions] = await Promise.all([
      this.tracker.getProject(ticket.projectId),
      this.tracker.listQuestions({ projectId: ticket.projectId }),
    ]);
    const others = runId === null ? questions : questions.filter((q) => q.runId !== runId);
    const since = new Date(this.now().getTime() - QUESTION_CAP_WINDOW_MS).toISOString();
    return {
      openOnTicket: others.filter((q) => q.ticketId === ticket.id && isOpen(q)).length,
      // Refine's own questions: one Andy asked or promoted is his to spend.
      openedToday: others.filter((q) => q.runId !== null && q.createdAt >= since).length,
      dailyCap: project?.dailyQuestionCap ?? 0,
    };
  }

  private async write(ticket: Ticket, fields: TicketFields): Promise<void> {
    await this.tracker.updateTicket(ticket.projectId, ticket.id, { fields }, "system");
  }
}

const isOpen = (q: { status: string }) => q.status === "open";

/** An assumption as a question, in the words refine wrote for it (ADR-0075, AI-73). */
export function assumptionQuestion(a: Assumption): NewQuestion {
  return {
    text: a.question,
    options: a.options,
    suggestedAnswer: a.recommendation?.answer ?? a.text.slice(0, REFINE_LIMITS.option),
    assumptions: [a.text],
    context: a.context,
    choices: a.choices,
    recommendation: a.recommendation,
  };
}

/** Plain words for the cap that holds a gap (status line, notices). */
export const CAP_WORDS: Record<DemotedBy, string> = {
  daily_cap: "the project's daily question cap",
  ticket_cap: "the limit of questions per ticket",
};

function capNotice(assumptions: Assumption[]): string {
  const demoted = assumptions.filter((a) => a.demotedBy);
  if (demoted.length === 0) return "";
  const which =
    CAP_WORDS[demoted.some((a) => a.demotedBy === "daily_cap") ? "daily_cap" : "ticket_cap"];
  const held = heldGaps({ refineAssumptions: demoted }).length;
  const holds =
    held > 0
      ? ` ${held} of them would be costly to get wrong, so the ticket waits: each is asked when the cap allows, or promote or accept it.`
      : "";
  return `Reached ${which}: ${demoted.length} gap(s) became assumptions. Promote one to ask about it.${holds}`;
}
