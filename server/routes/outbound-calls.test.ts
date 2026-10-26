import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseOutboundCall } from "../../shared/outbound-call.ts";
import { json, readBody } from "../harness/http.ts";
import { OutboundCalls, type OutboundCallRecord } from "../outbound-calls.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { TOOL_POLICY_ROWS } from "../tool-policy.generated.ts";
import { createOutboundCallRoutes } from "./outbound-calls.ts";
import { dispatchRoutes } from "./table.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function serve(options: { principal?: string | null; gate?: { status: number; body: unknown } | null; stepUp?: { status: number; body: unknown } | null; via?: string; admin?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-call-routes-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const calls = new OutboundCalls(dir);
  calls.updateSettings({ enabled: true, callbackNumber: "+14385550199" });
  const answered: OutboundCallRecord[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const routes = [createOutboundCallRoutes({
    calls,
    principal: () => options.principal === undefined ? "jean" : options.principal,
    ownerGate: () => options.gate ?? null,
    stepUp: () => options.stepUp ?? null,
    viaPrimary: () => options.via ?? null,
    isAdmin: () => options.admin === true,
    answered: (row) => { answered.push(row); },
    audit: (_auth, _action, detail) => { audits.push(detail); },
  })];
  const auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, { from: "inline" });
  });
  cleanups.push(() => new Promise((done) => server.close(done)));
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, body?: unknown, method = "POST") => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const request = parseOutboundCall({ to: "+1 514 555 0142", from: "+1 438 555 0100", purpose: "Rendez-vous", message: "Confirmé." });
  if (typeof request === "string") throw new Error(request);
  const opened = calls.open({ principalId: "jean", botId: "bot-a", threadId: "t-1", request });
  return { calls, call, answered, audits, id: opened.record.id };
}

describe("phone call routes", () => {
  it("lists the waiting call and lets its person answer once", async () => {
    const { call, answered, audits, id } = await serve();
    const listed = await call("/api/me/phone-calls");
    expect(listed.body.calls).toEqual([expect.objectContaining({ destination: "+1 514 555 0142", purpose: "Rendez-vous" })]);
    expect(await call(`/api/me/phone-calls/${id}/answer`, { decision: "always" })).toMatchObject({ status: 400 });
    expect(await call(`/api/me/phone-calls/${id}/answer`, { decision: "call", confirmed: true, confirmedTo: "+1 514 555 0142" })).toEqual({ status: 200, body: { status: "approved" } });
    expect(answered.map((row) => row.status)).toEqual(["approved"]);
    expect(JSON.stringify(audits)).not.toContain("5145550142");
    expect(await call(`/api/me/phone-calls/${id}/answer`, { decision: "deny" })).toMatchObject({ status: 409 });
  });

  it("refuses someone else, a bot not asked, and a missing security key", async () => {
    const nobody = await serve({ principal: null });
    expect((await nobody.call("/api/me/phone-calls")).status).toBe(403);
    const gated = await serve({ gate: { status: 403, body: { error: "Only the person answers." } } });
    expect(await gated.call(`/api/me/phone-calls/${gated.id}/answer`, { decision: "call", confirmed: true, confirmedTo: "+1 514 555 0142" })).toMatchObject({ status: 403 });
    const keyed = await serve({ stepUp: { status: 401, body: { code: "step_up_required" } } });
    expect(await keyed.call(`/api/me/phone-calls/${keyed.id}/answer`, { decision: "call", confirmed: true, confirmedTo: "+1 514 555 0142" })).toMatchObject({ status: 401 });
    // declining never needs the key
    expect(await keyed.call(`/api/me/phone-calls/${keyed.id}/answer`, { decision: "deny" })).toMatchObject({ status: 200, body: { status: "denied" } });
    const other = await serve({ principal: "someone" });
    expect(await other.call(`/api/me/phone-calls/${other.id}/answer`, { decision: "call", confirmed: true, confirmedTo: "+1 514 555 0142" })).toMatchObject({ status: 404 });
  });

  it("a Primary Bot may decline a call, never confirm it (re-review)", async () => {
    const { call, calls, id } = await serve({ via: "Chef" });
    expect(await call(`/api/me/phone-calls/${id}/answer`, { decision: "call", confirmed: true, confirmedTo: "+1 514 555 0142" })).toMatchObject({ status: 403 });
    expect(await call(`/api/me/phone-calls/${id}/answer`, { decision: "deny" })).toMatchObject({ status: 200 });
    expect(calls.get(id)?.via).toBe("Chef");
  });

  it("is the person's own route: member scope, never an agent tool", () => {
    for (const path of ["/api/me/phone-calls", "/api/me/phone-calls/call_0123456789abcdef/answer"]) {
      expect(requiredScope("POST", path)).toBe("client");
      expect(requiredScope("GET", path)).toBe("admin");
    }
    const rows = TOOL_POLICY_ROWS.filter((row) => row.route.includes("phone-calls"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toMatchObject({ tier: "admin", defaultEnabled: false });
  });

  it("needs the number confirmed on the card before Call", async () => {
    const { call, id } = await serve();
    expect(await call(`/api/me/phone-calls/${id}/answer`, { decision: "call" })).toMatchObject({ status: 400, body: { code: "confirm_number" } });
    expect(await call(`/api/me/phone-calls/${id}/answer`, { decision: "call", confirmedTo: "+1 514 555 0000" })).toMatchObject({ status: 400 });
  });

  it("an admin turns calls on, sets the callback number and the do-not-call list; nobody else", async () => {
    const member = await serve();
    expect(await member.call("/api/org/phone-calls", undefined, "GET")).toMatchObject({ status: 403 });
    const admin = await serve({ admin: true });
    expect(await admin.call("/api/org/phone-calls", { enabled: false, addDoNotCall: "514 555 0177" }, "PUT")).toMatchObject({ status: 200, body: { settings: { enabled: false, callbackNumber: "+14385550199", doNotCall: ["+15145550177"] } } });
    expect(await admin.call("/api/org/phone-calls", { callbackNumber: "bad" }, "PUT")).toMatchObject({ status: 400 });
    expect(await admin.call("/api/org/phone-calls", undefined, "GET")).toMatchObject({ status: 200, body: { settings: { enabled: false } } });
  });
});
