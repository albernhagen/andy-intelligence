# 2026-11-21 — Design file per project (AI-128: M4.15: Every project has its own design file that agents follow)

Andy re-scoped AI-128 the same day, from pluggable design skills to a design file per project (ADR-0132, amending ADR-0045's timing; design skills move to Later).

- **Baseline:** `template/design.md` is a new seed (create only) in `platform/baseline/manifest.json`, written to a managed project's root. It holds short generic defaults (layout, type, colour, components, states, accessibility, tone) and says the project owner edits it. The never-overwrite rule moved into `seedsToWrite` (`files.mjs`), so it now has a test.
- **Agent rules:** `template/AGENTS.md.template` rule 5: a ticket that changes a UI follows `design.md`; a contradiction gets a question, not a guess.
- **Brief:** `BriefAnswers.design` (optional, an additive change) holds the design direction and where the design file lives. It is the last line of Architectural expectations, so plan and build runs read it. With no answer, the brief names `design.md` at the repo root. `onboard.md` asks it.
- **Build task:** `DESIGN_FILE_LINE` is fixed text in every build prompt, so the cached prefix stays the same. A contradiction goes in `deviations`. No executor or sandbox change.
- **Tests:** the baseline consistency tests fail if the seed or the template rule is dropped; there are also tests for `seedsToWrite`, the brief's Design line and the build prompt line.
