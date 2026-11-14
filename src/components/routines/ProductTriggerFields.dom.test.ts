// @vitest-environment happy-dom
// #4250 (S4): every resource the person can watch is offered, never the first
// 24 alone (the organization server lists up to 100), with a search field
// like the run-as picker.
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listed = Array.from({ length: 40 }, (_, index) => ({ uri: `perspicax://watch/${index + 1}`, name: `Resource number ${index + 1} with a rather long name that must not be cut` }))
  .concat(Array.from({ length: 15 }, (_, index) => ({ uri: `perspicax://template/${index + 1}/{id}`, name: `Template ${index + 1}`, template: true as never })));
const server = vi.hoisted(() => ({ org: null as unknown }));
vi.mock("@/state/store", async (load) => {
  const original = await load<typeof import("@/state/store")>();
  return { ...original, api: vi.fn(async (path: string) => path === "/api/org" ? { org: server.org } : ({ available: true, resources: listed })) };
});
const { ProductTriggerFields, productTriggerOffered, useProductTriggerOffered, watchableRows } = await import("./ProductTriggerFields");
const { loadPerspicaxOrg } = await import("@/lib/perspicax-org");
const { loadLocale } = await import("@/lib/i18n");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("ProductTriggerFields", () => {
  it.each(["en", "fr"])("offers all 55 entries the server lists, with a search, in %s", async (lang) => {
    await loadLocale(lang);
    const changes: string[] = [];
    await act(async () => {
      root.render(createElement(ProductTriggerFields, { draft: { resources: "" }, onChange: (next: { resources: string }) => changes.push(next.resources), botId: "bot_a" }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const chips = [...host.querySelectorAll<HTMLButtonElement>("[data-product-watchable]")];
    expect(chips).toHaveLength(55);
    // the full name is the chip's text: nothing cut by the code
    expect(chips[39]!.textContent).toBe("Resource number 40 with a rather long name that must not be cut");
    expect(chips[39]!.className).not.toContain("truncate");
    expect(host.textContent).toContain(lang === "en" ? "You can watch (55)" : "Tu peux suivre (55)");
    // entry 50 (a template) can be picked
    await act(async () => chips[49]!.click());
    expect(changes.at(-1)).toBe("perspicax://template/10/{id}");
    const search = host.querySelector<HTMLInputElement>("[data-product-search]")!;
    expect(search).not.toBeNull();
    expect(search.getAttribute("aria-label")).toBe(lang === "en" ? "Search what you can watch" : "Chercher ce que tu peux suivre");
  });

  it("the search keeps the entries whose name or address matches, all of them", () => {
    const rows = watchableRows(listed, "");
    expect(rows.resources).toHaveLength(40);
    expect(rows.templates).toHaveLength(15);
    expect(watchableRows(listed, "number 3").resources.map((entry) => entry.uri)).toEqual(["perspicax://watch/3", ...Array.from({ length: 10 }, (_, index) => `perspicax://watch/${30 + index}`)]);
    expect(watchableRows(listed, "template/12").templates.map((entry) => entry.name)).toEqual(["Template 12"]);
    expect(watchableRows(listed, "nothing like this")).toEqual({ resources: [], templates: [] });
  });
});

// #4250 (S4) review: "When something changes in a product" is offered only
// where it can run (a server linked to Perspicax), and stays for a routine
// that already has this trigger.
describe("product trigger offered", () => {
  const product = { type: "event", source: "perspicax" };
  it("follows the link, and keeps a routine's own trigger", () => {
    expect(productTriggerOffered(false, undefined)).toBe(false);
    expect(productTriggerOffered(false, { type: "cron" })).toBe(false);
    expect(productTriggerOffered(false, { type: "event", source: "github" })).toBe(false);
    expect(productTriggerOffered(false, product)).toBe(true);
    expect(productTriggerOffered(true, undefined)).toBe(true);
  });

  function Probe({ schedule }: { schedule?: { type: string; source?: unknown } }) {
    return createElement("span", { "data-offered": String(useProductTriggerOffered(schedule)) });
  }
  const offered = async (org: unknown, schedule?: { type: string; source?: unknown }) => {
    server.org = org;
    await loadPerspicaxOrg(true);
    await act(async () => { root.render(createElement(Probe, { schedule })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    return host.querySelector("[data-offered]")!.getAttribute("data-offered");
  };
  it("is hidden on a solo server", async () => {
    expect(await offered(null)).toBe("false");
  });
  it("is offered on a server linked to Perspicax", async () => {
    expect(await offered({ name: "Org", identity: { kind: "perspicax" } })).toBe("true");
  });
  it("stays for a routine that already starts on a product change, even on a solo server", async () => {
    expect(await offered(null, product)).toBe("true");
  });
});
