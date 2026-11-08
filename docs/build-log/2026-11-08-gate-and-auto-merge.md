# 2026-11-08: M1.8b: Gate and auto-merge (AI-34)

**What:** the review gate is built. On each PR or finished-check webhook the control plane re-reads the PR's files, required checks and head check runs from GitHub, records `wouldAutoMerge` and `gateReasons` on the Run, and squash-merges with the App token when the project's `autoMerge` policy allows the ticket's size. On close it records outcome and metrics.

**Decisions inside the ticket's answers:**

| Topic                   | What was built                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `wouldAutoMerge`        | The gate's answer only; the policy doesn't change it. Under `none` it is still true when the gate passes, which is the dataset §4.5 asks for.                                                                                                          |
| Older project documents | `Project.autoMerge` reads as `none` when absent; registration writes `s-and-m`. Project AI needs no migration.                                                                                                                                         |
| Protected paths         | The ticket's list, widened to match ADR-0078's Andy-merges list where a path can express it, plus files that run commands on Andy's machine. Over-flagging only costs Andy a look.                                                                     |
| Merge guard             | A `mergeAttemptedSha` claim (atomic in `applyRunPatch`): one attempt per head commit, so racing check webhooks merge once and a failed merge is never retried; a new commit is assessed afresh. The merge is pinned to the head SHA that was assessed. |
| Required checks         | Read live from the branch rules, with their reporting app; `adversarial-review` and `security-review` are always required. No rules at all is a veto.                                                                                                  |

**Known limits:**

- The gate runs inside the webhook request. If a delivery times out or a host read fails on the last check, the PR waits for the next event or for Andy.
- Reverts are detected from a merged revert PR, not from a bare revert commit (no `push` webhook).
- The adversarial procedure's spec pass needs the acceptance criteria and plan in `.review/discussion.md`. Agent PRs don't provide them yet: the publish job's PR body has no criteria, and the prepare action drops descriptions from bot authors. Needs a `.github/` + `platform/actions/` change.
