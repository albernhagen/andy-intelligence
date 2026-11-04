# 2026-10-23 — Security review designed

- **Decided (Andy):** security is checked by agents on every PR and across the system over time (ADR-0025, ARCHITECTURE §9.1). New slice M1.10: Security review automation.
- **Defaults (Andy to confirm):** high/critical agent findings block merge, overridable with the `security-accepted` label; reviewer runs on the Claude subscription token; system review weekly (if anything merged) + end of each milestone.
- **Seed risks for the threat model:** CI's `tf-plan` identity has basic Viewer (likely reads Firestore data and logs) and is usable from any same-repo branch; repo secrets readable by same-repo branch workflows; public Cloud Run URL (cost abuse); Firebase web API key is public by design.
