import { createServer, type Server } from "node:http";
import { greet } from "./index.js";

/** The starter HTTP app: `/health` for deploy smoke checks and uptime checks, `/` says hello. */
export function createApp(): Server {
  return createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/health") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    } else if (path === "/") {
      res.writeHead(200, { "content-type": "text/plain" }).end(greet("world"));
    } else {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });
}
