# Night merges and the morning PR

During a night launch, a child ticket's PR into `epic/<KEY>` squash-merges there once the merge gate passes on every rule but "not the default branch" (required checks and CODEOWNERS from `main`), whatever `autoMerge` says; the ticket moves to Done so its dependants build on it. Once per ticket (≤ 50 per launch). A morning PR that can't open flags the epic. When the launch ends, one PR `epic/<KEY>` → `main` opens listing each ticket's commit range and PR; it never merges on its own. No merge: no PR, and the empty branch is deleted (ADR-0107)

**How to use:** nothing to set: it follows a night launch (AI-120: M4.17: Night launch step in UI and MCP). Review and merge the morning PR on GitHub
