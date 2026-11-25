# Epic merge mode

With a project (or an epic) in the `epic` merge mode (ADR-0124, AI-216), a child ticket of an epic builds on `epic/<KEY>` (made from the default branch's tip if missing), and its clean PR squash-merges there through the night-merge path: same gate, once per child ticket. The ticket is then Done. When the epic's last open child ticket is Done, one PR `epic/<KEY>` → the default branch opens listing each child ticket and its PR; Andy merges it, never the control plane. A ticket with no epic builds on the default branch and its PR waits for Andy, as in `manual`. MCP `merge_pr` answers `wait` for a PR into an epic branch. A child ticket added after the epic PR opened merges into the branch and so into the open PR, which doesn't list it.

**How to use:** Project settings → Merge mode → `epic` (or an epic's override); MCP `set_merge_mode` can tighten to it
