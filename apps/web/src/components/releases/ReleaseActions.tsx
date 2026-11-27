import { useState } from "react";
import type { DeployKind, EnvironmentPolicy, ReleaseRequest } from "@andy/contracts";
import { promoteSource, rollbackTarget, type ReleaseCandidate } from "@andy/domain";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorText } from "@/lib/api";
import { usePromote, useReleaseRequests, useReleaseTargets, useRollback } from "@/lib/queries";

/**
 * Promote and rollback on the Releases page (AI-199: M6.12, ADR-0160). Each button opens a confirm
 * step naming what will serve afterwards; confirming records a release request and starts the
 * project's release.yml. The same rules as the API decide the default target (`@andy/domain`), so
 * the dialog names what the server will ship. Below them, the last few requests with their status.
 */

type Action =
  | { kind: "promote"; digest: string; text: string }
  | { kind: "rollback"; environment: "prod" | "dev"; revision: string; text: string };

const short = (digest: string) => digest.slice(0, 19);

function promoteAction(dev: readonly ReleaseCandidate[]): Action | string {
  const source = promoteSource(dev, undefined);
  if (typeof source === "string") return source;
  return {
    kind: "promote",
    digest: source.imageDigest,
    text: `prod will serve ${short(source.imageDigest)} (commit ${source.gitSha.slice(0, 7)}), promoted from dev.`,
  };
}

function rollbackAction(
  deployments: readonly ReleaseCandidate[],
  environment: "prod" | "dev",
): Action | string {
  const target = rollbackTarget(deployments, environment, undefined);
  if (typeof target === "string") return target;
  return {
    kind: "rollback",
    environment,
    revision: target.revision ?? "",
    text: `${environment} will serve revision ${target.revision} (commit ${target.gitSha.slice(0, 7)}) again.`,
  };
}

const STATUS_TEXT: Record<ReleaseRequest["status"], string> = {
  requested: "requested",
  dispatch_failed: "not started",
  dispatched: "waiting for the workflow",
  started: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  ended_unreported: "ended without a result",
};

export function ReleaseActions({
  projectId,
  deployKind,
  environments,
}: {
  projectId: string;
  deployKind: DeployKind;
  environments: EnvironmentPolicy;
}) {
  if (deployKind === "none") {
    return (
      <p className="text-sm text-muted-foreground">
        This project does not deploy (deploy kind none), so it has no promote or rollback.
      </p>
    );
  }
  return <Actions projectId={projectId} withDev={environments === "dev-and-prod"} />;
}

function Actions({ projectId, withDev }: { projectId: string; withDev: boolean }) {
  const targets = useReleaseTargets(projectId, withDev);
  const requests = useReleaseRequests(projectId);
  const promote = usePromote(projectId);
  const rollback = useRollback(projectId);
  const [open, setOpen] = useState<Action | null>(null);

  const prod = targets.data?.prod ?? [];
  const dev = targets.data?.dev ?? [];
  const buttons: { label: string; action: Action | string }[] = [
    ...(withDev ? [{ label: "Promote to prod", action: promoteAction(dev) }] : []),
    { label: "Roll back prod", action: rollbackAction(prod, "prod") },
    ...(withDev ? [{ label: "Roll back dev", action: rollbackAction(dev, "dev") }] : []),
  ];
  const pending = promote.isPending || rollback.isPending;
  const last = promote.data ?? rollback.data;
  const failed = promote.error ?? rollback.error;
  const line = failed
    ? `Not started: ${errorText(failed)}`
    : last
      ? `Requested: ${last.summary.replace(/\.$/, "")}. release.yml is running.`
      : null;

  const confirm = () => {
    if (!open) return;
    promote.reset();
    rollback.reset();
    if (open.kind === "promote") promote.mutate({ digest: open.digest });
    else rollback.mutate({ environment: open.environment, revision: open.revision });
    setOpen(null);
  };

  return (
    <section aria-label="Promote and rollback" className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {buttons.map(({ label, action }) => (
          <Button
            key={label}
            type="button"
            size="sm"
            variant="outline"
            disabled={targets.isLoading || pending || typeof action === "string"}
            title={typeof action === "string" ? action : undefined}
            onClick={() => typeof action !== "string" && setOpen(action)}
            className="max-sm:min-h-11 max-sm:w-full"
          >
            {label}
          </Button>
        ))}
      </div>
      {targets.isError && (
        <p className="text-sm text-muted-foreground">
          Couldn't read deployments: {errorText(targets.error)}
        </p>
      )}
      {line && (
        <p role="status" className="text-sm text-muted-foreground">
          {line}
        </p>
      )}
      {requests.data && requests.data.length > 0 && (
        <ul aria-label="Release requests" className="grid gap-1 text-sm text-muted-foreground">
          {requests.data.map((r) => (
            <li key={r.id}>
              {r.action === "promote" ? "Promote" : "Rollback"} {r.environment} →{" "}
              {r.action === "promote" ? short(r.digest) : r.revision}: {STATUS_TEXT[r.status]}
              {r.error ? ` · ${r.error}` : ""}
              {r.runUrl && (
                <>
                  {" · "}
                  <a href={r.runUrl} target="_blank" rel="noreferrer" className="underline">
                    run
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {open?.kind === "promote" ? "Promote to prod?" : `Roll back ${open?.environment}?`}
            </DialogTitle>
            <DialogDescription>
              {open?.text} This starts release.yml in the project's repo and changes live traffic.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" onClick={confirm}>
              {open?.kind === "promote" ? "Promote" : "Roll back"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
