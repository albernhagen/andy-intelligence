# Threat model: Digest summary

The `summarize` agent task (AI-323: Digest: an AI-written summary of what was done, ADR-0137). Index: [threat-model.md](threat-model.md); risk: [R-AI-323](risks/R-AI-323.md). Once a day per project, a run with no ticket turns the day's merged PRs and ticket changes into a short summary that the digest shows.

## Entry points

| Entry point                                    | Who                                      | What it does                                                              |
| ---------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| First digest read after the day ends (PR 3)    | Anyone who can read the project's digest | Claims the day and starts the task, under the caps below                  |
| `/runs/:id/report` of a `summarize` run (PR 3) | Its own executor run only                | Stores the summary on the day's document, only for the run recorded on it |

## Trust boundaries

- **No tools at all.** The executor lists `summarize` as read-only with no tools: managed settings allow nothing and deny every tool, and the flags repeat it. It refuses a `summarize` context that has a ticket or a branch, or that asks for more than 3 turns, before the agent job gets the model credential. The agent step times out after 10 minutes.
- **The input is untrusted.** PR titles, release notes, and ticket, epic and milestone titles are written by people and agents. They go into the prompt after the fixed procedure, as JSON inside `<digest_data>` with `<` escaped, capped at 50 PRs and 24,000 characters. The procedure says they are data.
- **The output is untrusted.** It must pass the executor's JSON schema and the domain's `DigestSummaryOutput`: at most 120 words and 12 lines, and every claim cites tickets or PRs. A citation that isn't in the input fails the summary. It is shown as plain text, labelled as model-written, with the plain digest list below it.
- **No paid call.** It runs on the subscription. The direct executor path stays off until Andy turns a paid route on, and then the spend caps apply.

## Caps (ADR-0028)

One summary per project per day plus one retry by hand; 10 writes started per UTC day across projects; pause, quota reserve and run caps (`mayDispatch`); fast tier, 3 turns, 10 minutes. Nothing retries on its own.
