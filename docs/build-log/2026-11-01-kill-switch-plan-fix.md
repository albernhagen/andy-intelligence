# 2026-11-01 — Kill switch plan fix

- Andy applied `infra/control-plane` (6 added) and `infra/billing` without the switch (1 change: 150% threshold). With `kill_switch_enabled = true` the plan failed: `for_each` keyed by a custom role name unknown until apply. Fixed with static keys; budget threshold rules reordered to match the API (the plan showed a swap). Lesson: `terraform validate` doesn't catch unknown `for_each` keys; only a plan does, and `infra/billing` plans locally only.
- Applied by Andy from this branch: 15 added, 1 changed. **Demo passed:** fake budget message at 200% → workflow `SUCCEEDED`, `/health` 503 (manual scaling at 0 accepted with `launchStage: BETA`), `run-watchdog` `PAUSED`. Switch left on in Andy's tfvars. M1.14: Cost kill switch Done when met.
