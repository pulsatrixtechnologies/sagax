// OTLP export settings routes (#2609): admin scope, header values never answered.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import type { OtlpTarget } from "../telemetry/otel.ts";
import { createTelemetrySettingsStore } from "../telemetry/settings-store.ts";
import { dispatchRoutes } from "./table.ts";
import { createTelemetryRoutes } from "./telemetry.ts";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function serve(refuse = false) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-telemetry-route-"));
  dirs.push(dir);
  const tested: OtlpTarget[] = [];
  const store = createTelemetrySettingsStore(dir, () => ({ kind: "key", key: randomBytes(32) }));
  const tracer = {
    test: async (target: OtlpTarget) => { tested.push(target); if (refuse) throw new Error("OTLP collector answered HTTP 401"); },
    stats: () => ({ queued: 0, dropped: 0, exported: 4, failed: 1 }),
  };
  const routes = [createTelemetryRoutes({ store, tracer })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin", "client"] } as unknown as RequestAuth;
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, text: await response.text() };
  };
  return { call, tested };
}

describe("/api/telemetry", () => {
  it("is admin scope", () => {
    expect(requiredScope("GET", "/api/telemetry")).toBe("admin");
    expect(requiredScope("PUT", "/api/telemetry")).toBe("admin");
    expect(requiredScope("POST", "/api/telemetry/test")).toBe("admin");
  });

  it("saves, answers header names only, tests with the saved headers, and turns off", async () => {
    const { call, tested } = await serve();
    expect(JSON.parse((await call("GET", "/api/telemetry")).text)).toMatchObject({ enabled: false, endpoint: null, stats: { exported: 4 } });
    const saved = await call("PUT", "/api/telemetry", { endpoint: "https://otel.example.test:4318", headers: { authorization: "Bearer hidden-token" }, serviceName: "gox" });
    expect(saved.status).toBe(200);
    expect(saved.text).not.toContain("hidden-token");
    expect(JSON.parse(saved.text)).toMatchObject({ enabled: true, headerNames: ["authorization"], serviceName: "gox" });
    expect((await call("GET", "/api/telemetry")).text).not.toContain("hidden-token");
    expect((await call("POST", "/api/telemetry/test", { endpoint: "https://otel.example.test:4318", headers: { authorization: "" } })).status).toBe(200);
    expect(tested[0]).toEqual({ endpoint: "https://otel.example.test:4318", headers: { authorization: "Bearer hidden-token" } });
    expect((await call("PUT", "/api/telemetry", { endpoint: "ftp://x" })).status).toBe(400);
    const off = JSON.parse((await call("DELETE", "/api/telemetry")).text);
    expect(off).toMatchObject({ enabled: false, endpoint: null });
    expect((await call("POST", "/api/telemetry/test", {})).status).toBe(400);
  });

  it("answers 502 when the collector refuses the test span", async () => {
    const { call } = await serve(true);
    const answer = await call("POST", "/api/telemetry/test", { endpoint: "https://otel.example.test" });
    expect(answer.status).toBe(502);
    expect(answer.text).toContain("401");
  });
});
