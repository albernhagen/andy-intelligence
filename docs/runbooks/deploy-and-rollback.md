# Control-plane deploy and rollback — runbook (Andy)

How a merge reaches `control-plane` on Cloud Run, and how to go back (ADR-0076: Control-plane deploy: no-traffic revision, smoke test, then traffic; ADR-0114: Dev → prod releases design).

| Term       | Meaning                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Revision   | One immutable deployed version of the service, e.g. `control-plane-00042-abc`.                                      |
| Candidate  | The revision a deploy just made. It has no traffic and the tag `candidate`.                                         |
| Tagged URL | `https://candidate---<service host>`: reaches the candidate only. The API answers `/health` alone there (ADR-0044). |

## 1. How a deploy proceeds

Runs on push to `main` (not docs-only or `infra/`-only pushes, not bot merges) or by hand (`workflow_dispatch`, on `main` only: the deployer identity is bound to `refs/heads/main`). Workflow `deploy.yml`, action `platform/actions/cloud-run-safe-deploy`.

| Step                                                                                                                                       | On failure                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Record the serving revision                                                                                                                | Nothing deployed.                                                           |
| Deploy the candidate with no traffic                                                                                                       | Traffic stays.                                                              |
| Smoke test the candidate: `/health` 200, `/api/me` 404 (host rule)                                                                         | Traffic stays; job fails.                                                   |
| Tag the image `release-<digest hex>` so registry cleanup keeps it (AI-389: M6.23)                                                          | Traffic stays; job fails.                                                   |
| Move traffic to the candidate                                                                                                              | Check the summary: traffic may have moved.                                  |
| Check it serves 100 percent; smoke test the public URL: `/health` 200, `/api/me` 401, and on the run.app host `/health` 200, `/api/me` 404 | **The candidate is serving: roll back (§3).** Nothing rolls back by itself. |

`/api/me` 401 needs the public host, which only reaches a revision with traffic, so it runs after the move. **A revision with broken auth therefore serves until you roll back.**

## 2. Read the job summary

Actions → _Deploy control plane_ → the run → Summary: one verdict line, the serving revision before, the candidate, the serving revision after, and the rollback command with real names.

**First deploy after this ships:** expect "Deployed.", _Serving before_ `<old>=100`, _Serving after_ `<candidate>=100`, and the site working.

| Verdict                | Do                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Deployed.              | Nothing.                                                                                                                            |
| Traffic did not move   | Read the failed step's log, fix forward with a new PR. The job removes the candidate tag; its revision stays listed for inspection. |
| Traffic may have moved | Compare _Serving after_ with _Serving before_; if different, §3.                                                                    |
| It is serving traffic  | §3 now, then fix forward.                                                                                                           |

**Deployment record (AI-180: M6.4).** The job reports each deploy to the control plane, which records it as a Deployment (`started`, then `succeeded` or `failed` with the serving revision). The summary says "Deployment … recorded as …". "⚠️ Deployment not recorded in the control plane" means the report failed (control plane unreachable, a refused token, or the first deploy that ships this route, which reports to the old revision): the deploy itself is unaffected and nothing needs doing. Checks and caps: [`docs/security/deployments.md`](../security/deployments.md). **The first deploy after AI-190: M6.11 merges is not recorded either**: `deploy.yml` then sends `environment`, `kind` and `url`, which the old revision refuses (`400`). Nothing needs doing.

## 3. Roll back

Takes under 5 minutes, usually under one. Two ways: the release workflow (recorded, checked), or `gcloud` by hand (§3b).

### 3a. With the release workflow (AI-190: M6.11)

**From the UI or MCP (AI-199: M6.12):** the Releases page's **Roll back prod** (a confirm names the revision that will serve), or MCP `rollback` with project `AI` (no revision: the one before what serves now). It records a release request and starts this workflow; its status shows under the buttons and in `list_release_requests`:

| Request status         | Meaning                                                                                                  | Do                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| waiting / running      | The run is queued or moving traffic                                                                      | Wait; read the run's summary (link on the request).          |
| succeeded              | The revision serves                                                                                      | §4.                                                          |
| not started            | The control plane couldn't start the workflow (the reason says why, e.g. the App lacks `actions: write`) | Fix the cause or use the Actions tab below; nothing changed. |
| cancelled              | GitHub cancelled the run, usually because a deploy took its place in the queue                           | Ask again once the deploy finishes.                          |
| ended without a result | The run ended without reporting                                                                          | Read the run's summary; §4.                                  |

