/**
 * AI-366: one screenshot case per screen in src/router.tsx, at desktop and phone
 * (coverage.spec.ts). Keyed by the route's full path; src/router-screenshots.test.ts fails when a
 * route that renders a page has no entry here, so a new screen can't ship without a stored image.
 * Plain data with no Playwright import, so that Vitest test can read it.
 */
export interface Screen {
  /** The route's full path in src/router.tsx, e.g. "/p/$projectId/settings". */
  route: string;
  /** File name stem: `screen-<name>.png` at 1280×800, `phone-screen-<name>.png` at 390×844. */
  name: string;
  /**
   * The URL that opens it over the seeded fake API (e2e/fake-api.ts). Screens that need mocks or
   * clicks to open (dashboards, agent task) get them in coverage.spec.ts.
   */
  url: string;
  /** Text that shows once the screen has loaded. */
  ready: string;
  /** Also stored dark (`screen-<name>-dark.png`, desktop). */
  dark?: boolean;
}

export const SCREENS: Screen[] = [
  {
    route: "/all/inbox",
    name: "all-inbox",
    url: "/all/inbox",
    ready: "Keep backups for 7 or 30 days?",
  },
  { route: "/all/board", name: "all-board", url: "/all/board", ready: "A board shows one project" },
  { route: "/all/work", name: "all-work", url: "/all/work", ready: "Story side panel" },
  { route: "/all/roadmap", name: "all-roadmap", url: "/all/roadmap", ready: "M2: Backups" },
  { route: "/all/dashboards", name: "all-dashboards", url: "/all/dashboards", ready: "Dashboards" },
  // Opens the current project's settings (the first project in a fresh browser).
  {
    route: "/projects",
    name: "projects",
    url: "/projects",
    ready: "AI: Andy Intelligence settings",
  },
  { route: "/projects/new", name: "add-project", url: "/projects/new", ready: "Add project" },
  { route: "/p/$projectId", name: "board", url: "/p/ai", ready: "Story side panel", dark: true },
  {
    route: "/p/$projectId/t/$ticketRef",
    name: "ticket",
    url: "/p/ai/t/AI-1",
    ready: "Picking a project should feel like picking a tenant.",
  },
  {
    route: "/p/$projectId/inbox",
    name: "inbox",
    url: "/p/ops/inbox",
    ready: "Delete the old bucket too?",
    dark: true,
  },
  { route: "/p/$projectId/work", name: "work", url: "/p/ai/work", ready: "Story side panel" },
  { route: "/p/$projectId/roadmap", name: "roadmap", url: "/p/ops/roadmap", ready: "M2: Backups" },
  {
    route: "/p/$projectId/settings",
    name: "project-settings",
    url: "/p/ai/settings",
    ready: "AI: Andy Intelligence settings",
    dark: true,
  },
  {
    route: "/p/$projectId/whats-new",
    name: "whats-new",
    url: "/p/ops/whats-new",
    ready: "Backups now land in a second region",
  },
  {
    route: "/p/$projectId/dashboards",
    name: "dashboards",
    url: "/p/ai/dashboards",
    ready: "18 deployments",
  },
  {
    route: "/p/$projectId/runs/$runId",
    name: "agent-task",
    url: "/p/ai/t/AI-3",
    ready: "Waiting on your answer",
    dark: true,
  },
  { route: "/settings/github", name: "github", url: "/settings/github", ready: "Connect GitHub" },
  { route: "/settings/runners", name: "runners", url: "/settings/runners", ready: "Old laptop" },
  { route: "/settings/models", name: "models", url: "/settings/models", ready: "Global routing" },
  // Opened without the state its "Connect GitHub" click stores, so it says to start again.
  {
    route: "/settings/github/callback",
    name: "github-callback",
    url: "/settings/github/callback",
    ready: "Start again from Settings",
  },
];
