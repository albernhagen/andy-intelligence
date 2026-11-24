---
title: "A case on every milestone: who it serves, expected return, cheapest test; effort derived"
status: accepted (AI-365, 2026-11-23)
date: 2026-11-23
extends: 0131 (milestones)
---

# 0149 — A case on every milestone

AI-365: A case on every milestone before Andy approves it: who it serves, effort and expected return. From the 2026-11-23 product and architecture review: nothing helps Andy decide whether a milestone is worth building. AI-355: Product discovery before the brief covers a new project; this covers each milestone.

## Decision Outcome

| Topic    | Decision                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model    | A milestone (ADR-0131) gains an optional `case`: `serves` (who gains), `expectedReturn` (what they gain, and how Andy will know), `cheapestTest` (how to test it is worth building first); each 1 to 300 characters, all three or none. Additive (ADR-0035): stored milestones without one still parse.                                                                                                        |
| Effort   | Not stored. The roadmap derives it on read: the milestone's tickets (not epics, not Cancelled) and how many are S, M, L or unsized. A stored estimate would drift from the tickets.                                                                                                                                                                                                                            |
| Shown    | The roadmap's open not-reviewed row shows the case and effort beside the status control; with none it says "No case written yet" and approving still works. A reviewed milestone shows its case only if one was written. MCP `roadmap` returns both.                                                                                                                                                           |
| Edits    | Owner only, in the web UI or MCP `create_milestone` / `edit_milestone` (or the milestone route); `case: null` removes it. Each change is a milestone config change (entity `milestone`): logged with who, when and before/after, revertable like other fields.                                                                                                                                                 |
| Plans    | `plan-project` writes a case per proposed milestone (required in its agent schema, optional in the stored proposal). Approving a plan now also creates one not-reviewed milestone per planned milestone (name `M<N>: <title>`, outcome = goal, its case) and attaches its epic, so the case shows where Andy approves or parks it. Resuming an approval finds a milestone it already made by name and outcome. |
| Not done | No automatic scoring or ranking of milestones; agent tasks get no web access, so a case comes from the brief only.                                                                                                                                                                                                                                                                                             |

### Consequences

- Good: Andy sees who a milestone serves, what it returns, how to test it cheaply and how big it is, where he approves or parks it.
- Bad: a new project's tickets wait until Andy approves its first milestone (ADR-0131's rule for not-reviewed milestones): one more step after approving a plan. A case is untrusted agent text, shown as plain text and never followed.
