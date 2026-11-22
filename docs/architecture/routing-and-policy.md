# andy-intelligence — Routing and policy

Moved unchanged from [domain-and-ports.md](domain-and-ports.md) (AI-221): the routing entities, configuration rules and default quota policy.

| Entity | Key fields |
|---|---|
| **Provider** | key (claude-sub, google-sub, openrouter, claude-api), billing_type (subscription / pay_per_use), credential secret ref, quota_source, reserve_pct, warn_pct, pause_pct, caps (daily/monthly USD), enabled |
| **Harness** | key (claude-code, jules, opencode, direct), runtime (actions / api / in-process), compatible providers, capabilities (agentic, skills, subagents) |
| **Model** | id, provider, price in/out, context, metadata, last_scouted |
| **Tier** | key (frontier, strong, fast, cheap), ordered **routes** of (harness, provider, model) |
| **Policy** | scope (global / project / epic / ticket), gates, autonomy, auto-merge rules, write policy, step→tier mapping |

### Configuration rules
- **Global config is the ceiling; project config can only narrow** (disable providers, lower caps, raise reserves, pin tiers).
- **Compatibility enforced on save:** `claude-code` ↔ `claude-sub` or `claude-api` (AI-260) + Claude models; `jules` ↔ `google-sub`; `opencode` / `direct` ↔ `openrouter` + any model. Rule: `routeProblem` in `packages/domain/src/routing-rules.ts` (AI-231).
- **Override precedence:** ticket → epic (not `executor`) → project → global; the names are under Layers below.
- Every change is a ConfigChange (audited, revertable). Agent/scout proposals are `pending` until Andy approves.

### Layers (terminology)
Who sets a ticket's worker, tier and route; first match wins (`packages/domain/src/overrides.ts`). The ticket panel, Settings → Models, project settings and MCP `status` use these names (AI-282: M9).

| Layer | What it is |
|---|---|
| Ticket override | Set on the ticket itself. |
| Epic override | Set on its epic; the tickets under it inherit. A milestone is an epic titled `M<N>: …`. |
| Project default | The project's default worker and its routing config, which can only narrow global. |
| Global | Andy's routing config: the ceiling. A tier from size (S → fast, M/L → strong) counts here. |

### Default global quota policy
```
claude-sub:  reserve 20% (5h and weekly windows) → warn at 70%, pause dispatch at 80%
google-sub:  reserve 20% of daily Jules tasks     → warn at 70%, pause at 80%
openrouter:  hard daily/monthly USD caps (also enforced on the OpenRouter key itself)
claude-api:  off by default; the same USD caps, a per-task budget, and the Console workspace limit (AI-260)
```
Missing or stale quota reading ⇒ treat as **unknown**: warn in UI, prefer next route, never assume headroom.
Dispatch walks a tier's routes in order (`chooseRoute`, AI-261: M10.14): it skips a subscription at its pause level and a paid route the spend gate would refuse, and keeps each skip and why on the run (`routeSkips`). An unknown reading runs only if no other route has room and no route before it hit its reserve. Nothing left: dispatch idles with `quota_reserve` or `spend_cap`. A start by hand takes the first usable route.

Paid spend (ledger, caps, fail-closed rules): [`spend-and-caps.md`](spend-and-caps.md) (ADR-0129).
