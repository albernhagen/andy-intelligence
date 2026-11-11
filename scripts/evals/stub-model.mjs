#!/usr/bin/env node
// A scripted Messages API for the eval plumbing (AI-6), like scripts/sandbox-lab/stub-model.mjs:
// the first request of a case gets a StructuredOutput call holding the case's `stubOutput`
// (the case id comes from the `x-eval-case` header the provider sets); later ones get a short
// text. Input tokens are the request size / 4, so a bigger prompt reads as more tokens.
// Prints `port=<n>` once listening (STUB_PORT, or any free port). Loopback only; serves at most MAX_REQUESTS (ADR-0028).
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { streamEvents } from "../sandbox-lab/stub-model.mjs";

const MAX_REQUESTS = 200;
const CASE_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** The block answering a request: the case's structured output once, then text. */
export function chooseBlock(request, stubOutput) {
  const answered = request.messages?.some(
    (m) => Array.isArray(m?.content) && m.content.some((b) => b?.type === "tool_result"),
  );
  const tool = request.tools?.find((t) => t?.name === "StructuredOutput");
  if (tool && !answered && stubOutput) {
    return { type: "tool_use", id: "toolu_eval_stub", name: tool.name, input: stubOutput };
  }
  return { type: "text", text: "done" };
}

/** Rough input tokens: the request's size / 4. */
export function stubTokens(raw) {
  return Math.max(1, Math.round(Buffer.byteLength(raw, "utf8") / 4));
}

function serve(answersDir, port) {
  let served = 0;
  createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      served += 1;
      if (served > MAX_REQUESTS || req.method !== "POST" || !path.startsWith("/v1/messages")) {
        res.writeHead(served > MAX_REQUESTS ? 429 : 404).end();
        return;
      }
      res.setHeader("content-type", "application/json");
      if (path.endsWith("/count_tokens")) {
        res.end(JSON.stringify({ input_tokens: stubTokens(raw) }));
        return;
      }
      const caseId = String(req.headers["x-eval-case"] ?? "");
      let stubOutput = null;
      if (CASE_ID.test(caseId)) {
        try {
          stubOutput = JSON.parse(readFileSync(join(answersDir, `${caseId}.json`), "utf8"));
        } catch {
          stubOutput = null;
        }
      }
      const request = JSON.parse(raw);
      const block = chooseBlock(request, stubOutput);
      const events = streamEvents(block, request.model);
      events[0].message.usage.input_tokens = stubTokens(raw);
      if (!request.stream) {
        const stop = block.type === "tool_use" ? "tool_use" : "end_turn";
        res.end(JSON.stringify({ ...events[0].message, content: [block], stop_reason: stop }));
        return;
      }
      res.setHeader("content-type", "text/event-stream");
      for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      res.end();
    });
  })
    .listen(port, "127.0.0.1")
    .on("listening", function () {
      process.stdout.write(`port=${this.address().port}\n`);
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  serve(process.env.STUB_ANSWERS_DIR, Number(process.env.STUB_PORT ?? 0));
}
