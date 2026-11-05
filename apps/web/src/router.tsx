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
import { PickProjectPage } from "@/pages/PickProjectPage";
import { GitHubCallbackPage, GitHubPage } from "@/pages/GitHubPage";
import { InboxPage } from "@/pages/InboxPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { TicketPage } from "@/pages/TicketPage";

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: () => <p className="text-muted-foreground">Page not found.</p>,
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
  createRoute({ getParentRoute: () => rootRoute, path: "/projects", component: ProjectsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/p/$projectId", component: BoardPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/inbox",
    component: InboxPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/t/$ticketRef",
    component: TicketPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings/github", component: GitHubPage }),
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
