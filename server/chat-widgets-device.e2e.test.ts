// 2026-11-02, through a real server on an isolated fixture: a press on a
// widget button that opens a place in Sagax (open_page) is recorded as the
// person's message, marked done, and starts no turn: the model is never
// asked to open a page it cannot reach.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { removeTempDir } from "./testing/cleanup.ts";

it("records an in-app press as done and runs no turn", async () => {
  const gates = mkdtempSync(join(tmpdir(), "omb-widget-device-"));
  const gate = join(gates, "finish");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate, FAKE_CLAUDE_VERSION: "2.1.270" });
  const api = async (method: string, path: string, body?: unknown, expected = 200, token?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    expect(response.status, JSON.stringify(result)).toBe(expected);
    return result;
  };
  const dump = () => JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
  try {
    const bot = (await api("POST", "/api/bots", { name: "Scout" }, 201)).bot;
    const busy = async () => (await api("GET", "/api/bots?messages=0")).bots.find((candidate: any) => candidate.id === bot.id).busy;
    const transcript = async (): Promise<any[]> => (await api("GET", `/api/threads/${bot.threadId}/messages`)).messages;
    await runControlOmb(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "How are the routines?", "--url", fixture.info.url]);
    let token = "";
    await expect.poll(() => {
      try { token = dump().mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; } catch { return false; }
      return Boolean(token);
    }, { timeout: 15_000 }).toBe(true);
    const card = await api("POST", "/api/internal/options-card", { tool: "show_widget", widget: {
      type: "Card", title: "Fleet routines",
      children: [{ type: "Text", value: "18 of 30 on" }, { type: "Button", label: "Open the routine board", onClickAction: { type: "open_page", payload: { page: "routines" } } }],
    } }, 201, token);
    writeFileSync(gate, "finish");
    await expect.poll(busy, { timeout: 15_000 }).toBe(false);
    const turnsBefore = (await transcript()).filter((message) => message.kind === "digest").length;
    const ref = (await transcript()).find((message) => message.id === card.messageId).widget.root.children[1].id;

    const press = { threadId: bot.threadId, sendId: "device-press-0001", widgetAction: { messageId: card.messageId, ref, rev: 0 } };
    const first = await api("POST", `/api/bots/${bot.id}/messages`, press, 202);
    expect(first).toMatchObject({ ok: true, device: true, message: { role: "user", text: "Open the routine board", replyToId: card.messageId, deviceAction: { type: "open_page" } } });
    // a retry of the same press is the same message
    expect(await api("POST", `/api/bots/${bot.id}/messages`, press, 200)).toMatchObject({ device: true, message: { id: first.message.id } });
    expect(await busy()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const after = await transcript();
    expect(after.filter((message) => message.kind === "digest").length).toBe(turnsBefore);
    expect(after.filter((message) => message.role === "user" && message.deviceAction)).toHaveLength(1);
    expect(after.find((message) => message.id === card.messageId).widget.settled).toBeUndefined();
  } finally {
    await fixture.close();
    await removeTempDir(gates);
  }
}, 90_000);
