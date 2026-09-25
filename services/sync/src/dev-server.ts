import { createServer } from "node:http";
import { nodeRelayDb } from "./node-db.ts";
import { Relay } from "./relay.ts";

/**
 * The relay on Node, for trying sync from the browser preview without Bun:
 *
 *   node services/sync/src/dev-server.ts        (or pnpm --filter @duet/sync dev)
 *
 * DUET_DB keeps its data in a file (default: in memory); DUET_PORT changes the port.
 */

const port = Number(process.env.DUET_PORT ?? 8787);
const relay = new Relay({ db: nodeRelayDb(process.env.DUET_DB ?? ":memory:"), version: "dev" });

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && chunks.length > 0;
  const response = await relay.handle(
    new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
      method: req.method,
      headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
      signal: abort.signal,
    }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  res.on("close", () => void reader.cancel().catch(() => undefined));
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch {
    // the app went away
  }
  res.end();
}).listen(port, "127.0.0.1", () => {
  console.log(`Duet relay (dev) on http://127.0.0.1:${port}`);
});
