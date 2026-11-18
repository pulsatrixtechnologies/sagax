// @vitest-environment happy-dom
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
  product("desk", "Service Desk", { state: "key_expired", description: "Tickets and time", profiles: [{ name: "Support" }, { name: "Direct", personal: true }] }),
  product("rmm", "Remote Monitoring", { profiles: [{ name: "Support" }, { name: "Operations" }] }),
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
    const ids = [...document.querySelectorAll("[data-entry-action]")].map((node) => node.getAttribute("data-entry-action"));
    expect(ids).toEqual(expect.arrayContaining(["all", "choose", "off"]));
  });
});

describe("gateway connectors grouped by product", () => {
  it("shares one bundle card per product, including a standalone connector, and counts switches for the selected bot", async () => {
    const onOpenVendor = vi.fn();
    const setProducts = vi.fn();
    const context = ctx({ forBot: { id: "bot-b", name: "Orbit", products: { desk: false } }, setProducts });
    const rows = productRows(products, context, { mode: "connectors", onOpenVendor });
    expect(rows.map((row) => row.key)).toEqual(["vendor:harbor", "product:wiki"]);
    const view = await render(createElement("div", null, rows.map((row) => createElement("div", { key: row.key }, row.node))));
    const bundle = view.querySelector('[data-vendor-bundle="vendor:harbor"]')!;
    expect(bundle.querySelector("[data-vendor-line]")?.textContent).toBe("2 connectors · 1 on");
    expect(bundle.querySelector('[title="Support, Operations"]')?.textContent).toBe("Support, Operations");
    expect(bundle.textContent).not.toContain("Direct");
    expect(bundle.querySelectorAll("[data-row-state]")).toHaveLength(1);
    expect(bundle.querySelector('[data-row-state="fix"]')).not.toBeNull();
    await click(bundle.querySelector("[data-row-switch]"));
    expect(setProducts).toHaveBeenCalledWith(["bot-b"], ["desk", "rmm"], true);
    await click(bundle.querySelector("button"));
    expect(onOpenVendor).toHaveBeenCalledWith("vendor:harbor");
    const single = view.querySelector('[data-vendor-bundle="product:wiki"]')!;
    expect(single.querySelector("[data-vendor-line]")?.textContent).toBe("1 connector · 1 on");
    await click(single.querySelector("button"));
    expect(onOpenVendor).toHaveBeenCalledWith("product:wiki");
  });

  it("shows these same cards in Discover, including when they are its only results", async () => {
    const { DiscoverView } = await import("./DiscoverView");
    const rows = productRows(products, ctx(), { mode: "connectors", onOpenVendor: vi.fn() });
    const view = await render(createElement(DiscoverView, {
      items: [], filter: "all", onFilter: vi.fn(), type: "any", onType: vi.fn(), sourceLabel: (name: string) => name,
      onOpenItem: vi.fn(), renderAction: () => null, kind: "connectors", connectorProducts: { title: "Gateway", rows },
    }));
    expect(view.querySelectorAll('[data-plugins-section="connector-products"] [data-vendor-bundle]')).toHaveLength(2);
    expect(view.querySelector("[data-plugins-empty]")).toBeNull();
  });

  it("a product with no icon of its own takes its vendor's", async () => {
    const view = await render(createElement("div", null, productRows(products, ctx())[0]!.node));
    expect(view.querySelector("[data-person-product='desk'] [data-remote-image]")?.getAttribute("src")).toBe("https://cdn.example.test/harbor.svg");
  });

  it("keeps the one neutral tile when an image cannot load", async () => {
    const view = await render(createElement("div", null, productRows(products, ctx())[0]!.node));
    const image = view.querySelector("[data-person-product='desk'] [data-remote-image]")!;
    await act(async () => { image.dispatchEvent(new Event("error")); });
    expect(view.querySelector("[data-person-product='desk'] [data-remote-image]")).toBeNull();
    expect(view.querySelector("[data-person-product='desk'] [data-neutral-tile]")?.getAttribute("data-neutral-tile")).toBe("connector");
  });
});

