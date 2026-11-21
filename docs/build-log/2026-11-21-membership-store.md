# 2026-11-21 — AI-251: M8.2: Membership record and store

First M8: Project members storage slice (design ADR-0127, from AI-242: M8.1). Storage only: nothing reads it, no route, no permission change (M8.4, M8.5).

- Contracts (`packages/contracts/src/{entities,ports,fakes,testing}/membership.ts`, one `export *` line each): `MemberRole` (`contributor`, `viewer`; the owner is not a membership), `Membership`, `MembershipCapError` and the `MembershipStore` port, with an in-memory fake and a 10-case contract suite run on the fake and the Firestore emulator.
- Firestore adapter (`packages/store/src/membership-store.ts`): `memberships/{projectId}:{sha256(email)}`. New collection only: no `SCHEMA_VERSION` change, no rules change (clients are already denied everything), no composite index (single equality queries on `email` or `projectId`, sorted in memory).
- Emails are trimmed and lower-cased on parse, so every lookup is case-insensitive. They are stored, never logged, and kept out of document paths and error messages (ADR-0015).
- Caps (ADR-0028): 20 members per project, 100 in all. `put` checks both inside its transaction (the total is a count aggregate, not a collection read; ADR-0126), so concurrent puts can't pass them; replacing an existing membership is not counted. Recorded in ARCHITECTURE §8.1.
- Not here: the port's row in `domain-and-ports.md` and the security area notes belong to AI-242: M8.1, which owns those files.
