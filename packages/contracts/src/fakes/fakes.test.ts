import {
  codeEventLogContract,
  codeHostConnectionStoreContract,
  codeHostContract,
  evaluatorContract,
  executorContract,
  oauthGrantStoreContract,
  quotaStoreContract,
  runStoreContract,
  runnerStoreContract,
  watchdogQueueContract,
  workTrackerContract,
} from "../testing";
import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryCodeHostConnectionStore,
  InMemoryEvaluator,
  InMemoryExecutor,
  InMemoryOAuthGrantStore,
  InMemoryRunnerStore,
  InMemoryQuotaStore,
  InMemoryRunStore,
  InMemoryWatchdogQueue,
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

quotaStoreContract("in-memory", async () => new InMemoryQuotaStore());

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

runStoreContract("in-memory", async () => new InMemoryRunStore());

codeEventLogContract("in-memory", async () => new InMemoryCodeEventLog());

codeHostConnectionStoreContract("in-memory", async () => new InMemoryCodeHostConnectionStore());

watchdogQueueContract("in-memory", async () => new InMemoryWatchdogQueue());

evaluatorContract("in-memory", async (script) => {
  const outcome = {
    pass: { status: "ran", passed: true, inputTokens: 100, failures: [] },
    fail: { status: "ran", passed: false, inputTokens: 100, failures: ["expected a finding"] },
    error: { status: "error", passed: false, inputTokens: null, failures: ["no result"] },
  } as const;
  return new InMemoryEvaluator(
    Object.fromEntries(
      Object.entries(script).map(([id, o]) => [
        id,
        { ...outcome[o], failures: [...outcome[o].failures] },
      ]),
    ),
  );
});

runnerStoreContract("in-memory", async (now) => new InMemoryRunnerStore(now));
