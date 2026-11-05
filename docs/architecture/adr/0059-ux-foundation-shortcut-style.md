---
status: accepted (direction; built by tickets in project AI before M2: Multi-project in parallel)
date: 2026-11-04
amends: 0045 (timing of design.md, tokens and screenshot checks)
---

# 0059 — UX foundation pulled forward: project as workspace, a board that shows status, the story as a side panel

Decided by Andy, 2026-11-04.

## Context and Problem Statement

ADR-0045 put all design work in M5: Epics + story board and accepted that "the UI stays plain until M5". Since then the UI gained drag-and-drop, cancel and archive, and Andy uses it daily. His feedback: picking a project should feel like picking a tenant; moving a card to Done opens the ticket; status is hard to see. He wants the experience modelled on Shortcut: markdown stories, simple swim lanes, easy to understand, never complicated or over-engineered. The ticket model is changing too (ADR-0058), and its cards and capture form would otherwise be built twice.

## Decision Outcome

The UX foundation moves ahead of M2: Multi-project in parallel. Dashboards, the design-skill (Hallmark) trial and epic grouping stay in M5.

| Topic               | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principles          | Simple before complete. Automatic by default, editable everywhere. Status visible without opening anything. One obvious way to do each thing. Fast: keyboard first, moves apply at once.                                                                                                                                                                                                                                                                                                              |
| Source of truth     | `apps/web/design.md` plus the shadcn theme tokens (type, colour, spacing, density), written in the first slice. Every UI slice and agent follows it (ADR-0045, earlier than planned).                                                                                                                                                                                                                                                                                                                 |
| Project = workspace | A project switcher at the top left (name and key) that scopes everything under it: Board, Runs, Settings. The last project is remembered. URLs stay `/p/<key>/…`. The Needs-you inbox stays the home screen across projects, with its count always visible in the header.                                                                                                                                                                                                                             |
| Board               | One swim lane per stage. Cards show type, key, title, size, a Needs-you marker, the run in flight (step and elapsed time), the PR and its check state, and "blocked". Ready shows its order, with the top card marked as next (ADR-0058: order is priority). Drag within a lane reorders; drag across lanes moves. **A drop never opens the ticket.** Quick add: type a title, press Enter. Cancelled and archived tickets stay behind the existing toggle.                                           |
| Story panel         | Clicking a card opens the ticket as a panel over the board (same URL, `/p/<key>/t/<KEY>`; Esc closes; full page on a phone). A status line at the top says where it is and what it waits for: "Building · 3 min · PR #12 checks passing", "Waiting for you: 2 questions". Below: title, markdown description, checklist, out of scope, touches; a side rail with stage, type, size, epic, blocked by; then questions and one activity timeline (history, comments, runs). Every field edits in place. |
| Markdown            | Descriptions and comments are written and shown as markdown, with a preview while editing. Rendering is safe by construction: no raw HTML, no remote images, links open in a new tab and show their host. This replaces M1.3's "plain text only" rule; agent-written text stays untrusted, and the slice updates the threat model.                                                                                                                                                                    |
| Speed               | A command palette (go to a ticket, switch project, create, move) and a small set of keyboard shortcuts. Moves and reorders apply optimistically and roll back on an API error, with the message shown on the card.                                                                                                                                                                                                                                                                                    |
| Visual checks       | Playwright screenshot checks for the shell, board and story panel land with the first slice (ADR-0045, earlier than planned), so agent-built UI changes are compared, not guessed.                                                                                                                                                                                                                                                                                                                    |
| Phone               | M7: Mobile (ADR-0052) builds its phone layout on this shell and panel.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Not built           | Custom views, saved filters, swim lanes by anything but stage, per-user themes, a second design system.                                                                                                                                                                                                                                                                                                                                                                                               |

### Slices (tickets in project `AI`, created when this ADR merges)

| #   | Slice                                                                                      | Size | After              |
| --- | ------------------------------------------------------------------------------------------ | ---- | ------------------ |
| 0   | Bug: dropping a card on the board opens the ticket                                         | S    | —                  |
| 1   | `design.md`, tokens, app shell with the project switcher, screenshot checks                | M    | —                  |
| 2   | Board v2: status on cards, ordered Ready lane, reorder within a lane, quick add            | M    | 1, ticket model v2 |
| 3   | Story panel: status line, in-place markdown editing, safe rendering, one activity timeline | M    | 1, ticket model v2 |
| 4   | Command palette and keyboard shortcuts                                                     | S    | 2, 3               |

### Consequences

- Good: the screens Andy uses every day get designed once, with the new ticket model; one written design source before more agent-built UI lands; status is readable from the board; the phone work inherits a real shell.
- Bad: M2: Multi-project in parallel starts later by four slices; rendering markdown from agents widens the UI's attack surface (bounded by the renderer rules above); screenshot checks add a browser to CI; M5 keeps less than its name suggests.
