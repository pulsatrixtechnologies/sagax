// @vitest-environment happy-dom
// #3480: quiet mode on the screens. The bot page's switch (first row of
// « Ce que ce bot suit pour toi ») reads and writes the bot route, the
// switch for all the person's bots (Settings, Notifications, « Ce que je
// reçois ») marks each bot's switch, the page shows the state without
// opening anything, and a bot that is not the person's gets no switch.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotQuietState, PersonQuietView } from "../../../shared/quiet-mode";

const fixture = vi.hoisted(() => ({
  view: null as PersonQuietView | null,
  calls: [] as Array<{ path: string; method: string; body?: unknown }>,
}));

const state = (botId: string, bot: boolean, all: boolean): BotQuietState => ({ botId, bot, all, quiet: bot || all, kept: { runs: 0, problems: 0 } });

vi.mock("@/state/store", () => ({
  api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    fixture.calls.push({ path, method, body });
    const view = fixture.view!;
    if (path === "/api/me/quiet" && method === "GET") return view;
    if (path === "/api/me/quiet" && method === "PUT") {
      fixture.view = { all: body.on, bots: view.bots.map((row) => state(row.botId, row.bot, body.on)) };
      return { ...fixture.view, said: "Done" };
    }
    const bot = /^\/api\/bots\/([^/]+)\/quiet$/.exec(path)?.[1];
    if (bot && method === "PUT") {
      const next = state(decodeURIComponent(bot), body.on, view.all);
      fixture.view = { ...view, bots: view.bots.map((row) => (row.botId === next.botId ? next : row)) };
      return { ...next, said: "Done" };
    }
    // no proactive domains in these tests
    return {};
  }),
  useStore: () => ({
    state: { bots: [{ id: "mine-7f3a", name: "Atlas" }, { id: "theirs-2b1c", name: "Nova" }], config: null },
    dispatch: vi.fn(),
  }),
}));
vi.mock("@/state/store-selector", () => ({ useStoreDispatch: () => vi.fn() }));

import { setLocale } from "@/lib/i18n";
import { resetQuietModeForTests } from "@/lib/quiet-mode";
import { BotFollowsRows } from "./BotFollowsRows";
import { QuietModeMark } from "./QuietModeRow";
import { ProactiveReceiveSettings } from "../settings/ProactiveReceiveSettings";
import type { Bot } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mine = { id: "mine-7f3a", name: "Atlas" } as Bot;
const theirs = { id: "theirs-2b1c", name: "Nova" } as Bot;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  setLocale("en");
  // the person's view lists their own bot only
  fixture.view = { all: false, bots: [state("mine-7f3a", false, false)] };
  fixture.calls = [];
  resetQuietModeForTests();
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

const botSwitch = () => host.querySelector<HTMLButtonElement>('[data-settings-row="botQuietMode"] button[role="switch"]');
const allSwitch = () => host.querySelector<HTMLButtonElement>('[data-settings-row="receive.quietMode"] button[role="switch"]');

