# Merge gate

Per PR or check webhook, judges agent PRs on GitHub facts, not PR text. Vetoes: no verification output, protected or tooling paths, spike code outside `docs/`, a failing required or review check. Records `wouldAutoMerge` and reasons per task; squash-merges (one try per head) only if `autoMerge` covers the size; failed merges flag the ticket; close records outcome, metrics

**How to use:** Project settings or `set_auto_merge`: `none`, `s`, `s-and-m` (new projects' default), `all`; `AI` stays `none`
