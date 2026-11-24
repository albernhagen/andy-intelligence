# andy-intelligence — Review gate (v1.x: rules only)

§4.5 body moved unchanged from [workflow.md](workflow.md) (AI-221).

- **Hard vetoes → Andy reviews:** protected paths (CODEOWNERS: auth, payments, migrations, infra), dependency changes, CI not green, new behavior without new tests, no verification output in the run summary (ADR-0040), diff > N lines, any agent-raised concern.
- **Otherwise:** the gate merges an agent PR only when `mergeVerdict` (`packages/domain/src/merge-verdict.ts`, AI-215) says so under the ticket's merge mode (ADR-0124; the project's saved mode, or a stricter ticket or epic override): every required check and both review agents passed, the head contains the latest default branch (the product's check; GitHub doesn't require up-to-date branches, and the merge queue, AI-110: M5.18, will sync before each merge: ADR-0144), labels read with no `review-accepted` / `security-accepted`, no open blocker, should-fix, high or critical finding (the review checks fail on each, ADR-0134; a findings store, when wired, is read too), no kept path (`merge-paths.ts`, every mode) and, in `low-risk`, no high-risk path. Any fact it can't read means wait. No mode saved: nothing merges (ADR-0134). The mode and verdict are recorded on the Run.
- **Built (M1.8: Build + gate):** vetoes for no verification output, protected or tooling path, and a required or review check not passing; diff size and new-behaviour-without-tests are a follow-up. Facts: the host's PR and check webhooks, never PR text. `wouldAutoMerge` is the gate's own answer, recorded with `gateReasons` under every policy; the policy only decides whether to merge. Merge: squash with the App token, pinned to the assessed head, one attempt per head; a failure flags the ticket; no merge while a sync is pending (`sync_pending`). Outcome and metrics come from the close webhook, on the Run.
- **Dependabot** (ADR-0042): npm patches and 1.0+ minors auto-merge once checks pass, deploying with Andy's next merge; the rest go to Andy. CODEOWNERS (`* @albernhagen`) requests Andy's review on every PR he didn't author; paths listed after `*` are the protected paths above.
- **Adversarial review** on every PR (ADR-0026): a fresh reviewer session looks for reasons not to merge, each finding with a concrete failing scenario. Three passes: bugs and logic, plus (from M1.8: Build + gate) compliance with the ticket's acceptance criteria and approved plan; nits capped at 5 (ADR-0040). The implementer answers every finding. An unresolved `blocker` or `should-fix` fails the check unless Andy labels `review-accepted` (should-fix since ADR-0134). From M9 the reviewer is a different vendor than the implementer.
- Security review on every PR (§9.1). A high/critical security finding is a hard veto unless Andy marks it `security-accepted`.

## Reviewer seam (AI-361)

What any reviewer, ours or a hosted one, must post for `mergeVerdict` to count it. Written from the code on 2026-11-23; each row names its source, so drift can be checked.

| The gate reads | Exactly | Source |
| --- | --- | --- |
| Two check runs on the PR head | Names `adversarial-review` and `security-review`, required on every PR even if the branch rules omit them | `packages/domain/src/gate.ts` `REVIEW_CHECKS` |
| Who reported them | The check's reporter (`sourceId`, the GitHub App) must be the one the branch rules name for that check, else the rules' reporter for other checks; any other reporter's check of that name is ignored | `gate.ts` `assessChecks` |
| A pass | `completed` with conclusion `success` only; `neutral`, `skipped` or missing is not a pass (waits or fails) | `gate.ts` `reviewPasses` |
| Labels | `review-accepted` or `security-accepted` on the PR → verdict `wait` (`accepted_label`): an accepted finding is Andy's merge, never the gate's | `packages/domain/src/merge-verdict.ts` `ACCEPTED_LABELS` |
| Stored findings | Open findings recorded for this repo, PR number and head SHA → `wait` (`open_review_findings`); a failed or cut-short read → `wait` | `merge-verdict.ts` `openFindingsOn`; `gate-service.ts` `openFindings` (newest 30 PRs, 300 findings) |

**Severity words.** Each review's check must fail on its blocking words, so a passing check means a clean PR (ADR-0134). The gate's own list, `OPEN_FINDING_SEVERITIES`, is the union: `blocker`, `should-fix`, `critical`, `high`.

| Check | Words | Blocking (fails the check) | Source |
| --- | --- | --- | --- |
| `adversarial-review` | `blocker`, `should-fix`, `question` | `blocker`, `should-fix` | `scripts/review-gate.mjs` `ROLES.adversarial`; `platform/procedures/adversarial-review.schema.json` |
| `security-review` | `critical`, `high`, `medium`, `low`, `info` | `critical`, `high` | `ROLES.security`; `security-review.schema.json` |

A finding with any other word makes the whole output invalid: "not reviewed", which fails (`parseFindings`).

**Where findings live.**

- **Sticky PR comment**, one per check, posted by `github-actions[bot]` and starting with `<!-- adversarial-review -->` or `<!-- security-review -->`. A completed review adds `<!-- reviewed-sha: <40-hex head> -->` (`reviewedShaMarker`); "not reviewed", skipped and fork comments don't, so the next incremental review never skips unreviewed commits (`review-gate.mjs` `evaluate`; `platform/actions/agent-review-finish`). The re-sync carry-forward reads this marker and a `### ✅` heading (`scripts/review-carry.mjs`, ADR-0140). The gate never reads comments.
- **Findings store**: `POST /review/findings` with the review job's Actions OIDC token; the repo, PR and reviewer come only from the token's `workflow_ref`, which must be `.github/workflows/(security|adversarial)-review.yml@refs/pull/<n>/merge`; the body is the head SHA plus each finding's severity, kind, title and file, capped (`apps/api/src/review-findings.ts`, `scripts/review-findings.mjs`, ADR-0097). Wired in production (`apps/api/src/main.ts`), so the gate reads it.

**Accepted labels** (`review-accepted`, `security-accepted`): adding one passes its check without re-running the agent, and the comment shows ⚠️ accepted; the next push removes it (`platform/actions/agent-review-prepare`). It never lets the gate merge: `mergeVerdict` waits on either label.

**Modes that pass or fail** (ADR-0140): skipped by design (docs-only, draft, Dependabot) passes; a review that should have run and didn't (no token, agent failure, a re-sync merge that changed the PR) fails unless labelled; fork PRs pass only with the label.

**To swap in a hosted reviewer**, it must report both check names from the trusted reporter, with `success` only when no blocking word is open on that head, and honour the labels. Posting to the findings store needs a new caller in `reviewCaller`; without it the checks alone carry the verdict.

**Frozen, no new features** (2026-11-23 review, `docs/build-log/2026-11-23-review-outcome.md`): `scripts/resync-prs.mjs` and `scripts/coordinator/`. Desktop worker sessions rely on Auto-fix for CI failures, conflicts and review comments, so more PR babysitting there would duplicate it; fixes for bugs still land. **Revisit a hosted reviewer** only when one is open to a personal account, by running it beside these two reviews on ten real PRs and comparing the findings.
