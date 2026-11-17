// @vitest-environment happy-dom
// The bot's webhooks row leads to the right page: a webhook of its own to
// the Routines page's Webhooks tab (the page is named Routines, #4591), a
// routine's webhook to that routine.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({
    state: {
      bots: [], routines: [{ id: "r1", name: "New order", botId: "scout" }], webhookAttempts: [], routineRuns: [], webhookIngress: { available: true }, instances: [], config: null,
      webhooks: [
        { id: "w1", endpointId: "e1", name: "GitHub", prompt: "", botId: "scout", runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 1, tokenLast4: "k3Yz", routineId: "r1" },
        { id: "w2", endpointId: "e2", name: "Monitor", prompt: "", botId: "scout", runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 1, tokenLast4: "k3Yz" },
      ],
    },
    dispatch: fixture.dispatch,
  }),
}));
import { BotWebhooks } from "./BotWebhooks";

const bot = { id: "scout", name: "Scout", ownerUserId: "owner@example.test", modelSelection: { instanceId: "claude", model: "m" } } as unknown as Bot;

describe("regression #4591: the bot's webhooks row after the Routines rename", () => {
  it("a webhook of its own opens the Routines page on Webhooks, a routine's webhook opens its routine", async () => {
    setLocale("en");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(BotWebhooks, { bot })));
    const own = host.querySelector<HTMLButtonElement>('[data-open-webhook-home="automations"]')!;
    expect(own.textContent).toBe("Open in Routines");
    await act(async () => own.click());
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "showRoutines", section: "webhooks" });
    await act(async () => host.querySelector<HTMLButtonElement>('[data-open-webhook-home="routine"]')!.click());
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "openRoutine", botId: "scout", routineId: "r1" });
    await act(async () => root.unmount());
    host.remove();
  });
});
