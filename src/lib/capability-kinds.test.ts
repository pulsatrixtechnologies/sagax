// Connect Apps' three kinds (#4453): every row lands in exactly one tab.
import { describe, expect, it } from "vitest";

import { capabilityFixture } from "./capabilities.fixture";
import { visibleCapabilities } from "./capabilities";
import { buildPluginItems, type PluginKind } from "./plugins-model";
import { installedEntries } from "./installed-model";
import type { CapabilityForm } from "../../shared/capabilities";
import {
  CONNECT_APPS_KINDS,
  groupByVendor,
  whereLabel,
  declarationForms,
  entryKind,
  fromOrganization,
  kindCounts,
  kindOf,
  normalizeKind,
  ofKind,
} from "./capability-kinds";

const FORMS: CapabilityForm[] = ["plugin", "skill", "mcp", "connector", "role", "flow", "product"];
const ITEM_KINDS: PluginKind[] = ["app", "mcp", "featured", "skill", "plugin"];

describe("the three kinds of Connect Apps", () => {
  it("names the tabs in the reference's order", () => {
    expect(CONNECT_APPS_KINDS).toEqual(["skills", "connectors", "plugins"]);
  });

  it("puts every resolved form and every catalog kind in exactly one tab", () => {
    for (const form of FORMS) {
      const tabs = CONNECT_APPS_KINDS.filter((kind) => kindOf({ form }) === kind);
      expect(tabs, form).toHaveLength(1);
    }
    expect(kindOf({ form: "skill" })).toBe("skills");
    expect(kindOf({ form: "plugin" })).toBe("plugins");
    expect(kindOf({ form: "flow" })).toBe("plugins");
    for (const form of ["mcp", "connector", "product", "role"] as const) expect(kindOf({ form })).toBe("connectors");
    for (const kind of ITEM_KINDS) {
      const tabs = CONNECT_APPS_KINDS.filter((tab) => kindOf({ kind }) === tab);
      expect(tabs, kind).toHaveLength(1);
    }
    expect(kindOf({ kind: "skill" })).toBe("skills");
    expect(kindOf({ kind: "plugin" })).toBe("plugins");
    for (const kind of ["app", "featured", "mcp"] as const) expect(kindOf({ kind })).toBe("connectors");
  });

  // regression (#4453): the flat "Capabilities" list mixed every form; split
  // in three, each row listed at This bot shows once, in one tab only
  it("lists every row of a bot once across the three tabs", () => {
    const rows = visibleCapabilities(capabilityFixture().items);
    const byTab = CONNECT_APPS_KINDS.map((kind) => ofKind(rows, kind, kindOf));
    const keys = byTab.flat().map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(rows.map((row) => row.key).sort());
    const counts = kindCounts(rows, kindOf);
    expect(counts.skills + counts.connectors + counts.plugins).toBe(rows.length);
    expect(byTab.map((list) => list.length)).toEqual([counts.skills, counts.connectors, counts.plugins]);
  });

  it("sorts an installed entry by the row that stands for it", () => {
    const items = buildPluginItems({
      servers: [
        { name: "github", enabled: true, url: "https://api.githubcopilot.com/mcp/" },
        { name: "github-github", enabled: true, url: "https://api.githubcopilot.com/mcp/", source: "claude-plugins-official" },
        { name: "docs", enabled: true, url: "https://docs.example.com/mcp" },
      ],
      marketplaces: [{ name: "claude-plugins-official", plugins: [{ name: "github", installed: true, servers: ["github-github"], skills: [] }] }],
    });
    const entries = installedEntries(items);
    // GitHub (the plugin and its server folded into one) is a plugin; Docs a connector
    expect(Object.fromEntries(entries.map((entry) => [entry.name, entryKind(entry)]))).toEqual({ GitHub: "plugins", Docs: "connectors" });
  });

  it("groups the organization's rows apart", () => {
    expect(fromOrganization({ scope: "bot", source: { kind: "perspicax" } })).toBe(true);
    expect(fromOrganization({ scope: "organization", source: { kind: "marketplace" } })).toBe(true);
    expect(fromOrganization({ scope: "me", source: { kind: "file" } })).toBe(false);
  });

  it("reads a kind from a link and maps it to the organization's declaration forms", () => {
    expect(normalizeKind("connectors")).toBe("connectors");
    expect(normalizeKind("installed")).toBeNull();
    expect(normalizeKind(null)).toBeNull();
    expect(declarationForms("skills")).toEqual(["skill"]);
    expect(declarationForms("plugins")).toEqual(["plugin"]);
    expect(declarationForms("connectors")).toEqual(["mcp"]);
  });
});

describe("where an item is on (#4453)", () => {
  it("reads all, some or none of the person's bots", () => {
    expect(whereLabel(3, 3)).toEqual({ kind: "all" });
    expect(whereLabel(2, 3)).toEqual({ kind: "some", count: 2 });
    expect(whereLabel(1, 3)).toEqual({ kind: "some", count: 1 });
    expect(whereLabel(0, 3)).toEqual({ kind: "none" });
    // no bot at all is never "all"
    expect(whereLabel(0, 0)).toEqual({ kind: "none" });
    expect(whereLabel(1, 0)).toEqual({ kind: "none" });
  });
});

describe("one row per vendor (#4453)", () => {
  const product = (id: string, name: string, group?: { id: string; name: string }) => ({ id, name, ...(group ? { group } : {}) });
  const suite = { id: "harbor", name: "Harbor Suite" };

  it("files the products of one vendor under it, in the order the first of each appears", () => {
    const vendors = groupByVendor([product("desk", "Service Desk", suite), product("wiki", "Team Wiki"), product("rmm", "Remote Monitoring", suite), product("voice", "Phone Lines")]);
    expect(vendors.map((vendor) => [vendor.key, vendor.name, vendor.products.map((item) => item.id)])).toEqual([
      ["vendor:harbor", "Harbor Suite", ["desk", "rmm"]],
      ["product:wiki", "Team Wiki", ["wiki"]],
      ["product:voice", "Phone Lines", ["voice"]],
    ]);
  });

  it("never guesses a vendor from a name: without one a product is a vendor of one", () => {
    const vendors = groupByVendor([product("psa_company", "Harbor Manage: company"), product("psa_time", "Harbor Manage: time")]);
    expect(vendors).toHaveLength(2);
  });

  it("loses no product and shows none twice", () => {
    const products = [product("a", "A", suite), product("b", "B"), product("c", "C", suite), product("d", "D", { id: "beacon", name: "Beacon" })];
    const ids = groupByVendor(products).flatMap((vendor) => vendor.products.map((item) => item.id));
    expect([...ids].sort()).toEqual(["a", "b", "c", "d"]);
  });
});
