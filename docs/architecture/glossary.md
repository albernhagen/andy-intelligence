# andy-intelligence — Glossary

The only words for planning work, as the system stores them (ADR-0058: Ticket model; ADR-0131: Milestones). Docs, UI, agent rules and tickets use these and nothing else: no "slice", no "story".

## Planning

| Term          | Meaning                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project**   | One product with its own repo, tickets and settings; key in capitals (`AI`).                                                                                        |
| **Milestone** | An ordered stage of a project's roadmap with an outcome and a status (not reviewed, approved, parked); groups epics. ID and title, e.g. "M4: Epics + ticket board". |
| **Epic**      | A ticket of type `epic` that groups child tickets under one outcome and Done-when list; belongs to one milestone; never runs itself.                                |
| **Ticket**    | One unit of work, key `<PROJECT>-<n>` (`AI-42`): one PR, built by an agent or Andy. A ticket under an epic is its child ticket.                                     |

## Ticket types

| Type        | Meaning                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------- |
| **epic**    | Groups child tickets (above).                                                                       |
| **feature** | New behaviour; acceptance criteria in EARS form ("… shall …").                                      |
| **chore**   | Upkeep with no new behaviour (docs, config, refactors); a "done when" checklist.                    |
| **bug**     | Wrong behaviour; criteria state the expected behaviour, and the build commits a failing test first. |
| **spike**   | A question answered in a findings doc under `docs/`; no product code.                               |

## Naming

Write every milestone or ticket reference as `ID: title`: "M4: Epics + ticket board", "AI-205: M4.27: One glossary". `M<N>.<n>` in a ticket title is its place in milestone `M<N>`; branches use it too: `m<N>.<n>/<short-name>`.
