// @vitest-environment happy-dom
// #4151 (the owner, 2026-11-13, side by side with the reference): the bot
// panel's head writes "Name · Title" on ONE line, the joined form of the chat
// header pill (PillName), the whole text in a tooltip, both still editable in
// place. Before, the title sat on a second line under the name.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Action } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";
import { editBotFixture } from "@/gallery/edit-bot-api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));

class FixtureEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

const fixture = editBotFixture(false);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const { StoreProvider, useStore } = await import("@/state/store");
const { BotSettingsDialog } = await import("./BotSettingsDialog");

function Shell() {
  const { state, dispatch } = useStore();
  const { bot, neighbours, routines } = fixture;
  useEffect(() => {
    const send = dispatch as (action: Action) => void;
    send({ type: "hydrate", bots: [bot, ...neighbours], groups: [], sections: [], computerControl: {} } as never);
    send({ type: "routinesHydrated", routines, runs: [] } as never);
    send({ type: "select", id: bot.id } as never);
  }, []);
  const current = state.bots.find((candidate) => candidate.id === bot.id);
  return current ? createElement(BotSettingsDialog, { bot: current }) : null;
}

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

beforeAll(() => {
  setLocale("en");
  setAdvancedMode(true);
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost/");
    return Promise.resolve(fixture.answer(url.pathname) ?? json({ error: "not in this gallery" }, 404));
  });
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  if (!("scrollIntoView" in Element.prototype)) Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("bot panel header: Name · Title on one line", () => {
  it("draws the name and the title on one line with the pill's middle dot and a tooltip", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(StoreProvider, null, createElement(Shell))); });
    await settle();

    const { name, title } = fixture.bot;
    expect(title.trim()).not.toBe("");
    const nameEl = host.querySelector<HTMLElement>("#bot-settings-title");
    expect(nameEl?.textContent).toBe(name);
    const block = nameEl?.closest<HTMLElement>("[data-bot-name-title]");
    expect(block, "the name line").toBeTruthy();
    expect(block!.className).not.toContain("flex-col");
    expect(block!.querySelector("[data-bot-title-line]")).toBeNull();

    // the chat pill's joined form: name, dot, title, one line, cut with an ellipsis
    const line = block!.querySelector<HTMLElement>("[data-bot-header-text]");
    expect(line?.className).toContain("whitespace-nowrap");
    expect(line?.className).toContain("text-[17px]");
    expect(line?.textContent).toBe(`${name}·${title}`);
    expect(line?.getAttribute("title")).toBe(`${name}\n${title}`);
    const label = line!.querySelector<HTMLElement>("[data-bot-header-label]");
    expect(label?.className).toContain("truncate");

    // both still edited where they show, the whole text on hover
    expect(nameEl!.tagName).toBe("BUTTON");
    expect(nameEl!.getAttribute("title")).toBe(`${name}\n${title}`);
    const titleButton = label!.querySelector<HTMLElement>("[data-inline-edit]");
    expect(titleButton?.tagName).toBe("BUTTON");
    expect(titleButton?.textContent).toBe(title);
  });
});
