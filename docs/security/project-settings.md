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
