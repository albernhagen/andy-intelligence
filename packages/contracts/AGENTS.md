# Agent rules — `packages/contracts` (ports and schemas)

Loaded when you work here; the root `AGENTS.md` still applies.

- Contract-first: Zod schemas and the port interface land before any adapter (ADR-0005, ADR-0023).
- Every port has an in-memory fake and a shared contract suite; the fake and every adapter must pass it. CI runs suites on fakes, and the emulator-backed Firestore suites when the adapters change (`firestore-suite`, ADR-0048); `pnpm test:firestore` runs them locally.
- No vendor terms here (no "Firestore", "GitHub Actions", "Jules session"): map them to domain terms (ARCHITECTURE §6). GCP specifics stay in adapters so a `local` mode only adds adapters (ADR-0032).
- Additive schema changes only; a breaking one needs a versioned upgrader (ARCHITECTURE §10.4).
