# 2026-11-01 — PR #14, PR #15 and PR #16 merged; M1.2: Ticket core built

- Merged: PR #14: Project baseline, deployment modes, context sources plan (ADR-0031, ADR-0032, ADR-0033); PR #15: format system-review threat-model edits; PR #16: M2: Multi-project in parallel and data evolution plan (ADR-0035).
- **Decided (Andy):** Andy can force any stage move with a reason (recorded in history; agents can't); Firestore backups kept 7 days; epics need only intent + no open questions; Firestore adapter suite runs locally only, not in CI (ADR-0034: Contract suites that need an emulator run locally).
- Branch `m1.2/ticket-core`: `WorkTracker` port reshaped around Project/Ticket/TicketEvent/Question (every write appends its event atomically) + fake + contract suite; `packages/domain` (stage moves, Definition of Ready, Needs-you); `FirestoreWorkTracker`; ticket REST API (`/api/projects…`, `/api/needs-you`, 256 KB body cap); Terraform: Cloud Tasks `run-watchdog` queue (capped), `tasks-invoker` SA, daily Firestore backup. Runbook `docs/runbooks/ticket-core.md`.
- Verified locally: lint, typecheck, 83 tests, build; Trivy clean. Not run here: `terraform validate` (no registry access; CI runs it) and `pnpm test:firestore` (no Java; Andy runs it).
- Open on `main`: Dependabot alerts for `@grpc/grpc-js` (high, low; via `firebase` web SDK), `glob`, `minimatch` (medium); no fix PRs yet.
