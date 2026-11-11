# 2026-11-10 — AI-76: Security review housekeeping

Two gaps the M1 system security review (PR #126: Security: system review 2026-11-09) left open; Andy decided both on 2026-11-10.

- **R25: ruleset drift.** The live `protect-main` ruleset requires `firestore-suite`; the declared baseline file didn't list it.
  - Adding it to `platform/baseline/github/ruleset-main.json` alone would have pushed it to every managed repo through `baseline.mjs apply`, where no such job exists, so no PR there could merge. The baseline had no way to mark a check repo-only.
  - Fix (Andy chose this option): the check is in `ruleset-main.json`, and the new `github/source-only.json` lists it as source-only. `baseline.mjs` drops source-only checks for any repo other than `manifest.json`'s `source`. Tests cover both repos.
  - Read-only check (unauthenticated, labels and ruleset): `labels: ok`, `ruleset: unreadable`, the only diff being `bypass_actors` (needs admin). Required checks no longer drift. Andy still checks `bypass_actors` locally with an admin token.
- **Review edit scope.** After AI-35 split the security docs, the weekly review agent could still edit only `docs/security/threat-model.md`. It may now edit any existing `docs/security/*.md`. The workflow's collect and publish steps carry those files, and CI still rejects new, deleted or nested files and anything outside that folder. The procedure says area files are in scope, within their word budgets.
- **R26 closed:** Andy applied Terraform locally; the only change was the control-plane Cloud Run v2 service's revision template (AI-62's unapplied change). The next weekly review's drift check confirms it.
