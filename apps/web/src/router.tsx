import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { loadScope, scopePath } from "@/lib/scope";
import { BoardPage } from "@/pages/BoardPage";
import { DashboardsPage } from "@/pages/DashboardsPage";
import { DigestPage } from "@/pages/DigestPage";
import { PickProjectPage } from "@/pages/PickProjectPage";
import { GitHubCallbackPage, GitHubPage } from "@/pages/GitHubPage";
import { InboxPage } from "@/pages/InboxPage";
import { NewProjectPage, ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectSettingsPage } from "@/pages/ProjectSettingsPage";
import { RunnersPage } from "@/pages/RunnersPage";
import { RunPage } from "@/pages/RunPage";
import { TicketPage } from "@/pages/TicketPage";

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: () => <p className="text-muted-foreground">Page not found.</p>,
});

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId",
  component: BoardPage,
  // The Ready lane's view (AI-37); anything else in the URL reads as queue order.
  validateSearch: (search: Record<string, unknown>): { sort?: "score" } =>
    search.sort === "score" ? { sort: "score" } : {},
});

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
    // The story panel opens over the board, in its <Outlet /> (ADR-0059: UX foundation).
    createRoute({ getParentRoute: () => boardRoute, path: "t/$ticketRef", component: TicketPage }),
  ]),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/inbox",
    component: InboxPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/settings",
    component: ProjectSettingsPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/digest",
    component: DigestPage,
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
