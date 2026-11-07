import { useState } from "react";
import type { Run, TicketEvent } from "@andy/contracts";
import { Markdown } from "@/components/Markdown";
import { RunItem, StartRuns, latestPlanId } from "@/components/Runs";
import { useUnsavedDraft } from "@/components/InlineEdit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { QueryError } from "@/components/Status";
import { useAddComment } from "@/lib/queries";
import { describeEvent, timeline } from "@/lib/tickets";

/** Events whose body is untrusted prose (comments, question text): rendered as markdown. */
const MARKDOWN_BODIES = new Set<TicketEvent["kind"]>(["comment", "question_asked"]);

/**
 * The ticket's one activity timeline (ADR-0059): history events, comments and runs, oldest
 * first, with the comment box and the buttons that start a run.
 */
export function Activity(props: {
  projectId: string;
  ticketId: string;
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
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Activity</h3>
        <StartRuns path={path} runs={props.runs} />
      </div>
      <ol className="space-y-2">
        {timeline(props.events, props.runs).map((item) =>
          item.kind === "run" ? (
            <RunItem
              key={item.run.id}
              run={item.run}
              path={path}
              decidable={item.run.id === planId}
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
        <Button type="submit" size="sm" disabled={!body.trim() || comment.isPending}>
          Comment
        </Button>
      </form>
    </section>
  );
}

function EventItem({ event: e }: { event: TicketEvent }) {
  return (
    <li className="space-y-1 border-l-2 border-border pl-3 text-sm">
      <p>
        <span className="font-medium">{e.actor}</span> {describeEvent(e)}{" "}
        <time dateTime={e.createdAt} className="text-xs text-muted-foreground">
          {new Date(e.createdAt).toLocaleString()}
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
