# 2026-11-22 — AI-113: M5.14: Baseline PR on registration

- Registering a repo on a project now opens its baseline PR through the App (`apps/api/src/github/registration.ts`, `platform/baseline/plan.mjs`). New CodeHost methods: `proposeFiles` (one commit, many files) and `readRepoSetting` (GET-only settings reads).
- Andy's decision (2026-11-22): no `workflows` permission for the App. The PR leaves out `.github/workflows/**` and `.claude/**`; the report gives `baseline.mjs finish`. Settings are report-only (`apply`). Empty repos and failures go to Needs-you with `onboard` (ADR-0142: Baseline PR from the App).
- Not tried against a live repo yet: the first registration after deploy is the proof (runbook `onboard-a-repo.md` §2).
