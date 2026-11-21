---
title: "Project members: guests on a project, two roles, one permission function"
status: proposed (AI-242; Andy decides at review)
date: 2026-11-20
amends: 0010 (sign-in allow-list), 0082 (worker `me`, unchanged until a later ADR)
---

# 0127 — Project members: per-project email allow-list, contributor and viewer roles

AI-242: M8.1: Project members design, under AI-18: M8: Project members. Andy, 2026-11-04: let other people into specific projects with very basic roles. His answers on AI-18 (2026-11-10): invite by a per-project email allow-list; plan approval and builds stay with him at first, then contributors within a per-user cap, per project; contributor answers probably count toward the Definition of Ready everywhere. Five open questions are on AI-242; this ADR is written with the recommended answers.

## Context and Problem Statement

One allow-list (`ALLOWED_EMAILS`, ADR-0010) admits Andy to the UI, API and MCP, and every signed-in user is the owner (AI-19: `permissions.ts`). Any second person would see every project and could do everything. A contributor's ticket text also becomes input to agents that run on Andy's quota with write access to his repos.

## Decision Outcome

| Topic          | Decision                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shape          | Guests, not tenants: one owner, one set of credentials, one bill. The owner is whoever is in `ALLOWED_EMAILS` (Andy).                                                                                                                      |
| Membership     | Per project: email (lower-cased), role, uid and display name once they sign in, who added them and when. Firestore `memberships`, one document per project and email. Caps: 20 per project, 100 in all (ADR-0028).                         |
| Roles          | `contributor`: create, edit, comment, reorder, move forward or back (not force), answer questions, promote assumptions. `viewer`: read only. Owner: everything. Queuing to Up next, which starts refine on Andy's quota, stays owner-only. |
| Decision point | `can(principal, action, projectId)` from one role table in `packages/domain`. The principal (actor, owner flag, roles by project) is resolved per request, so a removal applies at once.                                                   |
| Sign-in        | UI, API and MCP admit an owner or anyone holding a membership; others get 403. No Identity Platform, IAM or Terraform change: any Google account already reaches this app-level gate.                                                      |
| Reads          | A project the caller isn't a member of answers 404, never 403. Cross-project lists show only the caller's projects; quota, runners, config changes, project plans, GitHub setup and night runs are owner-only.                             |
| Changing who   | Only the owner adds, removes or changes a role, in project settings; MCP gets `list_members` only. Each change goes in the config change log (AI-118). Removing someone's last membership deletes their MCP grants and push subscriptions. |
| Caps           | 60 ticket writes per member per hour (`429` past it); the owner is not capped.                                                                                                                                                             |
| History        | Events keep `user:<uid>`; the label is derived on read: "Andy" for the owner, the member's display name, "Former member" when none. No email is stored on an event or logged.                                                              |
| Notices        | Needs-you and push reach a member only for their projects and only for what their role can act on; email stays the owner's.                                                                                                                |
| Agent input    | Member text is untrusted input to agents, as all ticket text is today; prompts don't change.                                                                                                                                               |
| End state      | Project setting `memberBuilds` (`off` by default): when on, contributors approve plans, start tasks and queue to Up next, within a daily task cap per member. Owner turns it on; MCP may only turn it off.                                 |
| Order          | No member can exist until sign-in, write gates, cross-project filtering and caps have shipped: AI-263: M8.9 (adding members) waits on all of them.                                                                                         |

**Slices** (AI-18): AI-251 store and AI-252 access check → AI-253 roles → AI-254 sign-in, AI-255 writes → AI-256 lists, AI-262 caps → AI-263 members → AI-264 names, AI-265 settings, AI-270 role-aware UI, AI-271 inbox and push → AI-272 Andy's check → AI-273 contributor builds. Table: `docs/architecture/m8-slices.md`.

Not decided here: assigning tickets to members (ADR-0082 `me` as a person's id), ticket requester and owner roles (ADR-0058), invite links or email, local mode (ADR-0032).

### Consequences

- Good: one role table and one per-request principal decide everything; the owner's experience is unchanged; no new infrastructure.
- Bad: every API and MCP request reads memberships once (one Firestore query); member emails are stored in Firestore (server-only, never logged); members can still fill Ideas with text an owner may later queue to agents, which caps limit but don't remove.
