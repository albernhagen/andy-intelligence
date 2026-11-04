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

## 4. A run can't read secrets (done-when demo 2): checked on every run

A ticket can't test this: the agent treats ticket text as untrusted and refuses to read secrets on its own (AI-11, AI-12), so the profile is never exercised. Instead every run self-tests first, in the `agent` job:

1. **Write the self-test decoy:** `.env.selftest` in the checkout, holding a random token.
2. **Permission profile self-test:** a short Haiku session with the platform's own prompt tries to `Read` the decoy (a few cents of quota, ~20 s).
3. **Check the self-test:** passes only if the read was denied (`permission_denials` ≥ 1) and the token appears nowhere in the session. It deletes the decoy either way.

- Pass: the step prints `Self-test: permission profile enforced (1 denied tool call)` and the real agent runs.
- Fail: the job stops before the real agent, the run shows `failed` with `permission profile not proven …` or `… not enforced …`, and nothing ran on the ticket. Stop starting runs and tell the agent session: the profile must be fixed (or switch to a capped API key, §2).

CODEOWNERS paths: refine has no edit tools, so an edit can't be tried live until M1.8: Build + gate; `scripts/executor-profile.test.mjs` checks that every CODEOWNERS path becomes an `Edit` deny.

## Troubleshooting

| Symptom                                                                                      | Fix                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start → `502 … Resource not accessible by integration`                                       | §1 not done or not accepted                                                                                                                                                |
| Start → `502 … isn't connected or the App isn't installed`                                   | Connect GitHub / install the App on the repo (`github-app.md`)                                                                                                             |
| Run stays `queued`                                                                           | The `context` job failed: open the Run log. `credential=subscription but secret … is empty` → §2. `HTTP 403` → the run was dispatched from another workflow or branch      |
| Run `failed` in about 20 s; the `agent` job log says `Workflow initiated by non-human actor` | The App's name isn't in `allowed_bots` in `claude-executor.yml` (e.g. the App was renamed): set it to the App's slug, never `*`                                            |
| Run `failed`, summary `Agent stopped: error_max_turns`                                       | The ticket needs a tighter ask; turns are capped at 30                                                                                                                     |
| Run stuck `running` past its deadline                                                        | The `report` job failed after 3 tries; the watchdog (M1.6b) will catch these. Until then it stays `running`, but stops blocking new runs once its deadline (45 min) passes |
