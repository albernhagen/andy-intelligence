---
status: accepted
date: 2026-10-21
---

# 0002 — TypeScript pnpm-workspaces monorepo

## Context and Problem Statement

One person maintains API, UI, contracts, DB, workflows, and infra. Shared types between API, UI and MCP matter more than service isolation.

## Decision Outcome

Single repo, pnpm workspaces, Node 24 (CI) / ≥22 (local).

```
apps/api            Hono API, later MCP + webhooks + jobs
apps/web            React SPA (served by the API)
packages/contracts  Zod schemas, port interfaces, fakes, contract suites
packages/store      Firestore client + Zod converters
infra/bootstrap     one-time GCP bootstrap (state, WIF)
infra/control-plane control-plane GCP resources
```

`packages/domain`, `packages/adapters`, `platform/*` and `template/` from the suggested layout are created when first needed (M1+), not as empty folders now.

Internal packages are consumed as TypeScript source (`exports` → `src/*.ts`, `moduleResolution: Bundler`); the API is bundled with esbuild and the UI with Vite, so no per-package build step.

### Consequences

- Good: one typecheck/test/lint for everything; no publish step.
- Bad: npm deps used by workspace packages must also be listed on `apps/api` so `pnpm deploy` installs them in the image.