describe("the vendor's page", () => {
  const vendor = groupByVendor(products).find((entry) => entry.key === "vendor:harbor")!;
  const page = (extra: Partial<RowsContext> = {}) => createElement(VendorPage, { vendor, ctx: ctx(extra), onBack: vi.fn() });

  it("has a header, the line the console sends in the person's language (English fallback) and the Connectors & tools panel", async () => {
    const view = await render(page());
    expect(view.querySelector("[data-plugins-detail-name]")?.textContent).toBe("Harbor Suite");
    expect(view.querySelector("[data-plugins-detail-meta]")?.textContent).toBe("2 connectors · 2 on");
    expect(view.querySelector("[data-detail-description] p")?.textContent).toBe("Service desk, monitoring and quoting in one place.");
    expect([...view.querySelectorAll("[data-vendor-chip-product]")].map((item) => item.getAttribute("title"))).toEqual(["Service Desk", "Remote Monitoring"]);
    // the Overview is one column: no side panel next to a lone sentence
    expect(view.querySelector("[data-detail-reach]")).toBeNull();
    setLocale("fr");
    const french = await render(page());
    expect(french.querySelector("[data-detail-description] p")?.textContent).toBe("Service desk, supervision et soumissions au même endroit.");
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

describe("a bundle of many connectors that share a long name prefix (the owner, 2026-11-17)", () => {
  const areas = ["Company", "Configurations", "Expense", "Finance", "Marketing", "Procurement", "Project", "Sales", "Schedule", "Service", "System", "Time"];
  const family = areas.map((area, index) => product(`h${index}`, `Harbor Suite Public Endpoints: ${area}`, index === 3 ? { state: "key_expired" } : {}));
  const vendor = groupByVendor(family).find((entry) => entry.key === "vendor:harbor")!;
  const page = () => createElement(VendorPage, { vendor, ctx: ctx(), onBack: vi.fn() });

  it("names each connector by what tells it apart, the full name in its tooltip, about eight chips then Show N more", async () => {
    const view = await render(page());
    const chips = [...view.querySelectorAll("[data-vendor-chip-product]")];
    expect(chips).toHaveLength(8);
    expect(chips.map((chip) => chip.querySelector("span")?.textContent)).toEqual(["Company", "Configurations", "Expense", "Finance", "Marketing", "Procurement", "Project", "Sales"]);
    expect(chips[0]!.getAttribute("title")).toBe("Harbor Suite Public Endpoints: Company");
    // only a connector that is not "on" carries its state
    expect(chips.filter((chip) => chip.querySelector("[data-row-state]")).map((chip) => chip.querySelector("span")?.textContent)).toEqual(["Finance"]);
    expect(view.querySelector("[data-vendor-chips-more]")?.textContent).toBe("Show 4 more");
    await click(view.querySelector("[data-vendor-chips-more]"));
    expect(view.querySelectorAll("[data-vendor-chip-product]")).toHaveLength(12);
    expect(view.querySelector("[data-vendor-chips-more]")?.textContent).toBe("Show fewer");
  });

  it("never nests a button in a button: a chip with a state mark is one control, the mark an image with its tooltip", async () => {
    const view = await render(page());
    const chips = [...view.querySelectorAll("[data-vendor-chip-product]")];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(chip.querySelector("button")).toBeNull();
    expect(view.querySelector("button button")).toBeNull();
    const marked = chips.find((chip) => chip.querySelector("[data-row-state]"));
    expect(marked?.querySelector("[data-row-state] [role='img']")).not.toBeNull();
    expect(marked?.querySelector("[data-row-state-fix]")).toBeNull();
  });

  it("lists them in the Connectors tab by that name, with a search once there are more than eight", async () => {
    const view = await render(page());
    await click(view.querySelector('[data-vendor-tab="connectors"]'));
    const names = () => [...view.querySelectorAll("[data-vendor-panel='connectors'] li [data-person-product-line] span.block")].map((node) => node.textContent);
    expect(names()).toHaveLength(12);
    expect(names()[0]).toBe("Company");
    const search = view.querySelector<HTMLInputElement>("[data-vendor-search] input")!;
    expect(search).not.toBeNull();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { set.call(search, "fin"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(names()).toEqual(["Finance"]);
  });
});

describe("the Featured banner's art", () => {
  it("is the vendor's square mark, never the console's wide wordmark", async () => {
    const { VendorArt } = await import("./ProductRows");
    const vendor = groupByVendor([product("a", "One", { group: { ...suite, logo: "https://cdn.example.test/wordmark-wide.svg" } })]).find((entry) => entry.key === "vendor:harbor")!;
    const view = await render(createElement(VendorArt, { vendor }));
    const image = view.querySelector("[data-remote-image]")!;
    expect(image.getAttribute("src")).toBe("https://cdn.example.test/harbor.svg");
    expect(image.getAttribute("src")).not.toContain("wordmark");
    expect(image.className).toContain("size-20");
    expect(image.className).toContain("rounded-2xl");
  });
  it("falls back to the generic vendor tile when the console serves no square mark", async () => {
    const { VendorArt } = await import("./ProductRows");
    const bare = { id: "x", name: "Bare Co", logo: "https://cdn.example.test/wordmark-wide.svg" };
    const vendor = groupByVendor([product("b", "Two", { group: bare })]).find((entry) => entry.key === "vendor:x")!;
    const view = await render(createElement(VendorArt, { vendor }));
    expect(view.querySelector("[data-remote-image]")).toBeNull();
    expect(view.querySelector("[data-neutral-tile='vendor']")).not.toBeNull();
  });
});
