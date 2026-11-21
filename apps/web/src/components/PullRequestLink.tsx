import { ExternalLink } from "lucide-react";
import { PullRequestLink as PullRequestLinkData, type TicketEvent } from "@andy/contracts";

/**
 * AI-194: M7.15: Gated PRs from the phone (ADR-0115 Q5, option a). A ticket whose PR is open,
 * so waiting for Andy, links to it on github.com; on an iPhone with the GitHub app, iOS opens it
 * there, where Andy reviews and merges as himself. No merge from this app, no App token.
 */

/** Only a pull request page on github.com: the URL comes from a webhook, so it is checked. */
const GITHUB_PR = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/\d+$/;

/** The newest linked PR's URL while it is open; null when none is linked, or it closed or merged. */
export function waitingPullRequest(
  events: readonly TicketEvent[],
): { number: number; url: string } | null {
  const e = events.findLast((e) => e.kind === "pr_linked");
  const pr = PullRequestLinkData.safeParse(e?.data);
  if (!pr.success || pr.data.state !== "open" || !GITHUB_PR.test(pr.data.url)) return null;
  return { number: pr.data.number, url: pr.data.url };
}

export function PullRequestLink({ events }: { events: readonly TicketEvent[] }) {
  const pr = waitingPullRequest(events);
  if (!pr) return null;
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">PR #{pr.number} waits for you</span>
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 font-medium hover:bg-muted sm:min-h-8"
      >
        Open in GitHub
        <ExternalLink aria-hidden className="size-4" />
      </a>
    </p>
  );
}
