// @vitest-environment happy-dom
// #3457 (lot 6 of #3408, design 3.8): every alert a chosen watch sends
// carries two exits, « Arrêter cette veille » and « Arrêter ce domaine ».
// Each acts at once with no confirmation, writes the person's choice through
// PUT /api/me/proactive, and one quiet line says what stopped, by label.
// Fed to the real choice store, the watch loop no longer walks what stopped.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLocale, t } from "@/lib/i18n";
import { ProactiveChoices } from "../../server/proactive/proactive-choices";
import { parseChoiceChange } from "../../shared/proactive-choices";
import { WatchAlertExits } from "./WatchAlertExits";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WATCHES = [{ id: "unassigned-tickets", domain: "dispatch" }];
const AVAILABLE = [{
  domain: "dispatch", label: { fr: "Répartition", en: "Dispatch" }, eligible: true,
  watches: [{ id: "unassigned-tickets", summary: "Tickets with no one assigned", cadence: "1h", products: [], runs: true }],
}];

let root: Root | null = null;
let host: HTMLDivElement;
let puts: unknown[] = [];
let failPut = false;
/** the person's choices on the server, fed by each PUT the exits send */
let store: ProactiveChoices;

beforeEach(async () => {
  await loadLocale("en");
  puts = [];
  failPut = false;
  store = new ProactiveChoices(undefined, () => 1_000);
  store.apply("ana", { domain: "dispatch", state: "on", botId: "atlas", via: "card" }, "ana");
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (String(path).startsWith("/api/me/proactive") && init?.method === "PUT") {
      if (failPut) return json({ error: "nope" }, 500);
      const body = JSON.parse(String(init.body));
      puts.push(body);
      const parsed = parseChoiceChange(body);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      return json({ domains: store.apply("ana", parsed.change, "ana").domains });
    }
    if (String(path).startsWith("/api/me/proactive")) return json({ domains: store.get("ana").domains, available: AVAILABLE });
    return json({});
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(WatchAlertExits, { watches: WATCHES })); });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label);
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((done) => setTimeout(done, 0)); });

describe("the two exits of a watch alert (#3457)", () => {
  it("offers both exits, by their words", () => {
    expect(button(t("watchAlert.stopWatch"))).toBeTruthy();
    expect(button(t("watchAlert.stopDomain"))).toBeTruthy();
  });

  it("« Stop this watch » writes the choice at once and the watch stops", async () => {
    await act(async () => { button(t("watchAlert.stopWatch"))!.click(); });
    await settle();
    expect(puts).toEqual([{ domain: "dispatch", watch: "unassigned-tickets", on: false, via: "alert" }]);
    expect(store.chosen()).toEqual([{ person: "ana", domains: [{ domain: "dispatch", botId: "atlas", watchesOff: ["unassigned-tickets"] }] }]);
    const line = host.querySelector<HTMLElement>("[data-watch-alert-stopped]")!;
    expect(line.getAttribute("data-watch-alert-stopped")).toBe("watch");
    expect(line.textContent).toBe(t("watchAlert.stopped.watch", { label: "Tickets with no one assigned" }));
    expect(button(t("watchAlert.stopWatch"))).toBeUndefined();
    expect(line.textContent).not.toContain("unassigned-tickets");
  });

  it("« Stop this domain » writes the domain off at once and none of its watches runs", async () => {
    await act(async () => { button(t("watchAlert.stopDomain"))!.click(); });
    await settle();
    expect(puts).toEqual([{ domain: "dispatch", state: "off", via: "alert" }]);
    expect(store.chosen()).toEqual([]);
    expect(store.get("ana").domains.dispatch?.state).toBe("off");
    const line = host.querySelector<HTMLElement>("[data-watch-alert-stopped]")!;
    expect(line.textContent).toBe(t("watchAlert.stopped.domain", { label: "Dispatch" }));
  });

  it("a write that fails says so and keeps the exits", async () => {
    failPut = true;
    await act(async () => { button(t("watchAlert.stopWatch"))!.click(); });
    await settle();
    expect(host.querySelector("[data-watch-alert-stopped]")).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("suggestionFeedback.failed"));
    expect(button(t("watchAlert.stopWatch"))).toBeTruthy();
  });
});
