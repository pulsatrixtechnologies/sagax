// Apple apps On in Plugins > This Mac reach the person's bots on an
// organization server, whatever the engine or the computer the turn works on:
// the calls are relayed to the Mac through the desktop app, and an offline Mac
// keeps the tools listed with a clear error (2026-11-06). Mocks only: no real
// Calendar, Contacts, Messages or TCC prompt is touched.
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopBridges, DESKTOP_BRIDGE_MESSAGES, type DesktopBridgeOperation, type DesktopBridgeRegistration } from "./desktop-bridge.ts";
import { MAC_OFFLINE_MESSAGE, relayMacAppCall } from "./desktop-bridge-tools.ts";
import { handleMessagesMcp, type MessagesMcpDeps } from "../imessage/imessage-mcp.ts";
import { createMountUserSandbox } from "../index-leaves/mountUserSandbox.ts";

const ADA = "ada@example.com";
const secret = "a".repeat(64);
const registration = (name = "Ada's Mac"): DesktopBridgeRegistration => ({
  id: randomUUID(), name, platform: "darwin", attachmentsDir: "/var/folders/x/T/Sagax/attachments",
  capabilities: { shell: true, files: true, fetch: true, browser: true, computer: false, localVm: true, macApps: true },
});

describe("the server remembers the Apple apps On on the person's Mac", () => {
  it("keeps the list while the Mac is offline, across a reconnect and a server restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "sagax-mac-apps-")), "desktop-mac-apps.json");
    const sessions = new Map([["ada-session", ADA]]);
    const bridges = new DesktopBridges((session) => sessions.get(session) ?? null, Date.now, undefined, file);
    const desktop = registration();
    bridges.register(desktop, "ada-session", secret);
    expect(bridges.setMacApps(desktop.id, "ada-session", secret, ["calendar", "notes", "bogus", "contacts", "reminders", "messages", "mail"]))
      .toEqual(["messages", "mail", "calendar", "contacts", "reminders", "notes"]);
    bridges.disconnect(desktop.id, "ada-session", secret);
    expect(bridges.connected(ADA)).toBe(false);
    expect(bridges.macAppsOn(ADA)).toEqual(["messages", "mail", "calendar", "contacts", "reminders", "notes"]);
    expect(bridges.macAppsOn("bob@example.com")).toEqual([]);
    // A reconnect takes a new desktop id: same computer, same list.
    const again = registration();
    bridges.register(again, "ada-session", secret);
    bridges.setMacApps(again.id, "ada-session", secret, ["calendar"]);
    expect(bridges.macAppsOn(ADA)).toEqual(["calendar"]);
    const restarted = new DesktopBridges((session) => sessions.get(session) ?? null, Date.now, undefined, file);
    expect(restarted.macAppsOn(ADA)).toEqual(["calendar"]);
  });

  it("refuses a report from a desktop that is not the session's", () => {
    const bridges = new DesktopBridges((session) => (session === "ada-session" ? ADA : null));
    const desktop = registration();
    bridges.register(desktop, "ada-session", secret);
    expect(() => bridges.setMacApps(desktop.id, "ada-session", "b".repeat(64), ["calendar"])).toThrow();
    expect(bridges.macAppsOn(ADA)).toEqual([]);
  });
});

describe("a mac_* call relayed to the person's Mac", () => {
  it("returns the Mac's answer, and a clear error when the Mac is offline or its app is old", async () => {
    const seen: DesktopBridgeOperation[] = [];
    const done = await relayMacAppCall(async (operation) => { seen.push(operation); return { content: [{ type: "text", text: "2 events" }] }; }, "mac_calendar_list", { from: "2026-11-06", to: "2026-11-07" });
    expect(done).toEqual({ content: [{ type: "text", text: "2 events" }] });
    expect(seen[0]).toMatchObject({ action: "mac_app", tool_name: "mac_calendar_list" });
    const offline = await relayMacAppCall(async () => { throw Object.assign(new Error(DESKTOP_BRIDGE_MESSAGES.offline), { status: 409, code: "not_connected" }); }, "mac_calendar_list", {});
    expect(offline).toEqual({ content: [{ type: "text", text: MAC_OFFLINE_MESSAGE }], isError: true });
    const old = await relayMacAppCall(async () => ({ content: [{ type: "text", text: "Unsupported operation" }], isError: true }), "mac_notes_search", { query: "x" });
    expect(old.isError).toBe(true);
    expect(old.content[0]).toMatchObject({ text: expect.stringContaining("too old") });
  });
});

