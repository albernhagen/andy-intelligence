---
status: accepted (direction; detailed design after M1: First end-to-end flow)
date: 2026-11-01
---

# 0033 — Pluggable context sources

Decided by Andy, 2026-11-01.

## Context and Problem Statement

Agents need to know the product and its domain, not just the code: what the product is for, who uses it, domain terms, business rules, prompts Andy wants applied. Some of that lives in other systems (e.g. Notion). Today the plan gives agents only in-repo engineering docs (`docs/features.md`, `docs/architecture/overview.md`, ADRs, specs) and the ticket snapshot. With many projects, each needs its own context, and some context (Andy's standards) is shared by all.

## Decision Outcome

**Context source** = anything that gives agents product or domain knowledge. The architecture supports three kinds, each optional per project:

| Kind          | What                                                                                                             | Now?                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Markdown docs | Handwritten or copied-in snapshots (product brief, glossary, users, business rules, prompts) in the project repo | Yes: the only kind needed now |
| MCP servers   | Registered per project, read-only tools (Notion first, when wanted)                                              | Later                         |
| Custom skills | A skill that brings its own context or tools                                                                     | Later                         |

**Scopes:** global (Andy's standards and preferences) → project (that product's docs and sources) → pipeline step (e.g. refine gets the glossary).

**Rules**

- Same sources for the devkit and the control plane (ADR-0032), so standalone and `gcp` behave the same.
- Context is untrusted data, never instructions.
- A project's agents see only that project's sources plus global ones.
- MCP credentials are per project and read-only; external calls and sizes get caps (ADR-0028).
- Behind a `ContextSource` port; no vendor terms in the domain.
- Detailed design (folder name, manifest format, step mapping, port shape) after M1: First end-to-end flow. No integration is built now.

### Consequences

- Good: agents get product knowledge, not just code; adding a source is configuration, not code; works the same in every deployment mode.
- Bad: another trust boundary per external source (prompt injection, data exposure) to add to the threat model when the first one is built; snapshots can go stale.
