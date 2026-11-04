# 2026-11-04 — Live permission-profile check deferred to M1.8 (AI-1, AI-12)

- Live runs after PR #55 succeeded end to end (Actions runs 41761875946, 41762024909, 41762367331): dispatch, OIDC callbacks, report as a ticket comment.
- The `.env` refusal checks (AI-11, AI-12) never exercised the permission profile: the agent refused the ticket's instruction on its own (ticket text is untrusted), so `permission_denials_count` was 0.
- A per-run self-test (decoy `.env` read in every run, fail closed; PR #56) was built and closed unmerged: Andy judged it over-engineered for read-only refine runs. AI-1's `.env` criterion is covered by the read-only tool set, the model's refusals and the profile's unit tests; a counted live denial is now a precondition in the M1.8: Build + gate row, tracked by AI-12.
