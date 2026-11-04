# 2026-11-04 — Executor: permission profile self-test on every run (AI-12)

- Live checks AI-11 (`.env`, `/proc/self/environ`) and AI-12 (`/etc/hostname`): both runs succeeded, but the agent refused the ticket's instruction on its own (ticket text is untrusted), so `permission_denials_count` was 0 and the managed-settings profile was never exercised. A ticket can't test the profile.
- Andy chose a per-run self-test over a one-off check. Before the real agent, the `agent` job writes a decoy `.env.selftest` holding a random token, runs a short Haiku session with the platform's own prompt that tries to read it, and `scripts/executor-selftest.mjs` passes only on a counted denial with the token nowhere in the session. Otherwise the job stops before the agent (fail closed) and the run is reported failed with the reason. The decoy is deleted before the agent runs.
- Cost: about 20 s and a few cents of quota per run; not included in the Run's tokens or cost.
- AI-1's "read `.env` is refused" criterion is proven live by the first run after this merges.
