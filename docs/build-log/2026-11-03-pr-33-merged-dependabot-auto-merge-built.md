# 2026-11-03 — PR #33 merged; Dependabot auto-merge built

- Merged: PR #33: AI-native SDLC playbook gaps plan (ADR-0040). PR #31: M1.4: MCP core tools and PR #32: M1.5: GitHub App + project registration synced with `main`.
- **Decided (Andy, ADR-0042: Dependabot auto-merge for patch and minor updates; CODEOWNERS requests Andy's review):** npm patches and minors of 1.0+ packages auto-merge after every required check; majors, 0.x minors, GitHub Actions and Terraform providers stay manual (review findings); `deploy.yml` skips bot merges; `* @albernhagen` in CODEOWNERS so Andy is notified of Dependabot PRs (review not required).
- Branch `m1.0/dependabot-auto-merge`: `dependabot-auto-merge.yml` → `platform/actions/dependabot-auto-merge` (fetch-metadata v3.1.0, pinned) → `scripts/dependabot-merge.mjs` + tests; job runs the base branch's action; baseline: workflow (managed), CODEOWNERS (seed), `allow_auto_merge: true`; threat model R17; runbook `onboard-a-repo.md` §6.
- Verified locally: scripts tests (decision + CLI), Prettier. Not run here: actionlint (CI), the first real auto-merge (Andy, runbook §6).
