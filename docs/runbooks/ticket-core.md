# M1.2: Ticket core — runbook (Andy)

What you run by hand for M1.2: Ticket core: one Terraform apply, one local test, and the "Done when" checks.

## 1. Apply the infra

Adds (all in `infra/control-plane`):

| Resource                                                                                 | Why                                                  | Cost                            |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------- |
| Cloud Tasks API + queue `run-watchdog` (5/s, 5 concurrent, 3 attempts)                   | Run deadlines (used from M1.6: Claude Code executor) | Free tier (1M operations/month) |
| Service account `tasks-invoker` (no roles)                                               | Identity on watchdog calls; the API checks its token | Free                            |
| Runtime SA: `cloudtasks.enqueuer` on that queue, `serviceAccountUser` on `tasks-invoker` | Lets the API enqueue tasks as that identity          | Free                            |
| Firestore daily backup schedule, 7-day retention                                         | Firestore is the only copy of tickets                | Cents/month at this size        |

```sh
cd infra/control-plane
terraform plan -out=cp.tfplan   # expect: 6 to add, 0 to change, 0 to destroy
terraform apply cp.tfplan
```

Then check the PR's CI `plan` job: it should show "No changes" once you've applied (or the same 6 adds before).

## 2. Run the Firestore adapter suite (needs Java)

CI runs this suite on the real adapter when it changes (`firestore-suite`, ADR-0045). To run it locally:

```sh
brew install openjdk   # once; firebase-tools needs Java 21+ on PATH (/opt/homebrew/opt/openjdk/bin)
pnpm test:firestore
```

Expect the `WorkTracker contract: firestore (emulator)` tests to pass. The emulator uses the fake project `demo-andy-intelligence`, so nothing touches real GCP.

## 3. Verify "Done when"

After the PR merges and deploys:

1. Sign in to the app. In the browser dev tools → **Network**, open the `/api/me` request and copy the `authorization` header value (an ID token, valid 1 hour; don't paste it anywhere public).
2. Create a project and a ticket:

```sh
URL=https://ai.andybernhagen.com
read -rs AUTH   # paste "Bearer eyJ…", press Enter
curl -s -X POST "$URL/api/projects" -H "authorization: $AUTH" -H 'content-type: application/json' -d '{"name":"andy-intelligence","key":"AI"}'
curl -s -X POST "$URL/api/projects/ai/tickets" -H "authorization: $AUTH" -H 'content-type: application/json' -d '{"type":"task","title":"First ticket"}'
```

3. Firestore console → `projects/ai/tickets/<id>` exists with key `AI-1`, and `…/events` has one `created` event.

API reference: `$URL/openapi.json`.

## Restore from a backup

Firestore console → **Disaster recovery** → **Backups** → pick a backup → **Restore** into a **new** database ID, check it, then point `GCP_PROJECT_ID`'s database at it or copy documents back. A restore never overwrites `(default)`.
