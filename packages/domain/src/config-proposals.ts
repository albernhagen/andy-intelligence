import {
  AGENT_CONFIG_ENTITY,
  CONFIG_PROPOSAL_MAX_EXAMPLES,
  CONFIG_PROPOSAL_MAX_PRS,
  ConfigChange,
  FindingProposalDiff,
  pullKey,
  type ConfigChangeDecision,
  type ConfigChangeStore,
  type ConfigProposalSweep,
  type EventActor,
  type ReviewFinding,
  type ReviewFindingSource,
  type WorkTracker,
} from "@andy/contracts";
import { DomainError } from "./errors";
import { requireCan } from "./permissions";

/**
 * Repeated review findings become a pending ConfigChange (ADR-0040 row 5, ADR-0097): a finding
 * kind seen on `minPulls` or more of a project's recent PRs yields one proposal to add a rule to
 * the project's `AGENTS.md`. Nothing here applies a change: Andy accepts or rejects it, and
 * applying an accepted one is M4 config editing. Finding text is untrusted (an agent wrote it after reading PR content): only the
 * kind slug and PR numbers shape the proposal; titles appear as flattened examples.
 */

/** Caps and the threshold (ADR-0028; the ticket's assumption: 3 PRs). */
export const CONFIG_PROPOSAL_LIMITS = {
  /** A kind must appear on this many distinct PRs. */
  minPulls: 3,
  /** Only the project's most recently reviewed PRs count. */
  recentPulls: 20,
  /** Findings read per sweep. */
  maxFindings: 500,
  /** New proposals one sweep writes. */
  maxNewPerSweep: 5,
  /** Pending proposals per project; a sweep writes none past it. */
  maxPendingPerProject: 10,
  /** Characters kept of each example title. */
  exampleChars: 120,
  /** A project's sweeps are this far apart at least, per instance (max 2 instances). */
  minSweepIntervalMs: 60_000,
  /** Kinds per sweep whose last decision is looked up (one read each). */
  maxDecisionLookups: 20,
} as const;

export type ConfigProposalLimits = { [K in keyof typeof CONFIG_PROPOSAL_LIMITS]: number };

/** The file proposals target in the project's repo (v1: always the agent rules). */
export const PROPOSAL_TARGET_FILE = "AGENTS.md";

export interface FindingProposal {
  dedupeKey: string;
  diff: FindingProposalDiff;
  reason: string;
}

/** One pending proposal per project, target file and kind. */
export function proposalKey(projectId: string, file: string, kind: string): string {
  return `review-findings:${projectId}:${file}:${kind}`;
}

