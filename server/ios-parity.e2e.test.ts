// The iOS parity server routes against a real isolated server (no model
// calls, no live data): the look at creation, instructionsLead, the
// profile's Links/Files/export, Settings > Bot with the auto-review default,
// the rules list, remote input without a computer, the computer status, the
// personal session and account answers, plugins, pinned rooms, and what a
// chat-only paired phone may and may not change.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

let fixture: VerificationServer;
let url: string;

async function api(method: string, path: string, body?: unknown, status = 200, token?: string): Promise<any> {
  const response = await fetch(url + path, {
    method,
    headers: { origin: url, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  expect(response.status, `${method} ${path}: ${text.slice(0, 400)}`).toBe(status);
  return result;
}

beforeAll(async () => {
  fixture = await launchVerificationServer();
  url = fixture.info.url;
}, 60_000);
afterAll(async () => { await fixture?.close(); });

describe("iOS parity routes on a personal server", () => {
  it("creates a bot with its look and serves its lead, links, files and template", async () => {
    const look = { character: "shape", shape: "cloud", skins: { shape: "pastel" } };
    const { bot } = await api("POST", "/api/bots", {
      name: "Parity Scout", settings: { color: "teal" }, mascotLook: look, mascotSkin: "frost",
      modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
    }, 201);
    expect(bot).toMatchObject({ color: "teal", mascotLook: look, mascotSkin: "frost" });

    await api("POST", "/api/mcp/servers", { name: "vault", type: "http", url: "https://mcp.example.test/mcp", headers: { Authorization: "Bearer sekrit-parity-123" } }, 201);
    await api("PATCH", `/api/bots/${bot.id}`, { mcpServers: ["vault"] });
    const patched = await api("PATCH", `/api/bots/${bot.id}`, { soul: "\n## Research lead\nFind primary sources.", notifications: false, avatarZoom: 1.25 });
    expect(patched.bot).toMatchObject({ instructionsLead: "Research lead", notifications: false, avatarZoom: 1.25 });
    const listed = (await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id);
    expect(listed.instructionsLead).toBe("Research lead");

    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "Read [the spec](https://example.test/spec) and https://docs.example.test/a." }, 202);
    await expect.poll(async () => (await api("GET", `/api/bots/${bot.id}/links`)).links.map((link: any) => link.url), { timeout: 15_000 })
      .toEqual(expect.arrayContaining(["https://example.test/spec", "https://docs.example.test/a"]));
    const links = await api("GET", `/api/bots/${bot.id}/links?limit=1`);
    expect(links).toMatchObject({ total: 2, nextCursor: "1" });
    expect(links.links[0]).toMatchObject({ threadId: bot.threadId, domain: expect.any(String) });
    expect(await api("GET", `/api/bots/${bot.id}/files?kind=media`)).toMatchObject({ files: [], nextCursor: null });
    await api("GET", `/api/bots/${bot.id}/files?kind=other`, undefined, 400);

    const exported = await api("POST", `/api/bots/${bot.id}/export`);
    expect(exported.document).toMatchObject({ version: 2 });
    expect(JSON.stringify(exported)).not.toContain("sekrit-parity-123");
    expect(JSON.stringify(exported.document)).toContain("Parity Scout");

    const installed = await api("GET", "/api/plugins/installed");
    expect(installed.plugins).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "mcp", name: "vault", domain: "mcp.example.test" })]));
    expect(JSON.stringify(installed)).not.toContain("sekrit");
  });

  it("keeps Settings > Bot for the server and opens reviewed conversations when auto-review is on", async () => {
    const { bot } = await api("POST", "/api/bots", { name: "Review Scout", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }, 201);
    expect((await api("GET", "/api/settings/bot")).settings).toEqual({ autoReviewDefault: false, timeZone: null, timeZoneAuto: true });
    await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" });
    const before = (await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Before" }, 201)).task;
    // #1207: no copy of the level; the thread follows its Ask bot, live
    expect(before.approvalMode).toBeUndefined();
    expect(before.approvalOwn).toBeUndefined();
    const saved = await api("PUT", "/api/settings/bot", { autoReviewDefault: true, timeZone: "America/Toronto", timeZoneAuto: false });
    expect(saved).toMatchObject({ scope: "server", effectiveTimeZone: "America/Toronto" });
    await api("PUT", "/api/settings/bot", { timeZone: "Nowhere/Land" }, 400);
    const after = (await api("POST", `/api/bots/${bot.id}/tasks`, { title: "After" }, 201)).task;
    // #4200: a conversation runs at its bot's level; the auto-review
    // default writes no level of its own on it
    expect(after.approvalMode).toBeUndefined();
    expect(after.approvalOwn).toBeUndefined();
    await api("PUT", "/api/settings/bot", { autoReviewDefault: false });
    expect(await api("GET", "/api/auto-review/rules")).toEqual({ rules: [], global: [], total: 0 });
  });

  it("answers the computer, session and account routes for this computer", async () => {
    const { bot } = await api("POST", "/api/bots", { name: "Desk Scout" }, 201);
    const noComputer = await api("POST", `/api/bots/${bot.id}/computer/input`, { events: [{ type: "move", dx: 1, dy: 1 }] }, 404);
    expect(noComputer.code).toBe("no_computer");
    await api("POST", `/api/bots/${bot.id}/computer/input`, { events: [{ type: "exec", command: "id" }] }, 400);
    const status = await api("GET", "/api/computer/status");
    expect(status).toMatchObject({ kind: "local", diskState: expect.stringMatching(/^(normal|almostFull|full)$/) });
    await api("POST", "/api/computer/reset", {}, 400);

    const session = await api("GET", "/api/auth/session");
    expect(session).toMatchObject({ kind: "loopback", name: expect.any(String), computerName: expect.any(String) });
    expect(session.email).toBeUndefined();
    expect((await api("DELETE", "/api/me", { confirm: true }, 400)).code).toBe("personal_server");
  });

  it("pins a room, and holds a chat-only phone to display fields", async () => {
    const { bot } = await api("POST", "/api/bots", { name: "Room Scout" }, 201);
    const { group } = await api("POST", "/api/groups", { name: "Pinned room", memberIds: [bot.id] }, 201);
    expect((await api("PATCH", `/api/groups/${group.id}`, { pinned: true })).group.pinned).toBe(true);
    expect((await api("GET", "/api/bots")).groups.find((room: any) => room.id === group.id).pinned).toBe(true);

    const pairing = await api("POST", "/api/auth/pairing", { label: "Chat-only phone", scopes: ["client"] });
    const { token } = await api("POST", "/api/auth/pair", { code: pairing.code });
    expect((await api("PATCH", `/api/bots/${bot.id}`, { avatarZoom: 2, avatarFocusX: 0.4, pinned: true }, 200, token)).bot).toMatchObject({ avatarZoom: 2, pinned: true });
    await api("PATCH", `/api/bots/${bot.id}`, { soul: "not mine" }, 403, token);
    await api("PATCH", `/api/bots/${bot.id}`, { notifications: false }, 403, token);
    await api("GET", `/api/bots/${bot.id}/soul`, undefined, 403, token);
    await api("POST", `/api/bots/${bot.id}/avatar/generate`, { prompt: "an owl" }, 403, token);
    await api("POST", `/api/bots/${bot.id}/export`, undefined, 403, token);
    await api("GET", `/api/bots/${bot.id}/links`, undefined, 200, token);
    await api("PUT", "/api/settings/bot", { autoReviewDefault: true }, 403, token);
    await api("GET", "/api/settings/bot", undefined, 200, token);
    await api("GET", "/api/computer/status", undefined, 403, token);
    await api("POST", "/api/plugins/install", { id: "notion" }, 403, token);
    await api("GET", "/api/auto-review/rules", undefined, 403, token);
    await api("POST", `/api/bots/${bot.id}/computer/input`, { events: [{ type: "move", dx: 1, dy: 1 }] }, 403, token);
    expect((await api("PATCH", `/api/groups/${group.id}`, { pinned: false }, 200, token)).group.pinned).toBeUndefined();
    await api("PATCH", `/api/groups/${group.id}`, { cwd: "/" }, 403, token);
  });

  // iOS feature parity S2 and the Overview gate: a client session reaches
  // these routes, and each handler lets through only the bot's owner or this
  // computer's own person. A chat-only pairing (nobody behind it) is neither.
  it("holds the owner routes of a client session to the owner", async () => {
    const { bot } = await api("POST", "/api/bots", { name: "Owner Scout" }, 201);
    const chatOnly = await api("POST", "/api/auth/pair", { code: (await api("POST", "/api/auth/pairing", { label: "Chat-only phone", scopes: ["client"] })).code });
    const admin = await api("POST", "/api/auth/pair", { code: (await api("POST", "/api/auth/pairing", { label: "Admin phone", scopes: ["admin", "client"] })).code });

    // #1223: the overview refusal has its own code (it was not_bot_owner)
    expect((await api("GET", `/api/bots/${bot.id}/overview`, undefined, 403, chatOnly.token)).code).toBe("bot_activity_owner_only");
    expect(await api("GET", `/api/bots/${bot.id}/overview`, undefined, 200, admin.token)).toMatchObject({ does: expect.anything() });
    await api("GET", `/api/bots/${bot.id}/overview`);

    await api("GET", `/api/bots/${bot.id}/command-allowlist`, undefined, 403, chatOnly.token);
    await api("DELETE", `/api/bots/${bot.id}/command-allowlist/rule-1`, undefined, 403, chatOnly.token);
    await api("POST", `/api/bots/${bot.id}/command-allowlist`, { command: "ls" }, 403, chatOnly.token);
    expect(await api("GET", `/api/bots/${bot.id}/command-allowlist`, undefined, 200, admin.token)).toMatchObject({ rules: expect.any(Array) });

    expect((await api("POST", "/api/plugins/install", { id: "notion" }, 403, chatOnly.token)).error).toMatch(/owner/);
    // the voice engine stays an admin-scope write for a session
    await api("PUT", "/api/tts/provider", { provider: "fish" }, 403, chatOnly.token);
    await api("PUT", "/api/tts/provider", { provider: "elevenlabs" }, 200, admin.token);
  });
});
