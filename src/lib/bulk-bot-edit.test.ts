import { describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import {
  bulkDraftBot,
  bulkSectionRequest,
  dirtyPatch,
  listStart,
  mergeMcpAccounts,
  mixedFieldsOf,
  runBulkEdit,
  sectionBaseline,
  sectionFieldStates,
  sectionTouched,
  undoBulkEdit,
  type BulkSectionChange,
} from "./bulk-bot-edit";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "claude", model: "m" }, messages: [], ...extra,
} as Bot);

/** A made-up server: per-bot grants; Lina refuses a
 * change of where it works. */
function server() {
  const grants: Record<string, Array<{ target: string; level: string }>> = { atlas: [{ target: "user:ada", level: "use" }], iris: [], lina: [] };
  const calls: string[] = [];
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const [, , , id, kind, target] = path.split("/");
    if (kind === "grants") {
      if (method === "PUT") grants[id!] = [...grants[id!]!.filter((grant) => grant.target !== body.target), body];
      if (method === "DELETE") grants[id!] = grants[id!]!.filter((grant) => grant.target !== decodeURIComponent(target!));
      return { grants: grants[id!] };
    }
    throw new Error(`unexpected ${path}`);
  });
  const saved: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const saveBot = vi.fn(async (target: Bot, patch: Record<string, unknown>) => {
    if (target.id === "lina" && patch.computer !== undefined) throw new Error("Engine not available for this bot");
    saved.push({ id: target.id, patch });
    return target;
  });
  return { request, saveBot, saved, grants, calls };
}

