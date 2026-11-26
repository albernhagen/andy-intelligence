import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { parseWorkView, type WorkView } from "@andy/domain";
import { AppShell } from "@/components/AppShell";
import { loadScope, scopePath } from "@/lib/scope";
import { BoardPage } from "@/pages/BoardPage";
import { DashboardsPage } from "@/pages/DashboardsPage";
import { PickProjectPage } from "@/pages/PickProjectPage";
import { GitHubCallbackPage, GitHubPage } from "@/pages/GitHubPage";
import { InboxPage } from "@/pages/InboxPage";
import { NewProjectPage, ProjectsPage } from "@/pages/ProjectsPage";
import { ModelsPage } from "@/pages/ModelsPage";
import { ProjectSettingsPage } from "@/pages/ProjectSettingsPage";
import { SetupPage } from "@/pages/SetupPage";
import { readySearch } from "@/lib/ready";
import type { ReadyFilters } from "@andy/contracts";
import { ReleasesPage } from "@/pages/ReleasesPage";
import { RunnersPage } from "@/pages/RunnersPage";
import { RunPage } from "@/pages/RunPage";
import { TicketPage } from "@/pages/TicketPage";
import { WhatsNewPage } from "@/pages/WhatsNewPage";
import { RoadmapPage } from "@/pages/RoadmapPage";
import { WorkPage } from "@/pages/WorkPage";

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: () => <p className="text-muted-foreground">Page not found.</p>,
});

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId",
  component: BoardPage,
  // The Ready lane's sort (AI-37) and filters (AI-343), and the work view chip (AI-187); unknown
  // values read as unset.
  validateSearch: (
    search: Record<string, unknown>,
  ): { sort?: "score"; view?: WorkView } & ReadyFilters => {
    const view = parseWorkView(search.view);
    return {
      ...(search.sort === "score" && { sort: "score" }),
      ...(view && { view }),
      ...readySearch(search),
    };
  },
});

/** The Work list's view; an unknown or missing one reads as unset (the page shows Needs you). */
function workSearch(search: Record<string, unknown>): { view?: WorkView } {
  const view = parseWorkView(search.view);
  return view ? { view } : {};
}

/** URLs carry the picker's scope (lib/scope.ts): `/p/<project>/…` or `/all/…`. */
const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    // Home is the inbox in the scope Andy last used (ADR-0059).
    beforeLoad: () => {
      throw redirect({ href: scopePath(loadScope(), "inbox"), replace: true });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/all",
    beforeLoad: () => {
      throw redirect({ to: "/all/inbox", replace: true });
    },
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/all/inbox", component: InboxPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/all/board", component: PickProjectPage }),
  // Work across projects (AI-198): both scopes; the view chip is in `?view=` (default Needs you).
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/all/work",
    component: WorkPage,
    validateSearch: workSearch,
  }),
  // Roadmap (AI-202): milestones and their epics, both scopes.
  createRoute({ getParentRoute: () => rootRoute, path: "/all/roadmap", component: RoadmapPage }),
  // Dashboards (AI-117): both scopes.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/all/dashboards",
    component: DashboardsPage,
  }),
  // `/projects` opens the current project's settings, or offers a first project (AI-46).
  createRoute({ getParentRoute: () => rootRoute, path: "/projects", component: ProjectsPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/projects/new",
    component: NewProjectPage,
  }),
  boardRoute.addChildren([
    // The ticket panel opens over the board, in its <Outlet /> (ADR-0059: UX foundation).
    createRoute({ getParentRoute: () => boardRoute, path: "t/$ticketRef", component: TicketPage }),
  ]),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/inbox",
    component: InboxPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/work",
    component: WorkPage,
    validateSearch: workSearch,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/roadmap",
    component: RoadmapPage,
  }),
  // Old Ready page links (AI-298) open the board with the same filters (AI-343).
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/ready",
    // AI-343: the Ready page is gone; its filters are on the board's Ready lane (MCP list_ready stays).
    beforeLoad: ({ params, search }) => {
      throw redirect({ to: "/p/$projectId", params, search: readySearch(search), replace: true });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/settings",
    component: ProjectSettingsPage,
  }),
  // AI-373: a new project's setup path, from create to first build.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/setup",
    component: SetupPage,
  }),
  // AI-341: the Digest screen folded into What's new (24 hours, exceptions first); MCP digest stays.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/digest",
    beforeLoad: ({ params }) => {
      throw redirect({ to: "/p/$projectId/whats-new", params, search: { days: 1 }, replace: true });
    },
  }),
  // What's new (AI-159): project-scoped only, as status is per milestone epic of one project.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/whats-new",
    component: WhatsNewPage,
    // The window lives in the URL (`?days=1` is the old digest URL's 24 hours, AI-341); 14 days,
    // the default, and anything unknown read as unset.
    validateSearch: (search: Record<string, unknown>): { days?: 1 | 30 | 90 } => {
      const days = Number(search.days);
      return days === 1 || days === 30 || days === 90 ? { days } : {};
    },
  }),
  // Releases (AI-189: M6.10): under What's new, project-scoped only, as releases are per project.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/releases",
    component: ReleasesPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/dashboards",
    component: DashboardsPage,
  }),
  // An agent task's own screen (AI-101); project-scoped only, as its URL names its project.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/runs/$runId",
    component: RunPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings/github", component: GitHubPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/runners",
    component: RunnersPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings/models", component: ModelsPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/github/callback",
    component: GitHubCallbackPage,
  }),
]);

/** Code-based routes (no router codegen plugin). Tests pass a memory history. */
export function makeRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
