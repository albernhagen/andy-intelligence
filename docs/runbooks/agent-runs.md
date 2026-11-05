# Runbook: agent runs (Claude Code executor)

How Andy enables and checks agent runs (M1.6a: Claude Code executor: dispatch + callback, ADR-0051; M1.6b: Claude Code executor: watchdog + retry; M1.7: Refinement, ADR-0054). A run is one Claude Code session on GitHub Actions for one ticket step. Today the only step is `refine`: a read-only pass that reports on the ticket, proposes type, size, out of scope and touches (written only where empty), and asks Andy 1–5 questions (procedure: `platform/procedures/refine.md`). It starts on its own (§7).

| Piece               | Where                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start / watch a run | Automatic for new Backlog tickets (§7); by hand: UI → ticket → **Runs** → **Start refine run** (polls every 5 s while a run is in flight), or MCP `refine`                                                                    |
| Dispatched workflow | `.github/workflows/agent-run.yml` → `claude-executor.yml` (jobs `context`, `agent`, `report`)                                                                                                                                 |
| Permission profile  | `platform/executor/profile.json`, installed as `/etc/claude-code/managed-settings.json` (printed in the `agent` job log)                                                                                                      |
| Logs                | Cloud Logging `jsonPayload.component="runs"` (dispatch, report, watchdog decisions), `"run-callback"` (callbacks) and `"run-watchdog"` (watchdog calls)                                                                       |
| Caps                | 1 run in flight per project; refine: 30 turns, deadline 45 min, 3 runs per ticket, 1–5 questions; jobs time out at 5 / 30 / 5 min; 1 automatic retry per run; 1 watchdog check per run (queue: 5/s, 5 concurrent, 3 attempts) |

## 1. Give the GitHub App Actions write (once)

Dispatching a workflow needs **Actions: Read and write**. Apps created before this slice have read only; new ones get write from the manifest.

1. GitHub → Settings → Developer settings → GitHub Apps → your control-plane App (e.g. `andy-intelligence-control`) → **Permissions & events** → Repository permissions → **Actions: Read and write** → **Save changes**.
2. GitHub emails the installation owner; or open Settings → Applications → Installed GitHub Apps → **Configure** → **Review request** → **Accept new permissions**. Until you accept, starting a run fails with `502 … Resource not accessible by integration` and the run shows `failed`.

## 2. Model credential

