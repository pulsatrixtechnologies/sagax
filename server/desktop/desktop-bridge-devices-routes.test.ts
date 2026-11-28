// GET /api/me/desktop-bridge lists the person's devices (computers and
// phones); POST /api/me/desktop-bridge/computers/access sets what bots may do
// with one of them (2026-11-07).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DesktopBridges } from "./desktop-bridge.ts";
import { createDesktopBridgeRoutes } from "./desktop-bridge-routes.ts";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const capabilities = { shell: true, files: true, fetch: true, browser: true, computer: false, localVm: true };

function setup(organization = true) {
  const bridges = new DesktopBridges((session) => (session.startsWith("ada") ? ADA : null));
  bridges.register({ id: randomUUID(), name: "Work MacBook", platform: "darwin", attachmentsDir: "/tmp/a", capabilities }, "ada-1", "c".repeat(64));
  bridges.register({ id: randomUUID(), name: "Mac mini", platform: "darwin", attachmentsDir: "/tmp/a", capabilities }, "ada-2", "c".repeat(64));
  const routes = createDesktopBridgeRoutes({
    organization: () => organization,
    bridges,
    tunnels: { connected: () => false, selectedBridge: () => null, routedThisSession: () => 0 } as never,
    audit: { record() {}, recent: () => [] } as never,
    workplace: () => ({}),
    phones: (person) => (person === ADA ? [{ name: "My iPhone", platform: "ios", lastSeenAt: 5, online: false }] : []),
  });
  const call = async (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) => {
    let answer: { status: number; body: Record<string, unknown> } | undefined;
    await routes({
      req: { headers: { "content-type": "application/json", ...headers } },
      res: { setHeader() {} },
      path, method,
      auth: { kind: "session", session: { id: "ada-1", principalId: ADA } },
      json: (_res: unknown, status: number, value: Record<string, unknown>) => { answer = { status, body: value }; },
      readBody: async () => body,
    } as never);
    return answer!;
  };
  return { bridges, call };
}

describe("the person's devices routes", () => {
  it("lists this computer first, the other computers, then the phones without an access level", async () => {
    const { call } = setup();
    const answer = await call("/api/me/desktop-bridge", "GET");
    const devices = answer.body.devices as Array<{ name: string; kind: string; current: boolean; access: string | null }>;
    expect(devices.map((device) => [device.name, device.kind, device.current, device.access])).toEqual([
      ["Work MacBook", "computer", true, "always"],
      ["Mac mini", "computer", false, "always"],
      ["My iPhone", "phone", false, null],
    ]);
  });

  it("sets the access of one computer and refuses an unknown level", async () => {
    const { bridges, call } = setup();
    const set = await call("/api/me/desktop-bridge/computers/access", "POST", { computer: "Mac mini", access: "ask" });
    expect(set.status).toBe(200);
    expect(bridges.devices(ADA).find((device) => device.name === "Mac mini")?.access).toBe("ask");
    const bad = await call("/api/me/desktop-bridge/computers/access", "POST", { computer: "Mac mini", access: "maybe" });
    expect(bad.status).toBe(400);
  });

  it("on a solo server, the org probe is quiet and paired sessions use the bridge (#4856, #3043)", async () => {
    const { bridges, call } = setup(false);
    expect(await call("/api/me/desktop-bridge", "GET", undefined, { "x-sagax-org-probe": "1" })).toEqual({ status: 200, body: { offered: true } });
    const status = await call("/api/me/desktop-bridge", "GET");
    expect(status.status).toBe(200);
    expect(status.body.connected).toBe(true);
    expect((status.body.devices as Array<{ name: string }>).map((device) => device.name)).toEqual(["Work MacBook", "Mac mini", "My iPhone"]);
    const set = await call("/api/me/desktop-bridge/computers/access", "POST", { computer: "Mac mini", access: "never" });
    expect(set.status).toBe(200);
    expect(bridges.devices(ADA).find((device) => device.name === "Mac mini")?.access).toBe("never");
  });

  it("active, revoked, offline, re-paired and different-person cases on a solo fixture (#4856)", async () => {
    const bridges = new DesktopBridges((session) => (session.startsWith("ada") ? ADA : session.startsWith("bob") ? "pr_bob" : null));
    const macId = randomUUID();
    const secret = "c".repeat(64);
    bridges.register({ id: macId, name: "Ada Mac", platform: "darwin", attachmentsDir: "/tmp/a", capabilities }, "ada-live", secret);
    const routes = createDesktopBridgeRoutes({
      organization: () => false,
      bridges,
      tunnels: { connected: () => false, selectedBridge: () => null, routedThisSession: () => 0 } as never,
      audit: { record() {}, recent: () => [] } as never,
      workplace: () => ({}),
    });
    const call = async (sessionId: string, principalId: string, path: string, method: string, body?: unknown) => {
      let answer: { status: number; body: Record<string, unknown> } | undefined;
      await routes({
        req: { headers: { "content-type": "application/json" } },
        res: { setHeader() {} },
        path, method,
        auth: { kind: "session", session: { id: sessionId, principalId } },
        json: (_res: unknown, status: number, value: Record<string, unknown>) => { answer = { status, body: value }; },
        readBody: async () => body,
      } as never);
      return answer!;
    };
    // active
    expect((await call("ada-live", ADA, "/api/me/desktop-bridge", "GET")).body.connected).toBe(true);
    // revoked
    expect((await call("ada-live", ADA, "/api/me/desktop-bridge/computers/access", "POST", { computer: "Ada Mac", access: "never" })).status).toBe(200);
    expect(bridges.devices(ADA).find((device) => device.name === "Ada Mac")?.access).toBe("never");
    // re-paired: new session id, same person and computer name keeps Never
    bridges.register({ id: randomUUID(), name: "Ada Mac", platform: "darwin", attachmentsDir: "/tmp/a", capabilities }, "ada-repaired", secret);
    expect(bridges.devices(ADA, "ada-repaired").find((device) => device.name === "Ada Mac")?.access).toBe("never");
    // different person
    const bob = await call("bob-1", "pr_bob", "/api/me/desktop-bridge", "GET");
    expect(bob.status).toBe(200);
    expect(bob.body.connected).toBe(false);
    expect(bridges.devices("pr_bob")).toEqual([]);
  });
});
