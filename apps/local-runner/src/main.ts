import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { RUNNER_LIMITS } from "@andy/contracts";
import { ControlPlane } from "./api";
import { checkSettings } from "./check-settings";
import {
  DEFAULT_GIT_BASE,
  DEFAULT_PLATFORM_REPO,
  DEFAULT_URL,
  checkRepo,
  controlPlaneOrigin,
  defaultHome,
} from "./config";
import { RepoCache } from "./git";
import { login, logout, readSecret } from "./keychain";
import { consoleLogger, errorText } from "./log";
import { loadPlatform } from "./platform";
import { cleanLeftoverAgents, killAllAgents } from "./processes";
import { caffeinate, pruneWork, runLoop } from "./runner";
import { seatbelt, seatbeltProfile } from "./seatbelt";

export const VERSION = "0.1.0";

const USAGE = `local-runner: runs andy-intelligence agent tasks on this Mac (ADR-0089).

Commands:
  login           Store the runner secret (minted at /settings/runners) in the macOS Keychain.
                  security prompts for it twice; it never touches a file or the shell history.
  logout          Delete the stored runner secret.
  start           Poll for agent tasks (refine and plan) and run them; exits after 12 hours idle.
  check-settings  Live check: an agent with the runner's arguments loads no project or local
                  settings and no hooks (one short Haiku call).

Options:
  --url <origin>          Control plane (default ${DEFAULT_URL}).
  --home <dir>            Runner directory (default ~/.local-runner, or LOCAL_RUNNER_HOME).
  --claude <command>      Claude Code CLI (default claude).
  --platform-repo <repo>  Platform repository, owner/name (default ${DEFAULT_PLATFORM_REPO}).
  --runs-at-once <n>      Agent tasks at once, 1 to ${RUNNER_LIMITS.runsAtOnceMax} (default ${RUNNER_LIMITS.runsAtOnceDefault}).
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      url: { type: "string", default: process.env.LOCAL_RUNNER_URL ?? DEFAULT_URL },
      home: { type: "string", default: defaultHome() },
      claude: { type: "string", default: "claude" },
      "platform-repo": { type: "string", default: DEFAULT_PLATFORM_REPO },
      "git-base": { type: "string", default: DEFAULT_GIT_BASE },
      "runs-at-once": { type: "string", default: String(RUNNER_LIMITS.runsAtOnceDefault) },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command] = positionals;
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return command || values.help ? 0 : 1;
  }
  const origin = controlPlaneOrigin(values.url);
  const home = values.home;
  const log = consoleLogger;

  if (process.platform !== "darwin") {
    process.stderr.write("local-runner runs on macOS only (Keychain, Seatbelt, caffeinate).\n");
    return 1;
  }

  if (command === "login") {
    await login(origin);
    process.stdout.write(`Runner secret stored in the Keychain for ${origin}.\n`);
    return 0;
  }
  if (command === "logout") {
    process.stdout.write(
      (await logout(origin)) ? "Runner secret deleted.\n" : "No runner secret stored.\n",
    );
    return 0;
  }

  mkdirSync(home, { recursive: true, mode: 0o700 });
  const platformRepo = checkRepo(values["platform-repo"]);
  const repos = new RepoCache(home, values["git-base"]);

  if (command === "check-settings") {
    const sha = await repos.fetch(platformRepo);
    const dir = join(home, "check-settings");
    const platformDir = join(dir, "platform");
    const scratch = join(dir, "scratch");
    const platformProfile = join(dir, "platform.sb");
    await repos.removeWorktree(platformRepo, platformDir);
    await repos.addWorktree(platformRepo, sha, platformDir);
    writeFileSync(
      platformProfile,
      seatbeltProfile({ runnerHome: home, read: [platformDir, scratch], offline: true }),
    );
    try {
      const problem = await checkSettings({
        platform: loadPlatform({
          root: platformDir,
          confinement: seatbelt,
          profilePath: platformProfile,
        }),
        claudeCommand: values.claude,
        dir: scratch,
        runnerHome: home,
        confinement: seatbelt,
      });
      if (problem) {
        process.stdout.write(`FAIL: ${problem}.\n`);
        return 1;
      }
      process.stdout.write(
        `PASS: no project or local setting or hook loaded (platform ${sha.slice(0, 12)}).\n`,
      );
      return 0;
    } finally {
      await repos.removeWorktree(platformRepo, platformDir);
    }
  }

  if (command === "start") {
    const runsAtOnce = Number.parseInt(values["runs-at-once"], 10);
    if (!(runsAtOnce >= 1 && runsAtOnce <= RUNNER_LIMITS.runsAtOnceMax)) {
      throw new Error(`--runs-at-once must be 1 to ${RUNNER_LIMITS.runsAtOnceMax}`);
    }
    const secret = await readSecret(origin);
    if (!secret) {
      process.stderr.write(`No runner secret for ${origin}: run local-runner login first.\n`);
      return 1;
    }
    for (const runId of await cleanLeftoverAgents(home)) {
      log("WARNING", "stopped an agent a previous runner left running", { runId });
    }
    for (const name of pruneWork(home)) log("INFO", "old work directory removed", { name });
    const shutdown = new AbortController();
    // First signal: stop agents and report. Second: kill every agent now and exit.
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => {
        if (!shutdown.signal.aborted) {
          log("INFO", "stopping: finishing up the agent tasks in flight", { signal });
          shutdown.abort();
          return;
        }
        log("WARNING", "second signal: killing the agents and exiting", { signal });
        killAllAgents();
        process.exit(130);
      });
    }
    const end = await runLoop({
      api: new ControlPlane({ origin, version: VERSION }),
      secret,
      runsAtOnce,
      log,
      task: { repos, home, claudeCommand: values.claude, platformRepo, confinement: seatbelt },
      keepAwake: caffeinate(log),
      signal: shutdown.signal,
    });
    return end === "unauthorized" ? 1 : 0;
  }

  process.stderr.write(`Unknown command "${command}".\n\n${USAGE}`);
  return 1;
}

// Whatever ends the runner, its agents end with it (the watchdog covers SIGKILL).
process.on("exit", () => killAllAgents());
process.on("uncaughtException", (err) => {
  process.stderr.write(`local-runner: uncaught error: ${errorText(err)}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  process.stderr.write(`local-runner: unhandled rejection: ${errorText(err)}\n`);
  process.exit(1);
});

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`local-runner: ${errorText(err)}\n`);
    process.exit(1);
  },
);
