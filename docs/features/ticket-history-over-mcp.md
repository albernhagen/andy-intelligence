# Ticket history and agent tasks over MCP

Claude over MCP reads what the ticket page and the agent task page show: a ticket's whole history (every move, edit, comment, question and PR link), its agent tasks, and one task in full. The two lists come in pages of at most 200 that add up to exactly what the web shows (AI-293: Parity: a ticket's full history and runs over MCP).

**How to use:** MCP `ticket_history` and `list_runs` with a ticket key (pass `nextOffset` back as `offset` for the next page), then `get_run` with the project key and a task id.
