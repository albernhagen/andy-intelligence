# Project logo

Every project has a mark wherever it is named: the sidebar's project list, the project picker, the pick-a-project page, the roadmap under All projects and its settings. With no logo it is the project's key on a tile; with one, the logo (AI-393).

- **Upload:** SVG up to 64 KB or PNG up to 128 KB. An SVG is rebuilt from an allowlist of drawing elements and attributes; a file with a script, `foreignObject`, image or link element, an `on*` handler, a reference outside the file (`href` or `url()` not starting `#`) or CSS with `@import`, `image-set` or escapes is refused, and the reason shows. Editor metadata is dropped. A PNG must carry the PNG signature.
- **Shown** as an `<img>` from a data URL, never inline, so it runs no script and loads nothing.
- **Stored** apart from the project (`projectLogos/{project}`); the project's `logoUpdatedAt` tells the web when to fetch it again. Owner only; logged with who and when, not in the settings change log.
- **Not built yet:** the copy to the project's repo by a PR, and drafting three options in a PR (follow-up ticket).

**How to use:** Project settings → Logo (`/p/<project>/settings#logo`): Upload, Replace, Remove. MCP `set_project_logo` (format `svg` with the markup, or `png` with base64), `get_project_logo`, `remove_project_logo`; `get_project_settings` shows `logoUpdatedAt`.
