# 2026-11-20 — Coordinator tools in the repo; pre-push runs affected tests only

AI-149: Coordinator tools in the repo, and a lighter pre-push hook for parallel sessions (epic AI-140: Parallel development without merge conflicts).

## Why

From 2026-11-12 to 11-20 the coordinator ran about fifteen workers on one Mac and wrote its PR survey, merge queue and re-sync as throwaway scripts in a temp folder; a cleanup deleted them. Ten workers pushing at once each ran the full suite (2,624 tests) in the pre-push hook and starved the machine. A closed lid froze every session for four days and looked like failing tests.

## What changed

- `scripts/coordinator/`: `survey`, `merge-queue`, `resync`, `host-check` (runbook `coordinating-sessions.md` §6). `merge-queue` and `resync` change remote state and are for a coordinator under ADR-0120 only.
- Pre-push runs typecheck and `vitest run --changed origin/main` (ADR-0113: proposed). CI still runs the full suite.
- `scripts/cloud-setup.sh` and runbook §7: Running sessions in the cloud (untested until AI-151).

## Measured (14-core Mac, shared with other sessions)

| Hook                   | 1 push                                      | 3 at once                   | 5 at once                                       |
| ---------------------- | ------------------------------------------- | --------------------------- | ----------------------------------------------- |
| Before (full suite)    | 44 s, 177 CPU-s (load 6 → 34)               | 75 s each                   | not run                                         |
| After (affected tests) | 26 s at load 37; 74 s at load 124; 41 CPU-s | 84–90 s each at load 36–170 | 110–113 s each at load 123–127; no hook timeout |

Wall times after the change were taken while other sessions held the load at 36 to 170, so compare CPU-seconds: about 180 per push before, about 41 after. Typecheck (about 30 CPU-s) is now most of a push. In the five-at-once run, one real-git test of `resync` timed out at vitest's 5 s default; its suite now allows 30 s, as other real-git suites do.

## Seen while building

`host-check` on 2026-11-20 at 17:30: lid closed, macOS set to sleep on it (no external display), one clamshell sleep in the last hour, load 65 on 14 cores.
