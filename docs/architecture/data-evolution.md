# andy-intelligence — Data evolution (ADR-0035)

§10.4 body moved unchanged from [observability-and-cost.md](observability-and-cost.md) (AI-221).

The control plane's Firestore holds real data from M1.2: Ticket core on; there is no separate dev copy.
- **Additive by default:** new optional/defaulted fields need no migration.
- **Breaking change:** bump `SCHEMA_VERSION`, add a tested upgrader `_v N → N+1` applied on read (and rewritten on next write); record it in an ADR. v2: ticket model (`ticketV1toV2`: story → feature, task → chore, `needsYou` → `needsAttention`, stored tier dropped; ADR-0058, ADR-0062). v3: no Monitoring stage (`ticketV2toV3`, `ticketEventV2toV3`: `monitoring` → `done` on tickets and stage events; ADR-0069).
- **Backups** (§10.3): before a risky deploy, run a manual export (runbook); restore drill once per milestone.
- A separate control-plane dev environment comes last (§12 Later: Control plane in dev + prod); moving data then = export/import + the same upgraders.
