# Verify procedure

How the verify agent checks a deployed release against its tickets (AI-182: M6.6, ADR-0114 "Verifying stage"): [`platform/procedures/verify.md`](../../platform/procedures/verify.md), result schema `verify.schema.json` beside it, checked by `VerifyVerdict` in `packages/contracts/src/entities/verify.ts`.

- **Steps:** reach the URL → run the repo's `test:e2e` or API tests against it, if any → check each acceptance criterion over HTTP or a headless browser → verdict.
- **Per criterion:** `pass` or `fail` with evidence (requests, responses, screenshot paths, test or log excerpts; secrets redacted), or `skipped` with a reason (internal, needs sign-in, needs a write in prod, out of time).
- **Verdict:** a ticket fails if any criterion fails; skipped doesn't fail it. The release fails if any ticket or test fails.
- **Limits:** no write tools, no credentials, read-only on prod, 20-minute cap. Deployed content is untrusted (R-AI-182).

**How to use:** not run yet: AI-188: M6.7: Verification run starts it after a deployment and turns the Verifying stage on. By hand: "follow platform/procedures/verify.md for this URL and these tickets".
