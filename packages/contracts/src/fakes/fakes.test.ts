import {
  codeEventLogContract,
  codeHostConnectionStoreContract,
  codeHostContract,
  executorContract,
  oauthGrantStoreContract,
  quotaStoreContract,
  runStoreContract,
  watchdogQueueContract,
  workTrackerContract,
} from "../testing";
import {
  InMemoryCodeEventLog,
  InMemoryCodeHost,
  InMemoryCodeHostConnectionStore,
  InMemoryExecutor,
  InMemoryOAuthGrantStore,
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
