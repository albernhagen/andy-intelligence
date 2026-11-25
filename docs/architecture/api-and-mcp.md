# andy-intelligence — Components: control plane service, API and MCP

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 7. Components

### 7.1 Control plane service (Cloud Run)
- **Public URL** (ADR-0044) — `https://ai.andybernhagen.com`: Cloud Run domain mapping (Preview, $0, Google-managed certificate); DNS-only CNAME in Cloudflare, managed by the local-only `infra/dns` root. It is `PUBLIC_URL`: OAuth issuer and MCP resource, GitHub App URLs, Actions OIDC audience, and the only Firebase sign-in domain. The default `run.app` URLs answer only `GET /health`; everything else `404`. Cloud Tasks and Scheduler target `PUBLIC_URL` too.
- **API** — REST, OpenAPI-documented, sole entry for UI and MCP. Every route, and whether it is behind the `/api` sign-in: `pnpm reference` (AI-146).
- **MCP server** — remote, Streamable HTTP at `/mcp`. Planned: `get_ticket`, `quota`, `promote_release`, `get_config`.
  - Built: every tool with its purpose, and the owner-only actions: `pnpm reference` (AI-146); runners listed and revoked (`list_runners`, AI-294; `revoke_runner`, owner only, AI-351, ADR-0143); registering stays in the app. Thin REST adapters; rule violations are tool errors. Key lookups read one ticket (`getTicketByKey`); keyless `status` and `list_projects` count by aggregation (`countByStage`, ADR-0028); `list_work` and `roadmap` read boards through the read cache (ADR-0126); the refine dispatcher reads the whole project.
  - Parity (AI-300): every signed-in `/api` route and every tool belongs to an action in `apps/api/src/parity.ts`, with its counterpart or a recorded reason; `parity.test.ts` fails otherwise. A new route or tool needs its entry.
  - **Parity rule** (AI-40, narrowed by ADR-0148): actions Andy does from Claude (tickets, questions, plans, milestones, runs) exist as a UI control, API endpoint and MCP tool, in the same PR; a new settings action may be web only, on `WEB_ONLY_ALLOWED` in `parity.ts`. Existing tools stay. Adversarial review reports gaps. Inventory and open gaps: [ui-mcp-parity.md](ui-mcp-parity.md) (AI-285: Web UI and MCP parity). Inbox order and status line: `@andy/domain`. Skill: `platform/procedures/inbox.md`.
- **Webhook receiver** — `POST /webhooks/github`: GitHub App webhooks for PRs, check runs, and workflow runs (ADR-0041). Body ≤ 1 MB → HMAC-SHA256 → ≤ 300 signed deliveries/minute per instance → event type → repo in a project → recorded once per delivery ID (`CodeEventLog`; replays are no-ops) → a new `pull_request` delivery moves its ticket (§4.1). Off unless `GITHUB_APP_ID` is set.
- **Project registration** — `POST /api/projects` with `repos`: each repo must have the control-plane App installed and belongs to one project only (`ProjectService` in `@andy/domain`). Project #1: `albernhagen/andy-intelligence` (key `AI`).
- **GitHub setup** (ADR-0043) — Settings → GitHub runs GitHub's App manifest flow: `GET /api/github/manifest`, GitHub's Create page, `/settings/github/callback` (state checked in the tab), `POST /api/github/connect` saves the App (IDs in Firestore `config/codeHost`, secrets as Secret Manager versions). Credentials are read at runtime (cached 5 minutes). `GET /api/github` lists installed repos.
- **Repo tokens for CI** — `POST /github/token`: a workflow presents its Actions OIDC token (audience = service URL); if `repository` + `workflow_ref` match `TOKEN_POLICY` it gets a 1-hour App token with contents + pull requests write on its repo (ADR-0043). Today: the system security review's `publish` job, and the executor's `publish` job (M1.8a, ADR-0063), which must also match `job_workflow_ref` and name its run (`{"runId"}`): one token per build run in flight, for the workflow run it was dispatched to.
- **Agent runs** (M1.6a, ADR-0051): [`api-and-mcp-agent-runs.md`](api-and-mcp-agent-runs.md).
- **Run completion signals** (event-driven, per executor):
  | Executor | Primary signal | Backup |
  |---|---|---|
  | Claude Code / OpenCode (Actions) | API callback from the workflow (§9 agent callback auth) | `workflow_run` completed webhook |
  | Jules | `pull_request` opened webhook on the PR Jules creates (correlated to the Run by branch/PR body) | Watchdog reads session `activities` once at deadline |
  | Direct | In-process; no signal needed | — |
- **Run watchdog** (M1.6b, ADR-0055) — each dispatched run queues one check at its deadline (Cloud Tasks, one task per run) for `POST /runs/{id}/watchdog` (§9). Unreported, it asks the executor **once**: finished → heal the Run; failed, killed or overdue → one automatic retry (as after a reported failure); a failed retry flags Needs-you.
- **Deployment reports** (AI-180: M6.4) — a project's `deploy.yml` on `main` posts `POST /deployments` before deploying and `POST /deployments/{id}/finish` after, with its Actions OIDC token (ADR-0019); stored through `DeploymentStore`. A failed report never fails the deploy. Checks: `docs/security/deployments.md`.
- **Pipeline engine** — stage transitions, DoR checks, gate rules, dependency release, retry policy. It is the supervisor of parallel work; there is no LLM parent agent (ADR-0047). From M2: conflict-aware dispatch (no two in-flight tickets touching the same files in a repo), sync runs when `main` moves. From M5: a merge queue per repo, cross-project dependencies.
- **Router** — picks the route for a step: overrides → tier routes in order → skip providers paused by quota/budget → fall back or queue.
- **Scheduled jobs** (Cloud Scheduler → authenticated endpoint): weekly **model scout**; weekly **system security review** per project when something merged since the last one (§9.1). Quota readings are captured from run results, not sampled.
- **UI** — static SPA served by the same service.
