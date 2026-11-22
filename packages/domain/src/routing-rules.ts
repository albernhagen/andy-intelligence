import type { HarnessKey, ProviderKey, Route } from "@andy/contracts";

/**
 * Route compatibility (AI-231: M9.4; routing-and-policy.md "Compatibility enforced on save"):
 * which provider each harness runs on, and which models it takes. Pure; M9.6 (resolver) and
 * M9.7 (settings API and MCP) call `routeProblem` at resolve time and on save.
 */

/**
 * The providers each harness may run on: Claude Code on the subscription or, pay-per-use, an API
 * key (`claude-api`, AI-260).
 */
export const HARNESS_PROVIDERS: Readonly<Record<HarnessKey, readonly ProviderKey[]>> = {
  "claude-code": ["claude-sub", "claude-api"],
  jules: ["google-sub"],
  opencode: ["openrouter"],
  direct: ["openrouter"],
};

export const ROUTE_MODEL_MAX = 100;

/** Claude Code's model aliases; a trailing `[…]` option such as `[1m]` is allowed. */
const CLAUDE_ALIASES = new Set(["opus", "sonnet", "haiku", "fable", "opusplan"]);

/** A Claude model: a full id (`claude-…`) or one of Claude Code's aliases (`opus`, `sonnet`). */
export function isClaudeModel(model: string): boolean {
  const id = model.trim().toLowerCase();
  if (id.startsWith("claude-")) return true;
  // String ops, not a regex: the id is untrusted input (no backtracking on `[[[…`).
  const open = id.endsWith("]") ? id.lastIndexOf("[") : -1;
  return CLAUDE_ALIASES.has(open === -1 ? id : id.slice(0, open));
}

/** Why `route` can't run, or null when it can. The reason names what is wrong. */
export function routeProblem(route: Route): string | null {
  const { harness, provider, model } = route;
  const expected = HARNESS_PROVIDERS[harness];
  if (!expected.includes(provider)) {
    return `harness ${harness} doesn't run on provider ${provider} (it needs ${expected.join(" or ")})`;
  }
  const id = model.trim();
  if (id === "") return "the model id is empty";
  if (id.length > ROUTE_MODEL_MAX) {
    return `the model id is ${id.length} characters (at most ${ROUTE_MODEL_MAX})`;
  }
  if (harness === "claude-code" && !isClaudeModel(id)) {
    return `harness claude-code takes only Claude models, not ${id}`;
  }
  return null;
}
