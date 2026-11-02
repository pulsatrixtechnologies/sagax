// A group's shared memory through the real server (isolated fixture): what
// its owner writes loads into the room turn of every bot of that group, and
// never into another group's turn or into the bot's own memory.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";

it("loads the group's memory into its room turns only", async () => {
  const fixture = await launchVerificationServer();
  const env = { SAGAX_URL: fixture.info.url };
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as { [key: string]: unknown };
    return { status: response.status, body: result };
  };
  const dump = () => {
    try {
      // SAFETY: the fake CLI writes exactly this shape; a missing or partial file reads as no dump yet
      return JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { systemPrompt?: string; prompt?: unknown };
    } catch {
      return undefined;
    }
  };
  const roomTurnFor = async (groupId: string, text: string, botId: string) => {
    await api("POST", `/api/groups/${groupId}/messages`, { text });
    await expect.poll(() => JSON.stringify(dump()?.prompt ?? "").includes(text), { timeout: 30_000 }).toBe(true);
    await runControlOmb(["wait", "--bot", botId, "--timeout", "30"], { env });
    return dump()?.systemPrompt ?? "";
  };
  try {
    // SAFETY: control-omb returns the created bot record under `bot`
    const { bot: lead } = await runControlOmb(["new-bot", "--name", "Lead"], { env }) as { bot: { id: string } };
    const created = await api("POST", "/api/groups", {
      name: "Garden room", memberIds: [lead.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    });
    const other = await api("POST", "/api/groups", {
      name: "Other room", memberIds: [lead.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: lead.id } },
    });
    const groupId = (created.body.group as { id: string }).id;
    const otherId = (other.body.group as { id: string }).id;

    const read = await api("GET", `/api/groups/${groupId}/memory`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ enabled: true, canEdit: true, text: "" });
    const saved = await api("PUT", `/api/groups/${groupId}/memory`, { text: "- 2026-10-01 · The garden is watered on Mondays\n", expectedHash: read.body.hash });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const inGroup = await roomTurnFor(groupId, "Lead, when is the garden watered?", lead.id);
    expect(inGroup).toContain('Group memory of "Garden room"');
    expect(inGroup).toContain("The garden is watered on Mondays");

    const elsewhere = await roomTurnFor(otherId, "Lead, anything new in this room?", lead.id);
    expect(elsewhere).not.toContain("The garden is watered on Mondays");

    // the owner switches it off: the next turn carries none of it
    expect((await api("PUT", `/api/groups/${groupId}/memory`, { enabled: false })).body).toMatchObject({ enabled: false });
    const off = await roomTurnFor(groupId, "Lead, and now?", lead.id);
    expect(off).not.toContain("The garden is watered on Mondays");

    // the bot's own memory never received the group's notes
    const own = await api("GET", `/api/bots/${lead.id}/memory/file`);
    expect(String(own.body.text ?? "")).not.toContain("The garden is watered on Mondays");

    // the memory goes with its group
    expect((await api("DELETE", `/api/groups/${groupId}`)).status).toBe(200);
    expect((await api("GET", `/api/groups/${groupId}/memory`)).status).toBe(404);
  } finally {
    await fixture.close();
  }
}, 180_000);

// A phone paired with a personal server reads and edits the room memory like
// its other room routes (Room info > Memory, iOS WP11): the session carries
// no principal, so the channel filter must not hide the operator's rooms.
it("serves the room memory to a paired phone on a personal server", async () => {
  const fixture = await launchVerificationServer();
  const env = { SAGAX_URL: fixture.info.url };
  const api = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as { [key: string]: unknown };
    return { status: response.status, body: result };
  };
  const pair = async (scopes: string[]) => {
    const opened = await api("POST", "/api/auth/pairing", { label: "phone", scopes });
    const paired = await api("POST", "/api/auth/pair", { code: opened.body.code, label: "iPhone" });
    return String(paired.body.token);
  };
  try {
    // SAFETY: control-omb returns the created bot record under `bot`
    const { bot: lead } = await runControlOmb(["new-bot", "--name", "Lead"], { env }) as { bot: { id: string } };
    const created = await api("POST", "/api/groups", { name: "Phone room", memberIds: [lead.id] });
    const groupId = (created.body.group as { id: string }).id;

    const admin = await pair(["admin", "client"]);
    const read = await api("GET", `/api/groups/${groupId}/memory`, undefined, admin);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({ canEdit: true, text: "" });
    const saved = await api("PUT", `/api/groups/${groupId}/memory`, { text: "- from the phone\n", expectedHash: read.body.hash }, admin);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    // a chat-only pairing reads it, the owner's edit stays refused
    const client = await pair(["client"]);
    const clientRead = await api("GET", `/api/groups/${groupId}/memory`, undefined, client);
    expect(clientRead.status, JSON.stringify(clientRead.body)).toBe(200);
    expect(clientRead.body).toMatchObject({ canEdit: false, text: "- from the phone\n" });
    expect((await api("PUT", `/api/groups/${groupId}/memory`, { enabled: false }, client)).status).toBe(403);
  } finally {
    await fixture.close();
  }
}, 180_000);
