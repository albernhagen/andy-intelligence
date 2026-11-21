# 2026-11-21 — AI-230: M9.3: Routing config schemas and store

- Built: `RoutingConfig` (`packages/contracts/src/entities/routing.ts`), the `RoutingConfigStore` port, an in-memory fake, a shared contract suite, and `FirestoreRoutingConfigStore` (collection `routingConfigs`, documents `global` and `project-<id>`).
- `DEFAULT_ROUTING` reproduces today's routing: frontier and strong → Opus, fast and cheap → Sonnet, all on claude-code/claude-sub; refine, review, verify and scout on fast; plan, build and sync by size. google-sub and openrouter are off. Nothing reads it yet: M9.6: Route resolver switches runs over.
- One shape for global and project configs; how a project narrows global is M9.6's rule. A put needs the `updatedAt` the caller read (null when none stored), and each stamp is at least 1 ms after the last, so a stale writer is always refused.
- No Firestore rules change, no `SCHEMA_VERSION` bump (a new collection).
