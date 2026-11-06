// @vitest-environment happy-dom
// #2080 (L0): in Simple mode a page's `SettingsGroup advanced` cards fold
// under one "Advanced" row at the bottom of the page; in Advanced mode they
// stay where they are. A search opens the fold so a match can be found.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { SettingsAdvancedScope, SettingsGroup } from "./SettingsPrimitives";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  setLocale("en");
  try { localStorage.clear(); } catch { /* none */ }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const group = (title: string, groupId: string, text: string, advanced?: boolean) =>
  createElement(SettingsGroup, { key: groupId, title, groupId, advanced, children: createElement("p", null, text) });
const page = (fold: boolean, searching = false) => act(() => root.render(createElement(SettingsAdvancedScope, {
  pageId: "demo", fold, searching,
  children: [group("Everyday", "everyday", "daily"), group("Logs", "logs", "technical", true), group("Cache", "cache", "warm", true)],
})));
const fold = () => host.querySelector<HTMLElement>('[data-settings-card="demo.advancedFold"]');
const body = () => document.getElementById(fold()!.querySelector("button[aria-controls]")!.getAttribute("aria-controls")!)!;

describe("SettingsGroup advanced", () => {
  it("in Advanced mode, draws every card in place and no fold", () => {
    page(false);
    expect(fold()).toBeNull();
    expect([...host.querySelectorAll("[data-settings-group]")].map((node) => node.getAttribute("data-settings-group"))).toEqual(["everyday", "logs", "cache"]);
  });

  it("in Simple mode, moves the advanced cards into one closed fold named after them", () => {
    page(true);
    const section = fold()!;
    expect(section.hidden).toBe(false);
    expect(section.textContent).toContain("Advanced");
    expect(section.textContent).toContain("Logs, Cache");
    expect(body().hidden).toBe(true);
    expect(body().querySelector('[data-settings-group="logs"]')).not.toBeNull();
    expect(host.querySelector('[data-settings-group="everyday"]')!.closest('[data-settings-group="advanced"]')).toBeNull();
    // the pill opens it
    act(() => section.querySelector<HTMLButtonElement>("button[aria-controls]")!.click());
    expect(body().hidden).toBe(false);
  });

  it("opens the fold while a search is on, and hides it when nothing is advanced", () => {
    page(true, true);
    expect(body().hidden).toBe(false);
    act(() => root.render(createElement(SettingsAdvancedScope, { pageId: "demo", fold: true, children: group("Everyday", "everyday", "daily") })));
    expect(fold()!.hidden).toBe(true);
  });
});
