/**
 * The global scope chosen in the project picker (ADR-0059: Project = workspace): one project
 * (`/p/<project>/…`) or all projects (`/all/…`). The URL is the source of truth; the last scope
 * seen in a URL is remembered so `/` opens the inbox where Andy left off.
 */
export type Scope = { kind: "all" } | { kind: "project"; projectId: string };

export const ALL: Scope = { kind: "all" };

/** The screens the header links to. Settings is global, so it is not a scoped section. */
export type Section = "inbox" | "board" | "dashboards";

const PROJECT_ID = /^[a-z][a-z0-9]{0,9}$/;
const STORAGE_KEY = "andy.scope";

/** The scope a path names, or null for screens outside any scope (settings, projects). */
export function scopeFromPath(pathname: string): Scope | null {
  if (/^\/all(\/|$)/.test(pathname)) return ALL;
  const project = /^\/p\/([^/]+)/.exec(pathname)?.[1];
  return project ? { kind: "project", projectId: decode(project) } : null;
}

/** A bad escape (`/p/%zz`) must not crash the shell; the raw segment then shows "not found". */
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The section a path shows: the ticket page belongs to the board, everything else unscoped. */
export function sectionFromPath(pathname: string): Section | null {
  if (/^\/p\/[^/]+\/settings\/?$/.test(pathname)) return null;
  if (/^\/p\/[^/]+\/digest\/?$/.test(pathname)) return null; // The digest (AI-70) is its own page.
  if (/^\/(all|p\/[^/]+)\/inbox\/?$/.test(pathname)) return "inbox";
  if (/^\/(all|p\/[^/]+)\/dashboards\/?$/.test(pathname)) return "dashboards";
  if (/^\/(all\/board|p\/[^/]+)(\/|$)/.test(pathname)) return "board";
  return null;
}

/** Where a header link or picker choice goes. The board under All projects asks for a project. */
export function scopePath(scope: Scope, section: Section): string {
  if (scope.kind === "all") return `/all/${section}`;
  const base = `/p/${encodeURIComponent(scope.projectId)}`;
  return section === "board" ? base : `${base}/${section}`;
}

/** A project's settings page (AI-46), linked from the header while a project is in scope. */
export const projectSettingsPath = (projectId: string) =>
  `/p/${encodeURIComponent(projectId)}/settings`;

/** "all" or "p:<project>": the stored form, also handy as a React key. */
export const scopeKey = (scope: Scope) => (scope.kind === "all" ? "all" : `p:${scope.projectId}`);

/** The remembered scope; All projects when nothing (or something invalid) is stored. */
export function loadScope(): Scope {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored?.startsWith("p:") && PROJECT_ID.test(stored.slice(2)))
      return { kind: "project", projectId: stored.slice(2) };
  } catch {
    // Storage blocked (private mode, policy): fall back to All projects.
  }
  return ALL;
}

export function saveScope(scope: Scope): void {
  // Only well-formed project IDs are stored, so a mistyped URL isn't remembered.
  if (scope.kind === "project" && !PROJECT_ID.test(scope.projectId)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, scopeKey(scope));
  } catch {
    // Not remembering is fine; the URL still carries the scope.
  }
}
