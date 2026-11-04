# 2026-11-04 — Token-path check for the system review

- The App-token path (Actions OIDC → `/github/token` → repo token) had not run live: the review's `publish` job only runs on a threat-model change. Added a manual `token_check` input to `system-security-review.yml`: a `token-check` job gets the token, checks it reaches this repo only, and revokes it (no agent, no PR). Runbook `github-app.md` §5.3.
