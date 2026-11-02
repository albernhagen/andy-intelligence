# Adversarial review — runbook (Andy)

Manual steps for the per-PR adversarial-review agent (ADR-0026: Adversarial PR review, ADR-0037: Review agents share composite actions; adversarial re-reviews are incremental). It runs on the same `CLAUDE_CODE_OAUTH_TOKEN` as the security review (`docs/runbooks/security-review.md` §1), so it uses your subscription quota, not money.

| Term                     | Meaning                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocker`                | A finding with a failing scenario that should stop the merge. Fails the `adversarial-review` check.                                                                 |
| `should-fix`, `question` | Shown in the comment only; the check passes.                                                                                                                        |
| `review-accepted`        | PR label: Andy accepts the open blockers. Write why in the PR. Removed automatically on the next push.                                                              |
| Re-review                | Each push reviews only the new commits plus the open findings, with replies from you and collaborators as context. A fix or a reply with evidence clears a blocker. |

## 1. Label (once)

```sh
gh label create review-accepted --repo albernhagen/andy-intelligence \
  --color D93F0B --description "Andy accepts the adversarial-review blockers (reason in the PR)"
```

## 2. Required check (once, after the M1.11 PR has run)

Settings → Rules → Rulesets → `protect-main` → **Require status checks to pass** → add `adversarial-review`. It appears in the picker only after it has run once.

## 3. Answering findings

Reply on the PR to every finding (ADR-0026): "fixed in `<commit>`" or why not, with evidence. Then either:

- push the fix: the review re-runs on the new commits and moves fixed items to **Resolved**; or
- for a reply-only answer: Actions → the PR's **Adversarial review** run → **Re-run jobs**. The reviewer reads your reply; a reply without evidence doesn't clear a `blocker`.

Only comments by the repo owner and collaborators reach the reviewer; anyone else's are dropped.

## 4. Check it works (M1.11 "Done when")

After the M1.11 PR merges (so the procedure comes from `main`):

```sh
git switch -c test/adversarial-review-demo origin/main
cat > packages/domain/src/paging.ts <<'TS'
/** Items on 1-based page `page` of `size` items. */
export function pageOf<T>(items: T[], page: number, size: number): T[] {
  const start = (page - 1) * size;
  return items.slice(start, start + size + 1);
}
TS
git add packages/domain/src/paging.ts
git commit -m "test: planted off-by-one, no test (do not merge)" && git push -u origin HEAD
gh pr create --title "test: adversarial review demo (do not merge)" --body "Planted off-by-one in pageOf."
```

1. **Adversarial review** comments a `blocker` with a scenario like "page 1, size 10 → 11 items", and the check fails.
2. Fix it (`start + size`), add a test, push: the re-review lists it under **Resolved** and the check passes.
3. Plant it again and push, then add `review-accepted`: the check passes without re-running the agent. Push once more: the label is removed.
4. Close the PR and delete the branch.

## Troubleshooting

| Symptom                                     | Cause / fix                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| "not reviewed" comment, check passes        | Agent couldn't run (draft, Dependabot, docs-only, no token, quota). Expected; review by hand.        |
| Blocker you disagree with keeps coming back | Reply with the evidence (test, spec line, ADR) and re-run; or add `review-accepted` with the reason. |
| Review missed changes after a force-push    | A force-push drops the previous review commit, so the next run reviews the whole PR again.           |
