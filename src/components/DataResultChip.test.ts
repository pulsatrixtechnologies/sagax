// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";
import { groupTranscript, isStatusActivity } from "@/lib/activity-runs";
import { activityPreview, failedTurnCause } from "@/lib/failed-turn";
import { roomActivityVisible } from "@/lib/room-activity";

const dispatch = vi.fn();
const fixture = vi.hoisted(() => ({ dataWindow: true }));
const store = vi.hoisted(() => ({
  state: {
    bots: [{ id: "bot", name: "Pepper" }],
    config: { features: { dataWindow: true as boolean } },
    dataSheets: {} as Record<string, unknown>,
  },
}));
const openDataWindow = vi.hoisted(() => vi.fn(async () => "created"));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: store.state, dispatch }) }));
vi.mock("@/lib/data-window", () => ({ openDataWindow }));
vi.mock("./data/DataChart", () => ({
  DataChart: (props: { botId: string; cardId: string; spec: unknown; inline?: boolean }) =>
    createElement("div", { "data-testid": "data-chart", "data-card": props.cardId, "data-inline": String(props.inline), "data-spec": JSON.stringify(props.spec) }),
}));
import { DataResultChip } from "./DataResultChip";

// As the server stores it: the tool that ran, with the card's title only in dataResult.
const message: Message = { id: "receipt", at: 1, role: "bot", kind: "activity", tool: { name: "data_show", ok: true },
  dataResult: { botId: "bot", cardId: "c_1", title: "Revenue", kind: "chart" } };
const stackedBar = { mark: { type: "bar", orient: "vertical" }, encoding: { x: { field: "x" }, x2: { field: "x2" }, y: { field: "y" }, color: { field: "color" } } };
const chartCard = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "chart", title: "Weekly revenue by plan", sql: "SELECT 1", result: "r_1", rowCount: 24, status: "ready", vegaLite: stackedBar,
  by: "bot", createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z", ...extra,
});
const sheet = (botId: string, cards: unknown[]) => ({ version: 1, botId, cards, sources: [], updatedAt: "2026-10-27T00:00:00Z" });
const receipt = (botId: string, cardId: string, kind: "chart" | "table" = "chart", sql?: string): Message =>
  ({ ...message, id: `${botId}:${cardId}`, dataResult: { botId, cardId, title: "Weekly revenue by plan", kind, ...(sql ? { sql } : {}) } });
function mount(...messages: Message[]) {
  const container = document.createElement("div");
  const root = createRoot(container);
  flushSync(() => root.render(messages.map((entry) => createElement(DataResultChip, { key: entry.id, message: entry }))));
  return { container, rerender: () => flushSync(() => root.render(messages.map((entry) => createElement(DataResultChip, { key: entry.id, message: entry })))), unmount: () => root.unmount() };
}

