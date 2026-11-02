import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { OAuthConsent } from "./OAuthConsent";
import "./index.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {window.location.pathname === "/oauth/consent" ? <OAuthConsent /> : <App />}
    </QueryClientProvider>
  </StrictMode>,
);
