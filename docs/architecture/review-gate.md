# andy-intelligence — Review gate (v1.x: rules only)

§4.5 body moved unchanged from [workflow.md](workflow.md) (AI-221).

- **Hard vetoes → Andy reviews:** protected paths (CODEOWNERS: auth, payments, migrations, infra), dependency changes, CI not green, new behavior without new tests, no verification output in the run summary (ADR-0040), diff > N lines, any agent-raised concern.
- **Otherwise:** the gate merges an agent PR only when `mergeVerdict` (`packages/domain/src/merge-verdict.ts`, AI-215) says so under the ticket's merge mode (ADR-0124; the project's saved mode, or a stricter ticket or epic override): every required check and both review agents passed, the head contains the latest default branch (the product's check; GitHub doesn't require up-to-date branches, and the merge queue syncs before each merge: ADR-0144, below), labels read with no `review-accepted` / `security-accepted`, no open blocker, should-fix, high or critical finding (the review checks fail on each, ADR-0134; a findings store, when wired, is read too), no kept path (`merge-paths.ts`, every mode) and, in `low-risk`, no high-risk path. Any fact it can't read means wait. No mode saved: nothing merges (ADR-0134). The mode and verdict are recorded on the Run.
- **Built (M1.8: Build + gate):** vetoes for no verification output, protected or tooling path, and a required or review check not passing; diff size and new-behaviour-without-tests are a follow-up. Facts: the host's PR and check webhooks, never PR text. `wouldAutoMerge` is the gate's own answer, recorded with `gateReasons` under every policy; the policy only decides whether to merge. Merge: squash with the App token, pinned to the assessed head, one attempt per head; a failure flags the ticket; no merge while a sync is pending (`sync_pending`). Outcome and metrics come from the close webhook, on the Run.
- **Dependabot** (ADR-0042): npm patches and 1.0+ minors auto-merge once checks pass, deploying with Andy's next merge; the rest go to Andy. CODEOWNERS (`* @albernhagen`) requests Andy's review on every PR he didn't author; paths listed after `*` are the protected paths above.
- **Adversarial review** on every PR (ADR-0026): a fresh reviewer session looks for reasons not to merge, each finding with a concrete failing scenario. Three passes: bugs and logic, plus (from M1.8: Build + gate) compliance with the ticket's acceptance criteria and approved plan; nits capped at 5 (ADR-0040). The implementer answers every finding. An unresolved `blocker` or `should-fix` fails the check unless Andy labels `review-accepted` (should-fix since ADR-0134). From M9 the reviewer is a different vendor than the implementer.
- Security review on every PR (§9.1). A high/critical security finding is a hard veto unless Andy marks it `security-accepted`.

## Reviewer seam (AI-361)

What any reviewer, ours or a hosted one, must post for `mergeVerdict` to count it. From the code on 2026-11-23; each row names its source so drift can be checked.

| The gate reads | Exactly | Source |
| --- | --- | --- |
| Two check runs on the head | `adversarial-review` and `security-review`, required on every PR even if the branch rules omit them | `packages/domain/src/gate.ts` `REVIEW_CHECKS` |
| Reporter | The GitHub App (`sourceId`) the branch rules name for that check, else for other checks; another reporter's check of that name is ignored | `gate.ts` `assessChecks` |
| Pass | `completed` + `success` only; `neutral`, `skipped` or missing is not a pass | `gate.ts` `reviewPasses` |
| Labels | `review-accepted` or `security-accepted` → `wait` (`accepted_label`): Andy's merge, never the gate's | `packages/domain/src/merge-verdict.ts` `ACCEPTED_LABELS` |
| Stored findings | Open findings for this repo, PR and head SHA → `wait`; a failed or cut-short read → `wait` | `merge-verdict.ts` `openFindingsOn`; `gate-service.ts` `openFindings` |

**Severity words.** Each check fails on its blocking words, so a passing check means a clean PR (ADR-0134); the gate's `OPEN_FINDING_SEVERITIES` is their union. Any other word makes the output invalid: "not reviewed", which fails (`parseFindings`).

| Check | Words | Blocking | Source |
| --- | --- | --- | --- |
| `adversarial-review` | `blocker`, `should-fix`, `question` | `blocker`, `should-fix` | `scripts/review-gate.mjs` `ROLES`; `platform/procedures/adversarial-review.schema.json` |
| `security-review` | `critical`, `high`, `medium`, `low`, `info` | `critical`, `high` | `ROLES`; `security-review.schema.json` |

**Where findings live.**

- **Sticky PR comment** per check, by `github-actions[bot]`, starting `<!-- adversarial-review -->` or `<!-- security-review -->`. Only a completed review adds `<!-- reviewed-sha: <40-hex head> -->`, so the next incremental review never skips unreviewed commits (`review-gate.mjs` `evaluate`, `platform/actions/agent-review-finish`); re-sync carry-forward reads it (`scripts/review-carry.mjs`, ADR-0140). The gate never reads comments.
- **Findings store**: `POST /review/findings` with the job's Actions OIDC token, whose `workflow_ref` must be `.github/workflows/(security|adversarial)-review.yml@refs/pull/<n>/merge`; body: head SHA plus each finding's severity, kind, title, file (`apps/api/src/review-findings.ts`, `scripts/review-findings.mjs`, ADR-0097). Wired in production (`apps/api/src/main.ts`).

**Accepted labels** pass their check without re-running the agent (⚠️ in the comment) and are removed on the next push (`platform/actions/agent-review-prepare`); `mergeVerdict` still waits.

**Modes** (ADR-0140): skipped by design (docs-only, draft, Dependabot) passes; should have run and didn't fails unless labelled; forks pass only with the label.

**A hosted reviewer** must report both check names from the trusted reporter, `success` only with no blocking word open on that head, and honour the labels. Using the findings store needs a new caller in `reviewCaller`.

**Frozen, no new features** (`docs/build-log/2026-11-23-review-outcome.md`): `scripts/resync-prs.mjs` and `scripts/coordinator/`. Worker sessions rely on Auto-fix for CI failures, conflicts and comments, so more PR babysitting would duplicate it; bug fixes still land. **Revisit a hosted reviewer** only when one is open to a personal account, comparing it with these reviews on ten real PRs.

## Merge queue (AI-110)

Every control-plane merge into a default branch goes through the repo's merge queue (ADR-0150, `packages/domain/src/merge-queue.ts`): the gate's merges of agent PRs and MCP `merge_pr`'s of session PRs.

- **Joins:** a PR whose verdict is `merge`, or `wait` for `behind_default_branch` alone. Order: oldest first; only the head merges.
- **Lease:** the head is judged and merged under a lease on the repo's `mergeQueues` record (compare-and-set, 90 s; an expired lease is taken over), so it holds across instances.
- **Head:** behind → one sync round per head (sync tick for agent PRs, the re-sync workflow for the rest); then wait for checks and reviews on the new head; re-judge with the full verdict, re-read the base tip, merge pinned to the judged head. Up to date and clean → merges at once.
- **Drops:** failed checks, 20 PRs per repo, 3 syncs per PR, 60 minutes at the head → dropped and the ticket flagged (Needs-you). No longer clean or closed → dropped, logged.
- **Moves on:** webhooks (checks and PR events on the head, main moving; any event once the head is past its hold cap) and `merge_pr` calls. Logs: `merge queue enqueue|sync|wait|merge|drop|busy|lease takeover`.
