import {
  ADR_NUMBER_MAX,
  TicketKey,
  type AdrHold,
  type CodeHost,
  type EventActor,
  type WorkTracker,
} from "@andy/contracts";
import { adrLabel, highestAdrNumber } from "./dispatch-conflicts";
import { DomainError } from "./errors";
import { requireCan } from "./permissions";

/**
 * One ADR-number sequence for build runs and sessions (AI-384, ADR-0080). Both draw from the
 * project's counter (`WorkTracker.reserveAdrNumber` / `holdAdrNumber`), always above the highest
 * `NNNN-*.md` on the default branch, so neither gets a number the other has or one whose file
 * is on main. Numbers are never reissued: one that is never used is a gap, like 0161.
 */

/** Where a repo keeps its ADRs (`NNNN-*.md`); numbers are reserved above them (ADR-0080, ADR-0104). */
export const ADR_DIR = "docs/architecture/adr";

/**
 * Caps on sessions' holds (ADR-0028). 5 per ticket: a ticket rarely needs more than two ADRs, and
 * it bounds a session that loops. 20 per project: four times the sessions that run at once today,
 * and it keeps the counter document small. Holds expire after 7 days, longer than a ticket's PR
 * usually stays open; its merge or close releases them sooner.
 */
export const ADR_HOLDS_PER_TICKET = 5;
export const ADR_HOLDS_PER_PROJECT = 20;
export const ADR_HOLD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The highest ADR number on the repo's default branch, read the way build runs read it: one
 * repo read and one folder listing, no cache. Null when the repo, the folder or any `NNNN-*.md`
 * is missing.
 */
export async function highestAdrOnDefaultBranch(
  codeHost: Pick<CodeHost, "getRepo" | "listFiles">,
  repo: string,
): Promise<number | null> {
  const info = await codeHost.getRepo(repo);
  const files = info ? await codeHost.listFiles(repo, ADR_DIR, info.defaultBranch) : null;
  return files === null ? null : highestAdrNumber(files);
}

export interface AdrReservation {
  ticket: string;
  number: number;
  /** "ADR-0166" */
  label: string;
  expiresAt: string;
}

export class AdrNumbers {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly codeHost: Pick<CodeHost, "getRepo" | "listFiles"> | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * A session's ADR number for a ticket (MCP `reserve_adr_number`), owner only. The ticket key is
   * the holder: its PR merging or closing releases the hold (`PullRequestTickets`).
   */
  async reserveForTicket(actor: EventActor, key: string): Promise<AdrReservation> {
    requireCan(actor, "reserve_adr_number", null);
    const ticket = TicketKey.safeParse(key).success
      ? await this.tracker.getTicketByKey(key.slice(0, key.lastIndexOf("-")).toLowerCase(), key)
      : null;
    if (!ticket) throw new DomainError("invalid_reference", `no ticket ${key}`);
    const project = await this.tracker.getProject(ticket.projectId);
    const repo = project?.repos[0];
    if (!project || !repo) {
      throw new DomainError("invalid_repo", `project ${ticket.projectId} has no repo`);
    }
    if (!this.codeHost) throw new DomainError("code_host_unavailable", "GitHub is not connected");
    const highest = await this.highest(repo);
    if (highest >= ADR_NUMBER_MAX) {
      throw new DomainError("reservation_limit", `${repo} has used every ADR number`);
    }

    const now = this.now();
    const result = await this.tracker.holdAdrNumber(project.id, highest, {
      holder: ticket.key,
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + ADR_HOLD_TTL_MS).toISOString(),
      perHolder: ADR_HOLDS_PER_TICKET,
      perProject: ADR_HOLDS_PER_PROJECT,
    });
    if (!result.ok) throw refusal(ticket.key, project.key, result.reason, result.open);
    const { hold } = result;
    if (hold.number > ADR_NUMBER_MAX) {
      throw new DomainError("reservation_limit", `${repo} has used every ADR number`);
    }
    log("INFO", "ADR number reserved", { ticket: ticket.key, number: hold.number });
    return {
      ticket: ticket.key,
      number: hold.number,
      label: adrLabel(hold.number),
      expiresAt: hold.expiresAt,
    };
  }

  private async highest(repo: string): Promise<number> {
    let highest: number | null;
    try {
      highest = await highestAdrOnDefaultBranch(this.codeHost!, repo);
    } catch (err) {
      log("WARNING", "ADR folder not listed", { repo, error: String(err) });
      throw new DomainError("code_host_unavailable", `couldn't list ${ADR_DIR} in ${repo}`);
    }
    if (highest === null) {
      throw new DomainError(
        "invalid_repo",
        `${repo} has no ${ADR_DIR}/NNNN-*.md on its default branch to number above`,
      );
    }
    return highest;
  }
}

function refusal(
  key: string,
  projectKey: string,
  reason: "holder_cap" | "project_cap",
  open: AdrHold[],
): DomainError {
  const message =
    reason === "holder_cap"
      ? `${key} already holds ${ADR_HOLDS_PER_TICKET} ADR numbers, the cap; they free up when its PR merges or closes, or after 7 days`
      : `project ${projectKey} has ${ADR_HOLDS_PER_PROJECT} ADR numbers held open, the cap; they free up as their PRs merge or close, or after 7 days`;
  log("WARNING", "ADR number refused", { ticket: key, reason });
  return new DomainError(
    "reservation_limit",
    message,
    open.map((h) => `${adrLabel(h.number)} for ${h.holder} until ${h.expiresAt}`),
  );
}

function log(severity: "INFO" | "WARNING", message: string, fields: object) {
  console.log(JSON.stringify({ severity, message, component: "adr-numbers", ...fields }));
}
