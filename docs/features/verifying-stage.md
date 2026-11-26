# Verifying stage

A stage between Ready for review and Done for every project whose deploy kind is not `none` (ADR-0114, AI-181). A merge deployed the change; Verifying holds the ticket until the verify task (AI-188: M6.7) checks it. No per-project opt-out.

- **Off for now.** One system-wide switch, `VERIFYING_SWITCH` in `packages/domain/src/verifying.ts`, is `false`; AI-188 sets it to `true` in its PR. Off: every merge → Done, as before.
- **On a merge** (switch on, project deploys): → Verifying, unless every changed file is under `docs/`, under `infra/` or a `.md` file (the paths `deploy.yml` skips) → Done. An unreadable file list → Verifying.
- **Exits:** Done (verified), or In progress, which flags Needs-you (failed). Nothing else.
- **2 hours:** a ticket still in Verifying 2 hours after it entered is flagged Needs-you, with a comment. One check per entry, on the run watchdog's Cloud Tasks queue.
- **Board:** a Verifying lane before Done, only for projects that deploy (or while a ticket is in it). Dashboards, roadmap and What's new count Verifying as "in review".

**How to use:** nothing to set. Andy can drag a ticket into or out of Verifying; MCP `move_ticket` steps Ready for review → Verifying → Done.
