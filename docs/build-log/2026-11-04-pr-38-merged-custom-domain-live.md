# 2026-11-04 — PR #38 merged; custom domain live

- Merged: PR #38: M1.20: Custom domain. Andy applied `infra/dns` (2 added), the targeted mapping (after verifying `andybernhagen.com` in Search Console; the first try failed and was replaced: 1 added, 1 destroyed) and `infra/control-plane` (2 changed). Certificate live 15 minutes after the mapping.
- Verified: `https://ai.andybernhagen.com/health` 200 (Google Trust Services certificate); `/api/me` 401 there; `run.app` `/health` 200, `/api/me` and `/mcp` 404; MCP metadata names the new URL.
- System review runs 41741740609 and 41743556966 failed in the expected cutover window (DNS not yet live, then audience mismatch).
- Andy to finish: runbook `custom-domain.md` §6–8 (GitHub App URLs + redelivery, Claude connector, sign-in, system review rerun).
- Runbook troubleshooting gained this cutover's lessons (Search Console check, failed-mapping retry, worktree `init`/tfvars, the certificate's last few minutes).
