# 2026-11-05 — Refine questions can be answered (AI-27)

- **Bug:** no question asked by a refine run could be answered, over the API (what the UI calls) or MCP `answer_question`. Both validated the question id as a UUID; a run's questions get `<runId>-q<n>` so that a replayed report writes the same ids. About 60 questions were stuck in the inbox the day auto-refine went live, and no refined ticket could reach Ready.
- **Why CI missed it:** the tests answered hand-made questions (UUID ids). Nothing drove the real path: run report → questions → answer.
- **Fix:** one `QuestionId` schema in `packages/contracts` (letters, digits and `-`, at most 64 characters: covers both forms, safe as a storage path, rejects Firestore's reserved `__x__` form), used by the REST route, the MCP tool, and when a question is built, so a run id that can't form a sendable id fails at write time.
- **Tests:** a refine run reports a question, Andy answers it over the API, the ticket moves to Ready; the same over MCP; malformed ids are a 400 and unknown ones a 404.
- **Also:** `docs/architecture/ui.md` was 7 words over its budget on `main` after PR #72 and PR #75 each added to it; trimmed without losing content.
