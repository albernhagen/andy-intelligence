import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { BoardPage } from "@/pages/BoardPage";
import { GitHubCallbackPage, GitHubPage } from "@/pages/GitHubPage";
import { InboxPage } from "@/pages/InboxPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { TicketPage } from "@/pages/TicketPage";

const navLink = "text-sm text-muted-foreground hover:text-foreground [&.active]:text-foreground";

const rootRoute = createRootRoute({
  component: () => (
    <>
      <nav className="mb-6 flex gap-4">
        <Link to="/" className={navLink} activeOptions={{ exact: true }}>
          Needs you
        </Link>
        <Link to="/projects" className={navLink}>
          Tickets
        </Link>
        <Link to="/settings/github" className={navLink}>
          GitHub
        </Link>
      </nav>
      <Outlet />
    </>
  ),
  notFoundComponent: () => <p className="text-muted-foreground">Page not found.</p>,
});

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: InboxPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/projects", component: ProjectsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/p/$projectId", component: BoardPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings/github", component: GitHubPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/github/callback",
    component: GitHubCallbackPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/t/$ticketId",
    component: TicketPage,
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
