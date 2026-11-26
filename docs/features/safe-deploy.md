# Safe deploy

A merge deploys a no-traffic revision, smoke-tests it with the caller's checks (inputs `smoke-checks`, `smoke-checks-other-hosts`: `<path> <status>` lines; the control plane passes `/health` and `/api/me` from `deploy.yml`), with `keep-tag-prefix` tags the image `<prefix><digest hex>` before traffic moves so registry cleanup keeps what prod runs (AI-389: M6.23), moves traffic, checks the public URL; the job summary names revisions and the rollback command. Managed `cloud-run` projects get it through the [deploy caller](deploy-caller.md)

**How to use:** Failed deploy: read the job summary; roll back per `docs/runbooks/deploy-and-rollback.md`
