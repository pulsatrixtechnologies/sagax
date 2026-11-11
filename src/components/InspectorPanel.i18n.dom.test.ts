// @vitest-environment happy-dom
// #3676: the Inspector's own words come from the locale files, in French and
// in English, its counts through the app's number formatter, and no tab
// label is capitalized over the translator's text ("Journal D'exécution").
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import type { InspectorPage } from "../../shared/inspector";

const fixture = vi.hoisted(() => ({ page: null as unknown }));

vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  api: vi.fn(async () => fixture.page),
  useStore: () => ({ state: { bots: [], groups: [] }, dispatch: vi.fn(), flushBotPatches: () => Promise.resolve() }),
}));
vi.mock("./DesktopCapabilities", async (original) => ({
  ...await original<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: "", dragProps: {} }),
  useMacInsetChrome: () => ({ macInset: false, browser: true }),
}));
vi.mock("@/lib/live-events", () => ({ listenLiveFrames: () => () => {} }));

const { loadLocale: setLocale } = await import("@/lib/i18n");
const { InspectorPanel } = await import("./InspectorPanel");
const { inspectorCountLine } = await import("@/lib/inspector");

const bot = { id: "b", threadId: "t-b", name: "Bot", color: "green", messages: [], tasks: [] } as unknown as Bot;
const at = (n: number) => new Date(Date.UTC(2026, 10, 11, 9, 0, 0) + n * 1_000).toISOString();
const entries = (count: number): InspectorPage["entries"] => Array.from({ length: count }, (_, n) => ({
  kind: "runtime" as const,
  at: at(n),
  data: { eventId: `e${n}`, provider: "claude", threadId: "t", createdAt: at(n), type: "turn.started" } as never,
}));

let host: HTMLDivElement;
let root: Root;
const settle = () => new Promise((done) => setTimeout(done, 0));
const text = (selector: string) => host.querySelector(selector)?.textContent?.trim();
const openTab = (id: string) => flushSync(() => host.querySelector<HTMLElement>(`#inspector-tab-${id}`)!.click());
const count = () => [...host.querySelectorAll("span")].find((span) => span.className.includes("text-[11px]"))?.textContent;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  flushSync(() => root.unmount());
  host.remove();
  await setLocale("en");
});

describe("Inspector words (#3676)", () => {
  it("reads in French: tabs as the translator wrote them, count and empty state", async () => {
    await setLocale("fr");
    fixture.page = { entries: entries(3), total: { runtime: 1687, native: 0 } };
    flushSync(() => root.render(createElement(InspectorPanel, { bot })));
    await settle();
    const tabs = [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(["Journal d'exécution", "Événements", "Brut"]);
    expect(host.querySelector('[role="tab"]')!.className).not.toMatch(/\bcapitalize\b/);
    expect(host.textContent).toContain("Inspecteur");
    openTab("events");
    await settle();
    expect(count()?.replace(/\s/g, " ")).toBe("3 sur 1 687");
    openTab("raw");
    await settle();
    expect(text('[role="tabpanel"]')).toBe("Aucun message natif du protocole enregistré dans cette conversation pour l'instant.");
  });

  it("reads in English with the same words as before", async () => {
    await setLocale("en");
    fixture.page = { entries: entries(0), total: { runtime: 0, native: 0 } };
    flushSync(() => root.render(createElement(InspectorPanel, { bot })));
    await settle();
    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["Run log", "Events", "Raw"]);
    openTab("events");
    await settle();
    expect(count()).toBe("0 entries");
    expect(text('[role="tabpanel"]')).toBe("No runtime events in this conversation yet.");
  });

  it("formats each count line through the app's language", async () => {
    await setLocale("en");
    expect(inspectorCountLine(null)).toBe("loading…");
    expect(inspectorCountLine({ shown: 300, total: 1687, counting: false })).toBe("last 300 of 1,687");
    expect(inspectorCountLine({ shown: 300, total: 120, counting: true })).toBe("last 300 of at least 300");
    expect(inspectorCountLine({ shown: 1, total: 1, counting: false })).toBe("1 entry");
    await setLocale("fr");
    expect(inspectorCountLine({ shown: 300, total: 1687, counting: false }).replace(/\s/g, " ")).toBe("300 sur 1 687");
    expect(inspectorCountLine({ shown: 12, total: 12, counting: false })).toBe("12 entrées");
  });

  it("keeps no English word in the panel's source", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "InspectorPanel.tsx"), "utf8");
    expect(source).not.toMatch(/"loading…"|entries`|No runtime events|No native protocol|> Inspector\b|\bcapitalize\b/);
  });
});
