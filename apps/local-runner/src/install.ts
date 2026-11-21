import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { binaryDir, seatbeltProfile, type Confinement } from "./seatbelt";

/**
 * A build's dependencies, installed before the agent starts, as on Actions (ADR-0072): pnpm with
 * a frozen lockfile, no lifecycle scripts and no pnpmfile, so nothing from the project runs.
 * Under the runner's Seatbelt profile: network on (the registry), no Keychain, writes only the
 * checkout and this task's own store and home. A project without `pnpm-lock.yaml` installs
 * nothing.
 */

export type InstallResult =
  { kind: "installed" } | { kind: "skipped" } | { kind: "failed"; reason: string };

export interface InstallInput {
  checkout: string;
  runDir: string;
  runnerHome: string;
  confinement: Confinement;
  timeoutMs: number;
  signal: AbortSignal;
  /** The pnpm command; tests pass a stub. */
  pnpm?: string;
}

export async function installDependencies(input: InstallInput): Promise<InstallResult> {
  if (!existsSync(join(input.checkout, "pnpm-lock.yaml"))) return { kind: "skipped" };
  const pnpm = input.pnpm ?? "pnpm";
  const home = join(input.runDir, "install-home");
  const store = join(input.runDir, "pnpm-store");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(store, { recursive: true, mode: 0o700 });
  const profilePath = join(input.runDir, "install.sb");
  const pnpmDir = binaryDir(pnpm);
  await writeFile(
    profilePath,
    seatbeltProfile({
      runnerHome: input.runnerHome,
      read: pnpmDir ? [pnpmDir] : [],
      readWrite: [input.checkout, home, store],
      noKeychain: true,
    }),
    { mode: 0o600 },
  );
  const wrapped = input.confinement.wrap(profilePath, pnpm, [
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--store-dir",
    store,
  ]);
  return new Promise((resolve) => {
    execFile(
      wrapped.command,
      wrapped.args,
      {
        cwd: input.checkout,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: home,
          XDG_CACHE_HOME: join(home, ".cache"),
          XDG_DATA_HOME: join(home, ".local", "share"),
          CI: "1",
        },
        timeout: input.timeoutMs,
        signal: input.signal,
        maxBuffer: 16 * 1024 * 1024,
      },
      (err, _stdout, stderr) => {
        if (!err) {
          resolve({ kind: "installed" });
          return;
        }
        const tail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
        resolve({ kind: "failed", reason: `pnpm install failed${tail ? `: ${tail}` : ""}` });
      },
    );
  });
}
