import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { OAuthConsent } from "./OAuthConsent";
import { registerServiceWorker } from "./lib/service-worker";
import { applyTheme, loadTheme } from "./lib/theme";
import "./index.css";

// The remembered theme (ADR-0151) before the first render.
applyTheme(loadTheme());

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {window.location.pathname === "/oauth/consent" ? <OAuthConsent /> : <App />}
    </QueryClientProvider>
  </StrictMode>,
);

window.addEventListener("load", () => void registerServiceWorker());
