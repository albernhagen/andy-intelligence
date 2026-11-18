import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Every test run gets its own temporary directory, removed when the run ends (pass or fail).
 * Many suites make throwaway git repositories and checkouts with `mkdtemp(tmpdir())`; left in the
 * shared temporary directory they piled up (over 100,000 entries), and macOS's cleaner then kept
 * the disk busy enough to push slow tests past their timeouts. Workers and the processes tests
 * start inherit `TMPDIR`, so they all write under this run's directory.
 */
export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), "andy-test-run-"));
  const before = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  return () => {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    rmSync(dir, { recursive: true, force: true });
  };
}
