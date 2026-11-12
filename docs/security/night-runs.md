# Threat model: Night runs

Overnight launches (ADR-0049, AI-104, AI-123). Risk register: [threat-model.md](threat-model.md) (R27). Night launches aren't wired into the API yet (M4.18): until then nothing here runs.

## What an unattended night may decide by itself

- Only on a story of a **running** launch: an epic's child, listed in the launch when Andy started it.
- A refine gap that would have been a question, or held past a question cap (ADR-0087), becomes an assumption marked with the launch id (`nightLaunchId`). It isn't held, so the story can reach Ready and build without Andy's answer.

## What it never may

- Answer a question that was open before the launch: the launch refuses to start while any story has one, misses the Definition of Ready or waits for a plan approval (AI-104).
- Merge outside the merge gate: the auto-merge policy, required checks, both review agents and the protected paths are unchanged. A veto stops the story.
- Start a story whose blocker failed, was rejected or was vetoed: it waits on `blockedBy`, and the launch lists it as skipped.
- Keep going once the launch is `stopping` or ended: questions are asked again as usual.

## Caps (ADR-0028)

Per launch, set by Andy and checked at start: agent tasks ≤ 100, tokens ≤ 50 M, ≤ $500 at API prices, stop time ≤ 16 h away, ≤ 50 stories. The dispatch dial, the global cap, the cap on agent PRs waiting and the quota reserve still apply (ADR-0079).

## Threat and residual risk

- Gap text comes from refine output, which untrusted ticket content can shape. Overnight, an injected costly guess can therefore build without Andy's answer instead of waiting.
- Mitigations: the caps above; every agent PR still passes the merge gate, CI and both review agents; Andy reviews each `nightLaunchId` assumption in the morning, and the PR shows the change before he merges.
- Residual: a wrong night assumption can produce a plausible PR that passes the checks; only the morning review catches it.
