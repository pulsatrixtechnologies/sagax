// Bots (server/org/org-admin-bots.ts) with faked dependencies: the reach, the
// bodies, each action's audit row, the bulk results, package and import.
import { describe, expect, it } from "vitest";

import { botsRoutes, BULK_MAX_IDS, type BotsDeps } from "./org-admin-bots.ts";
import { ConsoleRefusal } from "./org-admin-console.ts";
import { botLook, botPersona } from "./org-admin-look.ts";
import type { AdminBot, AdminBotReach } from "./org-admin-routes.ts";
import { fakeConsole } from "../testing/console-context.ts";

function setup() {
  const bots = new Map<string, AdminBot>();
  const reach = new Map<string, AdminBotReach>();
  const add = (id: string, owner: string, extra: Partial<AdminBot> = {}) => {
    bots.set(id, {
      id, name: id.toUpperCase(), owner: { principalId: owner, sub: null, name: owner }, ownerRole: "member",
      engine: { instanceId: "claude", driverKind: "claudeAgent", installed: true }, model: "m1", access: "org-key",
      mcpProfiles: [], grants: [], sections: [], routines: 0, createdAt: 1, lastActivityAt: null, status: "active", label: null, threads: 1,
      look: botLook({ name: id, color: "green" }, () => false), persona: botPersona({ name: id }), approvalMode: "ask", ...extra,
    });
    reach.set(id, { ownerPrincipalId: owner, grantTargets: [], sectionMemberTargets: [] });
  };
  add("a", "pr_alice");
  add("b", "pr_bob");
  add("p", "pr_bob", { name: "PRIMARY" });
  add("busy", "pr_bob");
  add("plain", "pr_bob", { engine: { instanceId: "plain", driverKind: "plain", installed: true } });
  const calls: string[] = [];
  const deps: BotsDeps = {
    bots: () => [...bots.values()].map((bot) => ({ bot, reach: reach.get(bot.id)! })),
    detail: (id) => (bots.has(id) ? { threads: { count: 2, lastAt: 5 }, soul: { chars: 10, summary: "Helps." }, skills: [{ id: "s", name: "s", source: null }], permissions: { approvalMode: "ask", fullAccess: false }, routineList: [] } : null),
    owner: (id) => (["pr_alice", "pr_bob", "pr_mona"].includes(id) ? { principalId: id, sub: null, name: id } : null),
    ownerBySub: (sub) => (sub === "bob-sub" ? { principalId: "pr_bob", sub, name: "pr_bob" } : null),
    clone: async (id, input) => {
      const copy = `${id}-copy`;
      add(copy, input.ownerPrincipalId, { name: input.name ?? `${bots.get(id)!.name} 2` });
      return copy;
    },
    setArchived: (id, archived) => {
      if (id === "p" && archived) throw new ConsoleRefusal(409, "primary_bot", "Primary.");
      bots.set(id, { ...bots.get(id)!, status: archived ? "archived" : "active" });
    },
    transfer: (id, owner) => { bots.set(id, { ...bots.get(id)!, owner: { principalId: owner, sub: null, name: owner } }); reach.set(id, { ...reach.get(id)!, ownerPrincipalId: owner }); },
    setModel: (id, input) => {
      if (input.engineInstanceId === "ghost") throw new ConsoleRefusal(400, "engine_not_installed", "Not installed.");
      bots.set(id, { ...bots.get(id)!, model: input.model });
    },
    setApprovalMode: (id, mode, threads) => {
      const current = bots.get(id)!;
      if (id === "busy") throw new ConsoleRefusal(409, "busy", "Working.");
      if (current.engine.instanceId === "plain") throw new ConsoleRefusal(400, "mode_not_supported", "No Auto.");
      bots.set(id, { ...current, approvalMode: mode });
      calls.push(`mode:${id}:${mode}:${threads}`);
      return { before: current.approvalMode, after: mode, threadsMoved: threads && mode === "auto" ? ["t1"] : [] };
    },
    stop: async (id) => { calls.push(`stop:${id}`); },
    remove: async (id) => { bots.delete(id); return { status: 200, body: { ok: true } }; },
    notifyOwner: (id, action) => { calls.push(`notify:${action}:${id}`); },
    exportPackage: (id) => ({ document: { format: "package", version: 2, bot: id, secret: "[redacted]" }, filename: `${id} pkg.json`, redacted: ["x"], skipped: [] }),
    importPackage: async (_doc, input) => { add("imported", input.ownerPrincipalId, { name: input.name ?? "IMPORTED" }); return { botId: "imported", warnings: ["agents[x].skills: too_large"] }; },
    exportZip: (id, options) => ({ filename: `${id}.sagaxbot.zip`, bytes: id === "huge" ? 600 * 1024 * 1024 : 4, write: async (sink) => { await sink(Buffer.from(`PK${options.conversations ? "c" : ""}`)); return { bytes: 3, redacted: 2 }; } }),
    capabilities: (id, viewer) => {
      calls.push(`caps:${id}:${viewer.principalId}:${viewer.orgAdmin}`);
      return id === "plain" ? null : { botId: id, engine: { kind: "claudeAgent", label: "Claude" }, items: [] };
    },
    avatar: (id) => (id === "a" ? { bytes: Buffer.from("PNGBYTES"), type: "image/png", version: "0123456789abcdef" } : id === "p" ? "too_large" : null),
    importZip: async (_request, input) => {
      if (input.preview) return { preview: { kind: "zip", name: "A", importName: input.name ?? "A 2", includes: {}, hasConversations: false, hasSharing: false, created: [], skipped: [], needsAction: [] } };
      add("zipped", input.ownerPrincipalId, { name: input.name ?? "ZIPPED" });
      return { botId: "zipped", warnings: [] };
    },
  };
  return { bots, calls, console: fakeConsole(botsRoutes(deps)) };
}

