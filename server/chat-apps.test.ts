import { describe, expect, it, vi } from "vitest";

import { APP_LIMITS } from "../shared/app.ts";
import type { MausColor } from "../shared/wire.ts";
import { createAgentCard, type AgentCardStore } from "./chat-widgets.ts";
import type { Message } from "./store.ts";

const THREAD = "thread-scout";
const ROOM = "thread-room";
const SCOUT: { id: string; name: string; color: MausColor } = { id: "bot-scout", name: "Scout", color: "blue" };
const OTHER: { id: string; name: string; color: MausColor } = { id: "bot-other", name: "Other", color: "green" };
// A shape shared/redact.ts recognises: an Anthropic key.
const API_KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwx";

function fakeStore(rooms: string[] = []) {
  const threads = new Map<string, Message[]>();
  const rows = (threadId: string) => threads.get(threadId) ?? threads.set(threadId, []).get(threadId)!;
  let next = 1;
  const appendMessage = vi.fn((threadId: string, message: Omit<Message, "id" | "at">): Message => {
    const full: Message = { ...message, id: `m${next++}`, at: 1 };
    rows(threadId).push(full);
    return full;
  });
  const patchMessage = vi.fn((threadId: string, messageId: string, patch: Partial<Message>): Message | null => {
    const list = rows(threadId);
    const index = list.findIndex((message) => message.id === messageId);
    if (index === -1) return null;
    list[index] = { ...list[index], ...patch };
    return list[index];
  });
  const store: AgentCardStore = {
    groupByThread: (threadId) => (rooms.includes(threadId) ? { id: "room-1" } : undefined),
    messagesFor: rows,
    appendMessage,
    patchMessage,
  };
  return { store, rows, appendMessage, patchMessage };
}

type Fake = ReturnType<typeof fakeStore>;

function showHtml(fake: Fake, input: Record<string, unknown>, bot = SCOUT, threadId = THREAD) {
  return createAgentCard({ store: fake.store, bot, threadId, input: { tool: "show_html", ...input } });
}
function updateHtml(fake: Fake, input: Record<string, unknown>, bot = SCOUT, threadId = THREAD) {
  return createAgentCard({ store: fake.store, bot, threadId, input: { tool: "update_html", ...input } });
}
const rowOf = (fake: Fake, id: string, threadId = THREAD): Message => fake.rows(threadId).find((m) => m.id === id)!;

describe("show_html", () => {
  it("posts an app row with its html, a title and a text fallback, and no from", () => {
    const fake = fakeStore();
    const result = showHtml(fake, { html: "<h1>Rapport</h1><p>Live</p>", title: "Rapport" });
    expect(result).toEqual({ ok: true, messageId: "m1" });
    const [threadId, appended] = fake.appendMessage.mock.calls[0];
    expect(threadId).toBe(THREAD);
    expect(Object.keys(appended).sort()).toEqual(["app", "kind", "role", "text"]);
    expect(appended).not.toHaveProperty("from");
    const message = rowOf(fake, "m1");
    expect(message).toMatchObject({ role: "bot", kind: "app" });
    expect(message.app).toEqual({ v: 1, html: "<h1>Rapport</h1><p>Live</p>", title: "Rapport" });
    expect(message.text).toBe("[app] Rapport");
  });

  it("marks the row authored so the calling turn is not fed its own output", () => {
    const fake = fakeStore();
    const authored = vi.fn();
    const result = createAgentCard({ store: fake.store, bot: SCOUT, threadId: THREAD, input: { tool: "show_html", html: "<p>x</p>" }, authored });
    expect(result.ok).toBe(true);
    expect(authored).toHaveBeenCalledWith("m1");
  });

  it("refuses empty or malformed html before storing anything", () => {
    const fake = fakeStore();
    expect(showHtml(fake, { html: "" })).toEqual({ ok: false, status: 400, error: expect.any(String) });
    expect(showHtml(fake, { html: "   " }).ok).toBe(false);
    expect(showHtml(fake, {}).ok).toBe(false);
    expect(showHtml(fake, { html: 42 }).ok).toBe(false);
    expect(fake.appendMessage).not.toHaveBeenCalled();
  });

  it("refuses html past the byte limit", () => {
    const fake = fakeStore();
    const result = showHtml(fake, { html: "a".repeat(APP_LIMITS.htmlBytes + 1) });
    expect(result.ok).toBe(false);
    expect(fake.appendMessage).not.toHaveBeenCalled();
  });

  it("scrubs a secret out of the page and says it masked something", () => {
    const fake = fakeStore();
    const result = showHtml(fake, { html: `<pre>API_KEY=${API_KEY}</pre>` });
    expect(result).toEqual({ ok: true, messageId: "m1", masked: true });
    expect(rowOf(fake, "m1").app!.html).not.toContain(API_KEY);
  });

  it("is refused in a room", () => {
    const fake = fakeStore([ROOM]);
    const result = showHtml(fake, { html: "<p>x</p>" }, SCOUT, ROOM);
    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
  });
});

describe("update_html", () => {
  it("replaces the page in place and bumps the revision (a live update)", () => {
    const fake = fakeStore();
    showHtml(fake, { html: "<p>0%</p>", title: "Progress" });
    const result = updateHtml(fake, { app_id: "m1", html: "<p>50%</p>" });
    expect(result).toEqual({ ok: true, messageId: "m1" });
    const message = rowOf(fake, "m1");
    expect(message.app).toEqual({ v: 1, html: "<p>50%</p>", rev: 1 });
    expect(message.text).toBe("[app] 50%");
    // a second update keeps counting
    updateHtml(fake, { app_id: "m1", html: "<p>100%</p>" });
    expect(rowOf(fake, "m1").app!.rev).toBe(2);
    // one row only: the surface was replaced, not appended
    expect(fake.rows(THREAD).filter((m) => m.kind === "app")).toHaveLength(1);
  });

  it("refuses an unknown app id with 404", () => {
    const fake = fakeStore();
    expect(updateHtml(fake, { app_id: "nope", html: "<p>x</p>" })).toEqual({ ok: false, status: 404, error: expect.any(String) });
  });

  it("refuses a missing app_id with 400", () => {
    const fake = fakeStore();
    expect(updateHtml(fake, { html: "<p>x</p>" })).toEqual({ ok: false, status: 400, error: expect.any(String) });
  });

  it("will not let another bot replace the surface", () => {
    const fake = fakeStore();
    fake.rows(THREAD).push({ id: "m1", at: 1, role: "bot", kind: "app", text: "[app]", app: { v: 1, html: "<p>x</p>" }, from: { botId: SCOUT.id } } as Message);
    const result = updateHtml(fake, { app_id: "m1", html: "<p>y</p>" }, OTHER);
    expect(result).toEqual({ ok: false, status: 404, error: expect.any(String) });
  });

  it("refuses empty replacement html", () => {
    const fake = fakeStore();
    showHtml(fake, { html: "<p>x</p>" });
    expect(updateHtml(fake, { app_id: "m1", html: "" }).ok).toBe(false);
  });
});
