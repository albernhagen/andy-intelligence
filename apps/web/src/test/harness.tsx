import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryCodeHostConnectionStore,
  InMemoryConfigChangeStore,
  InMemoryDeploymentStore,
  InMemoryRoutingConfigStore,
  InMemorySpendCapsStore,
  InMemoryNightLaunchStore,
  InMemoryReleaseNoteStore,
  InMemoryReviewFindingSource,
  InMemoryQuotaStore,
  InMemoryRunStore,
  InMemoryRunnerStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { TicketService } from "@andy/domain";
import { createApp, ownerOnlyAccess } from "@andy/api/app";
import { ApiContext, createApi } from "@/lib/api";
import { makeRouter } from "@/router";

/**
 * Options for the first `findBy*` after opening a page (AI-219). A page's first render in a test
 * file runs its whole tree cold, through the in-process API: about 0.3 s alone, but past
 * testing-library's 1 s default when several sessions run the suite at once (pre-push). Only that
 * wait gets longer; it stays under the 5 s test timeout so a real failure still names the element.
 * Later waits keep the 1 s default.
 */
export const PAGE_LOAD = { timeout: 4000 } as const;

/**
 * Renders the UI against the real API running in-process (createApp + in-memory tracker), so
 * every UI test also exercises the API contract, auth middleware and domain rules.
 */
export function renderApp(
  path = "/",
  opts: {
    githubConnected?: boolean;
    /** Runs before each API request reaches the app; a test can hold one here. */
    beforeFetch?: (request: Request) => Promise<void>;
    /** Needs-you email (AI-77); absent: not configured. */
    email?: Parameters<typeof createApp>[0]["email"];
  } = {},
) {
  const tracker = new InMemoryWorkTracker();
  const runs = new InMemoryRunStore();
  const quota = new InMemoryQuotaStore();
  const runners = new InMemoryRunnerStore();
  const configChanges = new InMemoryConfigChangeStore();
  const nightLaunches = new InMemoryNightLaunchStore();
  const deployments = new InMemoryDeploymentStore();
  const routing = new InMemoryRoutingConfigStore();
  const spendCapsStore = new InMemorySpendCapsStore();
  const releaseNotes = new InMemoryReleaseNoteStore();
  const reviewFindings = new InMemoryReviewFindingSource();
  // GitHub fakes (ADR-0043): one installed repo; any manifest code "connects" this App.
  const connections = new InMemoryCodeHostConnectionStore();
  const codeHost = new InMemoryCodeHost([
    {
      fullName: "albernhagen/andy-intelligence",
      defaultBranch: "main",
      private: false,
      url: "https://github.com/albernhagen/andy-intelligence",
    },
  ]);
  const app = createApp({
    projectAccess: ownerOnlyAccess(),
    verifier: {
      async verify(token) {
        if (token !== "andy-token") throw new Error("bad token");
        return { uid: "andy", email: "andy@example.com", emailVerified: true };
      },
    },
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs,
    quota,
    runners,
    configChanges,
    nightLaunches,
    deployments,
    releaseNotes,
    reviewFindings,
    routing,
    spendCapsStore,
    email: opts.email,
    github: {
      publicUrl: "http://localhost",
      connections,
      events: new InMemoryCodeEventLog(),
      codeHostFor: () => codeHost,
      exchangeCode: async () => ({
        appId: "42",
        slug: "andy-intelligence",
        clientId: "Iv23x",
        owner: "albernhagen",
        privateKey: "PEM",
        webhookSecret: "whs",
      }),
    },
  });
  if (opts.githubConnected) {
    // The in-memory save settles before the first request is made.
    void connections.save({
      appId: "42",
      slug: "andy-intelligence",
      clientId: "Iv23x",
      owner: "albernhagen",
      privateKey: "PEM",
      webhookSecret: "whs",
      connectedAt: "2026-11-03T00:00:00.000Z",
    });
  }
  const api = createApi({
    baseUrl: "http://localhost",
    getToken: async () => "andy-token",
    fetch: async (request) => {
      await opts.beforeFetch?.(request);
      return app.fetch(request);
    },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  // No timer tick between keystrokes and clicks: under load each tick waits behind every other
  // test worker, and the UI under test doesn't depend on the gaps (AI-219).
  const user = userEvent.setup({ delay: null });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>
        <RouterProvider router={router} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  return {
    runners,
    spendCapsStore,
    releaseNotes,
    reviewFindings,
    configChanges,
    user,
    router,
    queryClient,
    tracker,
    runs,
    quota,
    codeHost,
    connections,
    nightLaunches,
    deployments,
    routing,
    service: new TicketService(tracker),
  };
}

/** A story that meets the Definition of Ready. */
export const readyStory = {
  type: "feature" as const,
  title: "Board",
  body: "Andy can't see tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  size: "S" as const,
  sizeReason: "one screen",
};