describe("runBulkEdit", () => {

  // #1674: a bot with several threads refused a model that named none
  it("names each bot's own thread with a new model, never the draft's, and on undo too", async () => {
    const fake = server();
    const bots = [bot("atlas"), bot("iris")];
    const run = await runBulkEdit(bots, {
      model: { patch: { modelSelection: { instanceId: "claude", model: "n" }, threadId: "draft-1" } },
      voice: { patch: { speakReplies: true } },
    }, { request: fake.request as never, saveBot: fake.saveBot });
    expect(run.outcomes).toEqual([{ botId: "atlas", ok: true }, { botId: "iris", ok: true }]);
    expect(fake.saved).toEqual([
      { id: "atlas", patch: { modelSelection: { instanceId: "claude", model: "n" }, speakReplies: true, threadId: "t-atlas" } },
      { id: "iris", patch: { modelSelection: { instanceId: "claude", model: "n" }, speakReplies: true, threadId: "t-iris" } },
    ]);
    fake.saved.length = 0;
    await undoBulkEdit(bots, run.before, { request: fake.request as never, saveBot: fake.saveBot });
    expect(fake.saved.map((row) => row.patch.threadId)).toEqual(["t-atlas", "t-iris"]);
    // a change without a model sends no thread
    fake.saved.length = 0;
    await runBulkEdit([bot("lina")], { voice: { patch: { speakReplies: true, threadId: "draft-1" } } }, { request: fake.request as never, saveBot: fake.saveBot });
    expect(fake.saved).toEqual([{ id: "lina", patch: { speakReplies: true } }]);
  });
  it("changes each bot in turn and says which refused why (a partial result)", async () => {
    const fake = server();
    const bots = [bot("atlas", { computer: "local" }), bot("iris", { computer: "cloud" }), bot("lina")];
    const run = await runBulkEdit(bots, {
      worksOn: { patch: { computer: "cloud" } },
    }, { request: fake.request as never, saveBot: fake.saveBot });
    expect(run.outcomes).toEqual([
      { botId: "atlas", ok: true },
      { botId: "iris", ok: true, skipped: true },
      { botId: "lina", ok: false, reasons: ["Engine not available for this bot"] },
    ]);
    // Iris already worked in the cloud, so it needs no write.
    expect(fake.saved).toEqual([{ id: "atlas", patch: { computer: "cloud" } }]);
    expect(run.before).toEqual([
      { botId: "atlas", patch: { computer: "local" } },
    ]);
  });

  it("marks a bot with nothing to change as already set", async () => {
    const fake = server();
    const run = await runBulkEdit([bot("iris", { computer: "cloud" })], { worksOn: { patch: { computer: "cloud" } } }, { request: fake.request as never, saveBot: fake.saveBot });
    expect(run.outcomes).toEqual([{ botId: "iris", ok: true, skipped: true }]);
  });

  it("adds, removes and replaces Shared with, then undoes it", async () => {
    const fake = server();
    const bots = [bot("atlas"), bot("iris")];
    await runBulkEdit(bots, { sharing: { patch: {}, grants: { mode: "add", grants: [{ target: "user:bob", level: "edit" }] } } }, { request: fake.request as never, saveBot: fake.saveBot });
    expect(fake.grants.atlas).toEqual([{ target: "user:ada", level: "use" }, { target: "user:bob", level: "edit" }]);
    expect(fake.grants.iris).toEqual([{ target: "user:bob", level: "edit" }]);

    await runBulkEdit(bots, { sharing: { patch: {}, grants: { mode: "remove", grants: [{ target: "user:ada", level: "use" }] } } }, { request: fake.request as never, saveBot: fake.saveBot });
    expect(fake.grants.atlas).toEqual([{ target: "user:bob", level: "edit" }]);

    const replaced = await runBulkEdit(bots, { sharing: { patch: {}, grants: { mode: "replace", grants: [{ target: "team:ops", level: "use" }] } } }, { request: fake.request as never, saveBot: fake.saveBot });
    expect(fake.grants.atlas).toEqual([{ target: "team:ops", level: "use" }]);
    expect(fake.grants.iris).toEqual([{ target: "team:ops", level: "use" }]);

    const undone = await undoBulkEdit(bots, replaced.before, { request: fake.request as never, saveBot: fake.saveBot });
    expect(undone.every((row) => row.ok)).toBe(true);
    expect(fake.grants.atlas).toEqual([{ target: "user:bob", level: "edit" }]);
    expect(fake.grants.iris).toEqual([{ target: "user:bob", level: "edit" }]);
  });

  it("undoes the fields", async () => {
    const fake = server();
    const bots = [bot("atlas", { computer: "local" })];
    const run = await runBulkEdit(bots, {
      worksOn: { patch: { computer: "off" } },
    }, { request: fake.request as never, saveBot: fake.saveBot });
    await undoBulkEdit(bots, run.before, { request: fake.request as never, saveBot: fake.saveBot });
    expect(fake.saved.at(-1)).toEqual({ id: "atlas", patch: { computer: "local" } });
  });

  it("skips a section the bot editor locks for that bot, with the reason", async () => {
    const fake = server();
    const run = await runBulkEdit([bot("forge")], { worksOn: { patch: { computer: "cloud" } } }, {
      request: fake.request as never, saveBot: fake.saveBot,
      locked: (_bot, section) => section === "worksOn" ? "Only its owner can change this" : null,
    });
    expect(run.outcomes).toEqual([{ botId: "forge", ok: false, reasons: ["Only its owner can change this"] }]);
    expect(fake.saveBot).not.toHaveBeenCalled();
  });

  it("removes MCP servers from a bot that mounts every enabled one", async () => {
    const fake = server();
    await runBulkEdit([bot("atlas")], { access: { patch: {}, mcpServers: { mode: "remove", items: ["files"] } } }, {
      request: fake.request as never, saveBot: fake.saveBot, enabledServers: ["github", "files"],
    });
    expect(fake.saved).toEqual([{ id: "atlas", patch: { mcpServers: ["github"] } }]);
  });
});

