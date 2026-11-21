import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { READ_ONLY_ALLOWED, READ_ONLY_DENIED, agentArgs, agentEnv, spawnAgent } from "./agent";
import { git } from "./git";
import type { Platform } from "./platform";
import { seatbeltProfile, type Confinement } from "./seatbelt";

/**
 * The live proof that a local agent loads no project or local settings and no hooks (ADR-0089
 * "Profile"): a throwaway project whose `.claude/settings.json` and `.claude/settings.local.json`
 * hold hooks on every event that touch a marker file, and allow Bash. The agent runs with the
 * exact arguments a refine gets and must read README.md (a nonce in it proves it ran a tool, so
 * PreToolUse hooks would have fired). Pass: it answered with the nonce and no marker exists.
 */

const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"];

function hookSettings(marker: string) {
  const hook = [{ matcher: "*", hooks: [{ type: "command", command: `touch '${marker}'` }] }];
  return {
    hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, hook])),
    permissions: { allow: ["Bash", "Edit", "Write", "WebFetch"] },
  };
}

export interface CheckSettingsInput {
  platform: Platform;
  claudeCommand: string;
  /** A scratch directory this check owns; removed afterwards. */
  dir: string;
  /** The runner's directory, denied to the agent like in a task. */
  runnerHome: string;
  confinement: Confinement;
  model?: string;
  signal?: AbortSignal;
}

/** Null when no project or local setting or hook loaded, else what went wrong. */
export async function checkSettings(input: CheckSettingsInput): Promise<string | null> {
  const project = join(input.dir, "project");
  // Writable under the agent's sandbox, so a hook that loads can leave its marker.
  const markerDir = join(input.dir, "markers");
  const markers = {
    project: join(markerDir, "project-hook-ran"),
    local: join(markerDir, "local-hook-ran"),
  };
  const nonce = randomBytes(8).toString("hex");
  await rm(input.dir, { recursive: true, force: true });
  await mkdir(join(project, ".claude"), { recursive: true, mode: 0o700 });
  await mkdir(markerDir, { mode: 0o700 });
  try {
    await writeFile(join(project, "README.md"), `settings-check-${nonce}\n`);
    await writeFile(
      join(project, ".claude", "settings.json"),
      JSON.stringify(hookSettings(markers.project), null, 2),
    );
    await writeFile(
      join(project, ".claude", "settings.local.json"),
      JSON.stringify(hookSettings(markers.local), null, 2),
    );
    await git(["init", "--quiet"], project);

    const settingsPath = join(input.dir, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify(await input.platform.settings("refine", project)),
      { mode: 0o600 },
    );
    // The same Seatbelt profile a task's agent gets, so this also proves Claude Code starts in it.
    const profilePath = join(input.dir, "agent.sb");
    await writeFile(
      profilePath,
      seatbeltProfile({
        runnerHome: input.runnerHome,
        read: [project, settingsPath],
        readWrite: [markerDir],
        claude: { command: input.claudeCommand },
      }),
    );
    const problem = await input.confinement.check({
      profilePath,
      checkout: project,
      runDir: input.dir,
    });
    if (problem) return `the sandbox check failed: ${problem}`;
    const run = await spawnAgent({
      ...input.confinement.wrap(
        profilePath,
        input.claudeCommand,
        agentArgs({
          model: input.model ?? "haiku",
          maxTurns: 3,
          settingsPath,
          schema: null,
          tools: { allowed: READ_ONLY_ALLOWED, disallowed: READ_ONLY_DENIED },
        }),
      ),
      cwd: project,
      env: agentEnv(),
      prompt:
        "Use the Read tool to read README.md, then reply with its first line and nothing else.",
      outputPath: join(input.dir, "agent.jsonl"),
      timeoutMs: 5 * 60_000,
      signal: input.signal ?? new AbortController().signal,
    });

    const ran = Object.entries(markers)
      .filter(([, path]) => existsSync(path))
      .map(([source]) => source);
    if (ran.length > 0) return `hooks from the ${ran.join(" and ")} settings ran`;
    if (run.exitCode !== 0) {
      return `the agent exited with code ${run.exitCode ?? "none"}: ${run.stderrTail.slice(-300)}`;
    }
    const result = run.messages?.findLast(
      (m): m is { type: string; result?: unknown } =>
        typeof m === "object" && m !== null && (m as { type?: unknown }).type === "result",
    );
    if (typeof result?.result !== "string" || !result.result.includes(nonce)) {
      return "the agent didn't answer with README.md's first line, so the check proves nothing";
    }
    return null;
  } finally {
    await rm(input.dir, { recursive: true, force: true });
  }
}
