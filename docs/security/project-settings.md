# Threat model: Project settings

Per-project settings Andy changes after registration. No risk file: until an M6 slice reads the setting it changes nothing (see the end of this file). PRs that change this area update this file. This file starts with the environment policy (AI-160); the other settings' entry points are in [ui-and-mcp.md](ui-and-mcp.md).

## Entry points

| Entry point                                                                              | Who can reach it                                    | Authn/authz                                                                                                                            | Notes                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /api/projects/:id` field `environments` (the settings page's Environments select) | Allow-listed users (Firebase ID token on `/api`)    | Owner-only through the project-settings rule (`change_project_settings` in `permissions.ts`, unchanged); agents and the system get 403 | A fixed two-value list, `prod-only` (default) or `dev-and-prod`; anything else is a 400. Each change goes into the config change log with who and when, and can be reverted there under the same rule |
| MCP `set_environments`                                                                   | Allow-listed users, with our access token on `/mcp` | Same rule; the tool acts as the signed-in user (`user:<uid>`)                                                                          | Same value list and log; `get_project_settings` reads it                                                                                                                                              |

## What it changes

- **Today:** the stored setting only. Nothing deploys, creates a GCP project or runs a workflow from it.
- **Later:** M6 slices read it to decide whether a release goes to dev first (AI-181: M6.5: Verifying stage, AI-109: M5.16: Deploy scaffold). Each slice that acts on it adds its own entry points and risks here.

## Threat and residual risk

- Only the owner can change it. A wrong value has no effect until an M6 slice reads it, and the change log shows who set it and allows a revert.

## Settings change log and revert (AI-119: M4.12)

Every settings write (this file's and those in `ui-and-mcp.md`) is logged; the log can be read and a change reverted.

| Entry point                                                                                                                                                       | Who can reach it              | Authn/authz                                                                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/projects/{id}/config-changes?limit=`, `POST /api/projects/{id}/config-changes/{changeId}/revert`; MCP `list_settings_changes`, `revert_settings_change` | Signed-in, allow-listed users | `/api/*` and `/mcp` sign-in plus the allow-list; revert is owner-only through the existing `change_project_settings` action (`permissions.ts`, AI-19) | The list is capped at 100. A revert replays the logged before-values through `ProjectService.update`, so it is logged as a new change (reason `Revert of <id>`), then the original is marked `reverted`. It is refused (`409 not_revertible`) for a change that isn't applied, when a newer logged change touched one of its fields, or when a field moved outside the log. A change that switches Builds can't be reverted over MCP (ADR-0063: Builds is set only in the app). |

Residual risks:

- **Two reverts at once** of the same change can both write the same before-values (both logged); `markReverted` is transactional, so only one marks it and the other gets `409`. Accepted: the values are identical.
- **What a revert can change:** any project setting the change touched, including `autoBuild`, `autoMerge` and `executor`, as the owner could by hand. `buildEnabled` only from the app.

## Spend caps (AI-249: M10.8)

A project's own caps on paid-model spend (ADR-0129); they can only lower the global caps, which are the code defaults (`DEFAULT_SPEND_CAPS`) until AI-276: M10: Global spend caps store and editing. Risk: [R-AI-249](risks/R-AI-249.md).

| Entry point                                                                                             | Who can reach it              | Authn/authz                                                                         | Notes                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/projects/{id}/spend`; MCP `get_spend`                                                         | Signed-in, allow-listed users | `/api/*` or `/mcp` sign-in plus the allow-list                                      | Caps, effective caps, spend today and this month; spend reads `null` ("unknown"), never zero, when the ledger can't be read                                                     |
| `PUT /api/projects/{id}/spend-caps`, `PATCH /api/projects/{id}` field `spendCaps`; MCP `set_spend_caps` | Signed-in, allow-listed users | Owner-only through `change_project_settings` (AI-19); agents and the system get 403 | Whole micro-dollars only (a fraction or negative is a 400); a cap above global is refused (422) on every path, in `ProjectService.update`; each change is logged and revertable |

Nothing here spends money or reaches a provider: the caps are read by the spend gate (AI-248: M10.7) before a paid task starts.