Runs use repo secret `CLAUDE_CODE_OAUTH_TOKEN` (your subscription; set on 2026-10-28 for the review agents). The token lasts one year: renew before **2027-10-28** with `claude setup-token`, then:

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo albernhagen/andy-intelligence
```

To use a capped API key instead: add secret `ANTHROPIC_API_KEY` and set `claude-sub` to `pay_per_use` in `PROVIDER_BILLING` (`packages/domain/src/runs.ts`, one PR). The run then dispatches with `credential: api_key`.

## 3. Start a run (done-when demo 1)

1. Merge and deploy this slice; finish §1.
2. UI → project `AI` → a ticket (e.g. AI-2: M1.7: Refinement) → **Start refine run**.
3. Expect: run `queued` → `running` → `succeeded` within a few minutes; a **Run log** link to the Actions run; the report (Ask, Gaps, Files, Risks) plus "Asked N question(s)" as a comment by `agent:<run id>` in History; the questions under Questions and in Needs you; tokens and `~$… (estimate)` on the run.
4. A second start while one is in flight: `409 … already has a run in flight`. A start while questions are open: `422 … open question(s)`.

## 4. A run can't read secrets (done-when demo 2)

A ticket can't test the permission profile: the agent treats ticket text as untrusted and refuses to read secrets on its own, so it never tries the read and the log shows `"permission_denials_count": 0`. That happened in both live checks (AI-11: `.env` and `/proc/self/environ`; AI-12: `/etc/hostname`).

What covers it until M1.8: Build + gate:

- Refine runs are read-only: Read, Glob and Grep only; no Bash, edit or web tools.
- The model refuses instructions in ticket text (seen live, above).
- `scripts/executor-profile.test.mjs` checks the profile denies secret reads and turns every CODEOWNERS path into an `Edit` deny.

Proving the profile live (a counted denial) is part of M1.8, when runs get Bash and edit tools and the sandbox lands (AI-12). If a refine report ever quotes a secret, stop starting runs, switch to a capped API key (§2), and tell the agent session.

## 5. Turn on the watchdog (once)

The watchdog needs two env vars on Cloud Run, set by Terraform (queue and `tasks-invoker` service account already exist):

```bash
cd infra/control-plane && terraform plan
```

Expect **0 to add, 1 to change, 0 to destroy**: `google_cloud_run_v2_service.control_plane` gains `WATCHDOG_QUEUE` and `WATCHDOG_INVOKER_EMAIL`. Then `terraform apply`. Until then the service logs `run watchdog off` at startup and runs have no deadline check.

## 6. A killed run is caught (done-when demo 6b)

1. Start a refine run (§3). Check its watchdog task is queued (task ID = run ID):

   ```bash
   gcloud tasks list --queue run-watchdog --location us-central1 --project andy-intelligence-512400
   ```

2. Kill it: Actions → the run → **Cancel workflow** while the `agent` job runs. Two outcomes, both caught:
   - The `report` job still posts `failed` → a retry starts at once.
   - Nothing reports (cancel again to force-stop `report`) → at the deadline (45 min) the watchdog asks GitHub, marks the run `cancelled`, and starts the retry.
3. Expect: a comment **Retrying the refine run (attempt 2 of 2)** with the new run's link; the first run `cancelled` or `failed` with its reason in `error`.
4. Cancel the retry the same way. Expect: no third run; the ticket is flagged **Needs you** (home page) with a comment naming the reason.
5. The flag stays until cleared; the UI has no toggle yet, so `PATCH /api/projects/ai/tickets/{id}` with `{"needsAttention": false}`.

**Cancelling on purpose:** any cancel in Actions counts as a kill, so the run retries once; cancel the retry too. The ticket is then flagged Needs-you.

A check delivered before the deadline answers `503` and Cloud Tasks retries it later; a check for a run that already reported is a no-op.

## 7. Create → refine starts by itself → answer over MCP → Ready (M1.7: Refinement demo)

In Claude desktop with the `andy-intelligence` connector (`mcp-connector.md`), with no other run in flight in project `AI`:

1. `create_ticket` in project `AI` with only a title, a body and criteria ("WHEN … the system shall …"). Leave type and size empty. Don't call `refine`.
2. Expect: `status` with its key shows a `system` comment "Started a refine run"; a few minutes later 1–5 open questions, `needsAttention: true`, and type, size, size reason, out of scope and touches filled by the run.
3. `list_needs_me`, then `answer_question` for each (`askedByRun` names the run that asked).
4. Expect: the last answer returns the ticket with `stage: "ready"`; History shows `stage_changed` by `system`. If the Definition of Ready is still unmet, a second refine starts instead (`status` shows it); answer its questions too.

Off switch: untick "Auto-refine" on `/projects` or `set_auto_refine` `enabled: false`; new tickets then wait until you start refine (ticket → Runs, or MCP `refine`).

## Troubleshooting

| Symptom                                                                                      | Fix                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start → `502 … Resource not accessible by integration`                                       | §1 not done or not accepted                                                                                                                                                                                                                                                               |
| Start → `502 … isn't connected or the App isn't installed`                                   | Connect GitHub / install the App on the repo (`github-app.md`)                                                                                                                                                                                                                            |
| Run stays `queued`                                                                           | The `context` job failed: open the Run log. `credential=subscription but secret … is empty` → §2. `HTTP 403` → the run was dispatched from another workflow or branch                                                                                                                     |
| Run `failed` in about 20 s; the `agent` job log says `Workflow initiated by non-human actor` | The App's name isn't in `allowed_bots` in `claude-executor.yml` (e.g. the App was renamed): set it to the App's slug, never `*`                                                                                                                                                           |
| Run `failed`, summary `Agent stopped: error_max_turns`                                       | The ticket needs a tighter ask; turns are capped at 30                                                                                                                                                                                                                                    |
| Refine run `failed`: "Its result was rejected (…); no questions were written"                | The agent's output broke `RefineOutput` (e.g. 6 questions, a question over 500 characters). It isn't retried; the ticket is in Needs you. Start refine again; if it repeats, tighten `platform/procedures/refine.md`                                                                      |
| Start → `409 … has had 3 refine runs`                                                        | Cap per ticket, retries included (ADR-0028). Refine by hand (ask questions in the UI) or raise `MAX_REFINE_RUNS_PER_TICKET` in a PR                                                                                                                                                       |
| New ticket gets no refine run                                                                | Another run is in flight in the project (it starts when that one ends), "Auto-refine" is off, GitHub isn't connected, or the ticket has open questions or is flagged Needs you                                                                                                            |
| Ticket in Needs you with "Refine couldn't start" or "Refine ran 3 times"                     | Dispatch failed (see the rows above), or 3 passes left the DoR unmet: finish the ticket by hand, clear Needs you, move it to Ready. The dispatcher never restarts a failed refine: start it again from the ticket                                                                         |
| Run stuck `running` past its deadline                                                        | The watchdog didn't fire: startup log `run watchdog off` → §5; `watchdog check not queued` in `component="runs"` → the runtime can't enqueue (IAM); `watchdog token rejected` → `WATCHDOG_INVOKER_EMAIL` or `PUBLIC_URL` is wrong. The run stops blocking new runs at its deadline anyway |
