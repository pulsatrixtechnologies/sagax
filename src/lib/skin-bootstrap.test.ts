import { describe, expect, it } from "vitest";
import { scriptSafeJson, skinBootstrapInlineScript, skinIdFromStored } from "./skin-bootstrap";

describe("skin bootstrap before hydration", () => {
  it("reads the last cached skin id", () => {
    expect(skinIdFromStored("midnight")).toBe("midnight");
    expect(skinIdFromStored("nope")).toBe("pulsatrix");
    expect(skinIdFromStored(null)).toBe("pulsatrix");
  });

  it("ships an inline script that stamps data-skin from localStorage", () => {
    const script = skinBootstrapInlineScript();
    expect(script).toContain("omb-skin");
    expect(script).toContain("document.documentElement.dataset.skin");
    expect(script).toContain("midnight");
  });

  it("escapes script-breaking characters in embedded JSON", () => {
    const input = ["</script><b>", "a\u2028b\u2029c", "x\\/y"];
    const out = scriptSafeJson(input);
    expect(out).not.toMatch(/[<>/\u2028\u2029]/);
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(JSON.parse(out)).toEqual(input);
  });
});

describe("skin bootstrap under Auto", () => {
  function stamp(stored: Record<string, string>, dark: boolean): Record<string, string> {
    const root = { dataset: {} as Record<string, string> };
    const fn = new Function("localStorage", "matchMedia", "document", skinBootstrapInlineScript());
    fn({ getItem: (key: string) => stored[key] ?? null }, () => ({ matches: dark }), { documentElement: root });
    return root.dataset;
  }
  const run = (stored: Record<string, string>, dark: boolean) => stamp(stored, dark).skin;

  it("swaps a paired skin for the system's scheme, and only under Auto", () => {
    expect(run({ "omb-skin": "midnight" }, false)).toBe("midnight");
    expect(run({ "omb-skin": "midnight", "omb-skin-mode": "auto" }, false)).toBe("daylight");
    expect(run({ "omb-skin": "atelier", "omb-skin-mode": "auto" }, true)).toBe("foundry");
    expect(run({ "omb-skin": "retro98", "omb-skin-mode": "auto" }, true)).toBe("retro98");
    expect(run({ "omb-skin-mode": "auto" }, false)).toBe("pulsatrix-light");
  });

  it("stamps the tint the skin's family has, before the first paint", () => {
    expect(stamp({ "omb-skin": "midnight", "omb-skin-tint": "red" }, false)).toEqual({ skin: "midnight", skinTint: "red" });
    expect(stamp({ "omb-skin": "midnight", "omb-skin-tint": "red", "omb-skin-mode": "auto" }, false)).toEqual({ skin: "daylight", skinTint: "red" });
    expect(stamp({ "omb-skin": "retro98", "omb-skin-tint": "win11" }, false)).toEqual({ skin: "retro98", skinTint: "win11" });
    // a tint the family lacks, or none: the family's own look
    expect(stamp({ "omb-skin": "pulsatrix", "omb-skin-tint": "blue" }, false)).toEqual({ skin: "pulsatrix" });
    expect(stamp({ "omb-skin": "midnight", "omb-skin-tint": "xp" }, false)).toEqual({ skin: "midnight" });
    expect(stamp({ "omb-skin": "midnight" }, false)).toEqual({ skin: "midnight" });
  });

  it("stamps the full intensity and a known texture, and nothing else", () => {
    expect(stamp({ "omb-skin": "midnight", "omb-skin-tint": "red", "omb-skin-depth": "full", "omb-skin-texture": "grid" }, false)).toEqual({
      skin: "midnight",
      skinTint: "red",
      skinDepth: "full",
      skinTexture: "grid",
    });
    expect(stamp({ "omb-skin": "midnight", "omb-skin-depth": "half", "omb-skin-texture": "stripes" }, false)).toEqual({ skin: "midnight" });
  });

  it("wears a retired look-alike as its base and colour", () => {
    expect(stamp({ "omb-skin": "dusk" }, false)).toEqual({ skin: "midnight", skinTint: "pink" });
    expect(stamp({ "omb-skin": "dusk", "omb-skin-mode": "auto" }, false)).toEqual({ skin: "daylight", skinTint: "pink" });
    expect(stamp({ "omb-skin": "lagoon", "omb-skin-tint": "red" }, false)).toEqual({ skin: "atelier", skinTint: "blue" });
  });
});
