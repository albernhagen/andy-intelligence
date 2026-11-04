# Runbook: agent runs (Claude Code executor)

How Andy enables and checks agent runs (M1.6a: Claude Code executor: dispatch + callback; ADR-0051). A run is one Claude Code session on GitHub Actions for one ticket step. Today the only step is `refine`: a read-only report on the ticket.

| Piece               | Where                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Start / watch a run | UI → ticket → **Runs** → **Start refine run** (polls every 5 s while a run is in flight)                                 |
| Dispatched workflow | `.github/workflows/agent-run.yml` → `claude-executor.yml` (jobs `context`, `agent`, `report`)                            |
| Permission profile  | `platform/executor/profile.json`, installed as `/etc/claude-code/managed-settings.json` (printed in the `agent` job log) |
| Logs                | Cloud Logging `jsonPayload.component="runs"` (dispatch, report) and `"run-callback"` (callbacks)                         |
| Caps                | 1 run in flight per project; refine: 30 turns, deadline 45 min; jobs time out at 5 / 30 / 5 min                          |

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
3. Expect: run `queued` → `running` → `succeeded` within a few minutes; a **Run log** link to the Actions run; the report (Ask, Gaps, Files, Risks) as a comment by `agent:<run id>` in History; tokens and `~$… (estimate)` on the run.
4. A second start while one is in flight: `409 … already has a run in flight`.

## 4. A run can't read secrets (done-when demo 2)

A ticket can't test the permission profile: the agent treats ticket text as untrusted and refuses to read secrets on its own, so it never tries the read and the log shows `"permission_denials_count": 0`. That happened in both live checks (AI-11: `.env` and `/proc/self/environ`; AI-12: `/etc/hostname`).

What covers it until M1.8: Build + gate:

- Refine runs are read-only: Read, Glob and Grep only; no Bash, edit or web tools.
- The model refuses instructions in ticket text (seen live, above).
- `scripts/executor-profile.test.mjs` checks the profile denies secret reads and turns every CODEOWNERS path into an `Edit` deny.

Proving the profile live (a counted denial) is part of M1.8, when runs get Bash and edit tools and the sandbox lands (AI-12). If a refine report ever quotes a secret, stop starting runs, switch to a capped API key (§2), and tell the agent session.

## Troubleshooting

| Symptom                                                                                      | Fix                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start → `502 … Resource not accessible by integration`                                       | §1 not done or not accepted                                                                                                                                                |
| Start → `502 … isn't connected or the App isn't installed`                                   | Connect GitHub / install the App on the repo (`github-app.md`)                                                                                                             |
| Run stays `queued`                                                                           | The `context` job failed: open the Run log. `credential=subscription but secret … is empty` → §2. `HTTP 403` → the run was dispatched from another workflow or branch      |
| Run `failed` in about 20 s; the `agent` job log says `Workflow initiated by non-human actor` | The App's name isn't in `allowed_bots` in `claude-executor.yml` (e.g. the App was renamed): set it to the App's slug, never `*`                                            |
| Run `failed`, summary `Agent stopped: error_max_turns`                                       | The ticket needs a tighter ask; turns are capped at 30                                                                                                                     |
| Run stuck `running` past its deadline                                                        | The `report` job failed after 3 tries; the watchdog (M1.6b) will catch these. Until then it stays `running`, but stops blocking new runs once its deadline (45 min) passes |