const MANAGER = { role: "manager" as const, principalId: "pr_mona", reach: ["pr_mona", "pr_bob"] };

describe("bots", () => {
  it("a bot's page, within reach", async () => {
    const { console } = setup();
    expect((await console.call("GET", "bots/a")).body.bot).toMatchObject({ id: "a", threads: { count: 2, lastAt: 5 }, soul: { summary: "Helps." }, permissions: { approvalMode: "ask" } });
    expect((await console.call("GET", "bots/a", MANAGER)).status).toBe(404);
    expect((await console.call("GET", "bots/b", MANAGER)).status).toBe(200);
    expect((await console.call("GET", "bots/zz")).status).toBe(404);
  });

  it("clone: same owner by default, another owner in reach, a name; audited", async () => {
    const { console } = setup();
    const same = await console.call("POST", "bots/b/clone", { body: {} });
    expect(same).toMatchObject({ status: 201, body: { bot: { id: "b-copy", owner: { principalId: "pr_bob" } } } });
    expect(console.records.at(-1)).toMatchObject({ category: "bot", action: "bot.clone", after: { from: "b", ownerPrincipalId: "pr_bob" } });
    const other = await console.call("POST", "bots/a/clone", { body: { ownerPrincipalId: "pr_mona", name: "Atlas for Mona" } });
    expect(other.body.bot).toMatchObject({ name: "Atlas for Mona", owner: { principalId: "pr_mona" } });
    // a manager: the bot and the new owner must be in reach
    expect((await console.call("POST", "bots/a/clone", { ...MANAGER, body: {} })).status).toBe(404);
    expect(await console.call("POST", "bots/b/clone", { ...MANAGER, body: { ownerPrincipalId: "pr_alice" } })).toMatchObject({ status: 404, body: { code: "owner_not_found" } });
    expect((await console.call("POST", "bots/b/clone", { body: { name: "" } })).status).toBe(400);
    expect((await console.call("POST", "bots/b/clone", { body: { other: 1 } })).status).toBe(400);
  });

  it("archive and restore: idempotent, a Primary Bot refused, audited once", async () => {
    const { console } = setup();
    expect((await console.call("POST", "bots/b/archive", MANAGER)).body.bot.status).toBe("archived");
    const rows = console.records.length;
    expect((await console.call("POST", "bots/b/archive")).body.bot.status).toBe("archived");
    expect(console.records.length).toBe(rows);
    expect(await console.call("POST", "bots/p/archive")).toMatchObject({ status: 409, body: { code: "primary_bot" } });
    expect((await console.call("POST", "bots/b/restore")).body.bot.status).toBe("active");
    expect(console.records.at(-1)).toMatchObject({ action: "bot.restore", before: { status: "archived" }, after: { status: "active" } });
    expect((await console.call("POST", "bots/a/archive", MANAGER)).status).toBe(404);
  });

  it("transfer and model", async () => {
    const { console } = setup();
    expect((await console.call("POST", "bots/a/transfer", { body: { ownerPrincipalId: "pr_bob" } })).body.bot.owner.principalId).toBe("pr_bob");
    expect(console.records.at(-1)).toMatchObject({ action: "bot.transfer", before: { ownerPrincipalId: "pr_alice" }, after: { ownerPrincipalId: "pr_bob" } });
    expect((await console.call("POST", "bots/a/transfer", { body: { ownerPrincipalId: "pr_ghost" } })).body.code).toBe("owner_not_found");
    expect((await console.call("POST", "bots/a/transfer", { body: {} })).status).toBe(400);
    expect((await console.call("POST", "bots/a/transfer", { body: { ownerSub: "bob-sub" } })).body.bot.owner.principalId).toBe("pr_bob");
    expect((await console.call("POST", "bots/a/clone", { body: { ownerSub: "bob-sub" } })).body.bot.owner.principalId).toBe("pr_bob");
    expect((await console.call("POST", "bots/a/clone", { body: { ownerSub: "bob-sub", ownerPrincipalId: "pr_bob" } })).status).toBe(400);
    expect((await console.call("POST", "bots/a/model", { body: { model: "m2" } })).body.bot.model).toBe("m2");
    expect(console.records.at(-1)).toMatchObject({ action: "bot.model", before: { model: "m1" }, after: { model: "m2" } });
    expect(await console.call("POST", "bots/a/model", { body: { engineInstanceId: "ghost", model: "m" } })).toMatchObject({ status: 400, body: { code: "engine_not_installed" } });
    expect((await console.call("POST", "bots/a/model", { body: { model: 5 } })).status).toBe(400);
  });

  it("stop and delete: the owner is told; delete needs the bot's name", async () => {
    const { console, calls, bots } = setup();
    expect((await console.call("POST", "bots/b/stop", { body: {} })).status).toBe(200);
    expect(calls).toEqual(["stop:b", "notify:stop:b"]);
    expect(console.records.at(-1)).toMatchObject({ action: "bot.force_stop" });
    expect(await console.call("POST", "bots/b/delete", { body: { confirm: "b" } })).toMatchObject({ status: 400, body: { code: "confirm_required" } });
    expect(await console.call("POST", "bots/b/delete", { body: { confirm: "B" } })).toMatchObject({ status: 200, body: { deleted: "b" } });
    expect(bots.has("b")).toBe(false);
    expect(console.records.at(-1)).toMatchObject({ action: "bot.force_delete", target: { id: "b" } });
  });

  it("bulk: one result per bot, one audit row per change", async () => {
    const { console } = setup();
    const got = await console.call("POST", "bots/bulk", { body: { action: "archive", ids: ["a", "p", "zz"] } });
    expect(got.body.results).toEqual([
      { id: "a", ok: true },
      { id: "p", ok: false, code: "primary_bot", message: "Primary." },
      { id: "zz", ok: false, code: "not_found", message: "No such bot." },
    ]);
    expect(console.records.filter((row) => row.action === "bot.archive")).toHaveLength(1);
    expect((await console.call("POST", "bots/bulk", { body: { action: "transfer", ids: ["a"], ownerPrincipalId: "pr_bob" } })).body.results).toEqual([{ id: "a", ok: true }]);
    for (const body of [{ action: "delete", ids: ["a"] }, { action: "archive", ids: [] }, { action: "archive", ids: ["a", "a"] }, { action: "archive", ids: Array.from({ length: BULK_MAX_IDS + 1 }, (_, i) => `x${i}`) }, { action: "transfer", ids: ["a"] }]) {
      expect((await console.call("POST", "bots/bulk", { body })).status).toBe(400);
    }
  });

  it("package and import", async () => {
    const { console } = setup();
    const pkg = await console.call("GET", "bots/a/package");
    expect(pkg.status).toBe(200);
    expect(console.records.at(-1)).toMatchObject({ action: "bot.export", after: { redacted: 1 } });
    const imported = await console.call("POST", "bots/import", { body: { package: { format: "package" }, ownerSub: "bob-sub", name: "Copied" } });
    expect(imported).toMatchObject({ status: 201, body: { bot: { id: "imported", name: "Copied", owner: { principalId: "pr_bob" } }, warnings: ["agents[x].skills: too_large"] } });
    // no owner named: the console person, who must be a person of this server
    expect((await console.call("POST", "bots/import", { body: { package: { format: "package" } } })).body.code).toBe("owner_not_found");
    expect((await console.call("POST", "bots/import", { principalId: "pr_alice", body: { package: { format: "package" } } })).body.bot.owner.principalId).toBe("pr_alice");
    expect((await console.call("POST", "bots/import", { body: { package: "text" } })).status).toBe(400);
    expect((await console.call("POST", "bots/import", { body: { package: {}, ownerSub: "nobody" } })).body.code).toBe("owner_not_found");
  });

  it("the bot zip: download and upload through the same routes", async () => {
    const { console } = setup();
    const zip = await console.call("GET", "bots/a/package?format=zip&conversations=1");
    expect(zip.status).toBe(200);
    expect(zip.raw?.toString()).toBe("PKc");
    expect(console.records.at(-1)).toMatchObject({ action: "bot.export", after: { format: "zip", redacted: 2, conversations: true } });
    expect((await console.call("GET", "bots/a/package?format=tar")).status).toBe(400);
    const preview = await console.call("POST", "bots/import?preview=1&ownerSub=bob-sub&name=Copy", { request: {} });
    expect(preview).toMatchObject({ status: 200, body: { preview: { importName: "Copy" } } });
    const imported = await console.call("POST", "bots/import?ownerSub=bob-sub&name=Copy", { request: {} });
    expect(imported).toMatchObject({ status: 201, body: { bot: { id: "zipped", name: "Copy", owner: { principalId: "pr_bob" } } } });
    expect(console.records.at(-1)).toMatchObject({ action: "bot.import", after: { format: "zip", ownerPrincipalId: "pr_bob" } });
    expect((await console.call("POST", "bots/import?ownerSub=nobody", { request: {} })).body.code).toBe("owner_not_found");
  });

  it("a bot's picture: bytes, a strong ETag and 304, private no-cache, nosniff; 404 without one", async () => {
    const { console } = setup();
    const got = await console.call("GET", "bots/a/avatar");
    expect(got.status).toBe(200);
    expect(got.raw?.toString()).toBe("PNGBYTES");
    expect(got.headers).toEqual({ etag: "\"0123456789abcdef\"", "cache-control": "private, no-cache", "x-content-type-options": "nosniff", "content-type": "image/png", "content-length": "8" });
    const again = await console.call("GET", "bots/a/avatar", { headers: { "if-none-match": "\"0123456789abcdef\"" } });
    expect(again.status).toBe(304);
    expect(again.raw?.length).toBe(0);
    expect((await console.call("GET", "bots/b/avatar")).body.code).toBe("not_found");
    expect((await console.call("GET", "bots/p/avatar")).body.code).toBe("too_large");
    // out of a manager's reach reads as no such bot
    expect((await console.call("GET", "bots/a/avatar", MANAGER)).status).toBe(404);
  });

  it("a bot's capabilities: the resolved list for the console person, within reach; read only", async () => {
    const { console, calls } = setup();
    const got = await console.call("GET", "bots/a/capabilities");
    expect(got.status).toBe(200);
    expect(got.body).toEqual({ botId: "a", engine: { kind: "claudeAgent", label: "Claude" }, items: [] });
    expect(calls).toContain("caps:a:pr_admin:true");
    expect((await console.call("GET", "bots/a/capabilities", MANAGER)).status).toBe(404);
    expect((await console.call("GET", "bots/b/capabilities", MANAGER)).status).toBe(200);
    expect(calls).toContain("caps:b:pr_mona:false");
    expect((await console.call("GET", "bots/plain/capabilities")).body.code).toBe("not_found");
    expect((await console.call("GET", "bots/zz/capabilities")).status).toBe(404);
  });

  it("every bot carries its look and persona", async () => {
    const { console } = setup();
    expect((await console.call("GET", "bots/a")).body.bot).toMatchObject({ look: { kind: "default", character: "owl", family: "classics" }, persona: { displayName: "a", title: null } });
  });

  it("bulk approvalMode: Ask or Approve for me only, per-bot results, one approval.mode row per changed bot", async () => {
    const { console, calls, bots } = setup();
    for (const body of [
      { action: "approvalMode", ids: ["a"] },
      { action: "approvalMode", ids: ["a"], mode: "full" },
      { action: "approvalMode", ids: ["a"], mode: "custom" },
      { action: "approvalMode", ids: ["a"], mode: "edits" },
      { action: "approvalMode", ids: ["a"], mode: "auto", threads: "yes" },
      { action: "archive", ids: ["a"], mode: "auto" },
    ]) {
      expect((await console.call("POST", "bots/bulk", { body })).status).toBe(400);
    }
    const before = console.records.length;
    const res = await console.call("POST", "bots/bulk", { body: { action: "approvalMode", ids: ["a", "busy", "plain", "zz"], mode: "auto", threads: true } });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { id: "a", ok: true },
      { id: "busy", ok: false, code: "busy", message: "Working." },
      { id: "plain", ok: false, code: "mode_not_supported", message: "No Auto." },
      { id: "zz", ok: false, code: "not_found", message: "No such bot." },
    ]);
    expect(calls).toContain("mode:a:auto:true");
    expect(bots.get("a")!.approvalMode).toBe("auto");
    const rows = console.records.slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: "approval", action: "approval.mode", target: { kind: "bot", id: "a" }, before: { approvalMode: "ask" }, after: { approvalMode: "auto", threads: 1 } });
    // no change, no row
    const again = console.records.length;
    bots.set("b", { ...bots.get("b")!, approvalMode: "auto" });
    expect((await console.call("POST", "bots/bulk", { body: { action: "approvalMode", ids: ["b"], mode: "auto" } })).body.results).toEqual([{ id: "b", ok: true }]);
    expect(console.records.length).toBe(again);
  });


});

