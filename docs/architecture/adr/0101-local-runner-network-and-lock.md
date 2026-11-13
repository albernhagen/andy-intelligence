---
status: proposed (AI-131 follow-up; Andy decides at review)
date: 2026-11-12
amends: 0098 (the agent's sandbox, and one runner per home)
---

# 0101 — Local runner: agent network HTTPS and DNS only; one runner per home, taken atomically

The review of the follow-up to PR #177 (AI-131: Local executor: runner CLI) found two gaps in what ADR-0098 decided.

- The agent's Seatbelt profile left outbound network open, and `/Volumes` readable.
- The runner lock could be taken by two runners starting together after a crash. A runner that lost the lock went on claiming for up to 30 s.

## Decisions

| Topic         | Choice                                                                                                                                                                                                                                                                                                                                                                                            | Why                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent network | The agent's profile denies outbound network, then allows TCP to port 443 and the DNS socket (`/private/var/run/mDNSResponder`).                                                                                                                                                                                                                                                                   | Claude Code needs only HTTPS to its API. Everything else, such as plain HTTP or other ports, is refused.                                        |
| `/Volumes`    | Denied like `/Users`: no file contents, no writes.                                                                                                                                                                                                                                                                                                                                                | External and network drives can hold any user's files.                                                                                          |
| Live check    | Before each agent, besides ADR-0098's file facts: a local HTTP server on a non-443 port answers `curl` outside the profile and must not answer it inside.                                                                                                                                                                                                                                         | The network limit fails closed like the file limits, with no model call.                                                                        |
| Lock          | `runner.lock` is taken with `link`, which fails if it exists. A dead runner's lock is moved aside with `rename`: only one starter's rename succeeds, and a live lock moved by mistake goes back with `link`. The runner checks it owns the lock before every claim and every 30 s; once it's lost, it claims nothing more and stops its tasks. `start` refuses to run without its own start time. | Two runners never claim from one home. A Ctrl-C after a lost lock is still a first signal (graceful stop), because lock loss has its own abort. |

## Residual risk (R-AI-44)

- HTTPS reaches any host: Seatbelt filters by port, not host name. Narrowing to the API's hosts would need a local allow-listing proxy.
- Lock loss is noticed at the next claim or the next 30 s check. Between them, a task already running keeps running.

## Consequences

- Good: an injected agent can't use plain HTTP, other ports or external drives.
- Bad: if Claude Code ever needs a port other than 443, the agent fails at start; `local-runner check-settings` shows it first.
