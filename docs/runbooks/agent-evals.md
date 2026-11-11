# Runbook — agent evals

The `agent-evals` check (AI-6: M1.17: Agent evals v1, ADR-0040, ADR-0086) tests the agent configuration like code. Workflow `.github/workflows/agent-evals.yml`, action `platform/actions/agent-evals`, runner `scripts/evals/`, cases `platform/evals/`.

## 1. What runs when

| Event                                                                                                                                | Job                    | What happens                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| PR changes `platform/procedures/**`, any `AGENTS.md`/`CLAUDE.md`, `template/AGENTS.md.template`, `.claude/**` or `platform/evals/**` | `agent-evals`          | Every case once, live model calls, runner from the base commit. Fails below 90% passing or on a case's input tokens +20% over baseline |
| PR changes nothing above                                                                                                             | `agent-evals`          | Passes without running                                                                                                                 |
| Fork PR changing the paths above                                                                                                     | `agent-evals`          | Fails: forks get no credential. Push the branch to this repo                                                                           |
| PR changes the runner (`scripts/evals/**`, the action, the workflow) or the paths above                                              | `agent-evals-plumbing` | The PR's runner on a stub model (no credential): the suite must pass, and `platform/evals/selftest/` must go red                       |
| Manual dispatch (Actions → Agent evals → Run workflow)                                                                               | `agent-evals`          | Runs always, with the chosen source, cases and procedure override                                                                      |

**Caps** (`scripts/evals/config.mjs`, ADR-0028): at most 10 cases per run (more is refused), 15 turns, $1 (`--max-budget-usd`) and 10 minutes per case, 45 minutes per job, one run per PR at a time. Subscription: when a case reports a 5-hour or weekly window at 80% (the dispatcher's quota reserve), the rest are skipped and the check passes as `skipped`, unless a case that ran failed.

**Reading the summary:** the job summary has one row per case: result, failed checks, input tokens of the first model request, baseline. It never shows the agent's text. To see what an agent said, run the case locally (§5).

## 2. Model source and how to switch it

| Source                   | Credential                                        | Set by                                                                     |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `subscription` (default) | `CLAUDE_CODE_OAUTH_TOKEN` (the reviewers' secret) | Nothing to do                                                              |
| `api-key`                | `AGENT_EVALS_ANTHROPIC_API_KEY`                   | Repo variable `AGENT_EVALS_SOURCE=api-key`, or the dispatch input `source` |
| `stub`                   | none (scripted model)                             | Only the plumbing job; `agent-evals` refuses it (it would pass every case) |

Only the selected source's secret reaches the runner; Claude Code gets a narrowed env (PATH, locale, that credential). The runner has no dependencies: nothing is downloaded but the pinned Claude Code CLI. The summary heading names the source. Switch back by deleting the variable (or setting it to `subscription`).

## 3. Setting up the API-key path (Andy, by hand)

Inert until done; selecting `api-key` before then fails with "needs the AGENT_EVALS_ANTHROPIC_API_KEY repo secret".

1. Claude Console → a workspace just for evals → **Limits**: set a monthly spend limit (the hard cap; e.g. $20). A run spends at most 10 × $1.
2. Create an API key in that workspace.
3. GitHub → repo Settings → Secrets and variables → Actions → New repository secret `AGENT_EVALS_ANTHROPIC_API_KEY`.
4. To use it: Variables → `AGENT_EVALS_SOURCE` = `api-key`; or pick `api-key` on a dispatch.

## 4. Add or change a case

1. Put the input under `platform/evals/inputs/` (a diff; optional discussion; optional files the agent may read).
2. Add `platform/evals/cases/<id>.json` (file name = `id`):

```json
{
  "id": "adversarial-planted-off-by-one",
  "agent": "adversarial-review",
  "source": "PR #22: where the case came from",
  "inputs": { "diff": "inputs/pr-22-off-by-one.diff" },
  "files": { "packages/domain/src/paging.ts": "inputs/paging.ts" },
  "expect": [
    { "check": "finding", "severity": ["blocker"], "file": "paging.ts", "mentions": ["off-by-one"] }
  ],
  "stubOutput": { "summary": "…", "findings": [{ "severity": "blocker", "…": "…" }] }
}
```

- `agent`: `adversarial-review` or `security-review` (v1).
- Checks: `finding` (at least one with that severity, optionally in a file ending `file`, mentioning any of `mentions`), `no-finding` (none of that severity), `max-findings` (at most `max`). Output always must match the agent's schema.
- `stubOutput`: what the stub model answers, so the plumbing job passes. It must satisfy `expect`.
- Every escaped bug or reverted agent PR should add a case (ADR-0040). Keep within the 10-case cap.

3. Record its baseline (§6) after the first live run.

## 5. Run it

Dispatch (the workflow must be on `main`; `--ref` picks the code and cases):

```bash
gh workflow run agent-evals.yml --ref main -f source=default
```

Prove the check goes red with the weakened procedure fixture (drops the failing-scenario and injection rules):

```bash
gh workflow run agent-evals.yml --ref main -f procedure-override=adversarial-review=platform/evals/fixtures/adversarial-review.weakened.md
```

Locally, with your own Claude Code sign-in (no secret; your `~/.claude` memory loads too, so token counts don't compare with CI):

```bash
node scripts/evals/run.mjs --source local --cases adversarial-planted-off-by-one
```

`--source stub` runs the plumbing locally; `--dir platform/evals/selftest --expect fail` the self-test.

**First live run after merge: check these, then record the result in the build log.** Neither has been seen on a live run yet.

| Check        | Pass                                                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quota scale  | The summary's "Quota: highest reading N%" roughly matches Claude's usage page. "No quota reading" means the reserve can't work: fix the parsing before relying on it. Over 200% fails the case: `utilization` isn't 0-1 |
| Token metric | Every case shows input tokens, thousands not tens (system prompt, `AGENTS.md`, procedure and inputs)                                                                                                                    |
| Weakened run | The second command above fails                                                                                                                                                                                          |

## 6. Token baselines

`platform/evals/cases/baselines.json` holds `"live": { "<case id>": <tokens> }`: input tokens of the case's first model request. A case without one is listed in the summary with its measured value, not failed. Change a baseline deliberately in a PR (it's a protected path: Andy reviews it); a Claude Code version bump (`scripts/sandbox-lab/Dockerfile`) can move them all.

## 7. Schemas the runner checks

`scripts/evals/schema-check.mjs` checks output against a JSON Schema subset (`type`, `properties`, `required`, `items`, `enum`, `description`). A schema using anything else is refused before any case runs: extend the checker (and its tests) first.