describe("a chart result in the chat", () => {
  it("draws the chart in the message itself, with its SQL hidden until the title is tapped", () => {
    dispatch.mockClear();
    store.state.bots = [{ id: "bot", name: "Pepper" }, { id: "inline", name: "Inline" }];
    store.state.config.features.dataWindow = true;
    store.state.dataSheets = { inline: sheet("inline", [chartCard("c_7")]) };
    const sql = "SELECT date_trunc('week', date) AS week, plan, sum(revenue_usd) AS revenue FROM signups GROUP BY ALL";
    const { container, unmount } = mount(receipt("inline", "c_7", "chart", sql));
    try {
      const chart = container.querySelector<HTMLElement>("[data-testid=inline-data-chart] [data-testid=data-chart]");
      expect(chart, "the chart is in the message").not.toBeNull();
      expect(chart!.dataset.card).toBe("c_7");
      expect(chart!.dataset.inline).toBe("true");
      expect(JSON.parse(chart!.dataset.spec!)).toEqual(stackedBar);
      expect(container.querySelector("[data-testid=inline-data-chart]")!.getAttribute("aria-label")).toBe("Weekly revenue by plan");
      expect(container.querySelector("pre"), "no SQL until asked").toBeNull();
      expect(container.textContent).not.toContain("SELECT");
      const title = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
      flushSync(() => title.click());
      expect(container.querySelector("pre code")!.textContent).toBe(sql);
      expect(container.querySelector("[data-testid=data-chart]")).not.toBeNull();
      expect(dispatch).not.toHaveBeenCalled();
    } finally { unmount(); }
  });

  it("loads the bot's sheet once for every receipt that needs it, and waits in place", () => {
    dispatch.mockClear();
    store.state.bots = [{ id: "loading-bot", name: "Loading" }];
    store.state.dataSheets = {};
    const { container, unmount } = mount(receipt("loading-bot", "c_1"), receipt("loading-bot", "c_2"));
    try {
      expect(dispatch.mock.calls.map(([action]) => [action.type, action.botId])).toEqual([["loadDataSheet", "loading-bot"]]);
      expect(container.querySelectorAll("[data-testid=inline-data-chart] [role=status]")).toHaveLength(2);
    } finally { unmount(); }
  });

  it("shows only the receipt for a table, a chart that is gone, a failed one or a sheet that cannot be read", () => {
    dispatch.mockClear();
    store.state.bots = [{ id: "plain", name: "Plain" }];
    store.state.dataSheets = { plain: sheet("plain", [chartCard("c_failed", { status: "failed" }), { ...chartCard("c_table"), kind: "table", vegaLite: undefined }]) };
    const { container, unmount } = mount(receipt("plain", "c_table", "table"), receipt("plain", "c_gone"), receipt("plain", "c_failed"));
    try {
      expect(container.querySelectorAll("[data-data-result]")).toHaveLength(3);
      expect(container.querySelector("[data-testid=inline-data-chart]")).toBeNull();
      expect(dispatch).not.toHaveBeenCalled();
    } finally { unmount(); }
    store.state.bots = [{ id: "unreadable", name: "Unreadable" }];
    store.state.dataSheets = {};
    dispatch.mockImplementationOnce((action: { onError: (message: string) => void }) => action.onError("Data tools are unavailable"));
    const failed = mount(receipt("unreadable", "c_1"));
    try {
      failed.rerender();
      expect(failed.container.querySelector("[data-testid=inline-data-chart]")).toBeNull();
      expect(failed.container.textContent).toContain("Weekly revenue by plan");
    } finally { failed.unmount(); dispatch.mockReset(); }
  });
});

