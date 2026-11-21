# Ranked Ready list

A project's Ready tickets in board order (the order is the priority), each with its score label ("S · low risk · confident") and the refine agent's reasons for size, risk and confidence. Filter by size, risk or confidence; a ticket without that score isn't listed. The web view and MCP `list_ready` read the same list, so they show the same tickets in the same order (AI-298: Parity: ranked Ready list in the web UI).

**How to use:** On a project's board, "Ranked list" in the Ready lane, or `/p/<project>/ready?size=S&risk=low`; MCP `list_ready`; REST `GET /api/projects/<id>/ready`.
