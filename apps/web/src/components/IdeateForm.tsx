import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Run } from "@andy/contracts";
import { STATUS_VARIANT } from "@/components/Runs";
import { QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { isActiveRun, useRun, useStartIdeate } from "@/lib/queries";

/** IdeateTaskRequest's cap (IDEATE_LIMITS.idea). */
const IDEA_MAX = 4000;

/**
 * Ideate from the board (AI-299, parity with MCP `ideate`): Andy types an idea and starts an
 * ideate agent task (`POST …/ideate/agent-task`, AI-134). It reads the brief and records its
 * result as MCP `ideate` does: an epic in Ideas with a spec draft PR, or a ticket with one
 * question. The task's own summary or refusal shows here, as untrusted plain text.
 */
export function IdeateForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [idea, setIdea] = useState("");
  const start = useStartIdeate(projectId);

  if (start.data) return <IdeateProgress run={start.data} onClose={onClose} />;
  return (
    <form
      aria-label="Ideate"
      className="max-w-2xl space-y-2 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (idea.trim()) start.mutate(idea.trim());
      }}
    >
      <Field label="Idea">
        <Textarea
          name="idea"
          autoComplete="off"
          maxLength={IDEA_MAX}
          className="text-base sm:text-sm"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        An agent task reads the brief and turns the idea into an epic in Ideas with a spec draft PR,
        or asks you one question. It uses Claude quota.
      </p>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          className="h-11 sm:h-8"
          disabled={!idea.trim() || start.isPending}
        >
          Start ideate
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {start.error && <QueryError error={start.error} />}
    </form>
  );
}

/** The started task, polled until it ends; then what it recorded, or why it recorded nothing. */
function IdeateProgress({ run: started, onClose }: { run: Run; onClose: () => void }) {
  const polled = useRun(started.projectId, started.id);
  const run = polled.data ?? started;
  return (
    <section
      aria-label="Ideate agent task"
      className="max-w-2xl space-y-2 rounded-md border border-border p-3 text-sm"
    >
      <p className="flex flex-wrap items-center gap-2">
        <Link
          to="/p/$projectId/runs/$runId"
          params={{ projectId: run.projectId, runId: run.id }}
          className="underline-offset-2 hover:underline"
        >
          Agent task · ideate
        </Link>
        <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
      </p>
      {isActiveRun(run) && (
        <p className="text-muted-foreground">The epic lands in Ideas when it finishes.</p>
      )}
      {run.status === "succeeded" && run.summary && (
        <p className="whitespace-pre-line break-words">{run.summary}</p>
      )}
      {run.status !== "succeeded" && run.error && (
        <p className="break-words text-destructive">{run.error}</p>
      )}
      <Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" onClick={onClose}>
        Close
      </Button>
    </section>
  );
}
