// @vitest-environment happy-dom
// A marketplace plugin named for a product group of the console sits in that
// group (lib/product-plugins): the group's card counts its skills and offers
// its Update, its page and its Uninstall; the group's page lists the plugin's
// row and its skills; it is not listed again under "Added by you". A plugin
// that matches no group stays under "Added by you".
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { groupByVendor } from "@/lib/capability-kinds";
import { installedEntries } from "@/lib/installed-model";
import { buildPluginItems } from "@/lib/plugins-model";
import { productPlugins } from "@/lib/product-plugins";
import type { PersonProduct } from "@/lib/person-products";
import { parsePersonProduct } from "../../../shared/person-products";

vi.mock("@/state/store", () => ({ api: vi.fn(), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

const { productRows, worseState } = await import("./ProductRows");
const { VendorPage } = await import("./VendorPage");
const { InstalledView } = await import("./InstalledView");
type RowsContext = import("./ProductRows").ProductRowsContext;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const suite = { id: "acme", name: "AcmeDesk", icon: { url: "https://cdn.example.test/acme.svg" } };
const other = { id: "zeta", name: "Zeta Cloud" };
const products: PersonProduct[] = [
  parsePersonProduct({ id: "desk", name: "AcmeDesk Service", state: "connected", group: suite })!,
  parsePersonProduct({ id: "time", name: "AcmeDesk Time", state: "connected", group: suite })!,
];
const twoGroups: PersonProduct[] = [
  parsePersonProduct({ id: "zeta-a", name: "Zeta Storage", state: "connected", group: other })!,
  ...products,
];
const ctx = (): RowsContext => ({ bots: [{ id: "bot-a", name: "Rocket" }], setProducts: vi.fn(), onOpen: vi.fn() });
const items = buildPluginItems({
  marketplaces: [{ name: "example-market", plugins: [
    { name: "acmedesk", description: "Every AcmeDesk product in one plugin", installed: true, servers: [], skills: ["init", "time"] },
    { name: "notes", description: "Notes", installed: true, servers: [], skills: [] },
  ] }],
  skills: [{ name: "init", description: "Set up", enabled: true, source: "example-market" }, { name: "time", description: "Log time", enabled: true, source: "example-market" }],
} as never);
const entries = installedEntries(items);

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { setLocale("en"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (node: unknown) => { await act(async () => { root.render(node as never); }); return host; };
const click = async (element: Element | null) => { expect(element).not.toBeNull(); await act(async () => { (element as HTMLElement).click(); }); };

describe("a plugin named for a product group", () => {
  const grouping = productPlugins(groupByVendor(products), entries);
  const acme = entries.find((entry) => entry.name.toLowerCase() === "acmedesk")!;
  const notes = entries.find((entry) => entry.name.toLowerCase() === "notes")!;

  it("joins the group by its name; the other plugin does not", () => {
    expect(grouping.groupOf.get(acme.key)).toBe("vendor:acme");
    expect(grouping.groupOf.has(notes.key)).toBe(false);
    expect(acme.brings.skills).toBe(2);
  });

  it("the group's card counts its skills and offers its Update, its page and its Uninstall", async () => {
    const update = vi.fn();
    const remove = vi.fn();
    const openPlugin = vi.fn();
    const rows = productRows(products, ctx(), { mode: "plugins", onOpenVendor: vi.fn(), plugins: (key) => key === "vendor:acme" ? {
      skills: 2,
      update: { running: false, onUpdate: update },
      actions: { update, updateWaiting: true, links: [{ id: "plugin-page", label: "AcmeDesk plugin page", icon: null, run: openPlugin }], remove, removeLabel: "Uninstall the AcmeDesk plugin" },
    } : undefined });
    const view = await render(createElement("div", null, rows[0]!.node));
    expect(view.querySelector("[data-vendor-line]")?.textContent).toBe("2 connectors · 2 skills · 2 on");
    // the product's logo stays the card's
    expect(view.querySelector("[data-remote-image]")?.getAttribute("src")).toBe("https://cdn.example.test/acme.svg");
    await click(view.querySelector("[data-entry-menu]"));
    const actions = [...document.querySelectorAll("[data-entry-action]")].map((node) => node.getAttribute("data-entry-action"));
    expect(actions).toEqual(expect.arrayContaining(["update", "plugin-page", "remove"]));
    expect(document.body.textContent).toContain("Uninstall the AcmeDesk plugin");
    await click(document.querySelector("[data-entry-action='plugin-page']"));
    expect(openPlugin).toHaveBeenCalled();
  });

  it("without a plugin the card reads as before", async () => {
    const view = await render(createElement("div", null, productRows(products, ctx(), { mode: "plugins", onOpenVendor: vi.fn() })[0]!.node));
    expect(view.querySelector("[data-vendor-line]")?.textContent).toBe("2 connectors · 2 on");
  });

  it("the group's page lists the plugin's row in its Overview and its skills under Skills", async () => {
    const vendor = groupByVendor(products)[0]!;
    const view = await render(createElement(VendorPage, {
      vendor, ctx: ctx(), onBack: vi.fn(),
      skills: [{ name: "init", description: "Set up" }, { name: "time", description: "Log time" }],
      plugins: { rows: [{ key: acme.key, node: createElement("div", { "data-test-plugin-row": "" }, "AcmeDesk plugin row") }] },
    }));
    expect(view.querySelector("[data-vendor-plugins] [data-test-plugin-row]")).not.toBeNull();
    expect(view.querySelector("[data-vendor-head]")?.textContent).toContain("2 connectors · 2 skills · 2 on");
    await click(view.querySelector("[data-vendor-tab='skills']"));
    expect(view.textContent).toContain("/init");
    expect(view.textContent).toContain("/time");
  });

  it("says ONE skills count on the page: the header, the Skills tab and Details count the same list (the console's skill and the plugin's)", async () => {
    const vendor = groupByVendor(products)[0]!;
    const view = await render(createElement(VendorPage, {
      vendor, ctx: ctx(), onBack: vi.fn(),
      skills: [{ name: "macros", description: "From the console" }, { name: "init", description: "Set up" }, { name: "time", description: "Log time" }],
      plugins: { rows: [{ key: acme.key, node: createElement("div", null, "row") }] },
    }));
    expect(view.querySelector("[data-vendor-head]")?.textContent).toContain("3 skills");
    expect(view.querySelector("[data-vendor-tab='skills']")?.textContent).toContain("3");
    const details = [...view.querySelectorAll("[data-plugin-details] dt")].find((node) => node.textContent === "Skills");
    expect(details?.nextElementSibling?.textContent).toBe("3");
  });

  it("keeps the plugin's state on the group's card: a plugin turned off says so on the line, a sign-in to finish is the card's warning", async () => {
    const rows = productRows(products, ctx(), { mode: "plugins", onOpenVendor: vi.fn(), plugins: () => ({
      skills: 2, off: true, state: { tone: "fix", text: "Needs sign-in" }, actions: {},
    }) });
    const view = await render(createElement("div", null, rows[0]!.node));
    expect(view.querySelector("[data-vendor-line]")?.textContent).toBe("2 connectors · 2 skills · 2 on · plugin off");
    // every product is on: the warning is the plugin's
    expect(view.querySelector("[data-row-state='fix']")).not.toBeNull();
  });

  it("puts a group whose plugin has an update first when sorted by Updates first", () => {
    const keys = (first?: (key: string) => boolean) => productRows(twoGroups, ctx(), { mode: "plugins", onOpenVendor: vi.fn() }, first).map((row) => row.key);
    expect(keys()).toEqual(["vendor:zeta", "vendor:acme"]);
    expect(keys((key) => key === "vendor:acme")).toEqual(["vendor:acme", "vendor:zeta"]);
  });

  it("rolls two states up to the worse one", () => {
    expect(worseState({ tone: "ok", text: "on" }, { tone: "fix", text: "sign in" })?.tone).toBe("fix");
    expect(worseState({ tone: "info", text: "i" }, null)?.tone).toBe("info");
    expect(worseState(undefined, undefined)).toBeUndefined();
  });

  it("is not listed again under Added by you, and no 'first plugin' banner shows; an unmatched plugin stays", async () => {
    const base = { entries, skills: [], sourceLabel: (source: string) => source, onOpenEntry: vi.fn(), onOpenSkill: vi.fn(), entryActions: () => ({}), kind: "plugins" as const };
    const grouped = await render(createElement(InstalledView, { ...base, grouped: new Set(grouping.groupOf.keys()) }));
    expect(grouped.querySelector(`[data-installed-entry="${acme.key}"]`)).toBeNull();
    expect(grouped.querySelector(`[data-installed-entry="${notes.key}"]`)).not.toBeNull();
    const alone = await render(createElement(InstalledView, { ...base, entries: [acme], grouped: new Set(grouping.groupOf.keys()) }));
    expect(alone.querySelector("[data-first-banner]")).toBeNull();
    // before: the plugin stood alone under Added by you
    const before = await render(createElement(InstalledView, base));
    expect(before.querySelector(`[data-installed-entry="${acme.key}"]`)).not.toBeNull();
  });
});
