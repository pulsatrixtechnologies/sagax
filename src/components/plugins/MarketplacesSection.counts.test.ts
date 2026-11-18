// Row counts in the Marketplaces list use each noun's plural form (#4645).
import { afterEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import { marketCounts } from "./MarketplacesSection";

afterEach(() => setLocale("en"));

describe("marketCounts", () => {
  it("pluralizes in English", () => {
    expect(marketCounts(1, 1)).toBe("1 plugin, 1 installed");
    expect(marketCounts(2, 0)).toBe("2 plugins, 0 installed");
  });
  it("pluralizes in French, where 0 is singular", async () => {
    await loadLocale("fr");
    expect(marketCounts(1, 1)).toBe("1 plugin, 1 installé");
    expect(marketCounts(2, 0)).toBe("2 plugins, 0 installé");
    expect(marketCounts(3, 2)).toBe("3 plugins, 2 installés");
  });
});
