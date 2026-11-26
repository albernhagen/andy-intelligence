# Release workflow

`release.yml` promotes an image digest to prod or rolls an environment back to an earlier revision. It checks the inputs and that the digest or revision exists before traffic moves, runs one release at a time per environment, and records each run as a promote or rollback Deployment.

**How to use:** Actions → _Release control plane_ → Run workflow on `main`; for the control plane only `rollback` to `prod` applies. A managed `cloud-run` project gets its own copy from the baseline ([deploy caller](deploy-caller.md)). Steps and checks: [`deploy-and-rollback.md`](../runbooks/deploy-and-rollback.md) §3
