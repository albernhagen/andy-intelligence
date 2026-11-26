# Deploy kind

Each project says how it ships (ADR-0114): `none` (default; the project does not deploy) or `cloud-run` (Cloud Run on GCP). Projects stored before the setting read as `none`, with no migration. The environments setting is used only while it is `cloud-run`; with `none` the Settings page marks Environments "Not in use". Owner only, logged in the config change log and revertable there. The baseline PR adds the deploy files and Terraform root for it ([deploy scaffold](deploy-scaffold.md), AI-109); AI-387. Not the same thing as a deployment record's kind (deploy, promote or rollback).

**How to use:** Project settings → Defaults → Deploy kind; MCP `set_deploy_kind`, read by `get_project_settings`
