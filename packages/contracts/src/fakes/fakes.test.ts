import {
  codeEventLogContract,
  codeHostContract,
  executorContract,
  oauthGrantStoreContract,
  quotaSourceContract,
  workTrackerContract,
} from "../testing";
import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryExecutor,
  InMemoryOAuthGrantStore,
  InMemoryQuotaSource,
  InMemoryWorkTracker,
} from "./index";

workTrackerContract("in-memory", async () => new InMemoryWorkTracker());

executorContract("in-memory", async () => ({
  executor: new InMemoryExecutor(),
  request: (runId) => ({
    runId,
    projectRef: "demo",
    ticketRef: null,
    step: "build",
    route: { harness: "claude-code", provider: "claude-sub", model: "claude-opus" },
    instructions: "do the thing",
    callbackUrl: null,
  }),
}));

quotaSourceContract("in-memory", async () => {
  const source = new InMemoryQuotaSource();
  return {
    source,
    seed: async () =>
      source.set("claude-sub", [
        {
          provider: "claude-sub",
          window: "5h",
          usedPct: 42,
          resetsAt: "2026-10-21T23:00:00Z",
          source: "test",
          takenAt: "2026-10-21T20:00:00Z",
          confidence: "high",
        },
      ]),
  };
});

oauthGrantStoreContract("in-memory", async (now) => new InMemoryOAuthGrantStore(now));

codeHostContract("in-memory", async () => ({
  host: new InMemoryCodeHost([
    {
      fullName: "Owner/Repo",
      defaultBranch: "main",
      private: false,
      url: "https://github.com/Owner/Repo",
    },
  ]),
  knownRepo: "owner/repo",
  unknownRepo: "owner/other",
}));

codeEventLogContract("in-memory", async () => new InMemoryCodeEventLog());
