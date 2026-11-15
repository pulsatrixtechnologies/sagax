import { describe, expect, it } from "vitest";

import { BOT_PRODUCTS_MAX, botProductEnabled, botProductsAfter, botProductsOff, parseBotProductsPatch, productOfTool } from "./bot-products.ts";

describe("bot products (#4359)", () => {
  it("keeps every product on for a bot that never switched one (no bot loses a product by the upgrade)", () => {
    expect(botProductEnabled({}, "psa")).toBe(true);
    expect(botProductEnabled(undefined, "psa")).toBe(true);
    expect(botProductEnabled({ products: { psa: true } }, "psa")).toBe(true);
    expect(botProductEnabled({ products: { psa: false } }, "PSA")).toBe(false);
    expect([...botProductsOff({ products: { psa: false, edr: true } })]).toEqual(["psa"]);
  });

  it("takes product ids with booleans only", () => {
    expect(parseBotProductsPatch({ PSA: false, edr: true })).toEqual({ ok: true, value: { psa: false, edr: true } });
    expect(parseBotProductsPatch({ psa: "off" }).ok).toBe(false);
    expect(parseBotProductsPatch({ "../x": false }).ok).toBe(false);
    expect(parseBotProductsPatch([]).ok).toBe(false);
    expect(parseBotProductsPatch(null).ok).toBe(false);
  });

  it("merges a patch onto the saved switches, bounded", () => {
    expect(botProductsAfter({ psa: false }, { edr: false })).toEqual({ psa: false, edr: false });
    const many = Object.fromEntries(Array.from({ length: BOT_PRODUCTS_MAX }, (_, i) => [`p${i}`, false]));
    const after = botProductsAfter(many, { last: false });
    expect(Object.keys(after)).toHaveLength(BOT_PRODUCTS_MAX);
    expect(after.last).toBe(false);
  });

  it("finds a tool's product by the longest id it starts with", () => {
    const known = ["cw", "cw_psa", "edr"];
    expect(productOfTool("cw_psa_query", known)).toBe("cw_psa");
    expect(productOfTool("cw_psa__write", known)).toBe("cw_psa");
    expect(productOfTool("cw_rmm_query", known)).toBe("cw");
    expect(productOfTool("edr_query", known)).toBe("edr");
    expect(productOfTool("edr", known)).toBeUndefined();
    expect(productOfTool("memory_recall", known)).toBeUndefined();
  });
});
