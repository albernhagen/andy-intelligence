import {
  AGENT_CONFIG_ENTITY,
  CONFIG_PROPOSAL_MAX_EXAMPLES,
  CONFIG_PROPOSAL_MAX_PRS,
  ConfigChange,
  FindingProposalDiff,
  pullKey,
  type ConfigChangeStatus,
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
 * the project's `AGENTS.md`. Nothing here applies a change: Andy accepts (M4 config editing) or
 * rejects it. Finding text is untrusted (an agent wrote it after reading PR content): only the
 * kind slug and PR numbers shape the proposal; titles appear as quoted, flattened examples.
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
  /** Changes one list returns. */
  maxList: 50,
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

/** Untrusted text as one short plain line: no control characters, markup, mentions or code. */
export function flattenUntrusted(text: string, max: number): string {
  const flat = text
    .replace(/[\p{Cc}\p{Cf}<>`@\\|]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The pure rule: groups findings by kind over distinct PRs and proposes one change per kind
 * seen on `minPulls`+ PRs, most widespread first, at most `maxNewPerSweep`.
 */
export function proposeFromFindings(
  projectId: string,
  findings: readonly ReviewFinding[],
  limits: ConfigProposalLimits = CONFIG_PROPOSAL_LIMITS,
): FindingProposal[] {
  const byKind = new Map<string, Map<string, ReviewFinding>>();
  for (const f of findings) {
    if (f.projectId !== projectId) continue;
    const pulls = byKind.get(f.kind) ?? new Map<string, ReviewFinding>();
    // The first finding seen per PR is its example; callers pass findings newest first.
    if (!pulls.has(pullKey(f))) pulls.set(pullKey(f), f);
    byKind.set(f.kind, pulls);
  }
  return [...byKind.entries()]
    .filter(([, pulls]) => pulls.size >= limits.minPulls)
    .sort(([ka, a], [kb, b]) => b.size - a.size || ka.localeCompare(kb))
    .slice(0, limits.maxNewPerSweep)
    .map(([kind, pulls]) => proposal(projectId, kind, [...pulls.values()], limits.exampleChars));
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

/** Sweeps for proposals, lists them, and records Andy's reject. Never applies a change. */
export class ConfigProposals {
  constructor(
    private readonly tracker: Pick<WorkTracker, "getProject">,
    private readonly findings: ReviewFindingSource,
    private readonly changes: ConfigChangeStore,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly limits: ConfigProposalLimits = CONFIG_PROPOSAL_LIMITS,
  ) {}

  /** Reads the project's recent findings and writes a pending proposal per repeated kind. */
  async sweep(projectId: string): Promise<ConfigProposalSweep> {
    if (!(await this.tracker.getProject(projectId))) {
      throw new DomainError("invalid_reference", `project ${projectId} not found`);
    }
    const findings = await this.findings.recent(projectId, {
      maxPulls: this.limits.recentPulls,
      maxFindings: this.limits.maxFindings,
    });
    const proposals = proposeFromFindings(projectId, findings, this.limits);
    const pending = await this.changes.list({
      projectId,
      status: "pending",
      limit: this.limits.maxPendingPerProject,
    });
    const pendingByKey = new Map(pending.map((c) => [c.dedupeKey, c.id]));
    let free = this.limits.maxPendingPerProject - pending.length;
    const result: ConfigProposalSweep = {
      projectId,
      findingsRead: findings.length,
      created: [],
      alreadyPending: [],
      heldByCap: 0,
    };
    for (const p of proposals) {
      const existingId = pendingByKey.get(p.dedupeKey);
      if (existingId) {
        result.alreadyPending.push(existingId);
        continue;
      }
      if (free <= 0) {
        result.heldByCap += 1;
        continue;
      }
      const { created, change } = await this.changes.createPending(
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
      );
      if (created) {
        result.created.push(change.id);
        free -= 1;
      } else {
        result.alreadyPending.push(change.id);
      }
    }
    log("config proposal sweep", { ...result });
    return result;
  }

  async list(filter: { projectId?: string; status?: ConfigChangeStatus }): Promise<ConfigChange[]> {
    return this.changes.list({ ...filter, limit: this.limits.maxList });
  }

  /** Andy's reject (owner only). `invalid_reference` when unknown; a decided change: conflict. */
  async reject(id: string, actor: EventActor): Promise<ConfigChange> {
    const change = await this.changes.get(id);
    if (!change) throw new DomainError("invalid_reference", `config change ${id} not found`);
    requireCan(actor, "decide_config_change", change.projectId);
    const rejected = await this.changes.reject(id, actor, this.now().toISOString());
    log("config change rejected", { id, projectId: change.projectId, actor });
    return rejected;
  }
}
