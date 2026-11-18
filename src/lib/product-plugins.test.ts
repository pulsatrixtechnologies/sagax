import { describe, expect, it } from "vitest";

import { productMatchKey, productPlugins } from "./product-plugins";

const plugin = (name: string, market = "market") => ({ key: `plugin:${market}:${name}`, primary: { kind: "plugin", name } });
const server = (name: string) => ({ key: `mcp:${name}`, primary: { kind: "mcp", name } });

describe("productPlugins", () => {
  it("puts a marketplace plugin named for a product group in that group", () => {
    const groups = [{ key: "vendor:acme", name: "AcmeDesk" }, { key: "vendor:other", name: "Other Suite" }];
    const result = productPlugins(groups, [plugin("acmedesk"), plugin("notes")]);
    expect(result.byGroup.get("vendor:acme")?.map((entry) => entry.key)).toEqual(["plugin:market:acmedesk"]);
    expect(result.groupOf.get("plugin:market:acmedesk")).toBe("vendor:acme");
    // a plugin that matches no group stays where it is
    expect(result.groupOf.has("plugin:market:notes")).toBe(false);
  });

  it("compares names without case, accents, spaces or punctuation", () => {
    expect(productMatchKey("Acme-Desk")).toBe(productMatchKey("acme desk"));
    expect(productMatchKey("Équipe")).toBe("equipe");
    const result = productPlugins([{ key: "vendor:x", name: "Acme Desk" }], [plugin("acme-desk")]);
    expect(result.groupOf.get("plugin:market:acme-desk")).toBe("vendor:x");
  });

  it("never matches a part of a name", () => {
    const result = productPlugins([{ key: "vendor:x", name: "AcmeDesk Manage" }, { key: "vendor:y", name: "Docs" }], [plugin("acmedesk"), plugin("docs-tools")]);
    expect(result.groupOf.size).toBe(0);
  });

  it("only groups plugins, never a server or an app of the same name", () => {
    const result = productPlugins([{ key: "vendor:x", name: "AcmeDesk" }], [server("acmedesk")]);
    expect(result.groupOf.size).toBe(0);
  });

  it("keeps every plugin of the same name (two marketplaces) in the group", () => {
    const result = productPlugins([{ key: "vendor:x", name: "AcmeDesk" }], [plugin("acmedesk", "one"), plugin("acmedesk", "two")]);
    expect(result.byGroup.get("vendor:x")).toHaveLength(2);
  });
});