/** URLs and bare `www.` hosts, removed from untrusted text before anything else. */
const URL_LIKE = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/giu;
/** Everything but letters, digits, spaces and plain punctuation: no markup survives. */
const NOT_PLAIN = /[^\p{L}\p{N} .,:;'?%+/-]/gu;

/**
 * Untrusted text as one short plain line: URLs become "link removed"; then every character
 * outside a small allow-list (letters, digits, spaces, `. , : ; ' ? % + / -`) becomes a space,
 * so no Markdown (links, emphasis, headings, code, quotes), HTML, mention or control character
 * reaches proposed text.
 */
export function flattenUntrusted(text: string, max: number): string {
  const flat = text
    .replace(URL_LIKE, " link removed ")
    .replace(NOT_PLAIN, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The pure rule: groups findings by kind over distinct PRs and proposes one change per kind
 * seen on `minPulls`+ PRs, most widespread first, at most `maxNewPerSweep`. `decidedAt` maps a
 * kind to Andy's last decision on its proposal: only findings recorded after it count, so an
 * accepted or rejected kind comes back only when it recurs on `minPulls` new PRs.
 */
export function proposeFromFindings(
  projectId: string,
  findings: readonly ReviewFinding[],
  limits: ConfigProposalLimits = CONFIG_PROPOSAL_LIMITS,
  decidedAt: ReadonlyMap<string, string> = new Map(),
): FindingProposal[] {
  return [...pullsByKind(projectId, findings, decidedAt).entries()]
    .filter(([, pulls]) => pulls.size >= limits.minPulls)
    .sort(([ka, a], [kb, b]) => b.size - a.size || ka.localeCompare(kb))
    .slice(0, limits.maxNewPerSweep)
    .map(([kind, pulls]) => proposal(projectId, kind, [...pulls.values()], limits.exampleChars));
}

/** Kinds seen on `minPulls`+ distinct PRs, ignoring decisions: the ones worth a decision lookup. */
export function repeatedKinds(
  projectId: string,
  findings: readonly ReviewFinding[],
  minPulls: number,
): string[] {
  return [...pullsByKind(projectId, findings, new Map()).entries()]
    .filter(([, pulls]) => pulls.size >= minPulls)
    .map(([kind]) => kind)
    .sort();
}

function pullsByKind(
  projectId: string,
  findings: readonly ReviewFinding[],
  decidedAt: ReadonlyMap<string, string>,
): Map<string, Map<string, ReviewFinding>> {
  const byKind = new Map<string, Map<string, ReviewFinding>>();
  for (const f of findings) {
    if (f.projectId !== projectId) continue;
    const decided = decidedAt.get(f.kind);
    if (decided !== undefined && Date.parse(f.recordedAt) <= Date.parse(decided)) continue;
    const pulls = byKind.get(f.kind) ?? new Map<string, ReviewFinding>();
    // The first finding seen per PR is its example; callers pass findings newest first.
    if (!pulls.has(pullKey(f))) pulls.set(pullKey(f), f);
    byKind.set(f.kind, pulls);
  }
  return byKind;
}

function proposal(
  projectId: string,
  kind: string,
  perPull: ReviewFinding[],
  exampleChars: number,
): FindingProposal {
  const pulls = perPull
    .slice(0, CONFIG_PROPOSAL_MAX_PRS)
    .map((f) => ({ repo: f.repo, number: f.pullNumber }));
  const examples = perPull
    .map((f) => flattenUntrusted(f.title, exampleChars))
    .filter((t) => t.length > 0)
    .slice(0, CONFIG_PROPOSAL_MAX_EXAMPLES);
  const refs = pulls.map((p) => `${p.repo}#${p.number}`).join(", ");
  const proposedText = [
    `## Review lesson: ${kind}`,
    "",
    `PR reviews flagged \`${kind}\` findings on ${perPull.length} recent PRs (${refs}). Before opening a PR, check the change for this kind of problem and fix it first.`,
    ...(examples.length > 0
      ? ["", "Examples (reviewer text, unverified):", ...examples.map((e) => `- "${e}"`)]
      : []),
  ].join("\n");
  return {
    dedupeKey: proposalKey(projectId, PROPOSAL_TARGET_FILE, kind),
    diff: FindingProposalDiff.parse({
      file: PROPOSAL_TARGET_FILE,
      kind,
      proposedText,
      pulls,
      examples,
    }),
    reason: `Review finding kind "${kind}" appeared on ${perPull.length} of the project's recent PRs.`,
  };
}

function log(message: string, fields: Record<string, unknown>) {
  console.log(
    JSON.stringify({ severity: "INFO", message, component: "config-proposals", ...fields }),
  );
}

/** Sweeps for proposals, lists pending ones, and records Andy's decision. Never applies one. */
export class ConfigProposals {
  private readonly lastSweep = new Map<string, number>();

  constructor(
    private readonly tracker: Pick<WorkTracker, "getProject">,
    private readonly findings: ReviewFindingSource,
    private readonly changes: ConfigChangeStore,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly limits: ConfigProposalLimits = CONFIG_PROPOSAL_LIMITS,
  ) {}

  /**
   * Reads the project's recent findings and writes a pending proposal per repeated kind. A
   * second sweep of the project within `minSweepIntervalMs` reads nothing (`throttled`).
   */
  async sweep(projectId: string): Promise<ConfigProposalSweep> {
    if (!(await this.tracker.getProject(projectId))) {
      throw new DomainError("invalid_reference", `project ${projectId} not found`);
    }
    const result: ConfigProposalSweep = {
      projectId,
      throttled: false,
      findingsRead: 0,
      created: [],
      alreadyPending: [],
      heldByCap: 0,
    };
    const nowMs = this.now().getTime();
    const last = this.lastSweep.get(projectId);
    if (last !== undefined && nowMs - last < this.limits.minSweepIntervalMs) {
      return { ...result, throttled: true };
    }
    this.lastSweep.set(projectId, nowMs);

    const findings = await this.findings.recent(projectId, {
      maxPulls: this.limits.recentPulls,
      maxFindings: this.limits.maxFindings,
    });
    result.findingsRead = findings.length;
    const decidedAt = await this.lastDecisions(projectId, findings);
    for (const p of proposeFromFindings(projectId, findings, this.limits, decidedAt)) {
      // The store checks duplicates and the pending cap in one transaction.
      const written = await this.changes.createPending(
        ConfigChange.parse({
          id: this.newId(),
          entity: AGENT_CONFIG_ENTITY,
          entityId: p.diff.file,
          diff: p.diff,
          actor: "agent",
          reason: p.reason,
          status: "pending",
          createdAt: this.now().toISOString(),
          appliedAt: null,
          projectId,
          dedupeKey: p.dedupeKey,
        }),
        this.limits.maxPendingPerProject,
      );
      if (written.outcome === "created") result.created.push(written.change.id);
      else if (written.outcome === "duplicate") result.alreadyPending.push(written.change.id);
      else result.heldByCap += 1;
    }
    log("config proposal sweep", { ...result });
    return result;
  }

  /**
   * When Andy last decided each repeated kind's proposal. Kinds past `maxDecisionLookups` (the
   * last by name) aren't looked up and are left out of this sweep, so a decided
   * kind is never re-proposed unread.
   */
  private async lastDecisions(
    projectId: string,
    findings: readonly ReviewFinding[],
  ): Promise<Map<string, string>> {
    const decidedAt = new Map<string, string>();
    const kinds = repeatedKinds(projectId, findings, this.limits.minPulls);
    for (const kind of kinds.slice(0, this.limits.maxDecisionLookups)) {
      const last = await this.changes.latestDecision(
        proposalKey(projectId, PROPOSAL_TARGET_FILE, kind),
      );
      if (last?.decidedAt) decidedAt.set(kind, last.decidedAt);
    }
    // Unlooked-up kinds: treated as decided now, so none of their findings count this sweep.
    for (const kind of kinds.slice(this.limits.maxDecisionLookups)) {
      decidedAt.set(kind, this.now().toISOString());
    }
    return decidedAt;
  }

  /** Every pending change (of one project when given), newest first. */
  async listPending(projectId?: string): Promise<ConfigChange[]> {
    if (projectId !== undefined && !(await this.tracker.getProject(projectId))) {
      throw new DomainError("invalid_reference", `project ${projectId} not found`);
    }
    return this.changes.listPending(projectId);
  }

  /**
   * Andy's accept or reject (owner only, under the project-settings rule: a config change is a
   * project setting). Accepting records agreement; it applies nothing (`appliedAt` stays null).
   * `invalid_reference` when unknown; a decided change: conflict.
   */
  async decide(
    id: string,
    decision: ConfigChangeDecision,
    actor: EventActor,
  ): Promise<ConfigChange> {
    const change = await this.changes.get(id);
    if (!change) throw new DomainError("invalid_reference", `config change ${id} not found`);
    requireCan(actor, "change_project_settings", change.projectId);
    const decided = await this.changes.decide(id, decision, actor, this.now().toISOString());
    log("config change decided", { id, projectId: change.projectId, decision, actor });
    return decided;
  }
}
