// 2026-11-02: a widget button that names a place in Sagax (open_page,
// open_routine, open_run) is opened on the device; the press is recorded for
// the bot as done and never asks the model to do it.
import { describe, expect, it, vi } from "vitest";

import { parseWidgetInput, resolveWidgetAction, widgetActions, widgetAppAction } from "../shared/widget.ts";
import { createAgentCard, prepareWidgetPress, type AgentCardStore } from "./chat-widgets.ts";
import { transcriptText } from "./replies.ts";
import type { Message } from "./store.ts";

const THREAD = "thread-scout";

function fakeStore() {
  const rows: Message[] = [];
  let next = 1;
  const store: AgentCardStore = {
    groupByThread: () => undefined,
    messagesFor: () => rows,
    appendMessage: vi.fn((_threadId: string, message: Omit<Message, "id" | "at">): Message => {
      const full = { ...message, id: `m${next++}`, at: 1 } as Message;
      rows.push(full);
      return full;
    }),
    patchMessage: vi.fn((_threadId: string, id: string, patch: Partial<Message>) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return null;
      rows[index] = { ...rows[index]!, ...patch };
      return rows[index]!;
    }),
  };
  return { store, rows };
}

const board = {
  type: "Card", title: "Fleet routines",
  children: [
    { type: "Text", value: "18 of 30 on" },
    { type: "Button", label: "Open the routine board", onClickAction: { type: "open_page", payload: { page: "routines" } } },
    { type: "Button", label: "Open last run", onClickAction: { type: "open_run", payload: { runId: "run-1", routineId: "r-1" } } },
    { type: "Button", label: "Pause all", onClickAction: { type: "routines.pause" } },
  ],
  confirm: { label: "Looks good", action: { type: "ok" } },
};

describe("in-app widget actions", () => {
  it("parses the three in-app actions and refuses an unknown page or a missing id", () => {
    const parsed = parseWidgetInput(board);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const entries = widgetActions(parsed.value);
    expect(entries.find((entry) => entry.label === "Open the routine board")).toMatchObject({ client: true });
    expect(entries.find((entry) => entry.label === "Open last run")).toMatchObject({ client: true });
    expect(entries.find((entry) => entry.label === "Pause all")?.client).toBeUndefined();
    expect(widgetAppAction({ type: "open_routine", payload: { routineId: "r-1" } })).toEqual({ type: "open_routine", routineId: "r-1" });
    expect(parseWidgetInput({ type: "Card", children: [{ type: "Button", label: "Go", onClickAction: { type: "open_page", payload: { page: "billing" } } }] }))
      .toMatchObject({ ok: false, error: expect.stringContaining("open_page needs {page}") });
    expect(parseWidgetInput({ type: "Card", children: [{ type: "Button", label: "Go", onClickAction: { type: "open_run", payload: {} } }] }))
      .toMatchObject({ ok: false, error: expect.stringContaining("open_run needs {runId") });
  });

  it("records the press as done: no settle, the device action named, even once the widget is answered", () => {
    const fake = fakeStore();
    const shown = createAgentCard({ store: fake.store, bot: { id: "b", name: "Scout", color: "blue" }, threadId: THREAD, input: { tool: "show_widget", widget: board } });
    if (!shown.ok) throw new Error(shown.error);
    const row = fake.rows.find((message) => message.id === shown.messageId)!;
    const ref = widgetActions(row.widget!.root).find((entry) => entry.label === "Open the routine board")!.ref;
    const press = prepareWidgetPress(fake.store, THREAD, { messageId: row.id, ref }, "send-1");
    expect(press).toMatchObject({ ok: true, text: "Open the routine board", settles: false, device: { type: "open_page", page: "routines" } });
    // an answered widget still opens its places
    const settled = { ...row.widget!, settled: { ref: "confirm", label: "Looks good", tone: "confirm" as const, at: 2 } };
    expect(resolveWidgetAction(settled, ref, undefined)).toMatchObject({ ok: true, device: { type: "open_page" } });
    // a button with an action of the bot's own is still a message to it
    const pause = widgetActions(row.widget!.root).find((entry) => entry.label === "Pause all")!.ref;
    expect(prepareWidgetPress(fake.store, THREAD, { messageId: row.id, ref: pause }, undefined)).not.toHaveProperty("device");
  });

  it("tells the model the place is already open, so it does not try again", () => {
    const widget: Message = { id: "w1", at: 1, role: "bot", kind: "widget", text: "Fleet routines" };
    const press: Message = { id: "u1", at: 2, role: "user", kind: "text", text: "Open the routine board", replyToId: "w1", deviceAction: { type: "open_page" } };
    const line = transcriptText(press, new Map([["w1", widget]]));
    expect(line).toContain("their device opened it (open_page)");
    expect(line).toContain("Already done");
  });
});
