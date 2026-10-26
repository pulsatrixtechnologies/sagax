import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { harnessMcpHttpKind, harnessMcpHttpSpec, loopbackNoProxy, serveHarnessMcpHttp } from "./harness-mcp-http.ts";

const stdio = (kind: string, env: Record<string, string> = { SAGAX_MCP_TOKEN: "tok-1", SAGAX_HARNESS_URL: "http://127.0.0.1:4321" }) =>
  ({ command: "/usr/bin/node", args: ["/app/server/harness-mcp-proxy.ts", kind], env });

describe("harnessMcpHttpSpec", () => {
  it("turns the stdio proxy into an HTTP server with the bearer in a header", () => {
    expect(harnessMcpHttpSpec(stdio("data"), "data", {})).toEqual({
      type: "http", url: "http://127.0.0.1:4321/api/internal/data/mcp-http", headers: { Authorization: "Bearer tok-1" },
    });
    expect(harnessMcpHttpSpec({ ...stdio("browser"), args: ["/app/dist/harness-mcp-proxy.mjs", "browser"] }, "browser", {})?.url)
      .toBe("http://127.0.0.1:4321/api/internal/browser/mcp-http");
  });
  it("keeps the token out of the URL", () => {
    const spec = harnessMcpHttpSpec(stdio("computer"), "computer", {})!;
    expect(spec.url).not.toContain("tok-1");
  });
  it("leaves anything else on stdio", () => {
    expect(harnessMcpHttpSpec(stdio("data"), "browser", {})).toBeNull();
    expect(harnessMcpHttpSpec({ ...stdio("data"), args: ["/app/server/agents-proxy.ts", "data"] }, "data", {})).toBeNull();
    expect(harnessMcpHttpSpec(stdio("data", { SAGAX_HARNESS_URL: "http://127.0.0.1:4321" }), "data", {})).toBeNull();
    expect(harnessMcpHttpSpec(stdio("data", { SAGAX_MCP_TOKEN: "t", SAGAX_HARNESS_URL: "http://example.com:4321" }), "data", {})).toBeNull();
    expect(harnessMcpHttpSpec(stdio("data", { SAGAX_MCP_TOKEN: "t", SAGAX_HARNESS_URL: "http://127.0.0.1:4321/x" }), "data", {})).toBeNull();
    expect(harnessMcpHttpSpec(stdio("data"), "data", { SAGAX_HARNESS_MCP_HTTP: "0" })).toBeNull();
    expect(harnessMcpHttpSpec(undefined, "data", {})).toBeNull();
  });
});

describe("harnessMcpHttpKind", () => {
  it("names only the three harness routes", () => {
    expect(harnessMcpHttpKind("/api/internal/data/mcp-http")).toBe("data");
    expect(harnessMcpHttpKind("/api/internal/computer/mcp-http")).toBe("computer");
    expect(harnessMcpHttpKind("/api/internal/data/mcp")).toBeNull();
    expect(harnessMcpHttpKind("/api/internal/agents/mcp-http")).toBeNull();
  });
});

describe("loopbackNoProxy", () => {
  it("adds loopback only when a proxy is set", () => {
    expect(loopbackNoProxy({})).toEqual({});
    expect(loopbackNoProxy({ HTTPS_PROXY: "http://p:1", NO_PROXY: "a.example" }).NO_PROXY).toBe("a.example,127.0.0.1,localhost,::1");
    expect(loopbackNoProxy({ HTTP_PROXY: "http://p:1", NO_PROXY: "127.0.0.1,localhost,::1" })).toEqual({});
  });
});

describe("serveHarnessMcpHttp", () => {
  let server: Server;
  let base = "";
  const seen: Array<{ auth?: string; body: unknown }> = [];
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const kind = harnessMcpHttpKind(req.url ?? "");
      if (kind) return serveHarnessMcpHttp(req, res, kind, base);
      // the unchanged internal route the proxy posts to
      let body = "";
      for await (const chunk of req) body += chunk;
      seen.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== "Bearer good") { res.statusCode = 401; return res.end(JSON.stringify({ error: "unauthorized" })); }
      res.end(JSON.stringify({ result: { tools: [{ name: "data_query" }] } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  type Rpc = { result: { protocolVersion: string; serverInfo: { name: string }; instructions?: string; isError?: boolean }; error: { code: number } };
  const post = (frame: unknown, auth = "Bearer good", raw?: string) => fetch(`${base}/api/internal/data/mcp-http`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) },
    body: raw ?? JSON.stringify(frame),
  });

  it("answers initialize itself and echoes a version it speaks", async () => {
    const reply = await (await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json() as Rpc;
    expect(reply.result.protocolVersion).toBe("2025-06-18");
    expect(reply.result.serverInfo.name).toBe("openmausbot-data");
    expect(reply.result.instructions).toBeTruthy();
    const old = await (await post({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })).json() as Rpc;
    expect(old.result.protocolVersion).toBe("2024-11-05");
  });
  it("accepts a notification with 202 and no body", async () => {
    const response = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });
  it("forwards tools/list with the bearer to the internal route", async () => {
    const reply = await (await post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })).json();
    expect(reply).toEqual({ jsonrpc: "2.0", id: 3, result: { tools: [{ name: "data_query" }] } });
    expect(seen.at(-1)).toEqual({ auth: "Bearer good", body: { method: "tools/list", params: {} } });
  });
  it("turns a refused capability into a tool error, never an HTTP 401", async () => {
    const response = await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "data_query", arguments: {} } }, "Bearer stale");
    expect(response.status).toBe(200);
    // every tool call answers as an event stream, the result as the last event
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reply = JSON.parse((await response.text()).trim().split("data: ").at(-1)!) as Rpc;
    expect(reply.result.isError).toBe(true);
  });
  it("streams a tool call that carries a progress token, the result as the last event", async () => {
    const response = await post({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "data_query", arguments: {}, _meta: { progressToken: 7 } } });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const events = (await response.text()).split("\n\n").filter(Boolean).map((block) => JSON.parse(block.split("data: ")[1]!));
    expect(events.at(-1)).toEqual({ jsonrpc: "2.0", id: 6, result: { tools: [{ name: "data_query" }] } });
  });
  it("refuses a request without a bearer, a GET, an oversized body and bad JSON", async () => {
    expect((await post({ jsonrpc: "2.0", id: 5, method: "ping" }, "")).status).toBe(401);
    expect((await fetch(`${base}/api/internal/data/mcp-http`, { headers: { authorization: "Bearer good" } })).status).toBe(405);
    expect((await post(null, "Bearer good", "x".repeat(1_048_577))).status).toBe(413);
    expect((await (await post(null, "Bearer good", "{")).json() as Rpc).error.code).toBe(-32700);
  });
});
