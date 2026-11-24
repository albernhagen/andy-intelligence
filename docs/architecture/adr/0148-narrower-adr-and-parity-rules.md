---
title: "Narrower rules: ADRs only for trust boundaries, the data model and who merges; MCP parity only for actions Andy does from Claude"
status: accepted (Andy, 2026-11-23)
date: 2026-11-23
amends: 0001 (which decisions get an ADR), 0022 (the docs table's ADR row); the AI-40 parity rule (no ADR of its own)
---

# 0148 — ADRs only for trust boundaries, the data model and who merges; MCP parity only for actions Andy does from Claude

Andy's decision ("light trim") in the 2026-11-23 product and architecture review. Built by AI-359: Narrower rules: ADRs only for trust boundaries, the data model and who merges; MCP parity only for actions Andy does from Claude.

## Context and Problem Statement

Two rules had grown past what they protect:

- **ADRs.** ADR-0001: Decisions as MADR and `BUILD-PROMPT.md` asked for an ADR for every architecture decision or deviation. By 2026-11-23 there were 129 ADRs and 30 still `proposed` while their code was merged: most recorded build choices (a script, a check, a doc layout) Andy never needed to decide, and the queue of open ones hid the few that mattered.
- **Parity.** The AI-40 parity rule (`docs/architecture/api-and-mcp.md`, enforced by `apps/api/src/parity.ts` from AI-300) asked for every web action to have an MCP tool too: 83 tools. Andy works tickets, questions, plans, milestones and runs from Claude, and changes settings in the web app.

## Decision Outcome

**1. An ADR is required only for:**

| Kind             | Examples                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| A trust boundary | A credential, an entry point, a sandbox, an IAM grant, what untrusted input can reach |
| The data model   | An entity, a stored field, a collection, a schema version                             |
| Who merges       | The gate, merge modes, review verdicts, who may merge what                            |

Any other build choice goes in the PR description (and the topic file when the design changes). Changing an existing ADR's decision still takes a new ADR. Rule text: `AGENTS.md` docs table, `docs/architecture/documentation.md`, `docs/BUILD-PROMPT.md`.

**2. MCP parity is required only for actions Andy does from Claude:** tickets, questions, plans, milestones, runs. A new settings action may be web only. Existing MCP tools stay; none is removed.

- `parity.ts` holds `WEB_ONLY_ALLOWED`, the explicit list of actions allowed without a tool (today: register a runner, OAuth consent, GitHub App setup). `webOnlyViolations` fails a web-only action that is off the list, and any web-only action whose route is under tickets, questions, the Needs-you inbox, plans, milestones, runs or the night launch, even when listed.
- An open gap with its ticket (`pending`) is not counted: it is being closed.
- Inventory and rule text: `docs/architecture/ui-mcp-parity.md`.

**3. The proposed ADRs** are listed once for Andy to decide in one sitting: `docs/build-log/2026-11-23-proposed-adrs.md`. ADR-0133: Board and ticket list read changed tickets is accepted by Andy on the ticket and left out of it.

### Consequences

- Good: fewer ADRs to write and decide; the ones left are the ones Andy must see. New settings ship without an MCP tool.
- Good: the parity test now refuses a web-only ticket, question, plan, milestone or run action, where before a `oneSide` reason was enough.
- Bad: why a build choice was made lives in a PR description, found through `git log` or the PR, not the ADR index.
- Bad: a settings change can't be made from Claude unless an existing tool already covers it.
- Not changed: managed projects' `template/AGENTS.md.template` still says "A decision → a new ADR"; carrying this rule there is separate work.
