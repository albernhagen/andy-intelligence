import type { NightLaunch, NightLaunchStore, Ticket, WorkTracker } from "@andy/contracts";

/**
 * While unattended (ADR-0049, AI-123): a ticket covered by a running night launch gets no new
 * questions (the refine gate records them as night assumptions, see `RefineGate`), and a story
 * whose run fails for good or whose PR is vetoed stops for the night. Its dependants in the
 * launch are skipped: they wait on it through `blockedBy` (the build dispatcher starts a ticket
 * only when every blocker is Done), and the launch lists them for the morning. The other stories
 * go on. Once the launch ends, nothing here applies.
 */

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "night-unattended", ...fields }));
}

/**
 * Launch stories that wait on `stoppedKey`, directly or through any other ticket (in the launch
 * or not), in launch order. Only launch stories are reported; a chain may pass through others.
 */
export function launchDependants(
  storyKeys: readonly string[],
  tickets: readonly Pick<Ticket, "key" | "blockedBy">[],
  stoppedKey: string,
): string[] {
  const waiting = new Set<string>([stoppedKey]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tickets) {
      if (waiting.has(t.key)) continue;
      if (t.blockedBy.some((b) => waiting.has(b))) {
        waiting.add(t.key);
        grew = true;
      }
    }
  }
  return storyKeys.filter((k) => k !== stoppedKey && waiting.has(k));
}

export class NightUnattended {
  constructor(
    private readonly store: NightLaunchStore,
    private readonly tracker: WorkTracker,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The running launch that covers `ticket`, or null (no launch, or it is stopping or ended). */
  async coveringLaunch(ticket: Pick<Ticket, "projectId" | "key">): Promise<NightLaunch | null> {
    const launch = await this.store.findActive(ticket.projectId);
    return launch?.status === "running" && launch.storyKeys.includes(ticket.key) ? launch : null;
  }

  /**
   * Stops `ticketId` for the night when a running launch covers it: records it on the launch
   * with its skipped dependants and comments the reason on the ticket. Null when no launch covers
   * it. Logs, never throws: the caller has already flagged the ticket Needs-you.
   */
  async stopStory(projectId: string, ticketId: string, reason: string) {
    try {
      const ticket = await this.tracker.getTicket(projectId, ticketId);
      if (!ticket) return null;
      const launch = await this.coveringLaunch(ticket);
      if (!launch) return null;
      if (launch.stoppedStories.some((s) => s.key === ticket.key)) return launch;
      const tickets = await this.tracker.listTickets(projectId);
      const skipped = launchDependants(launch.storyKeys, tickets, ticket.key);
      const text = reason.replace(/\s+/g, " ").trim().slice(0, 500) || "stopped";
      const stopped = await this.store.stopStory(launch.id, {
        key: ticket.key,
        reason: text,
        at: this.now().toISOString(),
        skipped,
      });
      await this.tracker.addComment(
        projectId,
        ticket.id,
        `Stopped for the night (launch ${launch.id}): ${text}${
          skipped.length > 0
            ? ` Its dependants in the launch are skipped: ${skipped.join(", ")}.`
            : ""
        } The other stories go on.`,
        "system",
      );
      log("WARNING", "night story stopped", {
        launchId: launch.id,
        ticket: ticket.key,
        skipped,
      });
      return stopped;
    } catch (err) {
      log("ERROR", "night story stop not recorded", {
        projectId,
        ticketId,
        error: String(err),
      });
      return null;
    }
  }
}
