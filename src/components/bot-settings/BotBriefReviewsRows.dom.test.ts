// @vitest-environment happy-dom
// #5445: the bot page's review switches (same keys as More notifications used).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  choices: {} as Record<string, unknown>,
  receive: null as unknown,
  calls: [] as Array<{ path: string; method: string; body?: unknown }>,
}));

vi.mock("@/state/store", () => ({
  api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    fixture.calls.push({ path, method, body });
    if (path.startsWith("/api/me/proactive") && method === "GET") {
      return { domains: fixture.choices, ...(fixture.receive ? { receive: fixture.receive } : {}) };
    }
    return {};
  }),
  useStore: () => ({ state: { bots: [{ id: "main-7f3a", name: "Mélodie" }], config: null }, dispatch: vi.fn() }),
}));
vi.mock("@/state/store-selector", () => ({ useStoreDispatch: () => vi.fn() }));

import { setLocale } from "@/lib/i18n";
import { BotReviewRows } from "./BotBriefReviewsRows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  setLocale("en");
  fixture.choices = {};
  fixture.receive = {
    bots: [{ id: "main-7f3a", brief: true, endOfDay: false, weekly: true }, { id: "other", brief: false }],
    domains: [],
  };
  fixture.calls = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(node: Parameters<typeof root.render>[0]) {
  await act(async () => { root.render(node); });
  await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
}

const row = (id: string) => host.querySelector<HTMLElement>(`[data-settings-row="${id}"]`);
const switchOf = (id: string) => row(id)?.querySelector<HTMLButtonElement>('button[role="switch"]') ?? null;

describe("BotReviewRows (#5445)", () => {
  it("shows and toggles the reviews this bot holds; same PUT as before", async () => {
    await render(createElement(BotReviewRows, { botId: "main-7f3a", botName: "Mélodie" }));
    expect(row("receive.endOfDay.main-7f3a")?.textContent).toContain("End of day");
    expect(row("receive.weekly.main-7f3a")?.textContent).toContain("Weekly review");
    expect(switchOf("receive.endOfDay.main-7f3a")?.getAttribute("aria-checked")).toBe("false");
    expect(switchOf("receive.weekly.main-7f3a")?.getAttribute("aria-checked")).toBe("true");
    // brief stays on BackgroundBriefCard, not duplicated here
    expect(row("receive.brief.main-7f3a")).toBeNull();
    await act(async () => { switchOf("receive.endOfDay.main-7f3a")!.click(); });
    expect(fixture.calls.at(-1)).toMatchObject({
      path: "/api/bots/main-7f3a/background-brief",
      method: "PUT",
      body: { reviews: { endOfDay: true } },
    });
    expect(typeof (fixture.calls.at(-1)!.body as { timeZone?: unknown }).timeZone).toBe("string");
  });

  it("draws nothing when this bot holds no review", async () => {
    await render(createElement(BotReviewRows, { botId: "other", botName: "Atlas" }));
    expect(host.querySelector("[data-bot-review-rows]")).toBeNull();
  });
});
