// @vitest-environment happy-dom
// JC 2026-11-06 (asked twice): in the bot panel the title sits under the
// name, on its own line, smaller and secondary; never "Name · Title" on one
// line. Both stay editable in place.
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

describe("bot panel header: title stacked under the name", () => {
  it("draws the name and the title as two separate lines, with no middle dot", async () => {
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
    expect(block, "name and title share one stacked block").toBeTruthy();
    expect(block!.className).toContain("flex-col");

    const titleLine = block!.querySelector<HTMLElement>("[data-bot-title-line]");
    expect(titleLine?.textContent).toBe(title);
    // a line of its own, after the name, not inside the name's element
    expect(nameEl!.contains(titleLine)).toBe(false);
    expect(nameEl!.compareDocumentPosition(titleLine!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // smaller and secondary, no permanent background
    const titleButton = titleLine!.querySelector<HTMLElement>("[data-inline-edit]");
    expect(titleButton?.className).toContain("text-ink-secondary");
    expect(titleButton?.className).toContain("text-[12.5px]");
    expect(titleButton?.className).not.toMatch(/(^|\s)bg-/);
    // still editable in place
    expect(titleButton?.tagName).toBe("BUTTON");

    expect(block!.textContent).not.toContain("·");
    expect(host.textContent).not.toContain(`${name} · ${title}`);
  });
});
