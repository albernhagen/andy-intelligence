# Build log — status

Slice status lives in **tickets in project `AI`** (ADR-0047 phase 1). This page keeps only what tickets can't hold yet: pending decisions and blockers. What happened and why goes in the history: [`docs/build-log/`](build-log/), one new file per entry (`YYYY-MM-DD-<slug>.md`).

## Where to look

- **Tickets:** the UI at `https://ai.andybernhagen.com`, or the MCP `status` tool (connector `andy-intelligence`): no key → counts per stage; a key (e.g. `AI-1`) → stage, Definition of Ready gaps, questions, history.
- **Moving a ticket:** Andy, in the UI (Move to …). Agents can't change a stage over MCP yet; they say in the PR which ticket it closes. From M1.8: Build + gate, runs and PR webhooks move tickets.
- **Slice definitions:** ARCHITECTURE §12. A ticket's body names its row.

## M1: First end-to-end flow: ticket → PR with Claude

Merged before the move to tickets: M1.0–M1.5, M1.10–M1.16, M1.19, M1.20 (list: [`build-log/2026-11-04-m1-slices-to-tickets.md`](build-log/2026-11-04-m1-slices-to-tickets.md)).

| Ticket | Slice                                            | Blocked by |
| ------ | ------------------------------------------------ | ---------- |
| AI-1   | M1.6a: Claude Code executor: dispatch + callback | —          |
| AI-2   | M1.7: Refinement                                 | AI-1       |
| AI-3   | M1.8: Build + gate                               | AI-2       |
| AI-4   | M1.6b: Claude Code executor: watchdog + retry    | AI-1       |
| AI-5   | M1.9: Quota capture                              | AI-3       |
| AI-6   | M1.17: Agent evals v1                            | AI-3       |

**Waves (ADR-0050):** 1. AI-1 → 2. AI-2 → 3. AI-3 → 4. AI-4 ‖ AI-5 ‖ AI-6. M1.18: Plan step is folded into M1.8.

## Pending decisions (Andy)

- `blockedBy` holds ticket **keys** (`AI-1`); ARCHITECTURE §5 says ticket ids, and nothing reads the field yet. Keep keys (readable, unique across projects) and fix §5 in M1.8: Build + gate, where the dispatcher first reads it?
- The Definition of Ready's EARS check matches only the literal "the system shall", so criteria like "the gate shall …" count as missing. Widen it to any "… shall", or write criteria that way?
- Email notifications for Needs-you (a `Notifier` adapter, S): move up from Later so the loop doesn't wait for an open tab?
- Safe deploy path for the control plane (tagged no-traffic Cloud Run revision per PR + rollback runbook): project `AI` keeps `autoMerge: none` until it exists (ADR-0050, ADR-0047 phase 2).
- Contract suites for ports with one adapter (`OAuthGrantStore`, `CodeHostConnectionStore`): keep the fakes, drop the shared suite?
- Production monitoring (alerts, error budget per project) as part of "shipped" (brief): add to M6: Dev → prod releases at slicing.
- Refine doesn't set a ticket's tier, and the Definition of Ready needs one, so answering every question leaves a tier-less ticket in Backlog. Default the tier from policy (§4.2), or let refine propose one? (M1.7: Refinement, ADR-0054)
- Refine must ask at least one question (§4.3: 1–5). Allow zero for a ticket that is already clear?
- Local mode design (open question 11); due after M1: First end-to-end flow.
- Context sources design (open question 12); due after M1: First end-to-end flow.

## Blocked on Andy

- AI-1: M1.6a: Claude Code executor: after PR #51 merges, give the GitHub App Actions write and run the demos (runbook `agent-runs.md` §1, §3, §5).