describe("the messages MCP on an organization server (relay)", () => {
  const relayDeps = (run: NonNullable<MessagesMcpDeps["macApps"]>["run"], unasked = true, cards: unknown[] = []): MessagesMcpDeps => ({
    host: { platform: "linux", identityKind: "perspicax" },
    useMessages: false,
    dbDir: null,
    sender: { send: async () => { throw new Error("no local send on an organization server"); } },
    botId: "bot",
    threadId: "thread",
    openCard: (pending) => { cards.push(pending); },
    allowedRecipients: [],
    macApps: { enabled: (app) => ["calendar", "contacts", "reminders", "notes", "messages"].includes(app), run, unasked, relay: { person: ADA } },
  });

  it("lists the tools of every app On, whatever the engine or computer, and never the local chat.db tools", async () => {
    const listed = await handleMessagesMcp({ method: "tools/list" }, relayDeps(async () => ({ content: [] }))) as { result: { tools: { name: string }[] } };
    const names = listed.result.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["mac_calendar_list", "mac_calendar_create", "mac_contacts_search", "mac_reminders_list", "mac_notes_search", "mac_messages_read", "mac_messages_send"]));
    expect(names.every((name) => name.startsWith("mac_"))).toBe(true);
    expect(names.some((name) => name.startsWith("mac_mail_"))).toBe(false);
  });

  it("relays a call to the Mac, and keeps the tool with a clear error when the Mac is offline", async () => {
    // A real hub with no desktop connected: the person's Mac is offline.
    const bridges = new DesktopBridges(() => null);
    const run = ((tool: string, args: Record<string, unknown>) => relayMacAppCall((operation) => bridges.request(ADA, operation, () => true), tool, args)) as NonNullable<MessagesMcpDeps["macApps"]>["run"];
    const deps = relayDeps(run);
    const listed = await handleMessagesMcp({ method: "tools/list" }, deps) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map((tool) => tool.name)).toContain("mac_calendar_list");
    const called = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_calendar_list", arguments: {} } }, deps) as { result: { content: { text: string }[]; isError?: boolean } };
    expect(called.result.isError).toBe(true);
    expect(called.result.content[0]!.text).toBe(MAC_OFFLINE_MESSAGE);
    const relayed: string[] = [];
    const online = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_reminders_list", arguments: {} } }, relayDeps(async (tool) => { relayed.push(tool); return { content: [{ type: "text", text: "ok" }] }; })) as { result: { content: { text: string }[] } };
    expect(online.result.content[0]!.text).toBe("ok");
    expect(relayed).toEqual(["mac_reminders_list"]);
  });

  it("stages a card for a write in Ask mode, carrying the person to relay to", async () => {
    const cards: Array<{ macApp?: { person?: string } }> = [];
    const runs: string[] = [];
    const deps = relayDeps(async (tool) => { runs.push(tool); return { content: [] }; }, false, cards);
    const asked = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_messages_send", arguments: { to: "+15145550100", text: "hi" } } }, deps) as { result: { content: { text: string }[] } };
    expect(asked.result.content[0]!.text).toContain("approval card");
    expect(cards[0]!.macApp?.person).toBe(ADA);
    expect(runs).toEqual([]);
  });
});

describe("mounting the messages MCP for an organization turn", () => {
  const host = (kind: string, on: string[]) => {
    const minted: unknown[][] = [];
    return {
      minted,
      host: {
        IDENTITY: { kind },
        turnWorkplaces: new Map(),
        desktopBridges: { macAppsOn: () => on },
        messagesIntegration: (...args: unknown[]) => { minted.push(args); return { name: "messages" }; },
      },
    };
  };
  const input = (principal: string | null) => ({ botId: "bot", threadId: "thread", generation: "g1", customMcp: false, decision: { principal, target: "auto" }, staging: undefined });

  it("mounts it for any engine or computer when an app is On, and not otherwise", () => {
    const org = host("perspicax", ["calendar"]);
    const integrations: Record<string, unknown> = {};
    createMountUserSandbox(() => org.host)(integrations, input(ADA));
    expect(integrations.messages).toEqual({ name: "messages" });
    expect(org.minted).toEqual([["bot", "thread", "g1", ADA]]);
    const none = host("perspicax", []);
    const empty: Record<string, unknown> = {};
    createMountUserSandbox(() => none.host)(empty, input(ADA));
    expect(empty.messages).toBeUndefined();
    const solo = host("solo", ["calendar"]);
    const soloIntegrations: Record<string, unknown> = {};
    createMountUserSandbox(() => solo.host)(soloIntegrations, input(ADA));
    expect(soloIntegrations.messages).toBeUndefined();
  });
});
