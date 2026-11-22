# 2026-11-21 — AI-327: UI text uses only project, milestone, epic, ticket and agent task

From the AI-322 UX review (quick win 3). This ticket covers UI text only; AI-205 (one glossary) covers the docs.

- **Epic panel:** the children section is headed "Tickets" (region `Tickets`), and its empty state reads "No tickets under this epic yet."
- **Night launch:** the progress line reads "0 of 2 tickets done · …", and the report reads "… to review on the tickets."
- **Digest:** totals read "3 agent tasks", and the read-cap note says "agent tasks". design.md says "agent task", never "run".
- **What's new:** its status table and filter list top-level epics, so they say "Epic" and "All epics". Since ADR-0131 a milestone is its own thing. The API's `milestones` field is unchanged.
- **Layer line** (`lib/route-layers.ts`, project settings and Models): drops the retired sentence "A milestone is an epic titled "M<N>: …"".
- **Kept:** "Run locally" and "Run on Actions" are verbs on buttons, not agent tasks. The MCP tool and field names are unchanged.
