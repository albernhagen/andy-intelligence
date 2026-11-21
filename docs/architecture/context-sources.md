# andy-intelligence — Components: context sources

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 7. Components

### 7.6 Context sources (ADR-0033, ADR-0053)
Product and domain knowledge for agents, pluggable per project, behind a `ContextSource` port. Kinds: **markdown docs** in the repo (first), MCP servers such as Notion (later), custom skills such as a design skill reading `design.md` (ADR-0045, M4).

**Project brief** (ADR-0053, M5): `docs/product/brief.md` (idea, users, vision, goals, architectural expectations, open questions), written by one onboarding interview from the `/onboard` skill (MCP) or the UI's new-project flow, both calling the API that opens it as a PR. The questions are `platform/procedures/onboard.md`; a template (`renderBrief`, no model call) writes the answers (`BriefAnswers`) and rejects a section over its word cap. Refine and plan raise a question when a ticket contradicts it; the build updates it in the same PR when Andy picks the brief. Ideate and refine read all of it, plan and build the expectations, reviews the goals. Built for agent tasks (AI-112, ADR-0117): dispatch reads it from the default branch and appends it to the prompt as an escaped, capped, untrusted `<brief>` block; refine gets all of it, plan and build the expectations; no brief, no block.

Scopes: global (Andy's standards) → project → pipeline step. Same sources for the devkit and the control plane (ADR-0032). Context is untrusted data; a project's agents see only its own sources plus global ones; credentials per project, read-only; external calls and sizes capped.
