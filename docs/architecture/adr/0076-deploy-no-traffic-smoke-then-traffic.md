---
status: accepted
date: 2026-11-08
---

# 0076 — Control-plane deploy: no-traffic revision, smoke test, then traffic

Built in AI-62: Safe deploy path. First piece of ADR-0060 §M2 "Safe to merge itself"; project `AI` stays at `autoMerge: none` (ADR-0050) until Andy has seen this work live.

## Context and Problem Statement

`deploy.yml` sent a new revision 100 percent of traffic, then smoke tested it. A bad revision served until someone noticed, and rollback was undocumented.

## Decision Outcome

| Question               | Decision                                                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol               | Record serving revision → deploy `--no-traffic --tag candidate` → smoke test the tagged URL → move traffic → check 100 percent → smoke test the public URL → job summary (always).                                                                                            |
| Pre-traffic checks     | Tagged URL: `/health` 200, `/api/me` 404. The host rule (ADR-0044) refuses every other route off the public host, so the 401 from real auth can't be tested before traffic.                                                                                                   |
| Post-traffic checks    | Public URL: `/health` 200, `/api/me` 401; run.app host: `/health` 200, `/api/me` 404.                                                                                                                                                                                         |
| Failure after the move | The job fails and the summary gives the command. No automatic rollback: Andy decides (AI-62's assumption).                                                                                                                                                                    |
| Promotion              | `update-traffic --to-latest`, after checking the latest ready revision is the candidate; then a check that it holds 100 percent. Rejected `--to-revisions=<candidate>=100`: it pins traffic, so later Terraform applies that change the service would silently never go live. |
| Candidate tag          | Removed on promotion and after any failed deploy, so a bad revision has no lasting URL. The tagged URL is public while a deploy runs; the host rule is its only guard.                                                                                                        |
| Who owns what          | CI owns image, revision labels and traffic (`ignore_changes` in `infra/control-plane`); Terraform owns the rest of the template.                                                                                                                                              |
| Credentials            | Unchanged: `push` to `main` and `workflow_dispatch` only; the deployer identity is bound to `refs/heads/main`. `roles/run.developer` already covers traffic moves.                                                                                                            |
| Caps (ADR-0028)        | Smoke tests retry at most 12 times per URL, 5 s apart, 10 s per request. The candidate scales to zero with the same instance cap.                                                                                                                                             |
| Carried to projects    | Composite action `platform/actions/cloud-run-safe-deploy` (ADR-0038).                                                                                                                                                                                                         |

### Consequences

- Good: a revision that doesn't start or breaks the host rule never serves (any other regression, such as broken auth, can). Rollback is one printed command.
- Bad: a revision with broken auth passes the pre-traffic check and serves until the post-traffic check fails and Andy rolls back. After a rollback or failed deploy, traffic is pinned, so Terraform changes to the service wait for the next deploy (runbook `deploy-and-rollback.md` §5).
