import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { HeaderEndContext } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ApiContext, createApi } from "@/lib/api";
import { makeRouter } from "@/router";
import { E2E_TOKEN } from "./token";
import "./e2e.css";

/**
 * The signed-in app without Firebase: the same router, shell and pages as App.tsx, talking to
 * the fake API that e2e/vite.config.ts serves. Only the screenshot checks load this page.
 */
const api = createApi({ baseUrl: window.location.origin, getToken: async () => E2E_TOKEN });
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>
        <HeaderEndContext.Provider
          value={
            <Button variant="ghost" size="sm">
              Sign out
            </Button>
          }
        >
          <RouterProvider router={makeRouter()} />
        </HeaderEndContext.Provider>
      </ApiContext.Provider>
    </QueryClientProvider>
  </StrictMode>,
);
