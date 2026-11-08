import { describe, expect, it } from "vitest";
import { actorForTurn, botActFrameAllowed, decideBotAct, fillPluginBot, uiCommandToAction, type TurnFacts } from "./bot-act.ts";

const client = (method: string, path: string) => path.startsWith("/api/admin") ? "admin" as const : "client" as const;

function facts(patch: Partial<TurnFacts> = {}): TurnFacts {
  return {
    automation: false,
    guest: false,
    requestUsable: true,
    senderUnproven: false,
    provenPerson: null,
    sharedServer: false,
    ...patch,
  };
}

describe("actorForTurn", () => {
  it("#2701: a routine acts for its owner, and is refused only with no owner on a shared server", () => {
    expect(actorForTurn(facts({ automation: true, sharedServer: true, provenPerson: "p1", routineOwner: "owner" }))).toEqual({ kind: "person", personKey: "owner", routine: true });
    expect(actorForTurn(facts({ automation: true, sharedServer: true, provenPerson: "p1" }))).toEqual({ kind: "none", reason: "automation" });
    expect(actorForTurn(facts({ automation: true, requestUsable: false }))).toEqual({ kind: "operator" });
  });

  it("refuses a guest before an unproven request", () => {
    expect(actorForTurn(facts({ guest: true, requestUsable: false }))).toEqual({ kind: "none", reason: "guest" });
  });

  it("refuses an unusable request, then a sender that was not proven", () => {
    expect(actorForTurn(facts({ requestUsable: false, senderUnproven: true }))).toEqual({ kind: "none", reason: "unproven" });
    expect(actorForTurn(facts({ senderUnproven: true, provenPerson: "p1" }))).toEqual({ kind: "none", reason: "stale" });
  });

  it("acts as the proven person, and as the owner only on a personal desktop", () => {
    expect(actorForTurn(facts({ provenPerson: "p1", sharedServer: true }))).toEqual({ kind: "person", personKey: "p1" });
    expect(actorForTurn(facts({ sharedServer: true }))).toEqual({ kind: "none", reason: "shared" });
    expect(actorForTurn(facts())).toEqual({ kind: "operator" });
  });
});

