# 2026-11-20 — AI-147: Re-sync open PRs on GitHub Actions when main moves

Design and decision: ADR-0111. Built option (a): a workflow on push to `main` calls GitHub's update-branch for each open same-repo PR that merges cleanly; option (b), sync tasks for worker PRs, is the later slice for conflicts.

- Why: from 2026-11-12 to 2026-11-20 each merge left about ten worker PRs behind; their sessions re-synced on Andy's Mac, the pre-push suites drove the load to 380 and pushes failed for hours.
- Built: `.github/workflows/resync-prs.yml` → `platform/actions/resync-prs` → `scripts/resync-prs.mjs`; `TOKEN_POLICY` entry for that workflow on `main`; label `no-auto-sync` in the baseline.
- Off until Andy sets `RESYNC_PRS=on` (runbook `coordinating-sessions.md` §6).
- Open for Andy: the write token (App token from the control plane, recommended; question in the PR).
- Deviation from the ticket: opt-out label instead of opt-in (the coordinator's brief); the repo variable is the pause switch, not the control plane's.
