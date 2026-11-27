# Build log — status

Status lives in **tickets in project `AI`** (ADR-0047 phase 1). This page keeps only what tickets can't hold yet: pending decisions and blockers. What happened and why goes in the history: [`docs/build-log/`](build-log/), one new file per entry (`YYYY-MM-DD-<slug>.md`).

## Where to look

- **Tickets:** the UI at `https://ai.andybernhagen.com`, or the MCP `status` tool (connector `andy-intelligence`): no key → counts per stage; a key (e.g. `AI-1`) → stage, Definition of Ready gaps, questions, history.
- **Moving a ticket:** Andy, in the UI, any move; cancel and archive also over MCP `cancel_ticket` / `archive_ticket`. Sessions and agents: MCP `move_ticket`, one step forward. PRs move their ticket (AI-14): name the key in the branch, or start the description with the ticket link; opened → Ready for review, merged → Done, from any open stage (ADR-0067); closed unmerged → In progress + Needs-you.
- **Milestones:** scope and Done when in [`architecture/milestones.md`](architecture/milestones.md) (ARCHITECTURE §12); each milestone's tickets on the roadmap. Terms: [`architecture/glossary.md`](architecture/glossary.md).

## Milestone map (ADR-0060: Milestones in completion order)

Generated from tickets, never edited here (AI-148). Every ticket sits under a milestone epic in project `AI`. MCP `milestone_map` (`project: "AI"`, optional `epic` key) or `GET /api/projects/ai/milestone-map` lists each open epic's tickets: done, in review with the PR, in progress, blocked and on what, not started; "needs Andy" marks Needs-you. The board groups by epic; an epic's panel shows its child tickets. Merged M1 tickets: [`history/m1-merged-slices.md`](architecture/history/m1-merged-slices.md).

## Pending decisions (Andy)

- Epic AI-154: Dependency agent is on hold (ADR-0116: Dependency agent merged as its design; none of AI-157, AI-158, AI-163 to AI-167 starts) until Andy judges whether the AI-399: Dependabot configuration is enough.
- AI-322 UX review: approve the ranked list in [`build-log/2026-11-21-ux-review.md`](build-log/2026-11-21-ux-review.md) (AI-325 to AI-343, all in Ideas) before any is built.
- `autoMerge` on for project `AI`: after a trial of five tickets where the gate's `would_auto_merge` calls are compared with the coordinator's (Andy, 2026-11-10).
- Context sources design (open question 12).
- Final review and handoff, where everything stands and what is next: [2026-11-26-final-handoff.md](build-log/2026-11-26-final-handoff.md) (earlier: [2026-11-23 outcome](build-log/2026-11-23-review-outcome.md)).
- AI-380: GitHub does not enforce code-owner review on kept paths here; only code (`mergeVerdict`) refuses them. Keep that, or make GitHub a backstop: PRs opened by a non-owner identity (works only if the runbook `onboard-a-repo.md` §1b cause check shows `REVIEW_REQUIRED`), or 1 required approval with the App approving non-kept PRs before it merges.

## Blocked on Andy

- Firestore export before the next schema-changing deploy (runbook `ticket-core.md`); the bucket exists.
- For AI-77: Email notifications: a Resend account, a verified domain, one secret, then `terraform apply` (runbook `email-notifications.md`).
- M2: Self-hosting: the "Done when" trial (auto-build on), Andy's to start.
- M3: New UI and MCP: local executor part 7 (runbook, live proof) needs Andy's Mac (ADR-0089).
- AI-111: M5.4: First managed project live needs a second repo (runbook `managed-project.md`).
- The OpenRouter and Claude API keys (AI-266, AI-267, AI-269).
- What's new: `release-note` as a required check.
- AI-129: M4.23: First overnight run trial: which epic and budget (question in its ticket body); after the first managed project.
