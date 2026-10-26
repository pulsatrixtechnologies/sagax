// Six consecutive "Go to conversation" receipts (Timesheets / Sales /
// Agreements, each twice) must draw as one grouped chip in the 1:1 chat.
// This file imports ChatView only, so the same test fails on main (six
// separate lines) and passes once collapseGotoLines is wired.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import { setLocale } from "@/lib/i18n";

setLocale("fr");

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  const bot = (id: string, name: string, color: string, threadId: string): Bot => ({
    id, threadId, name, color, title: "", description: "", notifications: true,
    unread: false, busy: false, messages: [],
    modelSelection: { instanceId: "test", model: "m" },
    tasks: [{ threadId, title: "General", createdAt: 1 }, { threadId: `th-${id}`, title: name, createdAt: 2 }],
  } as Bot);
  return { ...original, useStore: () => ({
    state: {
      ...original.initialState,
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo],
      bots: [
        bot("bot", "Pepper", "green", "t1"),
        bot("ts", "Timesheets", "blue", "ts-main"),
        bot("sales", "Sales", "green", "sales-main"),
        bot("ag", "Agreements", "orange", "ag-main"),
      ],
    },
    dispatch: vi.fn(),
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => createElement("span") }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  // These cases exercise threads-on chip grouping (ThreadChip now hides
  // receipts when threads are off; see ThreadChip.test.ts).
  useShowThreads: () => true,
}));

const { ChatView } = await import("./ChatView");
afterAll(() => {
  setLocale("en");
  vi.unstubAllGlobals();
});

const at = new Date(2026, 9, 13, 16, 42).getTime();
const receipt = (id: string, botId: string, name: string, offset: number): Message => ({
  id,
  role: "bot",
  kind: "activity",
  at: at + offset,
  tool: { name: `Opened thread #${name}`, ok: true },
  threadRef: { botId, threadId: `th-${botId}`, title: name },
} as Message);

const pepper = (messages: Message[]): Bot => ({
  id: "bot", threadId: "t1", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages,
  modelSelection: { instanceId: "test", model: "m" },
} as Bot);

describe("ChatView go-to grouping", () => {
  it("folds six consecutive Aller à la conversation lines into one chip of three agents", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, {
      bot: pepper([
        { id: "u", role: "user", kind: "text", text: "Fais le point sur les feuilles de temps et les ententes", at } as Message,
        receipt("g1", "ts", "Timesheets", 1),
        receipt("g2", "sales", "Sales", 2),
        receipt("g3", "ag", "Agreements", 3),
        receipt("g4", "sales", "Sales", 4),
        receipt("g5", "ag", "Agreements", 5),
        receipt("g6", "ts", "Timesheets", 6),
        { id: "s", role: "bot", kind: "text", text: "Voici le résumé.", at: at + 7 } as Message,
      ]),
    }));
    expect(markup).toContain("Fais le point sur les feuilles de temps et les ententes");
    expect(markup).toContain("Voici le résumé.");
    // Compact snapshot: on main this is six separate lines; on the branch, one chip.
    expect({
      goToLines: (markup.match(/Aller à la conversation/g) ?? []).length,
      groupChips: (markup.match(/data-testid="goto-group-chip"/g) ?? []).length,
      threadChips: (markup.match(/data-thread-chip=/g) ?? []).length,
      groupedLabel: /3 conversations avec/.test(markup),
      agentsLabel: /3 agents/.test(markup),
    }).toEqual({
      goToLines: 0,
      groupChips: 1,
      threadChips: 0,
      groupedLabel: true,
      agentsLabel: true,
    });
  });
});
