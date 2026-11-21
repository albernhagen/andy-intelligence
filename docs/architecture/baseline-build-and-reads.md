# andy-intelligence — §8.1 baseline: build runs and read caps

Rows moved unchanged from the §8.1 table in [template-and-baseline.md](template-and-baseline.md) to keep it within its word budget.

| Guardrail | ADR | Source in this repo | Carried by | Status |
|---|---|---|---|---|
| Build runs: `autoBuild` switch; `planApproval`: an approved read-only plan first, owner-only decision, ≤ 3 plan runs, stale after a ticket or policy change or 72 h; Bash only in the sandbox (registry-only network, credentials unset and scrubbed), live-checked by one sandboxed Bash call before the agent; `.git` paths that steer git checked and `.git` restored after it; sandbox placeholders dropped; publish job refuses protected paths, symlinks, > 200 files or > 5 MB; one App token per build run; ≤ 4 builds per ticket | 0028, 0063, 0071 | `packages/domain/src/build{s,-dispatch}.ts`, `profile.json` `steps.build`, `claude-executor.yml` (`publish`), `scripts/executor-{publish,sandbox}.mjs`, `apps/api/src/github/token.ts`, `packages/domain/src/plans.ts` | — | built (M1.8a); managed repos with the reusable workflow (M5) |
| Read caps (AI-222): `status` reads a ticket, its blockers and its lane, never the project; an unchanged board or ticket list is one counter read (cache 5 min, 200 views per instance); blocker and epic chains capped at 200 reads; the google-sub task count reads at most 500 runs and reads as 100% used past it (AI-232); tests count reads | 0028, 0126 | `packages/domain/src/{project-versions,ticket-reads,jules-quota}.ts`, `apps/api/src/reads.test.ts` | — | control plane only |
