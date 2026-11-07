import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryCodeHostConnectionStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { TicketService } from "@andy/domain";
import { createApp } from "@andy/api/app";
import { ApiContext, createApi } from "@/lib/api";
import { makeRouter } from "@/router";

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
  } = {},
) {
  const tracker = new InMemoryWorkTracker();
  const runs = new InMemoryRunStore();
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
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>
        <RouterProvider router={router} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  return {
    user,
    router,
    queryClient,
    tracker,
    runs,
    codeHost,
    connections,
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
