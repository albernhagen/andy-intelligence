# andy-intelligence — Documentation

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 14. Documentation

Docs are part of the change, not a follow-up. Every slice PR updates the docs its change affects; the reviewer (Andy, or the review gate for managed projects) treats a stale doc like a failing test.

**Style:** short, plain, and readable cold — by someone with no chat history. Lead with the point. Prefer tables and lists to prose. Define a term or ID where it's used. Cut anything that doesn't change what the reader does.

| Doc | Owns | Update when |
|---|---|---|
| `context-budget.json` | Size budgets for agent-loaded docs, checked in CI (ADR-0046) | A budgeted doc is added; never raise a number without Andy |
| `docs/features.md` | Catalog of shipped features, one row each, and how to use them | A feature is added or changed |
| `README.md` | What the repo is; **How it works today** (a summary linking to `docs/features.md`; one screen, ADR-0040); how to develop/run/test, layout table, links to the docs below | Commands, env vars, packages/apps, or layout change; a feature, component or way of using the system is added or changed |
| `docs/architecture/ARCHITECTURE.md` | Overview of the target design: goals, principles, system diagram, one summary per numbered section, technology, milestone table, open questions, reading map (ADR-0061) | Design intent, a component list or the milestone table changes. No revision counter: `git log` is its history (ADR-0046). |
| `docs/architecture/<topic>.md` | Detail per topic, numbered like the overview (ADR-0061): `workflow`, `domain-and-ports`, `api-and-mcp`, `executors`, `skills-and-scout`, `ui`, `context-sources`, `template-and-baseline`, `security`, `observability-and-cost`, `milestones` (milestone/slice plan), `documentation` (this doc) | The design, scope, or plan in that topic changes. Never let it describe something the code contradicts. |
| `docs/architecture/history/` | As-built notes and merged-slice plans moved out of topic files (unbudgeted, ADR-0061) | A finished slice's notes would crowd the rules |
| `docs/architecture/adr/NNNN-*.md` | Why a decision was made (MADR) | Any architecture decision or deviation. ADR bodies are immutable; to change a decision write a new ADR and update the old one's `status` (`superseded by` / `amended by`). |
| `docs/architecture/adr/README.md` | One line per ADR: number, decision, status (ADR-0046) | With every new ADR or status change (a test checks) |
| `docs/build-log.md` | Slice → ticket map, decisions pending, blockers (≤ 1 page, ADR-0046); slice status is in tickets in project `AI` (ADR-0047 phase 1) | When a decision or blocker changes. What happened goes in a new file per entry, `docs/build-log/YYYY-MM-DD-<slug>.md` (never append to a shared file). |
| `docs/runbooks/*.md` | Steps Andy runs by hand (setup, secrets, apply, release) | Any manual step is added, changed, or removed |
| `docs/security/threat-model.md` | Assets, mitigations, risk register (`R<n>`), index of area files | A risk changes; after each system security review |
| `docs/security/<area>.md` | Trust boundaries, entry points and credentials for one area (`entry-points-and-credentials`, `agents-and-executors`, `ui-and-mcp`, `infrastructure`) | A trust boundary, entry point, credential, or IAM grant in that area is added or changed (never by the system review) |
| `docs/BUILD-PROMPT.md` | How a building agent behaves | Operating rules change |
| `AGENTS.md` (`CLAUDE.md` → symlink) | Short, always-loaded rules for agents working in the repo; nested `AGENTS.md` in `infra/`, `.github/`, `packages/contracts/` load only when working there (ADR-0046) | Rules or doc map change |
| §8.1 Project baseline inventory | Every guardrail and how managed projects get it | A quality, security, cost or scaling guardrail is added or changed |
| Package/app `README.md` | Only when a package has setup or usage the root README can't cover in a line | That package's usage changes |

Managed projects get the same rule through the template (§8): `docs/features.md` is updated on merge, `docs/architecture/overview.md` when the design changes, ADRs for decisions.

The claude.ai Project holds reference copies of `ARCHITECTURE.md` (with the topic files planning needs) and `BUILD-PROMPT.md` for planning conversations. **The repo is canonical**; refresh the Project copies when `docs/architecture/` changes on `main`.