describe("Data result receipt", () => {
  it("expands only the recorded SQL without opening the viewer", () => {
    dispatch.mockClear();
    openDataWindow.mockClear();
    store.state.bots = [{ id: "bot", name: "Pepper" }];
    store.state.config.features.dataWindow = true;
    store.state.dataSheets = { bot: sheet("bot", [chartCard("c_1")]) };
    const container = document.createElement("div");
    const root = createRoot(container);
    const sql = "SELECT region, sum(revenue) AS revenue FROM orders GROUP BY region";
    try {
      flushSync(() => root.render(createElement(DataResultChip, { message: { ...message, dataResult: { ...message.dataResult!, sql } } })));
      const disclosure = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
      expect(disclosure.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector("pre")).toBeNull();
      flushSync(() => disclosure.click());
      expect(disclosure.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector("pre code")!.textContent).toBe(sql);
      expect(container.querySelector("pre")!.parentElement!.id).toBe(disclosure.getAttribute("aria-controls"));
      expect(openDataWindow).not.toHaveBeenCalled();
      container.querySelectorAll("button").forEach((button) => {
        if (!button.hasAttribute("aria-expanded")) button.click();
      });
      expect(openDataWindow).toHaveBeenCalledWith({ botId: "bot", title: "Data: Pepper", cardId: "c_1" });
      flushSync(() => disclosure.click());
      expect(container.querySelector("pre")).toBeNull();
    } finally { root.unmount(); }
  });

  it("opens the exact result, and a table result draws nothing in the chat", () => {
    store.state.bots = [{ id: "bot", name: "Pepper" }];
    store.state.config.features.dataWindow = true;
    store.state.dataSheets = { bot: sheet("bot", [chartCard("c_1")]) };
    const tableMessage: Message = { ...receipt("bot", "c_1", "table"), dataResult: { botId: "bot", cardId: "c_1", title: "Revenue", kind: "table" } };
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      flushSync(() => root.render(createElement(DataResultChip, { message: tableMessage })));
      expect(container.textContent).toContain("Revenue");
      expect(container.textContent).toContain("Open in Data");
      expect(container.querySelector("[data-testid=inline-data-chart]")).toBeNull();
      container.querySelector("button")!.click();
      expect(openDataWindow).toHaveBeenCalledWith({ botId: "bot", title: "Data: Pepper", cardId: "c_1" });
      expect(dispatch).not.toHaveBeenCalled();
      flushSync(() => root.render(createElement(DataResultChip, { message: { ...message, dataResult: { ...message.dataResult!, botId: "deleted" } } })));
      expect(container.querySelectorAll("button")[container.querySelectorAll("button").length - 1]!.disabled).toBe(true);
      vi.stubGlobal("ogb", { remoteClient: { active: true } });
      flushSync(() => root.render(createElement(DataResultChip, { message })));
      expect(container.querySelectorAll("button")[container.querySelectorAll("button").length - 1]!.disabled).toBe(true);
      expect(container.querySelectorAll("button")[container.querySelectorAll("button").length - 1]!.title).toContain("companion");
    } finally { root.unmount(); vi.unstubAllGlobals(); }
  });

  it("cannot open anything while the experimental Data window is off", () => {
    openDataWindow.mockClear();
    store.state.bots = [{ id: "bot", name: "Pepper" }];
    store.state.config.features.dataWindow = false;
    store.state.dataSheets = { bot: sheet("bot", [chartCard("c_1")]) };
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      flushSync(() => root.render(createElement(DataResultChip, { message })));
      const open = [...container.querySelectorAll("button")].find((button) => !button.hasAttribute("aria-expanded"))!;
      expect(open.disabled).toBe(true);
      expect(open.title).toContain("Experimental");
      open.click();
      expect(openDataWindow).not.toHaveBeenCalled();
    } finally { root.unmount(); store.state.config.features.dataWindow = true; }
  });

  it("is never read as a status row, a failed turn or a bare tool name, whatever the result is called", () => {
    store.state.bots = [{ id: "bot", name: "Pepper" }];
    store.state.dataSheets = { bot: sheet("bot", [chartCard("c_1")]) };
    const titled = (title: string): Message => ({ ...message, dataResult: { ...message.dataResult!, title } });
    for (const title of ["notice: revenue by region", "error: rows with no region", "stopped: deliveries", "recovery: Q3"]) {
      const titledReceipt = titled(title);
      expect(isStatusActivity(titledReceipt)).toBe(false);
      expect(failedTurnCause(titledReceipt.tool!.name)).toBeNull();
      expect(activityPreview(titledReceipt.tool!, undefined, titledReceipt.dataResult)).toBe(title);
      const container = document.createElement("div");
      const root = createRoot(container);
      try {
        flushSync(() => root.render(createElement(DataResultChip, { message: titledReceipt })));
        expect(container.querySelector("[data-data-result='c_1']")!.textContent).toContain(title);
      } finally { root.unmount(); }
    }
    expect(activityPreview({ name: "Read file", ok: true }, undefined)).toBe("Read file");
  });

  it("stays visible with tool calls hidden and outside folded tool runs", () => {
    expect(roomActivityVisible(message, false)).toBe(true);
    const ordinary = { ...message, dataResult: undefined };
    const grouped = groupTranscript([{ ...ordinary, id: "a" }, { ...ordinary, id: "b" }, message]);
    expect(grouped.map((item) => item.kind)).toEqual(["run", "message"]);
  });
});
