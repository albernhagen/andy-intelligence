# 2026-11-24 — AI-216: Merge modes: epic PR mode, child tickets merge into the epic branch and Andy merges one PR

- Built the `epic` merge mode by day on the night-merge path (AI-124): `EpicMode` (`packages/domain/src/epic-mode.ts`) gives a child ticket's build `epic/<KEY>` as its base (made from the default branch's tip when missing), lets `EpicMerges` merge its clean PR there, and opens one PR epic → default branch when the epic's last open child ticket is Done. A ticket with no epic waits for Andy (`mode_epic`).
- Epic-branch merges stay outside AI-110: M5.18: Merge queue per repo, as night merges do: the queue is per default branch and these merges never change it. Two child PRs judged on the same epic tip can both merge; the epic PR's checks, both reviews and Andy catch a break before the default branch.
- Bound (ADR-0028): once per child ticket (the run's merge claim), and an epic with more than 50 open or Done child tickets merges none into its branch.
- MCP `merge_pr` answers `wait` (`gate_not_clean`, `not_default_branch`) for a PR into an epic branch, in every mode; unchanged here.
- Stacked on PR #403 (AI-110) on Andy's word.