describe("decideBotAct", () => {
  it.each(["/api/org/admin", "/api/org/admin/routines", "/api/org/admin/routines/wren/runs", "/api/org/member", "/api/org/member/bots"])("#1993: explains the assertion transport for %s before replay or approval", (path) => {
    for (const method of ["GET", "HEAD", "POST"]) {
      for (const mode of ["ask", "auto", "full"] as const) {
        const result = decideBotAct({ raw: { method, path }, mode, scopes: ["client", "admin"], neededScope: client });
        expect(result).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("Connect a Perspicax profile to this bot") });
      }
    }
  });

  it("refuses an internal path, a testing path, and an internal frame", () => {
    expect(decideBotAct({ raw: { method: "GET", path: "/api/internal/agents" }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { method: "POST", path: "/api/testing/internal-capability" }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { method: "GET", path: "/api/bots/../admin" }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { ui: "hydrate" }, mode: "full", scopes: ["admin"], neededScope: client })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a member an admin route and runs a route they may read", () => {
    const refused = decideBotAct({ raw: { method: "POST", path: "/api/admin/settings" }, mode: "full", scopes: ["client"], neededScope: client });
    expect(refused).toMatchObject({ ok: false, status: 403 });
    const allowed = decideBotAct({ raw: { method: "GET", path: "/api/bots", query: { section: "general" } }, mode: "ask", scopes: ["client"], neededScope: client });
    expect(allowed).toMatchObject({ ok: true, effect: "run", summary: "GET /api/bots" });
    if (allowed.ok && allowed.target.kind === "route") expect(allowed.target.query).toEqual({ section: "general" });
  });

  it("holds a write in ask and edits, and runs an ordinary write in full", () => {
    const held = decideBotAct({ raw: { method: "POST", path: "/api/bots", body: { name: "Ada" } }, mode: "ask", scopes: ["client"], neededScope: client });
    expect(held).toMatchObject({ ok: true, effect: "hold", summary: "POST /api/bots" });
    expect(decideBotAct({ raw: { method: "POST", path: "/api/bots", body: ["a"] }, mode: undefined, scopes: ["client"], neededScope: client })).toMatchObject({ effect: "hold" });
    expect(decideBotAct({ raw: { method: "DELETE", path: "/api/bots/b1" }, mode: "ask", scopes: ["admin", "client"], neededScope: client })).toMatchObject({ effect: "hold" });
    expect(decideBotAct({ raw: { method: "PATCH", path: "/api/bots/b1", body: { name: "Bea" } }, mode: "full", scopes: ["admin", "client"], neededScope: client })).toMatchObject({ effect: "run" });
    expect(decideBotAct({ raw: { method: "POST", path: "/api/bots" }, mode: "edits", scopes: ["client"], neededScope: client })).toMatchObject({ effect: "hold" });
  });

  it("runs a write on the person's own bots, tasks, routines and plugins in auto", () => {
    const auto = { mode: "auto" as const, scopes: ["client"] as const, neededScope: client };
    for (const raw of [
      { method: "POST", path: "/api/bots", body: { name: "Ada" } },
      { method: "PATCH", path: "/api/bots/b1", body: { name: "Bea" } },
      { method: "DELETE", path: "/api/bots/b1" },
      { method: "PATCH", path: "/api/bots/b1/runtime-settings", body: { model: "x" } },
      { method: "POST", path: "/api/routines", body: { name: "daily" } },
      { plugins: { action: "install", botId: "b1", marketplace: "acme-tools", plugin: "reviewer" } },
      { ui: "updateBot", input: { botId: "b1", patch: { name: "Bea" } } },
      { ui: "deleteRoutine", input: { routineId: "r1" } },
      { ui: "renameTask", input: { botId: "b1", threadId: "t1", title: "Notes" } },
    ]) {
      expect(decideBotAct({ raw, ...auto }), JSON.stringify(raw)).toMatchObject({ ok: true, effect: "run" });
    }
  });

  it("still holds a write in auto that reaches other people or leaves the person's environment", () => {
    const auto = { mode: "auto" as const, scopes: ["admin", "client"] as const, neededScope: client };
    for (const raw of [
      { method: "PATCH", path: "/api/bots/b1", body: { visibility: "everyone" } },
      { ui: "updateBot", input: { botId: "b1", patch: { visibility: { people: ["bob"] } } } },
      { ui: "newBot", input: { visibility: "everyone" } },
      { method: "PATCH", path: "/api/bots/b1", body: { teamMemorySharing: "shared" } },
      { method: "POST", path: "/api/bots/b1/vault-cards/m1/grant" },
      { method: "POST", path: "/api/bots/b1/slack-management" },
      { method: "POST", path: "/api/groups", body: { name: "team" } },
      { method: "POST", path: "/api/admin/settings" },
      { method: "POST", path: "/api/team-memory" },
      { ui: "sendGroup", input: { groupId: "g1", text: "hi" } },
      { ui: "openPeopleDm", input: { principalId: "pr_bob" } },
      { ui: "nudgePerson", input: { principalId: "pr_bob" } },
    ]) {
      expect(decideBotAct({ raw, ...auto }), JSON.stringify(raw)).toMatchObject({ ok: true, effect: "hold" });
    }
    // an escalation stays refused in auto
    expect(decideBotAct({ raw: { method: "PATCH", path: "/api/bots/b1", body: { alwaysAllow: { kinds: ["shell"] } } }, ...auto })).toMatchObject({ ok: false, status: 403 });
  });

  it("holds a write that widens team memory sharing even in full; narrowing to private runs", () => {
    const full = { mode: "full" as const, scopes: ["admin", "client"] as const, neededScope: client };
    for (const value of ["shared", "everyone", null, ""]) {
      expect(decideBotAct({ raw: { method: "PATCH", path: "/api/bots/b1", body: { teamMemorySharing: value } }, ...full }), String(value)).toMatchObject({ ok: true, effect: "hold" });
    }
    expect(decideBotAct({ raw: { ui: "updateBot", input: { botId: "b1", patch: { teamMemorySharing: "shared" } } }, ...full })).toMatchObject({ ok: true, effect: "hold" });
    expect(decideBotAct({ raw: { method: "PATCH", path: "/api/bots/b1", body: { teamMemorySharing: "private" } }, ...full })).toMatchObject({ ok: true, effect: "run" });
    expect(decideBotAct({ raw: { method: "PATCH", path: "/api/bots/b1", body: { teamMemorySharing: "shared" } }, mode: "auto", scopes: ["admin", "client"], neededScope: client })).toMatchObject({ effect: "hold" });
  });

  it("refuses a mode change or a card answer in every mode, including full", () => {
    const error = "act does not change approval levels, rules or grants, nor answer a card: use sagax_settings (bot.approvalMode, rules.*), which asks the person when it must.";
    const full = { mode: "full" as const, scopes: ["admin", "client"] as const, neededScope: client };
    expect(decideBotAct({ raw: { ui: "decideRequest", input: { threadId: "t2", requestId: "r1", behavior: "allow" } }, ...full })).toMatchObject({ ok: false, status: 403, error });
    expect(decideBotAct({ raw: { ui: "answerCard", input: { botId: "b1", messageId: "m1", answer: "yes" } }, ...full })).toMatchObject({ ok: false, status: 403, error });
    expect(decideBotAct({ raw: { method: "POST", path: "/api/threads/t2/respond", body: { behavior: "allow" } }, ...full })).toMatchObject({ ok: false, status: 403, error });
    expect(decideBotAct({ raw: { method: "POST", path: "/api/approvals/bulk", body: { decision: "allow", items: [{ threadId: "t2", requestId: "r1" }] } }, ...full })).toMatchObject({ ok: false, status: 403, error });
    expect(decideBotAct({ raw: { method: "PATCH", path: "/api/bots/b1/tasks/t2", body: { approvalMode: "full", confirmFullAccess: true } }, ...full })).toMatchObject({ ok: false, status: 403, error });
    expect(decideBotAct({ raw: { ui: "updateBot", input: { botId: "b1", patch: { approvalMode: "full" } } }, ...full })).toMatchObject({ ok: false, status: 403, error });
    expect(decideBotAct({ raw: { ui: "updateTask", input: { botId: "b1", threadId: "t2", patch: { confirmFullAccess: true } } }, ...full })).toMatchObject({ ok: false, status: 403, error });
    expect(decideBotAct({ raw: { method: "PATCH", path: "/api/bots/b1", query: { approvalMode: "full" } }, mode: "auto", scopes: ["admin", "client"], neededScope: client })).toMatchObject({ ok: false, status: 403, error });
  });

  it("runs a screen change and holds a screen write", () => {
    const screen = decideBotAct({ raw: { ui: "showTeamMap" }, mode: "ask", scopes: ["client"], neededScope: client });
    expect(screen).toMatchObject({ ok: true, effect: "run", summary: "Screen: showTeamMap" });
    const send = decideBotAct({
      raw: { ui: "send", input: { botId: "b1", text: "Hello", onError: () => undefined } },
      mode: "ask",
      scopes: ["client"],
      neededScope: client,
    });
    expect(send).toMatchObject({ ok: true, effect: "hold", summary: "Screen: send" });
    if (send.ok && send.target.kind === "ui") {
      expect(send.target.action).toEqual({ type: "send", botId: "b1", text: "Hello" });
      expect(send.target.action).not.toHaveProperty("onError");
    }
  });

  it("refuses both forms at once, a read with a body, and a prototype key", () => {
    expect(decideBotAct({ raw: { ui: "showChat", method: "GET", path: "/api/bots" }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: {}, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { method: "GET", path: "/api/bots", body: { a: 1 } }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { method: "GET", path: "/api/bots", query: { "__proto__": "x" } }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
    expect(decideBotAct({ raw: { ui: "playMascotMotion", input: { botId: "b1", kind: "none" } }, mode: "full", scopes: ["admin"], neededScope: client }).ok).toBe(false);
  });
});

describe("plugin act", () => {
  const decide = (plugins: Record<string, unknown>, mode: "ask" | "full" = "full") =>
    decideBotAct({ raw: { plugins }, mode, scopes: ["client"], neededScope: client });

  it("holds an install in ask mode and runs it in full", () => {
    const held = decide({ action: "install", botId: "scout", marketplace: "acme-tools", plugin: "reviewer" }, "ask");
    expect(held).toMatchObject({ ok: true, effect: "hold", summary: "POST /api/bots/scout/plugins/install" });
    if (held.ok && held.target.kind === "route") expect(held.target.body).toEqual({ marketplace: "acme-tools", plugin: "reviewer" });
    expect(decide({ action: "install", botId: "scout", marketplace: "acme-tools", plugin: "reviewer" })).toMatchObject({ effect: "run" });
  });

  it("runs a list immediately and maps the other plugin actions onto their routes", () => {
    expect(decide({ action: "list", botId: "scout" }, "ask")).toMatchObject({ effect: "run", summary: "GET /api/bots/scout/plugins" });
    expect(decide({ action: "addMarketplace", botId: "scout", source: "acme/tools", ref: "main" })).toMatchObject({
      effect: "run", target: { method: "POST", path: "/api/bots/scout/plugins/marketplaces", body: { source: "acme/tools", ref: "main" } },
    });
    const toggled = decide({ action: "setEnabled", botId: "scout", key: "reviewer@acme-tools", enabled: false }, "ask");
    expect(toggled).toMatchObject({ effect: "hold", target: { method: "PATCH", path: "/api/bots/scout/plugins/reviewer@acme-tools", body: { enabled: false } } });
    const removed = decide({ action: "uninstall", botId: "scout", key: "reviewer@acme-tools" });
    expect(removed).toMatchObject({ target: { method: "DELETE", path: "/api/bots/scout/plugins/reviewer@acme-tools" } });
    if (removed.ok && removed.target.kind === "route") expect(removed.target.body).toBeUndefined();
    expect(decide({ action: "removeMarketplace", botId: "scout", marketplace: "acme-tools" })).toMatchObject({
      target: { method: "DELETE", path: "/api/bots/scout/plugins/marketplaces/acme-tools" },
    });
  });

  it("refuses a bad action, an extra field, and a plugin action mixed with a route", () => {
    expect(decide({ action: "explode", botId: "scout" })).toMatchObject({ ok: false, status: 400 });
    expect(decide({ action: "list", botId: "scout", source: "acme/tools" }).ok).toBe(false);
    expect(decideBotAct({ raw: { plugins: { action: "list", botId: "scout" }, method: "GET", path: "/api/bots" }, mode: "full", scopes: ["client"], neededScope: client }).ok).toBe(false);
  });

  it("fills the current bot id when the model omits it, without mutating the call", () => {
    const raw = { plugins: { action: "list" } };
    const filled = fillPluginBot(raw, "scout");
    expect(raw).toEqual({ plugins: { action: "list" } });
    expect(decideBotAct({ raw: filled, mode: "ask", scopes: ["client"], neededScope: client })).toMatchObject({
      ok: true, effect: "run", summary: "GET /api/bots/scout/plugins",
    });
    expect(fillPluginBot({ plugins: { action: "list", botId: "other" } }, "scout")).toEqual({ plugins: { action: "list", botId: "other" } });
    expect(fillPluginBot({ plugins: { action: "list" } }, "../x")).toEqual({ plugins: { action: "list" } });
  });
});

describe("uiCommandToAction", () => {
  it("keeps a null person panel and drops callbacks", () => {
    expect(uiCommandToAction("openPersonPanel", { personId: null })?.action).toEqual({ type: "openPersonPanel", personId: null });
    expect(uiCommandToAction("deleteBot", { botId: "b1", onDeleted: true })).toEqual({
      action: { type: "deleteBot", botId: "b1" },
      write: true,
      input: { botId: "b1" },
    });
    expect(uiCommandToAction("messageAdded", {})).toBeNull();
    expect(uiCommandToAction("nudgePerson", { principalId: "pr_bob" })?.action).toEqual({ type: "nudgePerson", principalId: "pr_bob" });
  });
});

describe("nudgePerson", () => {
  it("is the nudge route, so the server runs it once as this person", () => {
    const decision = decideBotAct({
      raw: { ui: "nudgePerson", input: { principalId: "pr_bob" } },
      mode: "auto",
      scopes: ["client"],
      neededScope: () => "client",
    });
    expect(decision).toMatchObject({
      ok: true,
      effect: "hold",
      summary: "Nudge",
      target: { kind: "route", method: "POST", path: "/api/nudges", body: { principalId: "pr_bob" } },
    });
  });

  it("nudges a group chat through the same route, once", () => {
    const decision = decideBotAct({
      raw: { ui: "nudgeGroup", input: { groupId: "room-1" } },
      mode: "auto",
      scopes: ["client"],
      neededScope: () => "client",
    });
    expect(decision).toMatchObject({
      ok: true,
      effect: "hold",
      summary: "Nudge",
      target: { kind: "route", method: "POST", path: "/api/nudges", body: { groupId: "room-1" } },
    });
  });
});

describe("botActFrameAllowed", () => {
  it("matches the viewer's id, or the operator when the stream has none", () => {
    expect(botActFrameAllowed("p1", "p1", "operator")).toBe(true);
    expect(botActFrameAllowed("p1", "p2", "operator")).toBe(false);
    expect(botActFrameAllowed("operator", undefined, "operator")).toBe(true);
    expect(botActFrameAllowed("p1", undefined, "operator")).toBe(false);
  });
});

describe("security review: a bot never widens its own approvals through act", () => {
  const client = () => "client" as const;
  const refused = (raw: unknown) => {
    const decision = decideBotAct({ raw, mode: "full", scopes: ["admin", "client"], neededScope: client });
    return !decision.ok && decision.status === 403;
  };
  it("refuses standing grants, saved commands, rules, modes and keys", () => {
    expect(refused({ method: "POST", path: "/api/bots/b1/always-allow", body: { allowKey: "Bash", threadId: "t" } })).toBe(true);
    expect(refused({ method: "PATCH", path: "/api/bots/b1", body: { alwaysAllow: ["Bash"] } })).toBe(true);
    expect(refused({ method: "POST", path: "/api/bots/b1/command-allowlist", body: { command: "rm -rf /", cwd: "/", providerInstanceId: "x" } })).toBe(true);
    expect(refused({ method: "DELETE", path: "/api/bots/b1/command-allowlist/r1" })).toBe(true);
    expect(refused({ method: "PUT", path: "/api/bots/b1/permission-mode", body: { mode: "bypass" } })).toBe(true);
    expect(refused({ method: "POST", path: "/api/custom-rules", body: { when: "x", behavior: "allow", botId: null } })).toBe(true);
    expect(refused({ method: "DELETE", path: "/api/approval-rules/rule_1" })).toBe(true);
    expect(refused({ method: "PUT", path: "/api/security-keys/classes", body: { classes: [] } })).toBe(true);
    expect(refused({ method: "POST", path: "/api/bots/b1/tool-grants" })).toBe(true);
    expect(refused({ method: "PATCH", path: "/api/bots/b1/tasks/t1", body: { autoApprove: true } })).toBe(true);
    expect(refused({ method: "POST", path: "/api/threads/t1/messages", body: { stepUp: "x" } })).toBe(true);
  });
  it("still lets an ordinary write through to its card", () => {
    expect(refused({ method: "PATCH", path: "/api/bots/b1", body: { name: "New name" } })).toBe(false);
  });
});

describe("security review: no path trick or nesting gets past the guard", () => {
  const client = () => "client" as const;
  const ok = (raw: unknown) => decideBotAct({ raw, mode: "full", scopes: ["admin", "client"], neededScope: client }).ok;
  it("refuses a dot segment, an empty segment or a path the URL parser would change", () => {
    expect(ok({ method: "POST", path: "/api/./custom-rules", body: { when: "x", behavior: "allow", botId: null } })).toBe(false);
    expect(ok({ method: "POST", path: "/api/./security-keys/register", body: { name: "k" } })).toBe(false);
    expect(ok({ method: "PATCH", path: "/api/./approval-rules/rule_1", body: { behavior: "allow" } })).toBe(false);
    expect(ok({ method: "DELETE", path: "/api/approval-rules/./rule_1" })).toBe(false);
    expect(ok({ method: "POST", path: "/api/custom-rules/", body: { when: "x" } })).toBe(false);
    expect(ok({ method: "POST", path: "/api/%2e/custom-rules" })).toBe(false);
    expect(ok({ method: "POST", path: "/api\\custom-rules" })).toBe(false);
  });
  it("refuses a permission refresh and anything nested deeper than it reads", () => {
    expect(ok({ method: "PATCH", path: "/api/bots/b1/tasks/t1", body: { refreshPermissions: true } })).toBe(false);
    expect(ok({ ui: "refreshTaskPermissions", input: { botId: "b1", threadId: "t1" } })).toBe(false);
    let deep: Record<string, unknown> = { name: "x" };
    for (let i = 0; i < 12; i++) deep = { inner: deep };
    expect(ok({ method: "PATCH", path: "/api/bots/b1", body: deep })).toBe(false);
  });
});
