# 2026-11-04 — Firestore suites move to CI

- `pnpm test:firestore` passed locally (OpenJDK 27; 27 tests). Java is now on Andy's `PATH` (`~/.zshrc`).
- System review run 41746394918 passed, but `publish` was skipped (no threat-model change), so the App-token PR path is still untested; it runs on the next review with a change.
- **Decided (Andy, ADR-0045: Firestore contract suites run in CI when the adapters change):** new `firestore-suite.yml`; the emulator starts only when `packages/store`, `packages/contracts/src`, `firebase.json`, `package.json` or `pnpm-lock.yaml` change. Not a required check yet.
