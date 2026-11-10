// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import type { Bot, Task } from "@/state/store";
import { connectorsCount, connectorsData } from "./connectors";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const record = {
  at: 1,
  connectors: [
    { name: "Mail", source: "claude", state: "connected" },
    { name: "Drive", source: "claude", state: "reconnect" },
    { name: "grok.com", source: "grok", state: "connected" },
    { name: "workshop", source: "perspicax", state: "connected" },
    { name: "notes", source: "personal", state: "connected" },
    { name: "github", source: "server", state: "connected" },
    { name: "review", source: "plugin", state: "connected" },
  ],
};
const bot = { id: "dev", threadId: "t1", mcpServers: null } as unknown as Bot;
const task = { threadId: "t1", connectors: record } as unknown as Task;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("connectors card", () => {
  it("reads what the turn reached, every source, not the app-wide server list", () => {
    const data = connectorsData({ bot, task }, [{ name: "linear", enabled: true }]);
    expect(data?.configured).toBe(false);
    expect(data?.connectors.map((row) => row.source)).toEqual(["claude", "claude", "grok", "perspicax", "personal", "server", "plugin"]);
    expect(data?.connectors.some((row) => row.name === "linear")).toBe(false);
    expect(connectorsCount(data!)).toBe(7);
  });

  it("falls back to the bot's set servers before any recorded turn, and says so", () => {
    const data = connectorsData({ bot, task: { threadId: "t1" } as Task }, [{ name: "github", enabled: true }, { name: "off", enabled: false }, { name: "docs", enabled: true, auth: "expired" }]);
    expect(data).toEqual({ configured: true, claudeAccount: false, hub: [], connectors: [
      { name: "github", source: "server", state: "connected" },
      { name: "docs", source: "server", state: "reconnect" },
    ] });
  });

  it("groups rows by source, shows the state, and links to Connect Apps", async () => {
    const dispatch = vi.fn();
    await act(async () => {
      const { devPodDefinitions } = await import("../registry");
      const pod = devPodDefinitions().find((entry) => entry.id === "connectors")!;
      root.render(createElement(pod.Body, { data: connectorsData({ bot, task }, null)!, ctx: { bot, task, messages: [], threadKey: "dev:t1", computerStart: undefined, dispatch } }));
    });
    // the one to reconnect is never hidden behind Show more
    expect(container.querySelector('[data-connector="Drive"]')!.getAttribute("data-connector-state")).toBe("reconnect");
    expect([...container.querySelectorAll("[data-connector-source]")].map((node) => node.getAttribute("data-connector-source")))
      .toEqual(["claude", "grok", "perspicax", "personal", "server"]);
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-connectors-more]")!.click(); });
    expect(container.querySelector('[data-connector-source="plugin"]')).not.toBeNull();
    expect(container.textContent).toContain(t("devPods.connectors.grokAccount"));
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-connector-reconnect]")!.click(); });
    expect(dispatch).toHaveBeenCalledWith({ type: "togglePlugins", open: true, botId: "dev" });
  });

  // #3357: the connectors this conversation called through call_connector, with their counters
  it("shows the conversation's call_connector counters, even with no mounted connector", async () => {
    const hub = [
      { provider: "grok-com", name: "Mail", calls: 3, errors: 1, warm: 2, input: 360, output: 36, at: 9, last: "error" },
      { provider: "chatgpt-apps", name: "Drive", calls: 1, errors: 0, warm: 0, input: 0, output: 0, at: 8, last: "ok" },
    ];
    const hubTask = { threadId: "t1", connectors: { at: 9, connectors: [], hub } } as unknown as Task;
    const data = connectorsData({ bot, task: hubTask }, null)!;
    expect(data.hub.map((row) => row.name)).toEqual(["Mail", "Drive"]);
    expect(connectorsCount(data)).toBe(2);
    await act(async () => {
      const { devPodDefinitions } = await import("../registry");
      const pod = devPodDefinitions().find((entry) => entry.id === "connectors")!;
      root.render(createElement(pod.Body, { data, ctx: { bot, task: hubTask, messages: [], threadKey: "dev:t1", computerStart: undefined, dispatch: vi.fn() } }));
    });
    const mail = container.querySelector('[data-connector-hub-row="Mail"]')!;
    expect(mail.getAttribute("data-connector-hub-last")).toBe("error");
    expect(mail.textContent).toContain(t("devPods.connectors.hub.calls", { count: "3" }));
    expect(mail.textContent).toContain(t("devPods.connectors.hub.errors", { count: "1" }));
    expect(mail.textContent).toContain(t("devPods.connectors.hub.warm", { count: "2" }));
    expect(mail.textContent).toContain(t("devPods.connectors.hub.provider.grokCom"));
    const drive = container.querySelector('[data-connector-hub-row="Drive"]')!;
    expect(drive.textContent).not.toContain(t("devPods.connectors.hub.warm", { count: "0" }));
  });
});
