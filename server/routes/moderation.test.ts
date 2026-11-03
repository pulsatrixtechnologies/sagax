import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { TERMS_VERSION, createModerationStore, type ModerationReport } from "../safety/moderation.ts";
import { peopleDmRouteRefusal } from "../people-dms.ts";
import { CLIENT_ALLOW, type RequestAuth } from "../auth/request-auth.ts";
import { createModerationRoutes, type ReportedMessage } from "./moderation.ts";
import { dispatchRoutes } from "./table.ts";

describe("moderation routes (App Store 1.2)", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function serve() {
    const dir = mkdtempSync(join(tmpdir(), "sagax-moderation-routes-"));
    dirs.push(dir);
    let ids = 0;
    const store = createModerationStore(dir, { now: () => 1_000, newId: () => `rep_${(++ids).toString(16).padStart(4, "0")}` });
    const notified: ModerationReport[] = [];
    const messages = new Map<string, ReportedMessage>([
      ["t-room:m-sam", { author: { id: "pr_sam", name: "Sam", kind: "person" }, text: "rude words", group: { id: "g-room", name: "Launch", peopleDm: false } }],
      ["t-room:m-alex", { author: { id: "pr_alex", name: "Alex", kind: "person" }, text: "mine", group: { id: "g-room", name: "Launch", peopleDm: false } }],
      ["t-dm:m-sam", { author: { id: "PR_SAM", name: "Sam", kind: "person" }, text: "in private", group: { id: "g-dm", name: "Alex, Sam", peopleDm: true } }],
      ["t-room:m-system", { author: null, text: "" }],
    ]);
    const routes = [createModerationRoutes({
      store,
      viewer: (auth) => {
        const who = (auth as { session?: { principalId?: string } }).session?.principalId;
        return who ? { id: who, name: who.slice(3) } : auth.kind === "loopback" ? { id: "pr_owner", name: "Owner" } : null;
      },
      isAdmin: (auth) => auth.kind === "loopback" || auth.scopes.includes("admin"),
      message: (threadId, messageId) => messages.get(`${threadId}:${messageId}`) ?? null,
      notifyAdmins: (report) => { notified.push(report); },
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = req.headers["x-who"] as string | undefined;
      const scope = (req.headers["x-scope"] as string | undefined) ?? "client";
      const auth = (who === "anon"
        ? { kind: "session", scopes: ["client"], session: {} }
        : who ? { kind: "session", scopes: [scope], session: { principalId: who } } : { kind: "loopback", scopes: ["admin", "client"] }) as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = (method: string, path: string, who?: string, body?: unknown, scope?: string) =>
      fetch(`${base}${path}`, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(who ? { "x-who": who } : {}), ...(scope ? { "x-scope": scope } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }).then(async (r) => ({ status: r.status, body: await r.json() as Record<string, any> }));
    return { call, notified, store };
  }

  it("stores a report on someone else's line, names the author from the message, and tells the admins", async () => {
    const { call, notified, store } = await serve();
    const sent = await call("POST", "/api/threads/t-room/messages/m-sam/report", "pr_alex", { reason: "harassment", note: "  three times today " });
    expect(sent).toEqual({ status: 201, body: { report: { id: "rep_0001", at: 1_000, status: "open" } } });
    expect(notified).toHaveLength(1);
    expect(store.reports()[0]).toMatchObject({
      threadId: "t-room", messageId: "m-sam", groupId: "g-room", groupName: "Launch",
      reportedId: "pr_sam", reportedName: "Sam", reportedKind: "person",
      reason: "harassment", note: "three times today", excerpt: "rude words",
      reporterId: "pr_alex", reporterName: "alex", status: "open",
    });
    // a direct conversation between people is reported the same way
    expect((await call("POST", "/api/threads/t-dm/messages/m-sam/report", "pr_alex", { reason: "sexual" })).status).toBe(201);
    expect(store.reports()[0]).toMatchObject({ peopleDm: true, reportedId: "pr_sam" });
  });

  it("refuses one's own line, a line with no author, an unknown message, a bad reason and a session that is nobody", async () => {
    const { call, notified } = await serve();
    expect(await call("POST", "/api/threads/t-room/messages/m-alex/report", "pr_alex", { reason: "spam" })).toMatchObject({ status: 400, body: { code: "report_own_message" } });
    expect(await call("POST", "/api/threads/t-room/messages/m-system/report", "pr_alex", { reason: "spam" })).toMatchObject({ status: 400, body: { code: "report_no_author" } });
    expect((await call("POST", "/api/threads/t-room/messages/nope/report", "pr_alex", { reason: "spam" })).status).toBe(404);
    expect(await call("POST", "/api/threads/t-room/messages/m-sam/report", "pr_alex", { reason: "rude" })).toMatchObject({ status: 400, body: { code: "report_invalid" } });
    // the author comes from the message, never from the body
    expect(await call("POST", "/api/threads/t-room/messages/m-sam/report", "pr_alex", { reason: "spam", reportedId: "pr_cara" })).toMatchObject({ status: 400 });
    expect((await call("POST", "/api/threads/t-room/messages/m-sam/report", "anon", { reason: "spam" })).status).toBe(403);
    expect(notified).toEqual([]);
  });

  it("only admins read and close reports", async () => {
    const { call } = await serve();
    await call("POST", "/api/threads/t-room/messages/m-sam/report", "pr_alex", { reason: "hate" });
    expect(await call("GET", "/api/moderation/reports", "pr_alex")).toMatchObject({ status: 403, body: { code: "admin_required" } });
    const listed = await call("GET", "/api/moderation/reports", "pr_boss", undefined, "admin");
    expect(listed.status).toBe(200);
    expect(listed.body.reports).toHaveLength(1);
    expect((await call("POST", "/api/moderation/reports/rep_0001/resolve", "pr_alex")).status).toBe(403);
    expect(await call("POST", "/api/moderation/reports/rep_0001/resolve", "pr_boss", undefined, "admin")).toMatchObject({ status: 200, body: { report: { status: "resolved", resolvedBy: "boss" } } });
    // the operator of a solo server is its owner
    expect((await call("GET", "/api/moderation/reports")).body.reports[0].status).toBe("resolved");
    expect((await call("POST", "/api/moderation/reports/rep_ffff/resolve")).status).toBe(404);
  });

  it("keeps each person's blocked people to themselves, synced across their devices", async () => {
    const { call } = await serve();
    expect(await call("GET", "/api/me/blocks", "pr_alex")).toEqual({ status: 200, body: { people: [] } });
    expect(await call("POST", "/api/me/blocks", "pr_alex", { id: "PR_SAM", name: "Sam" })).toEqual({ status: 200, body: { people: [{ id: "pr_sam", name: "Sam", at: 1_000 }] } });
    expect((await call("GET", "/api/me/blocks", "pr_alex")).body.people).toHaveLength(1);
    expect((await call("GET", "/api/me/blocks", "pr_sam")).body.people).toEqual([]);
    expect(await call("POST", "/api/me/blocks", "pr_alex", { id: "pr_alex" })).toMatchObject({ status: 400, body: { code: "block_self" } });
    expect(await call("POST", "/api/me/blocks", "pr_alex", { id: "" })).toMatchObject({ status: 400, body: { code: "block_invalid" } });
    expect(await call("DELETE", `/api/me/blocks/${encodeURIComponent("pr_sam")}`, "pr_alex")).toEqual({ status: 200, body: { people: [] } });
    expect((await call("GET", "/api/me/blocks", "anon")).status).toBe(403);
  });

  it("asks for the terms until the person accepts them, then never again", async () => {
    const { call } = await serve();
    expect(await call("GET", "/api/me/terms", "pr_alex")).toEqual({ status: 200, body: { accepted: false, current: TERMS_VERSION, url: "https://pulsatrix.ca/terms" } });
    const accepted = await call("POST", "/api/me/terms", "pr_alex", { version: TERMS_VERSION });
    expect(accepted).toMatchObject({ status: 200, body: { accepted: true, version: TERMS_VERSION, acceptedAt: 1_000 } });
    // another device of the same person reads it as accepted
    expect((await call("GET", "/api/me/terms", "pr_alex")).body).toMatchObject({ accepted: true, acceptedAt: 1_000 });
    expect((await call("GET", "/api/me/terms", "pr_sam")).body.accepted).toBe(false);
    expect((await call("GET", "/api/me/terms", "anon")).status).toBe(403);
  });

  it("is reachable by members, also in a direct conversation between people", () => {
    const allowed = (method: string, path: string) => CLIENT_ALLOW.some((rule) => rule.methods.includes(method) && rule.path.test(path));
    expect(allowed("POST", "/api/threads/t-1/messages/m-1/report")).toBe(true);
    expect(allowed("GET", "/api/me/blocks")).toBe(true);
    expect(allowed("POST", "/api/me/blocks")).toBe(true);
    expect(allowed("DELETE", "/api/me/blocks/pr_sam")).toBe(true);
    expect(allowed("GET", "/api/me/terms")).toBe(true);
    expect(allowed("POST", "/api/me/terms")).toBe(true);
    // the list of reports stays admin scope
    expect(allowed("GET", "/api/moderation/reports")).toBe(false);
    expect(allowed("POST", "/api/moderation/reports/rep_1/resolve")).toBe(false);
    expect(peopleDmRouteRefusal("POST", "/api/threads/t-1/messages/m-1/report")).toBeNull();
  });
});
