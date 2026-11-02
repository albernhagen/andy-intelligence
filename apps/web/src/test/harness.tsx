import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { InMemoryWorkTracker } from "@andy/contracts";
import { TicketService } from "@andy/domain";
import { createApp } from "@andy/api/app";
import { ApiContext, createApi } from "@/lib/api";
import { makeRouter } from "@/router";

/**
 * Renders the UI against the real API running in-process (createApp + in-memory tracker), so
 * every UI test also exercises the API contract, auth middleware and domain rules.
 */
export function renderApp(path = "/") {
  const tracker = new InMemoryWorkTracker();
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
  });
  const api = createApi({
    baseUrl: "http://localhost",
    getToken: async () => "andy-token",
    fetch: async (request) => app.fetch(request),
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
  return { user, router, tracker, service: new TicketService(tracker) };
}

/** A story that meets the Definition of Ready. */
export const readyStory = {
  type: "story" as const,
  title: "Board",
  body: "Andy can't see tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  size: "S" as const,
  sizeReason: "one screen",
  tier: "strong" as const,
};
