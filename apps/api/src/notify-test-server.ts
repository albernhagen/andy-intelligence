import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** A fake Resend server for tests: records each request, answers like the real API. */
export interface FakeEmailServer {
  baseUrl: string;
  requests: { path: string; authorization: string | undefined; body: Record<string, unknown> }[];
  /** The status the next sends get; 200 by default. */
  status: number;
  close(): Promise<void>;
}

export async function startFakeEmailServer(): Promise<FakeEmailServer> {
  const fake: Omit<FakeEmailServer, "baseUrl" | "close"> = { requests: [], status: 200 };
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      fake.requests.push({
        path: req.url ?? "",
        authorization: req.headers.authorization,
        body: JSON.parse(raw || "{}") as Record<string, unknown>,
      });
      res.writeHead(fake.status, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          fake.status === 200
            ? { id: `email-${fake.requests.length}` }
            : { name: "validation_error", message: "refused", statusCode: fake.status },
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(fake, {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}
