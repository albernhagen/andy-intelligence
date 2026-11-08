# Control-plane deploy and rollback — runbook (Andy)

How a merge reaches `control-plane` on Cloud Run, and how to go back (ADR-0076: Control-plane deploy: no-traffic revision, smoke test, then traffic).

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
| Move traffic to the candidate                                                                                                              | Check the summary: traffic may have moved.                                  |
| Check it serves 100 percent; smoke test the public URL: `/health` 200, `/api/me` 401, and on the run.app host `/health` 200, `/api/me` 404 | **The candidate is serving: roll back (§3).** Nothing rolls back by itself. |

`/api/me` 401 needs the public host, which only reaches a revision with traffic, so it runs after the move.

## 2. Read the job summary

Actions → _Deploy control plane_ → the run → Summary: one verdict line, the serving revision before, the candidate, the serving revision after, and the rollback command with real names.

**First deploy after this ships:** expect "Deployed.", _Serving before_ `<old>=100`, _Serving after_ `<candidate>=100`, and the site working.

| Verdict                | Do                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| Deployed.              | Nothing.                                                                                                        |
| Traffic did not move   | Read the failed step's log, fix forward with a new PR. The candidate tag stays until the next deploy reuses it. |
| Traffic may have moved | Compare _Serving after_ with _Serving before_; if different, §3.                                                |
| It is serving traffic  | §3 now, then fix forward.                                                                                       |

## 3. Roll back

Takes under 5 minutes, usually under one. Copy the command from the summary, or find the last good revision and pin it:

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
- **Schema changes:** a rollback doesn't undo data. Before deploying one, take the export in [`ticket-core.md`, "Before a risky deploy: manual export"](ticket-core.md#before-a-risky-deploy-manual-export).
