// @vitest-environment happy-dom
// #3432: Settings, Notifications, « Ce que je reçois », and the bot page's
// « Ce que ce bot suit pour toi »: every row has its switch and acts at once
// (no confirmation), a row that cannot work is not drawn, labels only.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceiveView } from "../../../shared/proactive-choices";

const fixture = vi.hoisted(() => ({
  choices: {} as Record<string, unknown>,
  receive: null as unknown,
  calls: [] as Array<{ path: string; method: string; body?: unknown }>,
  dispatched: [] as unknown[],
}));

vi.mock("@/state/store", () => ({
  api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    fixture.calls.push({ path, method, body });
    if (path.startsWith("/api/me/proactive") && method === "GET") return { domains: fixture.choices, ...(fixture.receive ? { receive: fixture.receive } : {}) };
    if (path === "/api/me/proactive" && method === "PUT") {
      const next = { ...fixture.choices, [body.domain]: body.watch ? { state: "off", at: 1, via: "settings", by: "p", watchesOff: { [body.watch]: { at: 1, via: "settings" } } } : { state: body.state, ...(body.botId ? { botId: body.botId } : {}), at: 1, via: "settings", by: "p" } };
      fixture.choices = next;
      return { domains: next };
    }
    return {};
  }),
  useStore: () => ({
    state: { bots: [
      { id: "main-7f3a", name: "Mélodie", chiefOfStaff: true, proactiveMode: "proactive" },
      { id: "b1-9c2e", name: "Atlas", proactiveMode: "off" },
    ], config: null },
    dispatch: vi.fn(),
  }),
}));
vi.mock("@/state/store-selector", () => ({ useStoreDispatch: () => (action: unknown) => fixture.dispatched.push(action) }));

import { setLocale } from "@/lib/i18n";
import { BotFollowsRows } from "../bot-settings/BotFollowsRows";
import { ProactiveReceiveSettings, cadenceText, domainRows } from "./ProactiveReceiveSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const receive: ReceiveView = {
  bots: [{ id: "main-7f3a", brief: true, checklist: false }, { id: "b1-9c2e", brief: false, screen: true }],
  domains: [
    { domain: "backups", label: { fr: "Sauvegardes", en: "Backups" }, carriers: ["b1-9c2e"],
      watches: [{ id: "w-backup-failed", summary: "Failed backups", cadence: "1h", runsOn: ["b1-9c2e"] }] },
    { domain: "service", label: { fr: "Service", en: "Service desk" }, carriers: ["main-7f3a", "b1-9c2e"], lastAlertAt: Date.now() - 3 * 60_000,
      watches: [{ id: "w-open-tickets", summary: "Open tickets past due", cadence: "daily@08:00", runsOn: ["main-7f3a", "b1-9c2e"], lastAlertAt: Date.now() - 3 * 60_000 }] },
  ],
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  setLocale("en");
  fixture.choices = { service: { state: "on", botId: "main-7f3a", at: 1, via: "card", by: "p" }, backups: { state: "never", at: 1, via: "card", by: "p" } };
  fixture.receive = receive;
  fixture.calls = [];
  fixture.dispatched = [];
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

