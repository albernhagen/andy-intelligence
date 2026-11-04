# 2026-11-03 — AI-native SDLC playbook gaps planned

- Compared the plan with Anthropic's [AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook). Most of it is already planned.
- **Decided (Andy, ADR-0040: Close the gaps against Anthropic's AI-native SDLC playbook):** new slices M1.17: Agent evals v1 and M1.18: Plan step; executor permission profile in M1.6: Claude Code executor; verification output, acceptance-criteria review pass and nit cap in M1.8: Build + gate; review-capacity cap and learning loop in M2: Multi-project in parallel; DORA metrics in M6: Dev → prod releases.
- **Decided (Andy):** `README.md` gets a one-screen "How it works today" section, updated with every feature change (AGENTS.md docs table).
- Wave 1 (in parallel): PR #31: M1.4: MCP core tools and PR #32: M1.5: GitHub App + project registration open; they update "How it works today" after this merges.
