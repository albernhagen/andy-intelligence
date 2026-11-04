# 2026-11-04 — Readable ticket links; PR title and ticket link rule (AI-7)

- Ticket pages are now at `/p/<project>/t/<KEY>` (e.g. `/p/ai/t/AI-2`); old id links load the ticket and switch to the key URL. New API route `GET /api/tickets/{key}` (same lookup as MCP `status`). Board and inbox link by key.
- Rule from Andy: every PR for ticket work is titled `<KEY>: <ticket title>` and its description starts with the ticket's link. Recorded in `AGENTS.md`, `docs/BUILD-PROMPT.md`, both PR templates, and the M1.8: Build + gate row (agent PRs) in ARCHITECTURE §12.
