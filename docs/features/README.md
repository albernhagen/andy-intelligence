# Features

Shipped on `main`, one file per feature, added or changed in its PR (ADR-0022). One file each so parallel PRs never edit the same lines (AI-141). Summary: `README.md` "How it works today"; design: [ARCHITECTURE.md](../architecture/ARCHITECTURE.md).

- **All features as one table:** `pnpm features` (generated on demand, not committed).
- **A new feature:** add `docs/features/<name>.md` in this shape (`pnpm test` checks it):

```md
# <Feature name>

<What it does, one short paragraph>

**How to use:** <where to click, command or MCP tool; links relative to this folder>
```
