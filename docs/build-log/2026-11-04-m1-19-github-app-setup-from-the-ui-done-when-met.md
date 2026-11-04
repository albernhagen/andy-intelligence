# 2026-11-04 — M1.19: GitHub App setup from the UI Done when met

- Merged: PR #46: token check.
- **Token check passed** (run 41748331077): `token-check` exchanged the Actions OIDC token at `https://ai.andybernhagen.com/github/token`; the control plane logged `repo token issued` for `system-security-review.yml@refs/heads/main`; actor `andy-intelligence-control[bot]`, 1-hour expiry; the token reached `albernhagen/andy-intelligence` only and was revoked.
- With connect → install → register done from the UI, webhooks recorded, replay `duplicate` and `pnpm test:firestore` green, M1.19: GitHub App setup from the UI Done when is met. One part still runs on its own: the first review PR opened by the App, with its checks starting unattended (GitHub's documented behaviour for App tokens), on the next review with a threat-model change.
