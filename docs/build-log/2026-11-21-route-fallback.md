# 2026-11-21 — AI-261: M10.14: Quota-aware route fallback

- New pure `packages/domain/src/route-fallback.ts`. `chooseRoute` walks the step's routes from the resolver in order. It skips a subscription whose fresh reading is at its pause level (80% by default, so the 20% reserve stays) and a pay_per_use route the spend gate would refuse. A route with a stale or missing reading is tried only if no later route has room, and never past a route that hit its reserve (fail closed). `dispatchQuotaLevel` makes dispatch idle at the reserve only when no provider that is on has room.
- `BuildDispatcher` reads each enabled subscription's level under the project's routing and passes it to `RunService.start`. With every route skipped, the start throws `quota_reserve` or `spend_cap` (the first skip's reason) before any run exists, and dispatch records that reason. The ticket isn't flagged.
- `SpendGate.refusal(projectId, route)` runs the reserve's checks without writing. `reserve` still decides, so a race is refused there.
- New `Run.routeSkips` (route and reason, at most 6; defaults to empty, so no schema version bump). The start comment lists the skips too.
- Unchanged: starts by hand, retries, refine and sync dispatch. They take the resolver's first usable route and the global claude-sub gate, as before. With only claude-sub on (the default) dispatch decides exactly as before.
