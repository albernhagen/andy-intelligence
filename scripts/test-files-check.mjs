#!/usr/bin/env node
// Whole-suite guard for sharded tests (AI-402): each shard runs with --passWithNoTests, since one
// shard of a small suite may hold no files. So a broken test glob can't pass every shard, shard 1
// first pipes `vitest list --filesOnly` (the whole suite, unsharded) here, and this fails when it
// lists no test files.
//
// CLI: reads the listing from stdin, prints the count, exits 1 when it is zero.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Counts the test files in a `vitest list --filesOnly` listing (one per non-blank line). */
export function countTestFiles(listing) {
  return listing.split("\n").filter((line) => line.trim() !== "").length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = countTestFiles(readFileSync(0, "utf8"));
  process.stdout.write(`Test files in the whole suite: ${count}\n`);
  if (count === 0) {
    process.stdout.write("::error::No test files found: the test step would pass with no tests\n");
    process.exit(1);
  }
}
