# andy-intelligence — Store ports

Moved unchanged from [domain-and-ports.md](domain-and-ports.md) §6 (main went over its word budget when three PRs merged at once): the store and ledger ports. Every one has an in-memory fake and a shared contract suite (ADR-0023).

| Port | Domain concepts | v1.x adapters | Later |
|---|---|---|---|
| `OAuthGrantStore` | OAuthGrant (code, access token, refresh token; keyed by token hash) | **Firestore** (ADR-0039) | Local store (ADR-0032) |
| `RunnerStore` | Runner, per-run token (hashes only; ADR-0089) | **Firestore** | — |
| `ConfigChangeStore`, `ReviewFindingSource`, `ReleaseNoteStore` | ConfigChange, ReviewFinding (ADR-0097), ReleaseNote | **Firestore** | — |
| `DigestSummaryStore` | DigestSummary (AI-323, ADR-0137): one per project per day; claim, retry and each status change are atomic; writes started are capped per UTC day across projects | **Firestore** (server-only) | — |
| `NightLaunchStore` | NightLaunch; one active per project, checked atomically | **Firestore** | — |
| `DeploymentStore` | Deployment (AI-161: M6.3): record, finish once, list one environment newest first (≤ 100), latest good | **Firestore** (`deployments`, server-only) | — |
| `ProjectVersions` | A change counter per project, bumped by every tracker and run write; unchanged board and ticket-list polls are served from a per-instance cache (AI-222); changed ones read only changed tickets (ADR-0133) | **Firestore** | — |
| `RoutingConfigStore` | RoutingConfig: providers, tier routes, step tiers; one global, one per project; puts carry `ifUpdatedAt` (AI-230: M9.3) | **Firestore** | — |
| `SpendLedger` | SpendEntry: reserve, then settle or release, in integer micro-dollars; append-only; a reservation over a per-task, project or global UTC day or month cap is refused atomically (AI-234: M10.2); totals per project, global and per provider (AI-280); `SpendNoticeLedger` dedupes cap notices (AI-257) | **Firestore** (AI-247: M10.6); in-memory fake | — |
| `SpendCapsStore` | SpendCaps: the global caps, one document; nothing stored means the defaults; puts carry `ifUpdatedAt`; an unreadable store fails paid calls closed (AI-276) | **Firestore** | — |
