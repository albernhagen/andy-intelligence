# Ranked Ready list

A project's Ready tickets in board order (the order is the priority), each with its score label ("S · low risk · confident") and the refine agent's reasons for size, risk and confidence. Filter by size, risk or confidence; a ticket without that score isn't listed. MCP `list_ready` and REST return it (AI-298); in the web, the board's Ready lane filters by the same rule (AI-343).

**How to use:** On a project's board, Filter in the Ready lane (`/p/<project>?size=S&risk=low`; the old `/ready` URL opens it); MCP `list_ready`; REST `GET /api/projects/<id>/ready`.
