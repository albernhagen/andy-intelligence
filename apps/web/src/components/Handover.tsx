import { Link } from "@tanstack/react-router";
import type { DigestHandover, DigestNextUpItem, DigestOpenPr } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";

/**
 * The digest's handover (AI-385): each open PR with why it waits, from the merge gate's recorded
 * verdict, and the Ready tickets the dispatcher would take next, with why any is skipped and why
 * nothing more starts. The same sections MCP `digest` returns. PR and ticket text is untrusted:
 * rendered as plain text, and a PR links out only when it is a github.com pull request.
 */
export function Handover({ handover, projectId }: { handover: DigestHandover; projectId: string }) {
  return (
    <>
      {handover.openPrs.length > 0 && (
        <section aria-label="Open PRs" className="space-y-2 rounded-lg border bg-raised p-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            Open PRs
            <Badge className="tabular-nums">{handover.openPrs.length}</Badge>
          </h3>
          <ul className="space-y-2.5 text-sm">
            {handover.openPrs.map((pr) => (
              <OpenPrRow key={pr.prUrl} pr={pr} projectId={projectId} />
            ))}
          </ul>
          {handover.openPrsTruncated && <CutShort what="open PRs" />}
        </section>
      )}
      <section aria-label="Next up" className="space-y-2 rounded-lg border bg-raised p-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          Next up
          <Badge className="tabular-nums">{handover.nextUp.length}</Badge>
        </h3>
        {handover.nextUp.length > 0 && (
          <ol className="space-y-1.5 text-sm">
            {handover.nextUp.map((item) => (
              <NextUpRow key={item.ticketKey} item={item} projectId={projectId} />
            ))}
          </ol>
        )}
        {handover.nextUpTruncated && <CutShort what="Ready tickets" />}
        <p className="text-sm text-muted-foreground">{handover.idle}</p>
      </section>
    </>
  );
}

const GITHUB_PR = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/\d+$/;

const PR_STATE: Record<
  DigestOpenPr["state"],
  { label: string; variant: "attention" | "running" | "default" }
> = {
  waiting: { label: "Waits", variant: "attention" },
  merging: { label: "Merging", variant: "running" },
  not_judged: { label: "Not judged", variant: "default" },
};

function OpenPrRow({ pr, projectId }: { pr: DigestOpenPr; projectId: string }) {
  const state = PR_STATE[pr.state];
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <TicketLink projectId={projectId} ticketKey={pr.ticketKey} title={pr.title} />
        {GITHUB_PR.test(pr.prUrl) ? (
          <a
            href={pr.prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground tabular-nums underline-offset-2 hover:underline"
          >
            PR #{pr.prNumber}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">PR #{pr.prNumber}</span>
        )}
        <Badge variant={state.variant}>{state.label}</Badge>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
        {pr.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </li>
  );
}

const NEXT_STATE: Record<
  DigestNextUpItem["status"],
  { label: string; variant: "success" | "default" | "attention" }
> = {
  starts_now: { label: "Starts now", variant: "success" },
  next: { label: "Next", variant: "default" },
  skipped: { label: "Skipped", variant: "attention" },
};

function NextUpRow({ item, projectId }: { item: DigestNextUpItem; projectId: string }) {
  const state = NEXT_STATE[item.status];
  return (
    <li className="space-y-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Badge variant={state.variant}>{state.label}</Badge>
        <TicketLink projectId={projectId} ticketKey={item.ticketKey} title={item.title} />
      </div>
      {item.reason && <p className="text-muted-foreground">{item.reason}</p>}
    </li>
  );
}

function CutShort({ what }: { what: string }) {
  return <p className="text-xs text-muted-foreground">List cut short: more {what} than shown.</p>;
}

function TicketLink(props: { projectId: string; ticketKey: string; title: string }) {
  return (
    <Link
      to="/p/$projectId/t/$ticketRef"
      params={{ projectId: props.projectId, ticketRef: props.ticketKey }}
      className="underline-offset-2 hover:underline"
    >
      <span className="text-xs text-muted-foreground tabular-nums">{props.ticketKey}:</span>{" "}
      {props.title}
    </Link>
  );
}
