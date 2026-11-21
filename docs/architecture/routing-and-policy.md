# andy-intelligence — Routing and policy

Moved unchanged from [domain-and-ports.md](domain-and-ports.md) (AI-221): the routing entities, configuration rules and default quota policy.

| Entity | Key fields |
|---|---|
| **Provider** | key (claude-sub, google-sub, openrouter), billing_type (subscription / pay_per_use), credential secret ref, quota_source, reserve_pct, warn_pct, pause_pct, caps (daily/monthly USD), enabled |
| **Harness** | key (claude-code, jules, opencode, direct), runtime (actions / api / in-process), compatible providers, capabilities (agentic, skills, subagents) |
| **Model** | id, provider, price in/out, context, metadata, last_scouted |
| **Tier** | key (frontier, strong, fast, cheap), ordered **routes** of (harness, provider, model) |
| **Policy** | scope (global / project / epic / ticket), gates, autonomy, auto-merge rules, write policy, step→tier mapping |

### Configuration rules
- **Global config is the ceiling; project config can only narrow** (disable providers, lower caps, raise reserves, pin tiers).
- **Compatibility enforced on save:** `claude-code` ↔ `claude-sub` + Claude models; `jules` ↔ `google-sub`; `opencode` / `direct` ↔ `openrouter` + any model. Rule: `routeProblem` in `packages/domain/src/routing-rules.ts` (AI-231).
- **Override precedence:** ticket → epic (not `executor`) → project → global.
- Every change is a ConfigChange (audited, revertable). Agent/scout proposals are `pending` until Andy approves.

### Default global quota policy
```
claude-sub:  reserve 20% (5h and weekly windows) → warn at 70%, pause dispatch at 80%
google-sub:  reserve 20% of daily Jules tasks     → warn at 70%, pause at 80%
openrouter:  hard daily/monthly USD caps (also enforced on the OpenRouter key itself)
```
Missing or stale quota reading ⇒ treat as **unknown**: warn in UI, prefer next route, never assume headroom.
Dispatch walks a tier's routes in order (`chooseRoute`, AI-261: M10.14): it skips a subscription at its pause level and a paid route the spend gate would refuse, and keeps each skip and why on the run (`routeSkips`). An unknown reading runs only if no other route has room and no route before it hit its reserve. Nothing left: dispatch idles with `quota_reserve` or `spend_cap`. A start by hand takes the first usable route.
