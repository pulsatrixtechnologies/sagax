// Characterization of GET /api/cli-candidates and POST /api/cli-test.
import { describe, expect, it, vi } from "vitest";

import { HOSTED_PROVIDER_SETTINGS_ERROR } from "../hosted-models.ts";
import { createCliTestRoutes, type CliTestRouteDeps } from "./cli-test.ts";
import { PASS } from "./table.ts";

function harness(overrides: Partial<CliTestRouteDeps> = {}) {
  const reset = vi.fn();
  const find = vi.fn(() => ["/usr/local/bin/claude", "/opt/claude"]);
  const testCli = vi.fn(async () => ({ ok: true, version: "1.2.3" }));
  const deps: CliTestRouteDeps = {
    hostedModels: false,
    testCliBinary: testCli,
    resetPathCache: reset,
    findCliCandidates: find,
    ...overrides,
  };
  const route = createCliTestRoutes(deps);
  const call = async (
    path: string,
    opts: { method?: string; body?: unknown; contentType?: string; query?: string } = {},
  ) => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const out = await route({
      req: { headers: { "content-type": opts.contentType ?? "application/json" } } as never,
      res: {} as never,
      url: new URL(`http://localhost${path}${opts.query ?? ""}`),
      path,
      method: opts.method ?? "GET",
      auth: { kind: "loopback", scopes: ["admin"] } as never,
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => opts.body ?? {}) as never,
    });
    return { out, sent: sent[0], reset, find, testCli };
  };
  return { call, reset, find, testCli };
}

describe("GET /api/cli-candidates", () => {
  it("resets the PATH cache and lists candidates for the name", async () => {
    const h = harness();
    const { sent } = await h.call("/api/cli-candidates", { query: "?name=claude" });
    expect(sent).toEqual({
      status: 200,
      body: { candidates: ["/usr/local/bin/claude", "/opt/claude"] },
    });
    expect(h.reset).toHaveBeenCalledOnce();
    expect(h.find).toHaveBeenCalledWith("claude");
  });
});

describe("POST /api/cli-test", () => {
  it("refuses a non-JSON content type and a hosted workspace", async () => {
    const plain = await harness().call("/api/cli-test", {
      method: "POST",
      contentType: "text/plain",
      body: { cli: "/bin/claude" },
    });
    expect(plain.sent).toEqual({ status: 415, body: { error: "content-type must be application/json" } });

    const hosted = await harness({ hostedModels: true }).call("/api/cli-test", {
      method: "POST",
      body: { cli: "/bin/claude" },
    });
    expect(hosted.sent).toEqual({ status: 403, body: { error: HOSTED_PROVIDER_SETTINGS_ERROR } });
  });

  it("refuses an empty cli, a newline, and a refused command", async () => {
    const h = harness();
    expect((await h.call("/api/cli-test", { method: "POST", body: { cli: "" } })).sent)
      .toEqual({ status: 400, body: { error: "cli must be a non-empty path" } });
    expect((await h.call("/api/cli-test", { method: "POST", body: { cli: "claude\nrm -rf /" } })).sent)
      .toEqual({ status: 400, body: { error: "cli must be a non-empty path" } });
    expect((await h.call("/api/cli-test", { method: "POST", body: { cli: "bash -c id" } })).sent?.status)
      .toBe(400);
    expect(h.testCli).not.toHaveBeenCalled();
  });

  it("probes a known engine name and returns the verdict", async () => {
    const h = harness();
    const { sent } = await h.call("/api/cli-test", {
      method: "POST",
      body: { cli: "claude", driver: "claudeAgent" },
    });
    expect(sent).toEqual({ status: 200, body: { ok: true, version: "1.2.3" } });
    expect(h.testCli).toHaveBeenCalledOnce();
    expect(h.testCli).toHaveBeenCalledWith("claude", expect.objectContaining({ driverKind: "claudeAgent" }));
  });

  it("passes other paths", async () => {
    const h = harness();
    expect((await h.call("/api/instances/claude")).out).toBe(PASS);
  });
});
