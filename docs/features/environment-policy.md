# Environment policy

Each project says where its releases go (ADR-0050): `prod-only` (default; one prod environment plus PR previews) or `dev-and-prod` (dev first, then a promote to prod). Used only while the project's [deploy kind](deploy-kind.md) is `cloud-run`; with `none` the Settings page marks it "Not in use". Owner only, logged in the config change log. A `cloud-run` project's baseline PR seeds the Terraform root for it ([deploy scaffold](deploy-scaffold.md), AI-109); AI-160.

**How to use:** Project settings → Environments; MCP `set_environments`, read by `get_project_settings`
