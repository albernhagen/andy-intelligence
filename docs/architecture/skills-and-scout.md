# andy-intelligence — Components: skills (devkit) and model scout

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 7. Components

### 7.3 Skills (platform plugin, versioned) — the devkit
`/ideate`, `/refine`, `/spec`, `/plan-story`, `/build`, `/review`, `/security-review` (per PR), `/threat-model` (system review), `/verify`, `/scout-models`, (later `/digest`).
Substance lives in shared procedure docs (`docs/agent/*.md`) so non-Claude harnesses use the same knowledge; Claude skills/subagents are thin wrappers. Subagents with least-privilege tools: researcher (read-only), designer, critic (read-only), security reviewer (read-only, no shell or network), test-writer, implementer, verifier (run, no edit).

**Build runs prove their work (ADR-0040):** `/build` runs the project's lint/typecheck/test/build commands (listed in its `AGENTS.md`) and puts the results in the run summary; bug tickets commit a failing test first and don't change it afterwards; the verifier does a fresh-context final check.

**Agent evals (ADR-0040, ADR-0086; built in M1.17):** procedures and agent rules are tested like code. Each case (`platform/evals/cases/`) is an input (diff) plus deterministic checks on the review agents' structured output, run once through Claude Code under promptfoo. The `agent-evals` check runs the suite when `platform/procedures/**`, `AGENTS.md`, `template/AGENTS.md.template`, `.claude/**` or `platform/evals/**` change, and fails below 90% passing or on a case's input tokens +20% over baseline. Every escaped bug or reverted agent PR adds a case. Refine and build cases: later. Runbook `agent-evals.md`.

**Devkit (ADR-0032, design after M1: First end-to-end flow):** these procedures + skills are a product of their own, in a `devkit/` folder in this repo, published as a Claude Code plugin marketplace. It reaches tools through MCP and works without the control plane: standalone, tickets/questions/status are markdown files in the project repo. The control plane is one host for it.

**Deployment modes (ADR-0032):** `gcp` (this design) and, later, `local` (one process on the user's machine, their own subscription and GitHub). Rule from now on: GCP specifics (Firestore storage for runs/config/spend, Cloud Tasks, Firebase Auth + allow-list) go behind ports when first built or touched, so `local` only adds adapters.

### 7.4 Model scout (weekly)
1. Pull OpenRouter models API (pricing, context, availability).
2. Research recent releases and coding leaderboards (web).
3. Optionally run Ori Eval smoke tests on new candidates.
4. Read Run outcomes per tier/model.
5. Emit a **pending ConfigChange** for tiers with rationale → Needs-you inbox.
