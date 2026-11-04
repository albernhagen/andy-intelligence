# 2026-10-28 — M1.15: Usage alerts merged; M1.12: Local quality gates built

- Merged: PR #8: Usage alerts.
- **Decided (Andy):** slice order M1.12: Local quality gates → M1.10: Security review automation → M1.2: Ticket core ‖ M1.1: MCP OAuth spike → M1.14: Cost kill switch → M1.11: Adversarial PR review.
- Branch `m1.12/local-quality-gates`: lefthook 2.2.2 (verified current; `prepare` script installs hooks because pnpm 10 blocks dependency postinstall scripts, skipped without `.git` for the Docker build); pre-commit prettier/eslint/`terraform fmt`/actionlint on staged files; pre-push typecheck + tests; Claude Code `PostToolUse` hook in `.claude/settings.json` (platform plugin doesn't exist yet).
- **Decided (Andy):** actionlint locally via brew, skipped with a message when missing; CI gets an actionlint job (checksum-verified v1.7.12 release binary, no third-party action). M1.12 "Done when" changed from "CI unchanged" accordingly.
- Verified locally: a commit with an ESLint error, a Prettier issue and an unformatted `.tf` is blocked; the hook script formats an edited file and returns exit 2 with the ESLint error for unfixable issues. actionlint not run locally (sandbox can't run downloaded binaries); CI runs it.
- Fixed: blank lines that split the M1 slice table in ARCHITECTURE §12.
