// @vitest-environment happy-dom
// A vendor the organization console offers is ONE plugin-like bundle (#4453):
// one row under Plugins that opens its page, never an unfolding list under
// Connectors; each of its products is still its own row of Connectors, marked
// "in <vendor>"; its page has Overview and Connectors; images come by https
// and fall back to the one neutral tile.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { groupByVendor, inLanguage } from "@/lib/capability-kinds";
import type { PersonProduct } from "@/lib/person-products";
import { parsePersonProduct } from "../../../shared/person-products";

vi.mock("@/state/store", () => ({ api: vi.fn(), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

const { productRows } = await import("./ProductRows");
const { VendorPage } = await import("./VendorPage");
type RowsContext = import("./ProductRows").ProductRowsContext;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const suite = { id: "harbor", name: "Harbor Suite", description: { en: "Service desk, monitoring and quoting in one place.", fr: "Service desk, supervision et soumissions au même endroit." }, icon: { url: "https://cdn.example.test/harbor.svg" } };
const wire = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, state: "connected", ...over });
const product = (id: string, name: string, over: Record<string, unknown> = {}): PersonProduct => parsePersonProduct(wire(id, name, { group: suite, ...over }))!;
const products = [
  product("desk", "Service Desk", { state: "key_expired", description: "Tickets and time" }),
  product("rmm", "Remote Monitoring"),
  parsePersonProduct(wire("wiki", "Team Wiki"))!,
];
const ctx = (extra: Partial<RowsContext> = {}): RowsContext => ({ bots: [{ id: "bot-a", name: "Rocket" }, { id: "bot-b", name: "Orbit" }], setProducts: vi.fn(), onOpen: vi.fn(), ...extra });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { setLocale("en"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (node: unknown) => { await act(async () => { root.render(node as never); }); return host; };
const click = async (element: Element | null) => { expect(element).not.toBeNull(); await act(async () => { (element as HTMLElement).click(); }); };

describe("the vendor as one bundle row under Plugins", () => {
  const rows = (onOpenVendor = vi.fn(), extra: Partial<RowsContext> = {}) => productRows(products, ctx(extra), { mode: "plugins", onOpenVendor });

  it("is one row per vendor (a product with no vendor is not a bundle), with its logo, \"N connectors · M on\" and its worst state as one icon", async () => {
    const list = rows();
    expect(list.map((row) => row.key)).toEqual(["vendor:harbor"]);
    const view = await render(createElement("div", null, list[0]!.node));
    const bundle = view.querySelector("[data-vendor-bundle]")!;
    expect(bundle.textContent).toContain("Harbor Suite");
    expect(bundle.textContent).toContain("2 connectors · 2 on");
    expect(bundle.querySelector("[data-remote-image]")?.getAttribute("src")).toBe("https://cdn.example.test/harbor.svg");
    // the worst state wins: the expired key is the one icon, a button that opens the page
    expect(bundle.querySelector("[data-row-state='fix']")).not.toBeNull();
    expect(bundle.querySelectorAll("[data-row-state]")).toHaveLength(1);
  });

  it("never unfolds: it opens the vendor's page, and its switch is for all of it", async () => {
    const onOpenVendor = vi.fn();
    const setProducts = vi.fn();
    const view = await render(createElement("div", null, rows(onOpenVendor, { setProducts })[0]!.node));
    expect(view.querySelector("[data-vendor-toggle]")).toBeNull();
    expect(view.querySelector("[data-vendor-products]")).toBeNull();
    await click(view.querySelector("[data-vendor-bundle] > button"));
    expect(onOpenVendor).toHaveBeenCalledWith("vendor:harbor");
    await click(view.querySelector("[data-row-switch]"));
    expect(setProducts).toHaveBeenCalledWith(["bot-a", "bot-b"], ["desk", "rmm"], false);
  });

  it("offers for all bots and the bots I choose in its menu", async () => {
    const view = await render(createElement("div", null, rows(vi.fn(), { bots: [{ id: "bot-a", name: "Rocket", products: { desk: false } }, { id: "bot-b", name: "Orbit" }] })[0]!.node));
    await click(view.querySelector("[data-entry-menu]"));
    const ids = [...view.querySelectorAll("[data-entry-action]")].map((node) => node.getAttribute("data-entry-action"));
    expect(ids).toEqual(expect.arrayContaining(["all", "choose", "off"]));
  });
});

describe("each product is its own row of Connectors, marked as part of its bundle", () => {
  const flat = (onOpenVendor = vi.fn()) => productRows(products, ctx(), { mode: "connectors", onOpenVendor });

  it("lists every product once, flat, with a small \"in <vendor>\" chip on those in a bundle only", async () => {
    const list = flat();
    expect(list.map((row) => row.key)).toEqual(["product:desk", "product:rmm", "product:wiki"]);
    const view = await render(createElement("div", null, list.map((row) => createElement("div", { key: row.key }, row.node))));
    expect(view.querySelector("[data-vendor-toggle]")).toBeNull();
    const chips = [...view.querySelectorAll("[data-vendor-chip]")].map((chip) => chip.textContent);
    expect(chips).toEqual(["in Harbor Suite", "in Harbor Suite"]);
    expect(view.querySelector("[data-person-product='wiki'] [data-vendor-chip]")).toBeNull();
  });

  it("the chip opens the bundle, by a click or the keyboard, and not the product's own page", async () => {
    const onOpenVendor = vi.fn();
    const opened = vi.fn();
    const view = await render(createElement("div", null, productRows(products, ctx({ onOpen: opened }), { mode: "connectors", onOpenVendor })[0]!.node));
    const chip = view.querySelector<HTMLElement>("[data-vendor-chip]")!;
    expect(chip.tabIndex).toBe(0);
    expect(chip.getAttribute("aria-label")).toBe("Part of Harbor Suite: open it");
    await click(chip);
    await act(async () => { chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(onOpenVendor).toHaveBeenCalledTimes(2);
    expect(onOpenVendor).toHaveBeenCalledWith("vendor:harbor");
    expect(opened).not.toHaveBeenCalled();
  });

  it("a product with no icon of its own takes its vendor's", async () => {
    const view = await render(createElement("div", null, flat()[0]!.node));
    expect(view.querySelector("[data-person-product='desk'] [data-remote-image]")?.getAttribute("src")).toBe("https://cdn.example.test/harbor.svg");
  });

  it("keeps the one neutral tile when an image cannot load", async () => {
    const view = await render(createElement("div", null, flat()[0]!.node));
    const image = view.querySelector("[data-person-product='desk'] [data-remote-image]")!;
    await act(async () => { image.dispatchEvent(new Event("error")); });
    expect(view.querySelector("[data-person-product='desk'] [data-remote-image]")).toBeNull();
    expect(view.querySelector("[data-person-product='desk'] [data-letter-tile]")?.textContent).toBe("S");
  });
});

describe("the vendor's page", () => {
  const vendor = groupByVendor(products).find((entry) => entry.key === "vendor:harbor")!;
  const page = (extra: Partial<RowsContext> = {}) => createElement(VendorPage, { vendor, ctx: ctx(extra), onBack: vi.fn() });

  it("has a header, the line the console sends in the person's language (English fallback) and the Connectors & tools panel", async () => {
    const view = await render(page());
    expect(view.querySelector("[data-vendor-name]")?.textContent).toBe("Harbor Suite");
    expect(view.querySelector("[data-vendor-line]")?.textContent).toBe("2 connectors · 2 on");
    expect(view.querySelector("[data-vendor-description]")?.textContent).toBe("Service desk, monitoring and quoting in one place.");
    expect([...view.querySelectorAll("[data-vendor-reach] li")].map((item) => item.querySelector("span.truncate")?.textContent)).toEqual(["Service Desk", "Remote Monitoring"]);
    setLocale("fr");
    const french = await render(page());
    expect(french.querySelector("[data-vendor-description]")?.textContent).toBe("Service desk, supervision et soumissions au même endroit.");
    expect(inLanguage({ en: "Only English" }, "fr-CA")).toBe("Only English");
    expect(inLanguage({ fr: "Seulement" }, "en")).toBe("Seulement");
  });

  it("has Overview and Connectors · N as underlined tabs; the Connectors tab lists each product with its own state, switch and menu", async () => {
    const view = await render(page());
    const tabs = [...view.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "Connectors2"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.className).toContain("border-b-2");
    await click(tabs[1]!);
    const rows = [...view.querySelectorAll("[data-vendor-panel='connectors'] [data-person-product]")];
    expect(rows.map((row) => row.getAttribute("data-person-product"))).toEqual(["desk", "rmm"]);
    for (const row of rows) {
      expect(row.querySelector("[data-row-switch]")).not.toBeNull();
      expect(row.querySelector("[data-entry-menu]")).not.toBeNull();
    }
    expect(view.querySelector("[data-person-product='desk'] [data-row-state='fix']")).not.toBeNull();
  });
});

describe("the console's vendor line and marks", () => {
  it("reads the line in each language, a plain string as English, and the product's icon falling back to the vendor's", () => {
    const parsed = parsePersonProduct(wire("desk", "Service Desk", { group: { id: "h", name: "Harbor", description: { en: "A", fr: "B" } }, icon: { url: "https://cdn.example.test/desk.svg" } }));
    expect(parsed?.group?.description).toEqual({ en: "A", fr: "B" });
    expect(parsed?.icon?.url).toBe("https://cdn.example.test/desk.svg");
    expect(parsePersonProduct(wire("desk", "Service Desk", { group: { id: "h", name: "Harbor", description: "Plain" } }))?.group?.description).toEqual({ en: "Plain" });
    expect(parsePersonProduct(wire("desk", "Service Desk", { group: { id: "h", name: "Harbor" } }))?.group).not.toHaveProperty("description");
  });
});
