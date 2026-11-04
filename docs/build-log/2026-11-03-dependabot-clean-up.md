# 2026-11-03 — Dependabot clean-up

- Merged: PR #34: Dependabot auto-merge (ADR-0042); Andy applied `allow_auto_merge`.
- PR #25: TypeScript 6: merged `main` in and dropped the deprecated `baseUrl` from `apps/web/tsconfig.json` (TS5101); gate passes.
- PR #27: `@types/node` 26 closed: the runtime is Node 24 (`.nvmrc`). Dependabot now ignores `@types/node` majors (this repo and the baseline template); bump them with `.nvmrc`.
