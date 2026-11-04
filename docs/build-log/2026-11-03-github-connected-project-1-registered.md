# 2026-11-03 — GitHub connected; project #1 registered

- Merged: PR #37: default GitHub App name fixed.
- Andy ran runbook `github-app.md` §2–4: connected the App from Settings → GitHub, installed it on `andy-intelligence`, registered project `AI` with repo `albernhagen/andy-intelligence`.
- Logs: deliveries for `pull_request`, `check_run`, `workflow_run` arrived with valid signatures; those within 60 s of registering were ignored as "unregistered repo" (repo → project cache, by design). Recorded since 23:37 UTC: `pull_request` (PR #38 `synchronize`, PR #39 `opened`), `check_run` and `workflow_run` deliveries, each a `codeHostEvents` document with `projectId: "ai"` (checked in Firestore).
- **Replay passed (Andy):** redelivered `bd32d4e0-…` (PR #39 `opened`) from the App's settings → `200 {"result":"duplicate"}`, record unchanged. M1.5: GitHub App + project registration Done when met.
- System review run 41741740609: review job passed (threat model changed); `publish` failed before reaching the control plane: PR #38 already points `CONTROL_PLANE_URL` at `ai.andybernhagen.com`, which doesn't resolve yet, and the OIDC audience must match `PUBLIC_URL` (still run.app). The custom-domain session owns the fix (switch both together). A second run was cancelled.
- `pnpm test:firestore` passed (2026-11-04, OpenJDK 27): 27 tests, incl. the `CodeEventLog` and `CodeHostConnectionStore` suites on their GCP adapters.
- Open (M1.19: GitHub App setup from the UI Done when): system review PR opened with the App token (run 41746394918, after the domain cutover).
