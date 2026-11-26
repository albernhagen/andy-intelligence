# Plan-named packages

A build can add npm packages: the plan names them (name, runtime or dev, workspace, why), Andy approves them with the plan, and a trusted executor job outside the sandbox adds the newest version at least 7 days old with install scripts off; the manifest and lockfile change ships in the PR. A build that needs a package its plan didn't name stops, the ticket names it, and the next start writes a new plan (AI-386, ADR-0156)

**How to use:** Approve or reject the plan's "Packages to install before the build" in the ticket's Activity (or MCP `approve_plan` / `reject_plan`); the run page lists them. Not on the local runner yet
