import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";

import { closeKeepAliveAgents, keepAliveAgentCount, keepAliveFetch } from "./mcp-keepalive-fetch.ts";

afterEach(async () => {
  await closeKeepAliveAgents();
});

describe("keepAliveFetch", () => {
  it("reuses one TCP connection across POSTs to the same origin", async () => {
    const ports: number[] = [];
    const server = http.createServer((req, res) => {
      ports.push(req.socket.remotePort ?? 0);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      for (let i = 0; i < 8; i++) {
        const response = await keepAliveFetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "ping" }),
        });
        expect(response.status).toBe(200);
        await response.arrayBuffer();
      }
      // One socket for sequential RPCs; undici may open a spare warm
      // connection, so the pool stays tiny versus a fresh TCP each POST.
      expect(new Set(ports).size).toBeLessThanOrEqual(2);
      expect(ports.length).toBe(8);
      expect(keepAliveAgentCount()).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("pools a separate Agent per origin", async () => {
    const servers: http.Server[] = [];
    const start = async () => {
      const server = http.createServer((_req, res) => {
        res.end("ok");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      servers.push(server);
      return (server.address() as { port: number }).port;
    };
    try {
      const a = await start();
      const b = await start();
      await (await keepAliveFetch(`http://127.0.0.1:${a}/`)).arrayBuffer();
      await (await keepAliveFetch(`http://127.0.0.1:${b}/`)).arrayBuffer();
      expect(keepAliveAgentCount()).toBe(2);
    } finally {
      await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))));
    }
  });

  it("closeKeepAliveAgents drops the pool", async () => {
    const server = http.createServer((_req, res) => { res.end("ok"); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      await (await keepAliveFetch(`http://127.0.0.1:${port}/`)).arrayBuffer();
      expect(keepAliveAgentCount()).toBe(1);
      await closeKeepAliveAgents();
      expect(keepAliveAgentCount()).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
