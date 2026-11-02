// @vitest-environment happy-dom
// 2026-11-01 (lot 2): WebhookEditor opens in the right DetailPanel, not a
// centred dialog. Escape closes it; there is no role="dialog" or backdrop.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import type { WebhookTrigger } from "@/lib/webhooks";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  dispatch: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
}));

const { setLocale } = await import("@/lib/i18n");
const { WebhookEditor } = await import("./WebhooksPanel");

const bot = {
  id: "scout", name: "Scout", hidden: false,
  modelSelection: { instanceId: "claude", model: "m" },
} as unknown as Bot;

const webhook = {
  id: "w1", endpointId: "ep-w1", name: "GitHub", prompt: "Triage it", botId: "scout",
  runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 0, tokenLast4: "k3Yz",
} as WebhookTrigger;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.state = {
    bots: [bot], webhooks: [webhook], webhookAttempts: [], routineRuns: [],
    webhookIngress: { available: true }, instances: [], config: null,
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("WebhookEditor DetailPanel", () => {
  it("renders in the detail panel without a dialog or backdrop", () => {
    const onClose = vi.fn();
    flushSync(() => root.render(createElement(WebhookEditor, {
      webhook, bots: [bot], onClose, onCredential: vi.fn(),
    })));
    expect(document.querySelector("[data-detail-panel]")).toBeTruthy();
    expect(document.querySelector("[data-webhook-editor-panel]")).toBeTruthy();
    expect(document.querySelector("[data-webhook-editor]")).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("[data-dialog-close]")).toBeNull();
    expect(document.body.textContent).toContain("Edit webhook");
    expect(document.body.textContent).toContain("Scout");
  });

  it("closes on Escape through the detail panel", () => {
    const onClose = vi.fn();
    flushSync(() => root.render(createElement(WebhookEditor, {
      webhook, bots: [bot], onClose, onCredential: vi.fn(),
    })));
    const panel = document.querySelector<HTMLElement>("[data-detail-panel]")!;
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes from the panel close button", () => {
    const onClose = vi.fn();
    flushSync(() => root.render(createElement(WebhookEditor, {
      webhook: undefined, bots: [bot], onClose, onCredential: vi.fn(),
    })));
    expect(document.body.textContent).toContain("New webhook");
    document.querySelector<HTMLButtonElement>("[data-detail-panel-close]")!.click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