`429` means a release request for the project was made in the last minute: wait and ask again. **By hand from the Actions tab** (always works, recorded without a request):

1. Find the revision: the last good Deployment's revision, or `gcloud run revisions list` below.
2. Actions → _Release control plane_ → **Run workflow**, branch `main`; `action` = `rollback`, `environment` = `prod`, `revision` = the revision; leave `digest` and `request` empty.
3. Read the run's summary: "Rolled back." means the revision serves 100 percent and `/health` answered 200.

| Summary or failure                             | Meaning                                                       | Do                                        |
| ---------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| Fails at _Check the inputs_                    | Bad input (not on `main`, no revision, a digest given too)    | Fix the input; nothing changed.           |
| Fails at _Check the digest or revision exists_ | The revision is not `control-plane`'s, or not ready           | Pick another revision; nothing changed.   |
| Traffic did not move / could not be pinned     | The pin failed                                                | Compare _Serving after_; §3b if needed.   |
| Traffic moved, but the check failed            | The revision serves but `/health` or the traffic check failed | §4 now; the summary has the command back. |

- A promote stops before traffic moves if the control plane refuses it (no succeeded dev deployment of that digest).
- If traffic moved but a check failed, the Deployment is `failed` but names the revision now serving.
- A run waits while a deploy or another release to prod runs (one queue per environment, so a rollback never races a deploy for traffic). GitHub keeps one waiting run: **a merge that starts `deploy.yml` while your rollback waits cancels the rollback**. A request from the UI or MCP shows _cancelled_ within about 45 minutes; a run started by hand: watch it. Either way, run it again once the deploy finishes.
- `promote` doesn't apply to the control plane (prod-only, no dev).
- It records a `rollback` Deployment, unless the target's image digest has no succeeded deployment among the last 100 in prod (older than the records, or deployed before AI-180: M6.4): then the summary says "Deployment not recorded" and the rollback still runs.
- Rolling back to a revision from before AI-190: M6.11 loses the finish report (that revision refuses `release.yml`), so the record stays `started`; the rollback itself is unaffected.
- Like any rollback, traffic stays pinned until the next deploy (§5).

### 3b. By hand

Copy the command from the summary, or find the last good revision and pin it:

```bash
gcloud run revisions list --service control-plane --region us-central1 --limit 5
```

```bash
gcloud run services update-traffic control-plane --region us-central1 --to-revisions=<REVISION>=100
```

Traffic moves when the command returns. Revisions are kept, so any recent one works unless its data expectations no longer hold (§5).

## 4. Check afterwards

```bash
gcloud run services describe control-plane --region us-central1 --format='value(status.traffic)'
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ai.andybernhagen.com/health
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ai.andybernhagen.com/api/me
```

Expect 100 percent on the revision you chose, then `200`, then `401`. Open the board and sign in.

## 5. Things to know

- **After a rollback or a failed deploy, traffic is pinned to one revision.** A Terraform apply that changes the service makes a new revision that gets no traffic. The next successful deploy returns traffic to latest. To go live sooner: `gcloud run services update-traffic control-plane --region us-central1 --to-latest`, only if the latest revision is good.
- **Don't apply `infra/control-plane` while a failed candidate is the newest revision** if the service template changes: the new revision would copy the candidate's image. Merge the fix first.
- **Normally (traffic on latest) a Terraform apply that changes the service goes live at once**, without a smoke test, as it always has.
- **After every deploy, a plan of `infra/control-plane` shows `template.revision = "<that deploy's revision>" -> null`** (1 to change). This is expected: applying it makes a new revision with the same image and settings. Terraform must not ignore the name: Cloud Run refuses a known name with a changed template (409, AI-314).
- **Widened values:** a revision older than a new stored value can't read records holding it (reads are validated). Since AI-19, history stores `user:<uid>` actors: roll back only to a revision that has AI-19, or fix forward.
- **Registry cleanup keeps only `release-*` images past the newest 10 and 30 days** (AI-389: M6.23). Deploys and promotes since then tag what prod runs; a revision deployed before is kept only by that window, so roll back to it soon or not at all.
- **Schema changes:** a rollback doesn't undo data. Before deploying one, take the export in [`ticket-core.md`, "Before a risky deploy: manual export"](ticket-core.md#before-a-risky-deploy-manual-export).