describe("quiet mode on the bot's page (#3480)", () => {
  it("the switch reads the person's view and writes the bot route, at once", async () => {
    await render(createElement(BotFollowsRows, { bot: mine }));
    expect(fixture.calls).toContainEqual({ path: "/api/me/quiet", method: "GET", body: undefined });
    // first row of « What this bot follows for you », one plain line of what it keeps
    expect(host.querySelector('[data-settings-group="botFollows"] [data-settings-row="botQuietMode"]')).not.toBeNull();
    expect(host.textContent).toContain("Quiet mode");
    expect(host.textContent).toContain("Only what needs your answer reaches you, pinned at the bottom of the chat, without sound. Its runs stay listed in Automations.");
    expect(botSwitch()!.getAttribute("aria-checked")).toBe("false");
    await act(async () => { botSwitch()!.click(); });
    expect(fixture.calls.at(-1)).toEqual({ path: "/api/bots/mine-7f3a/quiet", method: "PUT", body: { on: true } });
    expect(botSwitch()!.getAttribute("aria-checked")).toBe("true");
    await act(async () => { botSwitch()!.click(); });
    expect(fixture.calls.at(-1)).toEqual({ path: "/api/bots/mine-7f3a/quiet", method: "PUT", body: { on: false } });
    expect(botSwitch()!.getAttribute("aria-checked")).toBe("false");
    // never an identifier on screen
    expect(host.textContent).not.toMatch(/mine-7f3a/);
  });

  it("a bot that is not the person's shows no switch", async () => {
    await render(createElement(BotFollowsRows, { bot: theirs }));
    expect(fixture.calls).toContainEqual({ path: "/api/me/quiet", method: "GET", body: undefined });
    expect(botSwitch()).toBeNull();
    // nothing else to draw: the group is not drawn
    expect(host.querySelector('[data-settings-group="botFollows"]')).toBeNull();
  });

  it("the state is visible without opening anything: one mark and its label", async () => {
    const onOpen = vi.fn();
    await render(createElement(QuietModeMark, { state: state("mine-7f3a", false, false), onOpen }));
    expect(host.querySelector("[data-bot-profile-quiet]")).toBeNull();
    await render(createElement(QuietModeMark, { state: state("mine-7f3a", true, false), onOpen }));
    const mark = host.querySelector<HTMLButtonElement>("[data-bot-profile-quiet]")!;
    expect(mark.textContent?.trim()).toBe("Quiet mode");
    await act(async () => { mark.click(); });
    expect(onOpen).toHaveBeenCalledTimes(1);
    await render(createElement(QuietModeMark, { state: state("mine-7f3a", false, true), onOpen }));
    expect(host.querySelector("[data-bot-profile-quiet]")!.getAttribute("title")).toBe("Quiet mode, for all your bots");
  });
});

describe("quiet mode for all the person's bots (#3480)", () => {
  it("one switch under « What I receive » writes the person route, at once", async () => {
    await render(createElement(ProactiveReceiveSettings));
    expect(host.querySelector('[data-settings-group="receiveQuietMode"]')?.textContent).toContain("What I receive");
    expect(host.textContent).toContain("Quiet mode for all my bots");
    expect(allSwitch()!.getAttribute("aria-checked")).toBe("false");
    await act(async () => { allSwitch()!.click(); });
    expect(fixture.calls.at(-1)).toEqual({ path: "/api/me/quiet", method: "PUT", body: { on: true } });
    expect(allSwitch()!.getAttribute("aria-checked")).toBe("true");
  });

  it("marks each bot's own switch: on because of the switch for all, and readable", async () => {
    await render(createElement("div", null, createElement(ProactiveReceiveSettings), createElement(BotFollowsRows, { bot: mine })));
    await act(async () => { allSwitch()!.click(); });
    const own = botSwitch()!;
    expect(own.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector('[data-quiet-mode-bot="mine-7f3a"]')!.hasAttribute("data-quiet-mode-by-all")).toBe(true);
    expect(host.querySelector('[data-settings-row="botQuietMode"]')!.textContent).toContain("On for all your bots, in Settings, Notifications.");
    // readable: not a greyed disabled control; the switch for all turns it off
    expect(own.disabled).toBe(false);
    expect(own.getAttribute("aria-disabled")).toBe("true");
    const before = fixture.calls.length;
    await act(async () => { own.click(); });
    expect(fixture.calls.length).toBe(before);
    await act(async () => { allSwitch()!.click(); });
    expect(botSwitch()!.getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector('[data-quiet-mode-bot="mine-7f3a"]')!.hasAttribute("data-quiet-mode-by-all")).toBe(false);
  });

  it("in French", async () => {
    setLocale("fr");
    await render(createElement("div", null, createElement(ProactiveReceiveSettings), createElement(BotFollowsRows, { bot: mine })));
    expect(host.textContent).toContain("Mode silencieux pour tous mes bots");
    expect(host.textContent).toContain("Seulement ce qui attend ta réponse te joint, épinglé au bas du chat, sans son.");
    expect(host.textContent).toContain("Ce que ce bot suit pour toi");
  });
});