describe("« Ce que je reçois » (#3432)", () => {
  it("lists the eligible domains with their bot, watches and last alert, labels only", async () => {
    await render(createElement(ProactiveReceiveSettings));
    expect(fixture.calls[0]).toMatchObject({ path: "/api/me/proactive?view=all", method: "GET" });
    expect(row("receive.domain.service")?.textContent).toContain("Service desk");
    expect(switchOf("receive.domain.service")?.getAttribute("aria-checked")).toBe("true");
    expect(row("receive.domain.service")?.textContent).toContain("Last alert 3 min ago");
    // two bots can carry it: the picker offers only those, by name
    expect(row("receive.domain.service")?.querySelector('[aria-label="Bot that follows Service desk"]')).not.toBeNull();
    expect(row("receive.watch.w-open-tickets")?.textContent).toContain("Every day at 08:00");
    // a domain refused for good can still be turned on, and says so
    expect(switchOf("receive.domain.backups")?.getAttribute("aria-checked")).toBe("false");
    expect(row("receive.domain.backups")?.textContent).toContain("Never suggest again");
    // the brief, the screen and the checklist rows only where they work
    expect(row("receive.brief.main-7f3a")).not.toBeNull();
    expect(row("receive.brief.b1-9c2e")).not.toBeNull();
    expect(row("receive.screen.b1-9c2e")).not.toBeNull();
    expect(row("receive.screen.main-7f3a")).toBeNull();
    expect(row("receive.checklist.main-7f3a")).not.toBeNull();
    expect(row("receive.checklist.b1-9c2e")).toBeNull();
    // addressed to my bots: each bot's switch, and its direct triggers when on
    expect(switchOf("receive.addressed.main-7f3a")?.getAttribute("aria-checked")).toBe("true");
    expect(row("directTriggers.mail")).not.toBeNull();
    // never an identifier on screen
    expect(host.textContent).not.toMatch(/main-7f3a|b1-9c2e|w-open-tickets|w-backup-failed|daily@/);
  });

  it("each switch acts at once, with no confirmation", async () => {
    await render(createElement(ProactiveReceiveSettings));
    await act(async () => { switchOf("receive.domain.backups")!.click(); });
    expect(fixture.calls.at(-1)).toEqual({ path: "/api/me/proactive", method: "PUT", body: { domain: "backups", state: "on", botId: "b1-9c2e", via: "settings" } });
    expect(switchOf("receive.domain.backups")?.getAttribute("aria-checked")).toBe("true");
    await act(async () => { switchOf("receive.watch.w-open-tickets")!.click(); });
    expect(fixture.calls.at(-1)).toMatchObject({ method: "PUT", body: { domain: "service", watch: "w-open-tickets", on: false } });
    await act(async () => { switchOf("receive.brief.main-7f3a")!.click(); });
    expect(fixture.calls.at(-1)).toMatchObject({ path: "/api/bots/main-7f3a/background-brief", method: "PUT", body: { enabled: false } });
    await act(async () => { switchOf("receive.checklist.main-7f3a")!.click(); });
    // #3432: a plain switch on the brief's PUT, never the wake feedback (it leaves a memory line)
    expect(fixture.calls.at(-1)).toEqual(expect.objectContaining({ path: "/api/bots/main-7f3a/background-brief", method: "PUT", body: { checklist: true } }));
    expect(fixture.calls.some((call) => String(call.path).includes("/wake/feedback"))).toBe(false);
    await act(async () => { switchOf("receive.addressed.main-7f3a")!.click(); });
    expect(fixture.dispatched.at(-1)).toEqual({ type: "updateBot", botId: "main-7f3a", patch: { proactiveMode: "off" } });
    expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull();
  });

  it("draws nothing on a server without the view", async () => {
    fixture.receive = null;
    await render(createElement(ProactiveReceiveSettings));
    expect(host.innerHTML).toBe("");
  });

  it("the bot page lists the domains this bot can carry; a yes there moves the domain to it", async () => {
    const atlas = { id: "b1-9c2e", name: "Atlas" } as never;
    await render(createElement(BotFollowsRows, { bot: atlas }));
    expect(host.querySelector('[data-settings-group="botFollows"]')?.textContent).toContain("What this bot follows for you");
    expect(row("receive.domain.service")?.textContent).toContain("Followed by Mélodie");
    expect(switchOf("receive.domain.service")?.getAttribute("aria-checked")).toBe("false");
    await act(async () => { switchOf("receive.domain.service")!.click(); });
    expect(fixture.calls.at(-1)).toMatchObject({ method: "PUT", body: { domain: "service", state: "on", botId: "b1-9c2e" } });
    expect(switchOf("receive.domain.service")?.getAttribute("aria-checked")).toBe("true");
  });

  it("a paused domain says so, shows no carrier, and a yes moves it to the bot drawn", async () => {
    fixture.choices = {
      service: { state: "on", botId: "gone", at: 1, via: "card", by: "p" },
      backups: { state: "on", botId: "main-7f3a", at: 1, via: "card", by: "p" },
    };
    await render(createElement(ProactiveReceiveSettings));
    expect(switchOf("receive.domain.service")?.getAttribute("aria-checked")).toBe("false");
    expect(row("receive.domain.service")?.textContent).toContain("Paused: the bot that followed it can no longer do so");
    expect(row("receive.domain.service")?.textContent).not.toContain("Followed by");
    expect(row("receive.domain.service")?.querySelector('[aria-label="Bot that follows Service desk"]')).toBeNull();
    expect(row("receive.domain.backups")?.textContent).toContain("Paused: Mélodie can no longer follow it");
    expect(row("receive.domain.backups")?.textContent).not.toContain("Followed by");
    await act(async () => { switchOf("receive.domain.service")!.click(); });
    expect(fixture.calls.at(-1)).toEqual({ path: "/api/me/proactive", method: "PUT", body: { domain: "service", state: "on", botId: "main-7f3a", via: "settings" } });
    expect(switchOf("receive.domain.service")?.getAttribute("aria-checked")).toBe("true");
    act(() => root.unmount());
    root = createRoot(host);
    // the carrier's bot page: never "Followed by" a bot that cannot carry it
    await render(createElement(BotFollowsRows, { bot: { id: "b1-9c2e", name: "Atlas" } as never }));
    expect(row("receive.domain.backups")?.textContent).not.toContain("Followed by Mélodie");
    expect(row("receive.domain.backups")?.textContent).toContain("Paused: Mélodie can no longer follow it");
  });

  it("the main bot's page does not draw a domain it cannot carry", async () => {
    await render(createElement(BotFollowsRows, { bot: { id: "main-7f3a", name: "Mélodie" } as never }));
    expect(row("receive.domain.service")).not.toBeNull();
    expect(row("receive.domain.backups")).toBeNull();
  });
});

describe("receive rows", () => {
  it("a domain stored on with a bot that can no longer carry it is drawn off, paused, and a yes goes to one that can", () => {
    const rows = domainRows({ choices: { service: { state: "on", botId: "gone", at: 1, via: "card", by: "p" } }, receive });
    const service = rows.find((entry) => entry.domain === "service");
    expect(service).toMatchObject({ on: false, pausedOn: "gone", botId: "main-7f3a" });
    // the bot page of a carrier: off there too, never "on" with a bot nothing runs on
    expect(domainRows({ choices: { service: { state: "on", botId: "gone", at: 1, via: "card", by: "p" } }, receive }, "b1-9c2e").find((entry) => entry.domain === "service")).toMatchObject({ on: false, pausedOn: "gone" });
  });

  it("reads the cadence in words, never the raw value", () => {
    setLocale("en");
    expect(cadenceText("15m")).toBe("Every 15 min");
    expect(cadenceText("1h")).toBe("Every hour");
    expect(cadenceText("120m")).toBe("Every 2 hours");
    expect(cadenceText("weekly:sun@07:30")).toBe("Every Sunday at 07:30");
    expect(cadenceText("whenever")).toBe("");
  });
});
