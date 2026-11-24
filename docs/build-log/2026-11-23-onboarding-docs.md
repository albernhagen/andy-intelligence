# 2026-11-23 — AI-354: Onboarding docs match the code before the first managed project

From Andy's 2026-11-23 product and architecture review, before AI-111: M5.4: First managed project live. Docs only.

- **New runbook** `docs/runbooks/managed-project.md`: every hand step to onboard a managed repo, in order, from ADR-0096: Managed repos call one executor. It links `onboard-a-repo.md`, `github-app.md` and `agent-environment.md` instead of copying them. It states the limits up front (pnpm only; public on GitHub Free; default branch `main`; one repo per project) and adds the step no runbook had: check the repo's Actions settings allow reusable workflows.
- **Checked against the code:** ADR-0096 step 3 (allow reusable workflows, read-only token) is set by `baseline.mjs apply` (`platform/baseline/github/actions.json`: `allowed_actions: all`), so the runbook makes it a check, not a hand setting. Registering opens the baseline PR (AI-113), or a Needs-you ticket when the repo is empty or needs nothing.
- **Not verified:** the baseline also sets `sha_pinning_required: true`, and the caller calls the executor at `@main`. Whether GitHub's SHA-pinning policy blocks an unpinned reusable workflow isn't settled; this repo's own caller uses a local path, so nothing has tried it. The first refine (runbook step 8) shows it.
- **`platform/procedures/onboard.md`:** the brief is submitted over MCP `submit_brief`; the new-project form asks only name, key and repo.
- **`docs/build-log.md`:** removed done items (AI-307: M4.37: Create project AI's milestones, the What's new backfill, the ruleset apply after AI-352); the handover link already pointed at 2026-11-23.
