import { useState } from "react";
import type { Run, Ticket, TicketEvent } from "@andy/contracts";
import { actorLabel } from "@andy/domain";
import { Markdown } from "@/components/Markdown";
import { RunItem, StartRuns, latestPlanId } from "@/components/Runs";
import { useUnsavedDraft } from "@/components/InlineEdit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { QueryError } from "@/components/Status";
import { useAddComment } from "@/lib/queries";
import { describeEvent, timeline } from "@/lib/tickets";
import { dateTime } from "@/lib/format";

/** Events whose body is untrusted prose (comments, question text): rendered as markdown. */
const MARKDOWN_BODIES = new Set<TicketEvent["kind"]>(["comment", "question_asked"]);

/**
 * The ticket's one activity timeline (ADR-0059): history events, comments and runs, oldest
 * first, with the comment box and the buttons that start a run.
 */
export function Activity(props: {
  projectId: string;
  ticketId: string;
  /** For a running build's branch and touches (AI-342); absent: they aren't shown. */
  ticket?: Pick<Ticket, "key">;
  events: TicketEvent[];
  runs: Run[];
}) {
  const path = { projectId: props.projectId, ticketId: props.ticketId };
  const planId = latestPlanId(props.runs);
  const comment = useAddComment(path);
  const [body, setBody] = useState("");
  useUnsavedDraft(body.trim() !== "");

  return (
    <section aria-label="Activity" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Activity</h3>
        <StartRuns path={path} runs={props.runs} />
      </div>
      <ol className="ml-1 space-y-3 border-l border-border py-1">
        {timeline(props.events, props.runs).map((item) =>
          item.kind === "run" ? (
            <RunItem
              key={item.run.id}
              run={item.run}
              path={path}
              decidable={item.run.id === planId}
              ticket={props.ticket}
            />
          ) : (
            <EventItem key={item.event.id} event={item.event} />
          ),
        )}
      </ol>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          comment.mutate({ body: body.trim() }, { onSuccess: () => setBody("") });
        }}
      >
        <Textarea
          aria-label="Comment"
          placeholder="Comment (markdown)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {comment.error && <QueryError error={comment.error} />}
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!body.trim() || comment.isPending}
        >
          Comment
        </Button>
      </form>
    </section>
  );
}

/** The timeline dot's colour (AI-375 mockup): comments and PRs stand out; the rest is quiet. */
function dotTone(kind: TicketEvent["kind"]): string {
  if (kind === "comment" || kind === "question_asked") return "bg-primary";
  if (kind === "pr_linked") return "bg-success";
  return "bg-border";
}

function EventItem({ event: e }: { event: TicketEvent }) {
  return (
    <li className="relative space-y-1 pl-4 text-sm wrap-anywhere">
      {/* A dot on the timeline's line; colour is never the only marker: the text says what. */}
      <span
        aria-hidden
        className={`absolute top-1.5 -left-[5px] size-2.5 rounded-full ring-2 ring-raised ${dotTone(e.kind)}`}
      />
      <p>
        <span className="font-medium">{actorLabel(e.actor)}</span> {describeEvent(e)}{" "}
        <time dateTime={e.createdAt} className="text-xs text-muted-foreground tabular-nums">
          {dateTime(e.createdAt)}
        </time>
      </p>
      {e.body &&
        (MARKDOWN_BODIES.has(e.kind) ? (
          <Markdown>{e.body}</Markdown>
        ) : (
          <p className="whitespace-pre-wrap text-muted-foreground">{e.body}</p>
        ))}
    </li>
  );
}
