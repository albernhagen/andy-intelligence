# Dependabot updates

Grouped PRs: npm weekly (one PR for development and one for production minors and patches); Actions, Terraform (one PR per provider across every root) and Docker base images (pinned tag@digest) monthly, majors of base images by hand; a `cloud-run` project gets the same Docker entry for its seeded root `Dockerfile`, and this repo's watches `template/docker/` so new projects start on a fresh digest (AI-401); security updates do not wait (AI-399); npm patches (and minors of 1.0+ packages) auto-merge once checks pass; the rest wait for Andy. The review agents never run when Dependabot starts the run (no secrets); a minor or patch bump of manifests and lockfiles only also skips them when a person or bot starts the run (checks pass with the reason); Playwright gets its own PR, and the screenshot job fails, naming the fix, until its browser image matches (AI-394)

**How to use:** Review the rest
