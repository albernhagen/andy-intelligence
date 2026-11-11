import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryCodeHostConnectionStore,
  InMemoryWorkTracker,
  type Repo,
  InMemoryRunStore,
} from "@andy/contracts";
import type { CreatedApp } from "@andy/github";
import { createApp, type AppDeps } from "../app";
import type { TokenVerifier } from "../auth";

/** createApp wired with GitHub fakes, for the github/* route tests. */

export const PUBLIC_URL = "https://cp.example";
export const REPO = "albernhagen/andy-intelligence";

export const repo = (fullName = REPO): Repo => ({
  fullName,
  defaultBranch: "main",
  private: false,
  url: `https://github.com/${fullName}`,
});

export const createdApp: CreatedApp = {
  appId: "42",
  slug: "andy-intelligence",
  clientId: "Iv23x",
  owner: "albernhagen",
  privateKey: "PEM",
  webhookSecret: "whs",
};

const verifier: TokenVerifier = {
  async verify(token) {
    if (token !== "andy") throw new Error("bad token");
    return { uid: "andy", email: "andy@example.com", emailVerified: true };
  },
};

export function githubApp(
  overrides: Partial<NonNullable<AppDeps["github"]>> = {},
  extra: Pick<AppDeps, "watchdog" | "quota" | "mcp" | "email"> = {},
) {
  const connections = new InMemoryCodeHostConnectionStore();
  const host = new InMemoryCodeHost([repo()]);
  const tracker = new InMemoryWorkTracker();
  const runs = new InMemoryRunStore();
  const app = createApp({
    verifier,
    allowedEmails: new Set(["andy@example.com"]),
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs,
    ...extra,
    github: {
      publicUrl: PUBLIC_URL,
      connections,
      events: new InMemoryCodeEventLog(),
      codeHostFor: () => host,
      exchangeCode: async () => createdApp,
      ...overrides,
    },
  });
  const call = (path: string, init: RequestInit = {}, token: string | null = "andy") =>
    app.request(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers as Record<string, string>),
      },
    });
  return { app, call, connections, host, tracker, runs };
}
