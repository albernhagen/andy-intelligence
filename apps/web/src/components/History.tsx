import { useState } from "react";
import type { TicketEvent } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { QueryError } from "@/components/Status";
import { useAddComment } from "@/lib/queries";
import { describeEvent } from "@/lib/tickets";

/** The ticket's append-only history, oldest first, with a comment box. */
export function History(props: { projectId: string; ticketId: string; events: TicketEvent[] }) {
  const comment = useAddComment({ projectId: props.projectId, ticketId: props.ticketId });
  const [body, setBody] = useState("");

  return (
    <section aria-label="History" className="space-y-3">
      <h3 className="text-sm font-medium">History</h3>
      <ol className="space-y-2">
        {props.events.map((e) => (
          <li key={e.id} className="border-l-2 border-border pl-3 text-sm">
            <p>
              <span className="font-medium">{e.actor}</span> {describeEvent(e)}{" "}
              <time dateTime={e.createdAt} className="text-muted-foreground">
                {new Date(e.createdAt).toLocaleString()}
              </time>
            </p>
            {e.body && <p className="whitespace-pre-wrap text-muted-foreground">{e.body}</p>}
          </li>
        ))}
      </ol>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          comment.mutate({ body: body.trim() }, { onSuccess: () => setBody("") });
        }}
      >
        <Textarea aria-label="Comment" value={body} onChange={(e) => setBody(e.target.value)} />
        {comment.error && <QueryError error={comment.error} />}
        <Button type="submit" size="sm" disabled={!body.trim() || comment.isPending}>
          Comment
        </Button>
      </form>
    </section>
  );
}
