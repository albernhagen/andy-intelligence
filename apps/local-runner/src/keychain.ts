import { spawn } from "node:child_process";
import { KEYCHAIN_SERVICE } from "./config";

/** A runner secret as the control plane mints it (`air_` + 43 base64url characters). */
export const RUNNER_SECRET_SHAPE = /^air_[A-Za-z0-9_-]{43}$/;

export interface KeychainOptions {
  /** The macOS `security` CLI; tests pass a stub. */
  securityCommand?: string;
  /** Tests only: what the stub reads instead of the terminal prompt. */
  promptInput?: string;
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

function security(
  args: string[],
  { securityCommand = "security", promptInput }: KeychainOptions,
  interactive = false,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const piped = promptInput !== undefined;
    const child = spawn(securityCommand, args, {
      stdio:
        interactive && !piped
          ? ["inherit", "inherit", "inherit"]
          : [interactive ? "pipe" : "ignore", "pipe", "pipe"],
    });
    if (interactive && piped) child.stdin?.end(promptInput);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Stores the runner secret in the login Keychain and nowhere else. `security … -w` with no value
 * prompts for it on the terminal, so the secret never passes through this process, its argv, a
 * file or the shell history. Then reads it back once to check its shape; a wrong paste is
 * deleted again.
 */
export async function login(account: string, options: KeychainOptions = {}): Promise<void> {
  const add = await security(
    [
      "add-generic-password",
      "-U",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      account,
      "-l",
      "andy-intelligence local runner",
      "-w",
    ],
    options,
    true,
  );
  if (add.code !== 0) throw new Error(`security add-generic-password exited ${add.code}`);
  const stored = await readSecret(account, options);
  if (stored === null) {
    await logout(account, options);
    throw new Error(
      "that isn't a runner secret (air_…); mint one at /settings/runners and try again",
    );
  }
}

/** The stored runner secret for `account`, or null when none (or a malformed one) is stored. */
export async function readSecret(
  account: string,
  options: KeychainOptions = {},
): Promise<string | null> {
  const found = await security(
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
    options,
  );
  if (found.code !== 0) return null;
  const secret = found.stdout.trim();
  return RUNNER_SECRET_SHAPE.test(secret) ? secret : null;
}

/** Deletes the stored secret; false when there was none. */
export async function logout(account: string, options: KeychainOptions = {}): Promise<boolean> {
  const deleted = await security(
    ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account],
    options,
  );
  return deleted.code === 0;
}
