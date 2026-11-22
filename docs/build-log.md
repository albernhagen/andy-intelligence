# Build log — status

Slice status lives in **tickets in project `AI`** (ADR-0047 phase 1). This page keeps only what tickets can't hold yet: pending decisions and blockers. What happened and why goes in the history: [`docs/build-log/`](build-log/), one new file per entry (`YYYY-MM-DD-<slug>.md`).

## Where to look

- **Tickets:** the UI at `https://ai.andybernhagen.com`, or the MCP `status` tool (connector `andy-intelligence`): no key → counts per stage; a key (e.g. `AI-1`) → stage, Definition of Ready gaps, questions, history.
- **Moving a ticket:** Andy, in the UI, any move; cancel and archive also over MCP `cancel_ticket` / `archive_ticket`. Sessions and agents: MCP `move_ticket`, one step forward. PRs move their ticket (AI-14): name the key in the branch, or start the description with the ticket link; opened → Ready for review, merged → Done, from any open stage (ADR-0067); closed unmerged → In progress + Needs-you.
- **Slice definitions:** [`architecture/milestones.md`](architecture/milestones.md) (ARCHITECTURE §12). A ticket's body names its row.

## Milestone map (ADR-0060: Milestones in completion order)

Generated from tickets, never edited here (AI-148). Every ticket sits under a milestone epic in project `AI`. MCP `milestone_map` (`project: "AI"`, optional `epic` key) or `GET /api/projects/ai/milestone-map` lists each open epic's tickets: done, in review with the PR, in progress, blocked and on what, not started; "needs Andy" marks Needs-you. The board groups by epic; an epic's panel shows its stories. Merged M1 slices: [`history/m1-merged-slices.md`](architecture/history/m1-merged-slices.md).

## Pending decisions (Andy)

- AI-322 UX review: approve the ranked list in [`build-log/2026-11-21-ux-review.md`](build-log/2026-11-21-ux-review.md) (AI-325 to AI-343, all in Ideas) before any is built.
- Contract suites for ports with one adapter (`OAuthGrantStore`, `CodeHostConnectionStore`): keep the fakes, drop the shared suite?
- Production monitoring (alerts, error budget per project) as part of "shipped" (brief): add to M6: Dev → prod releases at slicing.
- `autoMerge` on for project `AI`: after a trial of five tickets where the gate's `would_auto_merge` calls are compared with the coordinator's (Andy, 2026-11-10).
- Context sources design (open question 12).
- ADR-0094: Local executor build choices (AI-79, PR review): accept the six, or change any?
- ADR-0097: Review findings → config proposals (AI-100): accept the two-PR plan, the 3-PR threshold and `AGENTS.md` as the only target?
- ADR-0096: Managed repos call one executor (AI-83): executor at `@main`, one repo per project? (Question 1 answered 2026-11-21: environment `agent` on `main`; built in AI-106.)
- ADR-0099: Agent read access (AI-97): steps, tools, live or bundled?
- ADR-0108: Roadmap view over epics, and fixed work views (M4.24 to M4.31): accept one new epic field (`outcome`), Done-when as the epic's acceptance criteria, and the five views?
- AI-144: Threat model: one file per risk: cap each risk file at 300 words and `threat-model.md` at 1000 (was 3600)?
- ADR-0111: Re-sync open PRs: its App token?
- ADR-0133: Board and ticket list read changed tickets (AI-317): accept the 60 s overlap and the hourly full re-read?
- Review handover with every open question and PR: [2026-11-21-handover-review.md](build-log/2026-11-21-handover-review.md).
- ADR-0134 (PR #328, AI-215: Merge modes): fail the review check on should-fix findings?
- AI-113: M5.14: baseline on a new repo: App opens the PR without workflows, Andy adds them?
- Re-sync cap (`scripts/resync-prs.mjs`, 4 an hour): raise to 12 and skip counting skipped runs?
- ADR-0136: Milestone create and edit over MCP (AI-321, PR #343): extend ADR-0131 to five MCP milestone tools?
- ADR-0140: Review check fails when not reviewed (AI-346, PR #356): carry verdicts over re-sync merges, and fail repos with no token?
- ADR-0141: Agent PRs get a real review (AI-348, PR to come): allow the App on `agent/*` branches only?

## Blocked on Andy

- Firestore export before the next schema-changing deploy (runbook `ticket-core.md`); the bucket exists.
- For AI-77: Email notifications: a Resend account, a verified domain, one secret, then `terraform apply` (runbook `email-notifications.md`).
- M2: Self-hosting: the "Done when" trial (auto-build on), Andy's to start.
- M3: New UI and MCP: local executor slice 7 (runbook, live proof) needs Andy's Mac (ADR-0089).
- AI-111: M5.4 needs a second repo.
- AI-307: M4.37: Create project AI's milestones; the OpenRouter and Claude API keys (AI-266, AI-267, AI-269).
- What's new: the backfill (runbook `whats-new-backfill.md`) and `release-note` as a required check; `terraform apply` of `infra/control-plane` for PR #217.
- M4 questions, each in its ticket body: AI-128: M4.15: Pluggable design skills (build now or move to Later), AI-129: M4.23: First overnight run trial (which epic and budget).
