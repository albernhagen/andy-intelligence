# Environment policy

Each project says where its releases go (ADR-0050): `prod-only` (default; one prod environment plus PR previews) or `dev-and-prod` (dev first, then a promote to prod). Owner only, logged in the config change log. Nothing deploys from it yet; later M6 tickets read it (AI-160).

**How to use:** Project settings → Environments; MCP `set_environments`, read by `get_project_settings`
