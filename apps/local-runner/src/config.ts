import { homedir } from "node:os";
import { join } from "node:path";

/** The control plane the runner polls (ADR-0089). Not secret. */
export const DEFAULT_URL = "https://ai.andybernhagen.com";

/** Where project and platform repositories are fetched from. */
export const DEFAULT_GIT_BASE = "https://github.com";

/** The platform repository: profile, procedures, schemas and report parsing come from it. */
export const DEFAULT_PLATFORM_REPO = "albernhagen/andy-intelligence";

/** Keychain service name of the runner secret; the account is the control plane's origin. */
export const KEYCHAIN_SERVICE = "andy-intelligence-local-runner";

/** Runner caps the contract leaves to the runner (ADR-0089 §Caps, ADR-0028). */
export const LOCAL_LIMITS = {
  /** The runner exits after this long without a claimed agent task. */
  idleHours: 12,
  /** Same as the Actions executor's `context` job (ADR-0028). */
  maxTurns: 200,
  maxPromptChars: 200_000,
  /** A read-only agent's time limit, as on Actions (25 minutes), and the sandbox check's. */
  readOnlyAgentMinutes: 25,
  sandboxCheckMinutes: 5,
  /** The agent's stream is cut here; the report then says so. */
  maxAgentOutputBytes: 32 * 1024 * 1024,
  /** Kept work directories (failed or lost tasks, for inspection): older ones are removed. */
  keptWorkDirs: 10,
  /** A stopped agent gets this long after SIGTERM before SIGKILL. */
  killGraceMs: 10_000,
  /** Report attempts on a network error or 5xx. */
  reportAttempts: 3,
} as const;

/** The steps this runner runs (ADR-0089 slice 5); build and sync are slice 6. */
export const LOCAL_STEPS = ["refine", "plan"] as const;

export function defaultHome(): string {
  return process.env.LOCAL_RUNNER_HOME ?? join(homedir(), ".local-runner");
}

/**
 * The control plane's origin. HTTPS only, except a loopback host (a fake server in tests or a
 * local API), so the runner secret never travels in clear text.
 */
export function controlPlaneOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("the control plane URL must be https (http only for localhost)");
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("the control plane URL must be an origin, like https://ai.example.com");
  }
  return url.origin;
}

/** `owner/name`, as the claim names the task's repo. */
export const REPO_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

export function checkRepo(repo: string): string {
  if (!REPO_SHAPE.test(repo) || repo.includes("..")) throw new Error(`invalid repo "${repo}"`);
  return repo;
}
