# 2026-11-21 — AI-334: Phone: 44 px targets on settings and the board's title row

From AI-322: UX deep dive (quick win 10). At 390 px, settings checkboxes were 20 px tall targets, selects about 21 px, cap inputs 28 px, and Revert 22 px; the board's checkboxes could sit beside its title.

- **Fix:** phone-only classes (`max-sm:`), so desktop is unchanged: a checkbox's label is `min-h-11`, selects and inputs `h-11 text-base`, Revert and Save buttons `min-h-11`. Screens: project settings (and its email, worker, executor, spend caps and Changes parts), Models (providers, global spend caps), the board's title row, which stacks its checkboxes under the title.
- **Check:** `expectTouchTargets` in `apps/web/e2e/phone.ts` lists every control under 44 px; `phone-targets.spec.ts` runs it on project settings, Models and the board's title row, and checks the title is one line above its checkboxes.
- **Screenshots:** rendered in CI's Docker image; one phone image changed (the board), no desktop image.
