---
status: accepted
date: 2026-10-21
---

# 0009 — Application stack

ARCHITECTURE §11 left the API framework to the builder. Andy asked for the standard TypeScript choices.

## Decision Outcome

| Concern                | Choice                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| API                    | Hono + `@hono/node-server`, `@hono/zod-openapi` (Zod v4)                                                                                |
| Validation / contracts | Zod v4                                                                                                                                  |
| DB                     | `@google-cloud/firestore` with Zod converters (ADR-0017)                                                                                |
| Auth (server)          | `firebase-admin` `verifyIdToken`                                                                                                        |
| UI                     | React 19, Vite, Tailwind v4, shadcn/ui (new-york), TanStack Query; TanStack Router/Table and dnd-kit added when screens need them (M1+) |
| Tests                  | Vitest (workspace projects)                                                                                                             |
| Lint / format          | ESLint (flat config, typescript-eslint) + Prettier                                                                                      |
| API bundling           | esbuild → single ESM file; npm deps installed via `pnpm deploy --prod`                                                                  |
| Container              | `node:24-slim`, non-root                                                                                                                |

### Consequences

- Good: mainstream, well-documented choices; one schema language end to end.
- Bad: none notable; versions should be kept current by Renovate/Dependabot (not set up yet).
