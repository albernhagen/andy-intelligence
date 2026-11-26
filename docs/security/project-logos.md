# Threat model: Project logos

Uploaded logos (AI-393): the first entry point that stores a file Andy (or a Claude session acting as him) supplies and the web then renders. Risk: [R-AI-393](risks/R-AI-393.md).

## Entry points

| Entry point                                                 | Who can reach it                                 | Authn/authz                                                                             | Notes                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/projects/{id}/logo`; MCP `get_project_logo`       | Allow-listed users (Firebase ID token on `/api`) | `/api/*` or `/mcp` sign-in, the allow-list and the project-access rule                  | Returns the stored, already sanitized file                                             |
| `PUT /api/projects/{id}/logo`; MCP `set_project_logo`       | Allow-listed users; `/mcp` with our access token | Owner-only through `change_project_settings` (`permissions.ts`); agents and system: 403 | Body capped by the `/api` and `/mcp` limits (256 KB); file caps: SVG 64 KB, PNG 128 KB |
| `DELETE /api/projects/{id}/logo`; MCP `remove_project_logo` | Same                                             | Same rule                                                                               | Clears `logoUpdatedAt` first, then the file                                            |

## Controls

- **Type:** only `svg` or `png` (else 400). PNG: base64 checked, signature checked, size capped.
- **SVG sanitizer** (`apps/api/src/logo-sanitize.ts`, `fast-xml-parser`): refuses DOCTYPE and entity declarations, malformed XML, a root other than `<svg>`, more than 32 levels or 4,000 elements, `script`, `foreignObject`, `iframe`, `object`, `embed`, `image`, `a`, animation elements, any `on*` attribute, a repeated attribute (in any case), a value starting `javascript:`, `vbscript:` or `data:` (or such a URL quoted in CSS), `href` or `url()` not starting `#`, and CSS with `@import`, `image-set`, `expression()` or escapes. Everything else outside the allowlist is dropped; only the rebuilt, re-escaped markup is stored.
- **Rendering:** the web shows a logo only as `<img src="data:…">`, which runs no script and fetches nothing, even if the sanitizer missed something.
- **Storage:** Firestore `projectLogos/{project}`, server-only like every collection.

## Residual risk

- A sanitizer gap would matter only where an SVG is rendered inline or opened as a document. Neither happens today; the follow-up that copies the logo into a project's repo must keep the sanitized file and review this file.
- Replacing or removing a logo is not in the settings change log (no revert); the log line records who and when.
