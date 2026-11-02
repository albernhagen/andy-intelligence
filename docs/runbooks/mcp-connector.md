# Runbook: connect Claude to the MCP endpoint

How Andy turns on `/mcp` and adds it to Claude desktop as a custom connector (ADR-0039: MCP OAuth facade). Done once; repeat section 3 on a new device or after revoking.

## 1. Apply Terraform (`infra/control-plane`)

Adds the `PUBLIC_URL` env var (turns MCP on) and a Firestore TTL policy for `oauthGrants`.

```sh
cd infra/control-plane
terraform plan -out=cp.tfplan   # expect: 1 to add, 1 to change, 0 to destroy
terraform apply cp.tfplan
```

- Add: `google_firestore_field.oauth_grant_ttl`. TTL policies can take a few minutes to become active.
- Change: `google_cloud_run_v2_service.control_plane` (new env var → new revision with the current image).

Apply before or after the code deploys: MCP turns on once both are done. Afterwards the CI `plan` job shows "No changes".

## 1b. Run the Firestore adapter suite (needs Java)

CI tests the in-memory fake only (ADR-0034). Run once for the new `FirestoreOAuthGrantStore`. Needs Java 21+ for the emulator: `brew install openjdk@21`, then `export PATH="$(brew --prefix openjdk@21)/bin:$PATH"` (add it to `~/.zshrc`).

```sh
pnpm test:firestore
```

## 2. Check the endpoint

Use the `service_url` output (`https://control-plane-<project-number>.us-central1.run.app`), not the legacy hash URL.

```sh
URL=$(terraform output -raw service_url)
curl -s "$URL/.well-known/oauth-protected-resource/mcp"   # resource = $URL/mcp
curl -si -X POST "$URL/mcp" | grep -i www-authenticate     # 401 + resource_metadata
```

## 3. Add the connector in Claude desktop

1. Settings → Connectors → Add custom connector. Name: `andy-intelligence`. URL: `<service_url>/mcp`. Leave the advanced OAuth fields empty.
2. Connect. A browser tab opens on `/oauth/consent`: sign in with Google, then **Approve**. The tab returns to Claude.
3. In a chat: "call the andy-intelligence status tool". Expect `signedInAs: <your email>` and your projects. (M1.1 used a `ping` tool; M1.4: MCP core tools replaced it.)

## 4. Negative check (allow-list)

Repeat section 3 signed in to a Google account **not** on the allow-list (or sign out on the consent page first): Approve shows "is not allowed to use this control plane" and no code is issued. Cloud Logging shows no `oauth approve: code issued` line for it.

## 4b. Core tools (M1.4: MCP core tools Done when)

After the M1.4 deploy, in a Claude desktop chat (reconnect the connector if Claude still lists `ping`). Each step should match what the UI shows for the same ticket.

1. "Create a story in project AI titled 'MCP smoke test' with body 'check MCP tools'." Expect a new key (e.g. `AI-7`), stage `backlog`, and DoR gaps (acceptance criteria, size, tier).
2. In the UI, open that ticket → **Ask a question…** → "Kanban or list?".
3. "What needs me?" (`list_needs_me`). Expect the question with the ticket key and the ticket flagged.
4. "Answer it: Kanban." (`answer_question`). Expect `answeredVia: mcp`; the UI's inbox no longer shows it and the ticket's history shows the answer.
5. "Status of AI-7." Expect stage, DoR gaps (no open question any more), and recent history. "Status" with no ticket shows ticket counts per stage.
6. Error path: "Status of AI-9999." Expect `ticket not found`.
7. Move or delete the smoke-test ticket in the UI (e.g. force-move to `done` with reason "smoke test").

## 5. Revoke

- One person: remove the email from `allowed_emails` and apply; every token stops working on the next request.
- All tokens: delete the `oauthGrants` collection in the Firestore console. Claude asks to reconnect.

## Troubleshooting

| Symptom                                            | Look at                                                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude says the server has no auth / can't connect | Step 2; `PUBLIC_URL` must equal the URL entered in Claude (same host, no trailing slash).                                                    |
| `/oauth/authorize` shows `invalid_client`          | Cloud Logging `component="mcp-oauth"`: Claude's `client_id` host isn't `claude.ai`/`claude.com`, or it used DCR. Record it in the build log. |
| Popup blocked on the consent page                  | Allow popups for the `run.app` host; sign-in uses the same Firebase popup as the UI.                                                         |
