#!/usr/bin/env node
// A scripted stand-in for the Messages API (AI-63), so the CI self-test drives the real Claude
// Code and its real sandbox with no model and no credential. A request that offers the Bash tool
// gets one Bash call running the command in STUB_COMMAND_FILE; once that call has a result, or
// when Bash isn't offered, it gets a short text. Listens on loopback only; serves at most
// MAX_REQUESTS (ADR-0028).
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const MAX_REQUESTS = 50;

/** The content block answering a Messages request: a Bash tool_use or a text block. */
export function chooseBlock(request, command) {
  const answered = request.messages?.some(
    (m) => Array.isArray(m?.content) && m.content.some((b) => b?.type === "tool_result"),
  );
  const offered = request.tools?.some((t) => t?.name === "Bash");
  if (offered && !answered) {
    return {
      type: "tool_use",
      id: "toolu_sandbox_lab",
      name: "Bash",
      input: { command, description: "Sandbox self-test" },
    };
  }
  return { type: "text", text: "0" };
}

/** The server-sent events of a streamed Messages response holding `block`. */
export function streamEvents(block, model) {
  const message = {
    id: "msg_sandbox_lab",
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const isTool = block.type === "tool_use";
  const start = isTool ? { ...block, input: {} } : { type: "text", text: "" };
  const delta = isTool
    ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
    : { type: "text_delta", text: block.text };
  return [
    { type: "message_start", message },
    { type: "content_block_start", index: 0, content_block: start },
    { type: "content_block_delta", index: 0, delta },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: isTool ? "tool_use" : "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
}

function serve(commandFile, port) {
  let served = 0;
  createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      served += 1;
      if (served > MAX_REQUESTS || req.method !== "POST" || !path.startsWith("/v1/messages")) {
        process.stderr.write(`stub-model: refused ${req.method} ${path} (request ${served})\n`);
        res.writeHead(served > MAX_REQUESTS ? 429 : 404).end();
        return;
      }
      res.setHeader("content-type", "application/json");
      if (path.endsWith("/count_tokens")) {
        res.end(JSON.stringify({ input_tokens: 1 }));
        return;
      }
      const request = JSON.parse(raw);
      const block = chooseBlock(request, readFileSync(commandFile, "utf8"));
      process.stderr.write(`stub-model: ${block.type} for model ${request.model}\n`);
      if (!request.stream) {
        const [{ message }] = streamEvents(block, request.model);
        const stop = block.type === "tool_use" ? "tool_use" : "end_turn";
        res.end(JSON.stringify({ ...message, content: [block], stop_reason: stop }));
        return;
      }
      res.setHeader("content-type", "text/event-stream");
      for (const e of streamEvents(block, request.model)) {
        res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      }
      res.end();
    });
  }).listen(port, "127.0.0.1");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  serve(process.env.STUB_COMMAND_FILE, Number(process.env.STUB_PORT));
}