describe("the dialog's draft", () => {
  it("keeps a section's writes as its change, never a real bot's", async () => {
    let change: BulkSectionChange = { patch: {} };
    const request = bulkSectionRequest("bulk-x", () => change, (next) => { change = next; }, () => bulkDraftBot("bulk-x", [bot("atlas")], "pr_me", change), (target) => target === "user:ada" ? "Ada" : target);
    await request("/api/bots/bulk-x", { method: "PATCH", body: JSON.stringify({ cwd: "/work", mcpServers: ["github"] }) });
    expect(change).toEqual({ patch: { cwd: "/work" }, mcpServers: { mode: "add", items: ["github"] } });
    const answer = await request<{ grants: Array<{ label: string }> }>("/api/bots/bulk-x/grants", { method: "PUT", body: JSON.stringify({ target: "user:ada", level: "use" }) });
    expect(answer.grants[0]!.label).toBe("Ada");
    expect(change.grants).toEqual({ mode: "add", grants: [{ target: "user:ada", level: "use" }] });
    await expect(request("/api/bots/atlas", { method: "PATCH", body: "{}" })).rejects.toThrow();
    expect(sectionTouched(change)).toBe(true);
    expect(sectionTouched({ patch: {} })).toBe(false);
  });
  it("draws the draft as the first bot, owned by the viewer, with the list's items", () => {
    const draft = bulkDraftBot("bulk-y", [bot("atlas", { ownerUserId: "pr_other", busy: true, mcpServers: ["files"] })], "pr_me", { patch: { computer: "off" }, mcpServers: { mode: "add", items: ["github"] } });
    expect(draft).toMatchObject({ id: "bulk-y", ownerUserId: "pr_me", busy: false, computer: "off", mcpServers: ["github"] });
  });
  it("starts Replace from the common items, Add and Remove from nothing", () => {
    expect(listStart("replace", [["a", "b"], ["b"]])).toEqual(["b"]);
    expect(listStart("add", [["a"]])).toEqual([]);
  });

  // #1701: mixed fields must not look like the first bot, and only dirty writes stick
  it("clears mixed section fields on the draft and keeps shared ones", () => {
    const bots = [
      bot("atlas", { computer: "local", approvalMode: "ask", notifications: true }),
      bot("iris", { computer: "cloud", approvalMode: "ask", notifications: false }),
    ];
    const fieldValue = (target: Bot, field: string) => (target as unknown as Record<string, unknown>)[field];
    const draft = bulkDraftBot("bulk-z", bots, "pr_me", { patch: {} }, { section: "worksOn", fieldValue });
    expect(draft.computer).toBeUndefined();
    const perms = bulkDraftBot("bulk-p", bots, "pr_me", { patch: {} }, { section: "permissions", fieldValue });
    expect(perms.approvalMode).toBe("ask");
    expect(mixedFieldsOf(sectionFieldStates(bots, "permissions", fieldValue)).has("approvalMode")).toBe(false);
    const voiceDraft = bulkDraftBot("bulk-v", bots, "pr_me", { patch: {} }, { section: "voice", fieldValue });
    expect(voiceDraft.notifications).toBeUndefined();
    expect(mixedFieldsOf(sectionFieldStates(bots, "voice", fieldValue)).has("notifications")).toBe(true);
  });

  it("marks only dirty fields against the opening baseline, including a mixed pick", () => {
    const bots = [bot("atlas", { computer: "local" }), bot("iris", { computer: "cloud" })];
    const fieldValue = (target: Bot, field: string) => (target as unknown as Record<string, unknown>)[field];
    const baseline = sectionBaseline(sectionFieldStates(bots, "worksOn", fieldValue));
    expect(dirtyPatch(baseline, { computer: "local" })).toEqual({ computer: "local" });
    expect(dirtyPatch(baseline, { computer: "cloud" })).toEqual({ computer: "cloud" });
    const shared = sectionBaseline(sectionFieldStates(
      [bot("a", { computer: "local" }), bot("b", { computer: "local" })],
      "worksOn",
      fieldValue,
    ));
    expect(dirtyPatch(shared, { computer: "local" })).toEqual({});
    expect(dirtyPatch(shared, { computer: "off", confirmFullAccess: true })).toEqual({ computer: "off", confirmFullAccess: true });
  });

  it("filters PATCH writes through the baseline so echoing a shared value is not a change", async () => {
    let change: BulkSectionChange = { patch: {} };
    const bots = [bot("atlas", { cwd: "/a" }), bot("iris", { cwd: "/a" })];
    const fieldValue = (target: Bot, field: string) => (target as unknown as Record<string, unknown>)[field];
    const baseline = sectionBaseline(sectionFieldStates(bots, "access", fieldValue));
    const request = bulkSectionRequest(
      "bulk-d",
      () => change,
      (next) => { change = next; },
      () => bulkDraftBot("bulk-d", bots, "pr_me", change, { section: "access", fieldValue }),
      (target) => target,
      () => baseline,
    );
    await request("/api/bots/bulk-d", { method: "PATCH", body: JSON.stringify({ cwd: "/a" }) });
    expect(change.patch).toEqual({});
    await request("/api/bots/bulk-d", { method: "PATCH", body: JSON.stringify({ cwd: "/b" }) });
    expect(change.patch).toEqual({ cwd: "/b" });
  });

  it("merges mcpAccounts onto each bot instead of replacing the map", async () => {
    expect(mergeMcpAccounts({ linear: "old", notes: "keep" }, { linear: "new" }))
      .toEqual({ linear: "new", notes: "keep" });
    const fake = server();
    await runBulkEdit(
      [bot("atlas", { mcpAccounts: { linear: "old", notes: "keep" } as never })],
      { access: { patch: { mcpAccounts: { linear: "new" } } } },
      { request: fake.request as never, saveBot: fake.saveBot },
    );
    expect(fake.saved).toEqual([{ id: "atlas", patch: { mcpAccounts: { linear: "new", notes: "keep" } } }]);
  });
});
