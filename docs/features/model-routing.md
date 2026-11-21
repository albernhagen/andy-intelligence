# Model routing

Which providers are on, each tier's routes (harness, provider, model) in order, and which tier each step uses: global, and per project (narrowing only). A save is refused with the reason when a route can't run (for example Jules on claude-sub) or a project config is wider than global, and each save is logged as a settings change (AI-239: M9.7). Agent tasks run on it: each dispatch reads global and the project's config and takes the first usable route (AI-238: M9.6).

**How to use:** MCP `get_routing`, `set_tier_routes`, `set_provider_routing`, `set_step_tier`; REST `GET`/`PUT /api/routing`, `PUT /api/projects/<id>/routing`
