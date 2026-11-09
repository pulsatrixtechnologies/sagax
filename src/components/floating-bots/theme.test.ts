import { describe, expect, it } from "vitest";
import { accentInk } from "@/lib/brand";
import { applyFloatingTheme, cleanTheme, readAppTheme, themeVars } from "./theme";
import { chatFrameRate, mascotTaskFor } from "./FloatingBotView";
import { brandBubbleVars } from "@/lib/bubble-colors";
import { brandSwitchVars } from "@/lib/switch-colors";

/** The bits of an element the theme touches: its data attributes and inline custom properties. */
function element() {
  const props = new Map<string, string>();
  return {
    dataset: {} as Record<string, string>,
    style: {
      getPropertyValue: (name: string) => props.get(name) ?? "",
      setProperty: (name: string, value: string) => void props.set(name, value),
      removeProperty: (name: string) => void props.delete(name),
    },
  } as unknown as HTMLElement;
}

describe("the desktop balloon wears the app's theme", () => {
  it("reads the skin and the brand accent the app page stamped", () => {
    const root = element();
    expect(readAppTheme(root)).toBeUndefined();
    root.dataset.skin = "pulsatrix-light";
    expect(readAppTheme(root)).toEqual({ skin: "pulsatrix-light" });
    root.style.setProperty("--color-accent", "#ff6600");
    expect(readAppTheme(root)).toEqual({ skin: "pulsatrix-light", accent: "#ff6600" });
    root.dataset.skin = "not-a-skin";
    expect(readAppTheme(root)).toBeUndefined();
  });

  it("maps the accent to every accent token, and clears them without one", () => {
    expect(themeVars({ skin: "midnight", accent: "#ff6600" })).toEqual({
      "--color-accent": "#ff6600",
      "--color-accent-border": "#ff6600",
      "--color-focus": "#ff6600",
      "--color-accent-text": "light-dark(#a64200, #ff6600)", // the brand's link step (#3035)
      "--color-accent-ink": accentInk("#ff6600"),
      ...brandSwitchVars("#ff6600"),
      ...brandBubbleVars("#ff6600"),
    });
    expect(Object.values(themeVars({ skin: "midnight" })).every((value) => value === "")).toBe(true);
  });

  it("stamps a theme on the window and follows a change, light to dark and back", () => {
    const root = element();
    applyFloatingTheme({ skin: "pulsatrix-light", accent: "#123456" }, root);
    expect(root.dataset.skin).toBe("pulsatrix-light");
    expect(root.style.getPropertyValue("--color-accent")).toBe("#123456");
    applyFloatingTheme({ skin: "midnight" }, root);
    expect(root.dataset.skin).toBe("midnight");
    expect(root.style.getPropertyValue("--color-accent")).toBe("");
    // a snapshot without a theme (an older brain) leaves the window as it is
    applyFloatingTheme(undefined, root);
    expect(root.dataset.skin).toBe("midnight");
  });

  it("takes only known skins and plain hex accents (main checks the same: floating-bot-window.test.mjs)", () => {
    expect(cleanTheme({ skin: "dusk", accent: "#abcdef" })).toEqual({ skin: "dusk", accent: "#abcdef" });
    expect(cleanTheme({ skin: "dusk", accent: "red; background: url(x)" })).toEqual({ skin: "dusk" });
    expect(cleanTheme({ skin: "nope" })).toBeUndefined();
  });
});

describe("the mascot while its balloon is open", () => {
  it("stays home while the bot works on the reply, and flies off once the balloon closes", () => {
    expect(mascotTaskFor("working", true)).toBe("idle");
    expect(mascotTaskFor("working", false)).toBe("working");
    // an approval or an error still shows
    expect(mascotTaskFor("waiting", true)).toBe("waiting");
    expect(mascotTaskFor("error", true)).toBe("error");
  });

  it("lives at half rate at most behind the chat", () => {
    expect(chatFrameRate(60, true)).toBe(30);
    expect(chatFrameRate(12, true)).toBe(12);
    expect(chatFrameRate(60, false)).toBe(60);
  });
});
