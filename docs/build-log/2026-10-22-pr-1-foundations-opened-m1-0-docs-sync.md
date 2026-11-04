# 2026-10-22 — PR #1: Foundations opened; M1.0: Docs sync

- PR #1: Foundations opened: `m0/foundations` → `main`. Runbook steps 0–4 still pending.
- M1.0: Docs sync folded into PR #1: Foundations to avoid a stacked PR; PR #2: Docs sync closed: ARCHITECTURE revision `2026-10-22a`; ADRs 0018–0023; `AGENTS.md` (+ `CLAUDE.md` symlink); PR template with docs checklist; build prompt moved to slices.
- **Decided (Andy):** ADR-0012 rejected — every port gets a fake + contract suite, written in the slice that first uses the port (ADR-0023). Docs ship with the change (ADR-0022). M1: First end-to-end flow split into slices (ADR-0021).
- **Decided (Andy):** no stacked PRs — slices branch from latest `main` (ADR-0021). Terraform pinned to 1.16.7 via `.terraform-version`, managed with tenv (ADR-0024). Docs written short and plain (ADR-0022).
