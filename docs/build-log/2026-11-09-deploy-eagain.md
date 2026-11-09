# 2026-11-09 — First safe deploy failed on a stdin read (AI-64)

AI-64: Deploy fails before the smoke test: `cloud-run-deploy.mjs` reads stdin with `readFileSync(0)` and dies with EAGAIN.

**The failed run:** `Deploy control plane` run 42562348424 on commit c6ab4b2, the first run of the safe deploy path from AI-62: Safe deploy path (ADR-0076: no-traffic revision, smoke test, then traffic).

| Part             | Result                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Held             | The candidate deployed with no traffic. Smoke, promote and verify were skipped. The tag-removal step ran.      |
| Traffic          | Stayed at 100 percent on the previous revision, `control-plane-00067-qn5`.                                     |
| Broke            | "Identify the candidate" and "Read the serving revision" died with `EAGAIN: resource temporarily unavailable`. |
| Passed by timing | "Record the serving revision" uses the same read and got its data in time.                                     |

**Cause:** the helper script read gcloud's piped JSON with `readFileSync(0)`. On a non-blocking pipe, a synchronous read before the data arrives throws EAGAIN.

**Fix:** every command that takes the service JSON now awaits an asynchronous read of stdin to its end (`text(process.stdin)`). Empty or invalid input exits non-zero with a clear error that does not echo the input. The action and `deploy.yml` are unchanged.

**Tests:** `scripts/cloud-run-deploy.test.mjs` runs the real script as a child process and sends its stdin 200 ms late, in two parts. Run against the old script, those tests fail with the same EAGAIN.

**Live proof:** the next `Deploy control plane` run on `main` after the merge must move traffic and show the before and after revisions in the job summary. No one reran the failed deploy.
