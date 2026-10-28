---
status: accepted
date: 2026-10-21
---

# 0010 — Authentication: Identity Platform Google sign-in + email allow-list

## Decision Outcome

- **UI → API:** Firebase Auth (Identity Platform) with the Google provider. The SPA sends the Firebase ID token as `Authorization: Bearer`. The API verifies it with `firebase-admin` (`checkRevoked: true`), requires `email_verified`, and checks the email against `ALLOWED_EMAILS` (case-insensitive). 401 for missing/invalid tokens, 403 for valid-but-not-allowed.
- **Public routes:** `/health`, `/config.json` (public Firebase web config — API key and auth domain are not secrets), `/openapi.json`, and SPA assets. Everything under `/api/*` requires auth.
- **Cloud Run invoker IAM is disabled** (`invoker_iam_disabled = true`). Browsers and Claude's MCP connector must reach the service directly; app-level auth is the gate. Defence in depth (e.g., Cloud Armor) is deferred.
- **Google provider setup is manual** (one console step): it needs an OAuth client, and Google's OAuth client admin APIs were shut down (provider v8 upgrade guide removed `google_iap_client` for this reason). Everything else (Firebase project, web app, Identity Platform config, authorized domains) is Terraform.
- **MCP OAuth** is not decided here; see the M0 spike (open).

### Consequences

- Good: no custom auth code beyond one middleware; allow-list is config.
- Bad: the service URL is publicly reachable; correctness of the middleware is security-critical (covered by API tests).
