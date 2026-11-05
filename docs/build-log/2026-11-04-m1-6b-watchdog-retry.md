# 2026-11-04 — M1.6b: Claude Code executor: watchdog + retry (AI-4)

- Run ahead of ADR-0050's wave 4 (Andy's call): its only dependency, AI-1: M1.6a: Claude Code executor: dispatch + callback, had merged. Built in parallel with AI-2: M1.7: Refinement; both touch `RunService` (hand-over notes in the PR).
- Built: `WatchdogQueue` port (fake, contract suite) and its Cloud Tasks adapter (`@andy/store`, one named task per run); `Run.attempt` and `Run.retryOf`; `RunService.checkDeadline` plus the rules in `packages/domain/src/watchdog.ts`; `POST /runs/{id}/watchdog` with Google OIDC verification of the `tasks-invoker` service account; env vars `WATCHDOG_QUEUE` and `WATCHDOG_INVOKER_EMAIL` in `infra/control-plane`.
- Choices (ADR-0055): a retry is a new Run through the normal start path; reported failures retry too; a check before the deadline answers `503` so the queue tries later.
- The queue and invoker service account already existed (M1.2: Ticket core); only the two env vars need an apply.
- Andy: apply `infra/control-plane` (0 add, 1 change, 0 destroy), then run the demo (runbook `agent-runs.md` §5–6). Not live-verified yet: a real Cloud Tasks delivery and its OIDC token.
- Follow-up: the UI can't clear a Needs-you flag yet (PATCH only).
