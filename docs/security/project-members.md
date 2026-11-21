# Threat model: Project members

People other than Andy on specific projects (M8: Project members, ADR-0127, proposed). Nothing here is built yet; rows name the slice that builds them. Risk: [R-AI-242](risks/R-AI-242.md). PRs that change this area update this file.

## Who is who

| Identity    | How they get in                                                 | What they can do                                                                                      |
| ----------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Owner       | Verified Google email in `ALLOWED_EMAILS` (ADR-0010)            | Everything, in every project                                                                          |
| Contributor | Verified Google email with a membership in the project (AI-254) | Create, edit, comment, reorder, move (not force), answer, promote assumptions, in their projects only |
| Viewer      | Same                                                            | Read their projects only                                                                              |

## Entry points

| Entry point                                                         | Change                                                                                                             | Slice          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------- |
| `/api/*` sign-in                                                    | Admits an owner or a member; the principal (owner flag, roles) is resolved per request                             | AI-254         |
| `/api/projects/{p}/*`                                               | 404 unless the caller can read `p`                                                                                 | AI-252         |
| Cross-project `/api/*` reads                                        | Filtered to the caller's projects, or owner-only                                                                   | AI-256         |
| `/oauth/approve`, `/mcp`                                            | Admit members; access re-checked per request, so removal applies at once; tools naming a project or ticket checked | AI-252, AI-254 |
| `GET`/`PUT`/`DELETE /api/projects/{p}/members…`; MCP `list_members` | Owner only; changes logged in the config change log; MCP cannot change members                                     | AI-263         |

## Data

- `memberships` (Firestore, server-only): email, role, uid, display name, who added and when. Emails never logged or put on events (ADR-0015).
- Caps: 20 members per project, 100 in all (AI-251); 60 ticket writes per member per hour (AI-262).
- Removal of a last membership deletes that uid's MCP grants and push subscriptions (AI-263).
