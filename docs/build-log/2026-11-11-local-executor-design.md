# 2026-11-11 — AI-44: Local executor, slice 1: design

- Wrote ADR-0089: Local executor. A runner program on Andy's Mac polls `POST /runner/claim` every 30 s; the run is created inside the claim through the dispatcher's selection and `RunService.start`, so the caps, overlap check and one-run-per-ticket rule stop double takes. Nothing listens on the laptop and nothing in the cloud connects in (Andy, 2026-11-10).
- Credentials: a runner secret minted in the UI, kept in the macOS Keychain, hashed at rest, revocable; a per-run token from each claim; the same one-per-run App token for publish. The agent holds none of them.
- Laptop sleeps mid-run: the 5-minute lease lapses, the run fails with `lease_lost`, no retry, Needs-you (Andy, 2026-11-10).
- Project `executor` default plus a typed ticket override `overrides.executor`, resolved at read time like the worker (ADR-0082).
- Planned risk R-AI-44 in the threat model; detail in `docs/security/agents-and-executors.md`. Nothing built.
- Next: slices 2 to 7 in the ADR's table, after Andy answers its four open questions (runner program vs his own session, isolation, ticket override when away, who publishes).
- Also: `executors.md` dropped the stale "build sandbox not yet proven live" line (proven 2026-11-08); a few ADR index and threat-model lines shortened to stay within budget.
