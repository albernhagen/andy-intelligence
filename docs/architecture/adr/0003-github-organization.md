---
status: accepted
date: 2026-10-21
---

# 0003 — Host repos on Andy's personal GitHub account (public), not an organization

**Deviation from ARCHITECTURE §11** ("GitHub App in a GitHub organization").

## Context and Problem Statement

GitHub's webhook reference describes `projects_v2_item` / `projects_v2` as events for **organization-level** projects, with availability "Organizations" only; the 2022 launch changelog likewise says Organizations and GitHub Apps. User-owned Projects v2 boards therefore emit no webhooks. The architecture assumed board Status drives stages, which is why it required an org.

Andy prefers a normal personal repo. Everything except board events works the same on a personal account: issue, label, comment, sub-issue, PR and push webhooks all fire, and a GitHub App installs on a personal account.

## Decision Outcome

- Repos live under `albernhagen` (this repo: `albernhagen/andy-intelligence`), **public** — public repos get rulesets/branch protection and secret scanning + push protection free (ADR-0015).
- The GitHub App (M1) installs on the personal account, scoped to selected repos.
- How stages sync without board webhooks is decided separately (ADR-0016).

### Consequences

- Good: no org to manage; nothing lost except board webhooks.
- Bad: if multiple collaborators or org-only features (e.g., issue types) are ever needed, a transfer to an org is required.
