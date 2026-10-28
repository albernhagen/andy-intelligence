---
status: accepted
date: 2026-10-22
amends: 0016
---

# 0019 — Agent callbacks authenticated with GitHub Actions OIDC

## Context and Problem Statement

Claude Code and OpenCode runs in GitHub Actions call the API back with reports, comments, and questions. ADR-0016 assumed a short-lived per-run token. Passing a secret through `workflow_dispatch` inputs leaks it: inputs are visible in a public repo's run UI.

## Considered Options

1. Per-run token passed as a `workflow_dispatch` input.
2. Per-run token stored as a repo secret before dispatch (races between concurrent runs; needs secret-write permission).
3. **GitHub Actions OIDC token requested by the workflow.**

## Decision Outcome

Option 3. The reusable workflow requests an ID token (`id-token: write`, audience = the control-plane URL). The API verifies it against GitHub's JWKS and checks `repository`, `job_workflow_ref` (must be the platform's reusable workflow), and `run_id` against the dispatched Run. A verified caller may write only to its own Run and ticket (report, comment, question). `workflow_dispatch` carries only the non-secret run ID.

Non-Actions executors (Jules) don't call back (ADR-0018). Agent **read** access to the API/MCP is M4; non-Actions executors will then get a per-run token minted at dispatch.

### Consequences

- Good: no secret in transit or at rest; identity is bound to the exact workflow run.
- Bad: claim names and reusable-workflow behavior must be verified against current GitHub docs in slice M1.6.
