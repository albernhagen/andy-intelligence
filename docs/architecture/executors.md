# andy-intelligence — Components: executors and agent runs

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Sections match the overview (ADR-0061).

## 7. Components

### 7.2 Executors
- **Claude Code**: reusable Actions workflow (`anthropics/claude-code-action`, `CLAUDE_CODE_OAUTH_TOKEN`); dispatched with the run ID (non-secret) as input; reports back via an API callback authenticated with the workflow's GitHub OIDC token. **Context per step** (ADR-0046): ticket snapshot, approved plan, `AGENTS.md`; subagents return summaries; `--max-turns` per step; stable prompt prefix for caching; input tokens recorded. Runs with a **permission profile** from `platform/` that the project can't override (ADR-0040): no reads of `.env*`, `*.tfvars`, Terraform state or credential files; bypass mode off; tools per step (refine and plan read-only; build edits + sandboxed Bash); edits to CODEOWNERS paths blocked at edit time.
  - **Built (M1.6a, ADR-0051):** `claude-executor.yml`; the agent's job never holds an OIDC token (`context` fetches the prompt, `agent` runs the action, `report` posts the result). Per step, `platform/procedures/<step>.md` prefixes the prompt and `<step>.schema.json` becomes `--json-schema` (ADR-0054). The profile (`platform/executor/profile.json` + CODEOWNERS edit denies, `scripts/executor-profile.mjs`) is installed as managed settings: only its rules apply; project hooks and MCP servers are off. `allowed_bots` admits only the App's bot.
  - **Built (M1.8a, ADR-0063):** the `build` step. Bash only inside Claude Code's sandbox (bubblewrap, fails closed): model and GitHub credentials unset and scrubbed, own PID namespace, writes to the checkout and git's working files in `.git` (paths that steer git stay read-only), network to the package registry. Dependencies installed first, outside the sandbox, scripts off (ADR-0072). One sandboxed Bash call is checked before the agent starts; empty sandbox placeholders are dropped from the change (ADR-0071). A `publish` job (no agent code) checks the patch's paths, pushes `agent/<KEY>/<run>` with the run's one App token and opens the PR.
  - **Built (AI-72, ADR-0083):** the `sync` step, under build's profile and sandbox: the job merges `main` into an open agent PR; the agent resolves conflicts and runs checks; `publish` checks the merge and pushes only the agent's edits.
  - **Managed repos (ADR-0096, not built):** a registered repo's `agent-run.yml` calls `claude-executor.yml@main` here; callbacks and push grant only from that caller and executor, for tasks dispatched there.
  - **Built (M1.8a, ADR-0050):** the `plan` step: read-only like refine, no publish job; `plan.md` + `plan.schema.json` (the build plan). An approved plan goes into the build's prompt; deviations are recorded.
- **Ticket context for agents** (all executors): the dispatch request carries the ticket snapshot (title, body, acceptance criteria, assumptions, answered questions). Planned (ADR-0099): a read-only token per run for `/mcp/agent`: three read tools, its project only, dead when the run settles.
- **Local** (ADR-0089): a runner on Andy's Mac polls `POST /runner/claim`, which starts a `local` ticket's agent task and returns a token for context, heartbeat (5-minute lease) and report; no runner yet.
- **OpenCode**: Actions workflow, per-project OpenRouter key, non-Claude models.
- **Jules**: REST API; its PR is detected by the PR webhook (§7.1).
- **Direct**: in-process OpenRouter calls for single-call steps (sizing, digests, scout analysis).
