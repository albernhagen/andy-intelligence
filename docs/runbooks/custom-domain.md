# Runbook: serve the control plane at `ai.andybernhagen.com`

How Andy moves the control plane from `https://control-plane-662512537397.us-central1.run.app` to `https://ai.andybernhagen.com` (ADR-0044: Custom domain before M6). Done once. Terms:

- **Domain mapping**: Cloud Run's built-in custom domain (Preview, $0). Google issues and renews the certificate.
- **`infra/dns`**: Terraform root for the Cloudflare records. Local plans and applies only; CI runs fmt/validate.
- **`PUBLIC_URL`**: the env var the API uses as OAuth issuer, MCP resource, GitHub App URLs and Actions OIDC audience.

After the switch, the `run.app` URLs answer only `GET /health` (for monitoring); everything else there is `404`, and they aren't sign-in domains. Until step 5, `PUBLIC_URL` is the run.app URL, so nothing changes before then (no lockout mid-switch).

Merge the PR, then do steps 1–7 on the same day: the merged `system-security-review.yml` already uses the new URL as its OIDC audience, so its `publish` job fails until step 5.

## 1. Before you start

1. **CAA:** `dig +short CAA andybernhagen.com`. Empty is fine. If it lists CAs, add `0 issue "pki.goog"` and `0 issue "letsencrypt.org"` in Cloudflare, or Google can't issue the certificate.
2. **Cloudflare account:** 2FA on; registrar lock on (Cloudflare → andybernhagen.com → Configuration). Whoever controls this zone can take over sign-in and CI tokens (threat model R20).
3. **Cloudflare API token:** My Profile → API Tokens → Create Token → template **Edit zone DNS** → Zone Resources: Include → Specific zone → `andybernhagen.com` → set an expiry → Create. Store it in the macOS keychain, never in a file:

   ```sh
   security add-generic-password -a "$USER" -s cloudflare-dns-andy-intelligence -w   # paste the token at the prompt
   ```

4. **Zone ID:** Cloudflare → andybernhagen.com → Overview → API → Zone ID.
5. **Search Console:** [search.google.com/search-console](https://search.google.com/search-console) → Add property → **Domain** → `andybernhagen.com` → copy the TXT value. Use the Google account that runs Terraform (`gcloud auth application-default login`): only verified owners can create the mapping. Leave the page open.

## 2. Apply `infra/dns`

```sh
cd infra/dns
cp terraform.tfvars.example terraform.tfvars   # zone_id, and the TXT token without "google-site-verification="
export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s cloudflare-dns-andy-intelligence -w)
terraform init
terraform plan -out=dns.tfplan    # expect: 2 to add, 0 to change, 0 to destroy
terraform apply dns.tfplan
unset CLOUDFLARE_API_TOKEN
```

- `cloudflare_dns_record.control_plane`: `ai.andybernhagen.com CNAME ghs.googlehosted.com`, DNS-only (grey cloud). Never turn on the proxy: Google can't issue the certificate behind it.
- `cloudflare_dns_record.google_site_verification`: TXT on `andybernhagen.com`.

Then click **Verify** in Search Console (TXT can take a few minutes to show up: `dig +short TXT andybernhagen.com`).

## 3. Create the domain mapping

```sh
cd infra/control-plane
terraform plan -target=google_cloud_run_domain_mapping.public -out=map.tfplan   # expect: 1 to add, 0 to change, 0 to destroy
terraform apply map.tfplan
```

Targeted on purpose: the rest of the plan switches `PUBLIC_URL` and sign-in, which must wait for the certificate. `terraform output domain_mapping_records` should show `CNAME ghs.googlehosted.com` for `ai`.

## 4. Wait for the certificate

Usually about 15 minutes; up to 24 hours.

```sh
gcloud beta run domain-mappings describe --domain ai.andybernhagen.com --region us-central1 --project andy-intelligence-512400 --format='value(status.conditions)'
curl -s https://ai.andybernhagen.com/health    # {"status":"ok",…}
```

Ready when every condition is `True` and `/health` returns 200 without certificate errors.

## 5. Switch `PUBLIC_URL` and sign-in

```sh
terraform plan -out=cp.tfplan    # expect: 0 to add, 2 to change, 0 to destroy
terraform apply cp.tfplan
```

- `google_identity_platform_config.this`: authorized domains swap the `run.app` host for `ai.andybernhagen.com`.
- `google_cloud_run_v2_service.control_plane`: `PUBLIC_URL=https://ai.andybernhagen.com` → new revision. From here the `run.app` URLs answer only `/health`.

Afterwards the CI `plan` job shows "No changes". Existing MCP tokens stop working: they were issued for the old resource URL.

## 6. Point the GitHub App at the new URL

Skip this if you connect GitHub (runbook `github-app.md` §2) only after step 5: the manifest already uses the new URL.

GitHub → Settings → Developer settings → GitHub Apps → the App → General:

| Field        | New value                                      |
| ------------ | ---------------------------------------------- |
| Homepage URL | `https://ai.andybernhagen.com`                 |
| Setup URL    | `https://ai.andybernhagen.com/settings/github` |
| Webhook URL  | `https://ai.andybernhagen.com/webhooks/github` |

Save. The webhook secret doesn't change.

## 7. Re-add the Claude connector

Claude desktop → Settings → Connectors → remove `andy-intelligence` → Add custom connector → URL `https://ai.andybernhagen.com/mcp` → Connect → sign in → **Approve** (runbook `mcp-connector.md` §3).

## 8. Done when

- [ ] `curl -sI https://ai.andybernhagen.com/health` → `200`; the certificate is valid (`curl` prints no TLS error).
- [ ] Google sign-in works at `https://ai.andybernhagen.com`.
- [ ] The old URL is refused: `curl -s -o /dev/null -w '%{http_code}\n' https://control-plane-662512537397.us-central1.run.app/api/me` → `404`; `…/health` → `200`.
- [ ] Next deploy's smoke test passes (it checks both).
- [ ] In a Claude chat: "call the andy-intelligence status tool" → `signedInAs: <your email>`.
- [ ] The App → Advanced → Recent deliveries → redeliver one → `200` (`{"result":"duplicate"}` for an old one); the delivery's URL is the new domain.
- [ ] `gh workflow run system-security-review.yml --repo albernhagen/andy-intelligence`: if it reaches `publish`, the token step succeeds (logs: `jsonPayload.component="github-token"`).

## Roll back

Changing `custom_domain` alone won't do it. To return to `run.app`: revert this slice's PR, apply `infra/control-plane` (domain mapping destroyed; `PUBLIC_URL` and authorized domains back), redo steps 6–7 with the `run.app` URL, then `terraform destroy` in `infra/dns`.

## Troubleshooting

| Symptom                                                     | Fix                                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Step 3: `Caller is not authorized to administer the domain` | The Terraform account isn't a verified Search Console owner: step 1.5 and the Verify click in step 2, same Google account. |
| Certificate pending after 24 hours                          | CNAME proxied (orange cloud) or wrong; a CAA record blocking `pki.goog`/`letsencrypt.org` (step 1.1).                      |
| Sign-in popup: `auth/unauthorized-domain`                   | Step 5 not applied.                                                                                                        |
| `404 {"error":"not found"}`                                 | You're on a `run.app` URL; use `https://ai.andybernhagen.com`.                                                             |
| Claude: can't connect / no auth                             | Connector still on the old URL (step 7), or `PUBLIC_URL` not switched (step 5).                                            |
| `publish` job: `401` from `/github/token`                   | Step 5 not applied: the workflow's audience is already the new URL.                                                        |
