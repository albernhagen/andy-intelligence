# 2026-11-20 — AI-161: M6.3: Deployment record

The data model every later M6: Dev → prod releases slice reads. No route, MCP tool or UI yet; deploy workflows report deployments from AI-180: M6.4.

- **Contract** (`packages/contracts`): `Deployment` (project, environment `dev`/`prod`/`preview`, image digest, git sha, revision, kind `deploy`/`promote`/`rollback`, status `started`/`succeeded`/`failed`, start and finish times, actor, previous deployment) and `DeploymentStore`: `record`, `finish` (only a `started` one; `conflict` otherwise), `get`, `list` (one environment, newest first, page of at most 100), `latestGood` (newest `succeeded`, or null). One contract suite; the in-memory fake and the Firestore adapter pass it (the latter on the emulator).
- **Firestore** (`packages/store/src/deployments-store.ts`): new collection `deployments`, server-only; the rules already deny every client read and write, so no rules change. No `SCHEMA_VERSION` change (new documents only).
- **No composite index:** the document id starts with the start time inverted and zero-padded, so Firestore's id order is newest first. Every query is equality filters plus a `limit`, which Firestore serves from its built-in single-field indexes. The emulator doesn't check indexes, so this rests on Firestore's documented behaviour; a missing index would show as a query error at the first real listing (M6.9).
- **Caps (ADR-0028):** a listing reads at most 100 documents, the latest good one reads one.
- **Docs held:** the port's row in `docs/architecture/domain-and-ports.md` (at its 1200-word budget).
