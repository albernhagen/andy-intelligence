# 2026-11-09: Daily digest

AI-70: Daily digest: exceptions first (rework, reverts, blocked, waiting on Andy), then what merged and what it cost; a page and an MCP tool. Decision: ADR-0081: Daily digest, computed on read.

- One pure builder, `buildDigest` in `packages/domain/src/digest.ts`, feeds the page `/p/<project>/digest`, `GET /api/projects/{p}/digest` and MCP `digest`. `DigestReader` gathers the data in a bounded number of reads.
- One new store read: `RunStore.listEndedBetween` (port, in-memory fake, contract test, Firestore adapter). Firestore reads at most 500 documents (`orderBy(endedAt desc).limit`) on `endedAt`'s automatic index and filters the project in memory: no composite index, so no Terraform change. Review (PR #124) asked for the project in the query; that needs a composite index and an apply, so it waits for Andy.
- No schema change and no `SCHEMA_VERSION` bump: the digest is a read model, never stored. No scheduler.
- "Who merged" is not recorded anywhere, so it is inferred from the run that links to the PR: `gate` when its merge attempt succeeded, else `andy` (a coordinator merge through Andy's account reads as Andy); `unknown` when no run links to it. PRs are keyed by URL, so two repos in one project don't collide.
- Waiting, blocked, dispatch idle and quota are current state, so they only appear when the window reaches now; a past window with no events is one line ("nothing happened").
- Left out: "since the previous digest view" from the ticket body (needs stored per-viewer state; the window covers it); delivery by email or push; cross-project rollups.
- The API route is `apps/api/src/digest.ts`, beside `board.ts` and `quota.ts`, not a new `routes/` folder, to keep one pattern.
