# Night merges and the morning PR

During a night launch, a story PR into `epic/<KEY>` squash-merges there once the merge gate passes on every rule but "not the default branch" (required checks and CODEOWNERS from `main`), whatever `autoMerge` says; the story moves to Done so its dependants build on it. Once per story (≤ 50 per launch). A morning PR that can't open flags the epic. When the launch ends, one PR `epic/<KEY>` → `main` opens listing each story's commit range and PR; it never merges on its own. No merge: no PR, and the empty branch is deleted (ADR-0107)

**How to use:** nothing to set: it follows a night launch (live once launches are wired in the API, AI-120: M4.17). Review and merge the morning PR on GitHub
