import type { DeploymentRelease } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";

/**
 * A deployment's release notes (AI-189: M6.10, ADR-0114 "Release notes"): one "What changed" line
 * per PR merged since the previous succeeded deployment, grouped by milestone epic. Note text is
 * PR authors' text, so it stays plain text (no Markdown).
 */
export function ReleaseNotes({ release }: { release: DeploymentRelease }) {
  if (release.status !== "listed")
    return <p className="text-muted-foreground">{NO_LINES[release.status](release)}</p>;
  if (release.groups.length === 0)
    return <p className="text-muted-foreground">No commits between the two deployments.</p>;
  return (
    <div className="space-y-3">
      {release.groups.map((g) => (
        <section key={g.epicKey ?? "none"} aria-label={g.epicKey ? epicName(g) : "No epic"}>
          <h4 className="text-xs font-medium text-muted-foreground">
            {g.epicKey ? epicName(g) : "No epic"}
          </h4>
          <ul className="mt-1 space-y-1">
            {g.lines.map((l) => (
              <li key={l.sha} className="flex items-baseline gap-2">
                {l.prUrl ? (
                  <a
                    href={l.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums underline-offset-2 hover:underline"
                  >
                    PR #{l.prNumber}
                  </a>
                ) : (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {l.sha.slice(0, 7)}
                  </span>
                )}
                <span className="min-w-0 break-words">{l.text}</span>
                {l.noNote && <Badge>{l.prNumber ? "no note" : "no PR"}</Badge>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {release.truncated && (
        <p className="text-muted-foreground">
          Only the first 100 commits are listed; newer ones are missing.
        </p>
      )}
    </div>
  );
}

const epicName = (g: DeploymentRelease["groups"][number]) =>
  g.epicTitle ? `${g.epicKey}: ${g.epicTitle}` : (g.epicKey ?? "");

const NO_LINES: Record<
  Exclude<DeploymentRelease["status"], "listed">,
  (r: DeploymentRelease) => string
> = {
  first: (r) => `First deployment to ${r.environment}: nothing earlier to compare with.`,
  same_commit: () => "Same commit as the previous deployment: nothing new ships.",
  not_ahead: () => "Behind the previous deployment (a rollback): nothing new ships.",
  unavailable: (r) =>
    `Release notes unavailable: ${r.reason ?? "the code host could not compare"}.`,
};
