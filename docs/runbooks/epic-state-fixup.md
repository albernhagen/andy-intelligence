# Epic state: one-off fix-up

Puts every existing epic of a project at the stage its tickets give it (AI-404, ADR-0164). Run once per project, after the AI-404 PR is deployed. Safe to re-run: a second run finds nothing to move. Until it runs, each epic heals on its next ticket write.

| Step       | Command or action                                                                                                   | Expect                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1. Sign in | `gcloud auth application-default login`                                                                             | Signed in as you                                                                                                     |
| 2. Dry run | `GOOGLE_CLOUD_PROJECT=<control-plane project> pnpm --filter @andy/api exec tsx src/fix-epic-stages.ts --project ai` | One line per epic (`AI-x: title · ready → done · follows its tickets: N of M done`), then `Dry run: N epics to move` |
| 3. Write   | The same command with `--apply`                                                                                     | `Moved N epics; M were already in step`                                                                              |
| 4. Check   | Run step 2 again; open the Roadmap                                                                                  | `Dry run: 0 epics to move`; each epic's state matches its tickets                                                    |

- Rule: no tickets or all in Backlog → Backlog; any past Backlog → In progress; all Done (Cancelled left out) → Done, or Ready for review when the epic's `needsCheck` is on. Child epics are written before their parents. Cancelled epics are left alone.
- Reads: the project's tickets once; with `--apply`, each moved epic and its children again. Writes: one stage change per moved epic, as `system`, with its reason in the epic's history. Firestore of `GOOGLE_CLOUD_PROJECT`, your Application Default Credentials (needs Firestore write).
- The web and MCP see the changes within the read cache's max age (ADR-0126), since the script doesn't bump the project's change counter.
- Undo: each move is a `stage_changed` event by `system`; move an epic back by restoring the old stage in the console (moves through the app are refused for epics).
