# 2026-11-20 — AI-194: M7.15: Gated PRs from the phone

Built ADR-0115: M7 build choices Q5's recommended option (a), which waits for Andy: link out instead of merging in-app.

- `apps/web/src/components/PullRequestLink.tsx`: the newest `pr_linked` event's PR, shown only while `open` and only if its URL is a github.com pull request page (the URL comes from a webhook). "Open in GitHub" opens it in a new tab; on iOS the GitHub app takes the universal link. No API change, no App token, no merge path.
- `TicketPage.tsx`: the link sits at the top of the ticket story, under the sticky status line; the panel (z-30) covers the phone bottom bar (z-20), so they never overlap.
- Tests: 11 unit cases (open, merged, closed, newer PR, off-host and lookalike URLs) and `e2e/phone-pr-link.spec.ts` at 390 px (44 px target, below the header and status line, nothing on top of it; no link for a merged PR). No screenshot, so the shared images are unchanged.
- If Andy picks (b), an in-app approve that merges with the App token, it replaces this link in a new high-risk ticket.
