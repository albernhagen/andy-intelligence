import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_BODY_BYTES } from "./mcp/endpoint";
import { meterReads, readMeterMiddleware } from "./read-meter";

const store = meterReads({ getThing: async () => ({ id: "x" }) });

function app() {
  const a = new Hono();
  a.use("*", readMeterMiddleware());
  a.post("/mcp", async (c) => {
    await store.getThing();
    return c.json({ ok: true });
  });
  return a;
}

function loggedTool(lines: string[]): unknown {
  const line = lines.map((l) => JSON.parse(l) as { tool?: string }).at(-1);
  return line?.tool ?? null;
}

const call = JSON.stringify({ method: "tools/call", params: { name: "status" } });

describe("readMeterMiddleware tool name (AI-315)", () => {
  afterEach(() => vi.restoreAllMocks());

  const cases: [string, Record<string, string>, string, unknown][] = [
    ["a bearer post within the cap", { authorization: "Bearer t" }, call, "status"],
    ["a post with no token", {}, call, null],
    [
      "a post declaring more than the MCP cap",
      { authorization: "Bearer t", "content-length": String(MCP_BODY_BYTES + 1) },
      call,
      null,
    ],
  ];

  for (const [name, headers, body, tool] of cases) {
    it(`GivenMcp_When${name.replace(/\W+/g, "")}_ThenTheLoggedToolIs${String(tool)}`, async () => {
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((l: unknown) => void lines.push(String(l)));
      await app().request("/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(body.length),
          ...headers,
        },
        body,
      });
      expect(loggedTool(lines)).toBe(tool);
    });
  }
});
