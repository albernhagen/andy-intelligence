Ticket: <!-- https://ai.andybernhagen.com/p/<project>/t/<KEY>; PR title: `<KEY>: <ticket title>` -->

<!-- Release note (ADR-0121), shown on What's new; CI checks the caps. Delete "Needs you" if none. -->

What changed: <!-- one plain sentence, ≤ 25 words: what Andy can now do or see -->
How it works: <!-- ≤ 45 words: the mechanism -->
Needs you: <!-- ≤ 25 words: a step only Andy can take -->

## What

## Why

<!-- Slice as `ID: title`, e.g. "M1.2: Ticket core", and its "Done when". Never a bare ID. -->

## Risks

## How verified

## Assumptions

## Security (ADR-0025)

<!-- Trust boundaries, entry points, credentials, IAM, workflow permissions, or dependencies touched? Say which, or "none". -->

## Docs (ADR-0022)

<!-- Tick each box or mark it n/a. Unticked means not done. -->

- [ ] `README.md` — commands, env vars, layout
- [ ] `docs/architecture/` — design/scope/plan: the topic file; `ARCHITECTURE.md` only if intent, components or milestones change
- [ ] ADR added or status updated
- [ ] Runbook — manual steps
- [ ] `docs/build-log.md` — decisions, blockers; new entry file in `docs/build-log/`; ticket in project `AI` named in "Why"
- [ ] `docs/security/threat-model.md` and its area file — trust boundary / IAM / credentials changed
- [ ] `AGENTS.md` / `docs/BUILD-PROMPT.md` — agent rules
