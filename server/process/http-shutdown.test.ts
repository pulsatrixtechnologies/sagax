import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  drainHttpServers,
  isShuttingDown,
  markShuttingDown,
  resetShuttingDownForTests,
} from "./http-shutdown.ts";

const listen = (server: Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("expected a TCP address"));
        return;
      }
      resolve(address.port);
    });
  });

describe("http shutdown", () => {
  beforeEach(() => resetShuttingDownForTests());
  afterEach(() => resetShuttingDownForTests());

  it("marks readiness unready once", () => {
    expect(isShuttingDown()).toBe(false);
    markShuttingDown();
    expect(isShuttingDown()).toBe(true);
    markShuttingDown();
    expect(isShuttingDown()).toBe(true);
  });

  it("stops accepting and finishes in-flight HTTP within the bound", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inFlightSeen = false;
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/hold") {
        inFlightSeen = true;
        void held.then(() => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ok");
        });
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ready");
    });
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;

    const inFlight = fetch(`${base}/hold`);
    await expect.poll(() => inFlightSeen, { timeout: 2_000 }).toBe(true);

    const draining = drainHttpServers([server], {
      timeoutMs: 2_000,
      closeStreams: () => {
        /* exercised below */
      },
    });
    expect(isShuttingDown()).toBe(true);

    // New connections are refused once close() has run.
    await expect.poll(async () => {
      try {
        await fetch(`${base}/`, { signal: AbortSignal.timeout(200) });
        return false;
      } catch {
        return true;
      }
    }, { timeout: 2_000 }).toBe(true);

    release();
    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    await draining;
  });

  it("force-closes lingering connections when the budget elapses", async () => {
    const server = createServer((_req, res) => {
      // Never ends: the drain budget must cut it loose.
      res.writeHead(200, { "content-type": "text/plain" });
    });
    const port = await listen(server);
    const pending = fetch(`http://127.0.0.1:${port}/`);
    await expect.poll(() => (server as Server & { _connections?: number }).listening === true, { timeout: 1_000 }).toBe(true);

    const started = Date.now();
    await drainHttpServers([server], { timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(1_500);
    await expect(pending).rejects.toThrow();
  });

  it("runs closeStreams before waiting on sockets", async () => {
    const order: string[] = [];
    const server = createServer((_req, res) => {
      res.end("ok");
    });
    await listen(server);
    await drainHttpServers([server], {
      timeoutMs: 500,
      closeStreams: () => {
        order.push("streams");
      },
    });
    order.push("drained");
    expect(order[0]).toBe("streams");
    expect(order.at(-1)).toBe("drained");
  });

  it("ignores null servers and zero timeout", async () => {
    await expect(drainHttpServers([null, undefined], { timeoutMs: 0 })).resolves.toBeUndefined();
    expect(isShuttingDown()).toBe(true);
  });
});
