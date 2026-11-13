// The conversation bubbles (2026-10-28): the person's own message is filled
// with the accent, a bot's reply (and another person's message in a room) is a
// neutral grey, and the text on the accent reads at 4.5:1 or better (WCAG 1.4.3)
// (2026-10-29: the accent exactly, the accent button's ink on it; #4096:
// white text on a coloured accent as the reference, the hue a step deeper
// where white would not read)
// on every skin, colour, Full colour, duo-tone, mood and Windows edition, plus
// a brand accent over every skin.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { BRAND_BUBBLE_VARS, BUBBLE_MIN_CONTRAST, BUBBLE_WELL_DEPTH, SCOPED_BUBBLE_VARS, accentInk, botBubbleVars, bubbleDrift, brandBubbleVars, bubbleColors, isNeutralAccent, userBubble, whiteInkFill, type BubbleColors } from "./bubble-colors";
import { contrastRatio, mixSrgb } from "./color-contrast";
import { MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { contrastHex, parseHex, type Scheme } from "./switch-colors";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Context = { id: string; selector: string; scheme: Scheme; app: string; ink: string; accent: string; accentTo?: string; buttonInk?: string; colors: BubbleColors; userTo: string };
let contexts: Context[];
let generated: string;
let css: string;

beforeAll(async () => {
  const mod = (await import(pathToFileURL(join(ROOT, "scripts", "gen-bubble-tokens.mjs")).href)) as {
    bubbleContexts: () => Context[];
    bubbleStylesheet: () => string;
  };
  contexts = mod.bubbleContexts();
  generated = mod.bubbleStylesheet();
  css = readFileSync(join(ROOT, "src/styles/skin-bubble.css"), "utf8");
});

/** The values the shipped stylesheet gives one selector (a brand fallback read as its default). */
function shipped(selector: string): BubbleColors {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no block for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(at, css.indexOf("}", at));
  const value = (name: string) => {
    const raw = new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].trim() ?? "";
    return raw.startsWith("var(") ? raw.replace(/^var\([^,]+,\s*/, "").replace(/\)$/, "") : raw;
  };
  return { user: value("--color-bubble-user"), userInk: value("--color-bubble-user-ink"), userWell: value("--color-bubble-user-well"), bot: value("--color-bubble-bot") };
}

/** The colour a shipped block's bubble drifts toward on a duo-tone (`--color-bubble-user-to`, its brand fallback read as its default). */
function shippedTo(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  const body = css.slice(at, css.indexOf("}", at));
  const raw = /--color-bubble-user-to:\s*([^;]+);/.exec(body)?.[1].trim() ?? "";
  return raw.startsWith("var(") ? raw.replace(/^var\([^,]+,\s*/, "").replace(/\)$/, "") : raw;
}

describe("bubble colours", () => {
  it("covers every skin, colour, duo-tone, mood and edition, in both schemes", () => {
    const ids = new Set(contexts.map((c) => c.id));
    for (const family of ["pulsatrix", "pulsatrix-light", "midnight", "daylight", "atelier", "foundry"]) {
      expect(ids.has(family)).toBe(true);
      for (const tint of ["red", "pink", "green", "yellow", "aurore", "ocean", "neon", "foret", "sunset", "nordic"]) expect(ids.has(`${family}+${tint}`), `${family}+${tint}`).toBe(true);
    }
    expect([...ids].some((id) => id.startsWith("retro98+"))).toBe(true);
    expect(new Set(contexts.map((c) => c.scheme))).toEqual(new Set(["light", "dark"]));
  });

  it("the stylesheet is the derivation's output (pnpm gen:bubble after a palette change)", () => {
    expect(css).toBe(generated);
    expect(readFileSync(join(ROOT, "src/styles.css"), "utf8")).toContain('@import "./styles/skin-bubble.css";');
  });

  it("reads the text on the person's bubble at 4.5:1 or better, for every skin and accent as shipped", () => {
    const problems = contexts.flatMap((c) => {
      const s = shipped(c.selector);
      const ratio = contrastHex(s.userInk, s.user);
      return ratio >= BUBBLE_MIN_CONTRAST ? [] : [`${c.id}: ${ratio.toFixed(2)}:1`];
    });
    expect(problems).toEqual([]);
  });

  it("writes a coloured accent's bubble in white, on the accent or the same hue a step deeper (#4096)", () => {
    for (const c of contexts) {
      if (isNeutralAccent(c.accent)) {
        // a neutral accent keeps the accent exactly, with the button's ink where it reads
        expect(c.colors.user, c.id).toBe(c.accent.toLowerCase());
        if (c.buttonInk && contrastHex(c.buttonInk, c.accent) >= BUBBLE_MIN_CONTRAST) expect(c.colors.userInk, c.id).toBe(c.buttonInk.toLowerCase());
        else expect(c.colors.userInk, c.id).toBe(accentInk(c.accent));
      } else {
        expect(c.colors.userInk, c.id).toBe("#ffffff");
        expect(c.colors.user, c.id).toBe(whiteInkFill(c.accent.toLowerCase()));
      }
    }
    expect(userBubble("#2f62dd")).toMatchObject({ user: "#2f62dd", userInk: "#ffffff" });
  });

  it("keeps the ink at 4.5:1 on every surface inside the bubble (a code span, a quote, a chip), as shipped", () => {
    const problems = contexts.flatMap((c) => {
      const s = shipped(c.selector);
      return [0.08, 0.12, 0.16, BUBBLE_WELL_DEPTH].flatMap((w) => {
        const ratio = contrastRatio(s.userInk, mixSrgb(s.userWell, s.user, w));
        return ratio >= BUBBLE_MIN_CONTRAST ? [] : [`${c.id} at ${w}: ${ratio.toFixed(2)}:1`];
      });
    });
    expect(problems).toEqual([]);
  });

  // Regression (#4096, review): on a duo-tone the bubble drifts toward the
  // far end (skin-duo.css). With the fill cut to just reach 4.5:1 under white,
  // a raw lighter far end (#fb923c, #2dd4bf, #a3e635) pulled the corner down
  // to 3.7:1. The drift now goes to the far end's own white-ink fill.
  it("keeps white text at 4.5:1 across a duo-tone bubble's gradient, its far corner included, as shipped", () => {
    const duo = readFileSync(join(ROOT, "src/styles/skin-duo.css"), "utf8");
    const rule = /\.bg-bubble-user\s*\{([^}]*)\}/.exec(duo)?.[1] ?? "";
    expect(rule).toContain("color-mix(in srgb, var(--color-bubble-user-to, var(--color-bubble-user)) 16%, transparent)");
    const duos = contexts.filter((c) => c.accentTo);
    expect(duos.length).toBeGreaterThanOrEqual(40);
    const problems = duos.flatMap((c) => {
      const s = shipped(c.selector);
      const to = shippedTo(c.selector);
      expect(parseHex(to), `${c.id} ${to}`).not.toBeNull();
      return [0.04, 0.08, 0.12, 0.16].flatMap((w) => {
        const ratio = contrastRatio(s.userInk, mixSrgb(to, s.user, w));
        return ratio >= BUBBLE_MIN_CONTRAST ? [] : [`${c.id} toward ${to} at ${w}: ${ratio.toFixed(2)}:1`];
      });
    });
    expect(problems).toEqual([]);
    // the drift keeps the far end's hue where white reads on it
    expect(bubbleDrift("#bd1475", "#ffffff", "#fb923c")).toBe(whiteInkFill("#fb923c"));
    // no far end, or an ink that is not white: no drift
    expect(bubbleDrift("#f5f5f5", "#121212", "#fb923c")).toBe("#f5f5f5");
    expect(bubbleDrift("#316ef3", "#ffffff")).toBe("#316ef3");
    // a bot's own bubble stops the skin's drift at its own fill
    const vars = botBubbleVars("#f472b6");
    expect(vars["--color-bubble-user-to"]).toBe(vars["--color-bubble-user"]);
    expect(Object.keys(vars).sort()).toEqual([...SCOPED_BUBBLE_VARS].sort());
  });

  it("makes the bot's bubble a neutral grey off the page, with the page's own text readable on it", () => {
    for (const c of contexts) {
      const bot = shipped(c.selector).bot;
      const [r, g, b] = parseHex(bot)!;
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${c.id} ${bot}`).toBeLessThanOrEqual(1);
      expect(bot.toLowerCase(), c.id).not.toBe(c.app.toLowerCase());
      const ratio = contrastHex(c.ink, bot);
      expect(ratio, `${c.id}: ink ${c.ink} on ${bot}`).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
      // lighter than a dark page, darker than a light one
      expect(c.scheme === "dark" ? contrastHex(bot, "#ffffff") < contrastHex(c.app, "#ffffff") : contrastHex(bot, "#ffffff") > contrastHex(c.app, "#ffffff"), c.id).toBe(true);
    }
  });

  it("holds 4.5:1 for any brand accent, a hue sweep included", () => {
    const accents = ["#f97316", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ffffff", "#000000", "#808080", "#e8e8e8", "#c2410c", "#7c3aed", "#14b8a6"];
    for (let hue = 0; hue < 360; hue += 15) accents.push(`hsl:${hue}`);
    for (const accent of accents) {
      const hex = accent.startsWith("hsl:") ? hslHex(Number(accent.slice(4))) : accent;
      const { user, userInk, userWell } = userBubble(hex);
      if (isNeutralAccent(hex)) {
        expect(user, hex).toBe(hex.toLowerCase());
        expect(userInk, hex).toBe(accentInk(hex));
      } else {
        expect(user, hex).toBe(whiteInkFill(hex));
        expect(userInk, hex).toBe("#ffffff");
      }
      expect(contrastHex(userInk, user), `${hex} -> ${userInk}`).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
      expect(contrastRatio(userInk, mixSrgb(userWell, user, BUBBLE_WELL_DEPTH)), `${hex} well`).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
      const vars = brandBubbleVars(hex);
      expect(vars["--brand-bubble-user"]).toBe(user);
      expect(vars["--brand-bubble-user-ink"]).toBe(userInk);
      expect(vars["--brand-bubble-user-well"]).toBe(userWell);
    }
    expect(Object.keys(brandBubbleVars("#f97316")).sort()).toEqual([...BRAND_BUBBLE_VARS].sort());
    expect(brandBubbleVars("not a colour")).toEqual({});
    expect(brandBubbleVars(undefined)).toEqual({});
  });

  // Regression (#4096): the person's bubble on a saturated accent (a pink, an
  // orange) was written in near black; the reference writes every accent
  // bubble in white and keeps a deeper shade of the hue where white would not
  // read. Same hue, white text, 4.5:1, the bubble and everything in it.
  it("writes a saturated accent's bubble in white, as the reference", () => {
    for (const accent of ["#f472b6", "#ec4899", "#f97316", "#ff9500", "#e78531", "#facc15", "#4ade80", "#60a5fa"]) {
      const { user, userInk, userWell } = userBubble(accent);
      expect(userInk, accent).toBe("#ffffff");
      expect(contrastHex(user, userInk), accent).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
      // the same hue, deeper only as far as white needs
      expect(Math.abs(hueOf(user) - hueOf(accent)), accent).toBeLessThan(4);
      expect(contrastHex(user, userInk), accent).toBeLessThan(4.7);
      // a code span's well sinks under white text instead of lifting
      expect(userWell, accent).toBe("#000000");
    }
    // an accent white already reads on stays exactly itself
    expect(userBubble("#5b21b6")).toMatchObject({ user: "#5b21b6", userInk: "#ffffff" });
    // a skin's own dark button ink no longer wins on a coloured accent
    expect(userBubble("#f97316", "#1c150c").userInk).toBe("#ffffff");
    // a neutral accent keeps its button's ink
    expect(userBubble("#f5f5f5", "#121212")).toMatchObject({ user: "#f5f5f5", userInk: "#121212" });
  });

  it("writes every bot colour's bubble in white at 4.5:1, its inner surfaces included", () => {
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const vars = botBubbleVars(hex);
      const user = vars["--color-bubble-user"]!;
      const ink = vars["--color-bubble-user-ink"]!;
      if (!isNeutralAccent(hex)) expect(ink, name).toBe("#ffffff");
      for (const w of [0, 0.08, 0.12, 0.16, BUBBLE_WELL_DEPTH]) {
        const surface = w ? mixSrgb(vars["--color-bubble-user-well"]!, user, w) : user;
        expect(contrastRatio(ink, surface), `${name} at ${w}`).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
      }
    }
  });

  it("accentInk is white or near black, black only where neither reaches 4.5:1", () => {
    for (let hue = 0; hue < 360; hue += 5) for (const hex of [hslHex(hue), "#808080", "#767676", "#949494"]) {
      const ink = accentInk(hex);
      expect(contrastHex(ink, hex), `${hex} ${ink}`).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
      if (ink === "#000000") expect(Math.max(contrastHex(hex, "#ffffff"), contrastHex(hex, "#111111"))).toBeLessThan(BUBBLE_MIN_CONTRAST);
    }
  });

  it("bubbleColors combines both", () => {
    const c = bubbleColors({ accent: "#2f62dd", app: "#ffffff", scheme: "light" });
    expect(c.user).toBe("#2f62dd");
    expect(parseHex(c.bot)![0]).toBeLessThan(255);
  });
});

describe("bubble stylesheet rules", () => {
  const styles = readFileSync(join(ROOT, "src/styles.css"), "utf8");

  it("paints the person's bubble with its own ink and keeps what it holds readable", () => {
    const rule = /\.bg-bubble-user\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    expect(rule).toContain("color: var(--color-bubble-user-ink)");
    for (const token of ["--color-ink", "--color-accent", "--color-accent-text", "--color-ink-secondary", "--color-ink-tertiary"]) {
      expect(rule, token).toMatch(new RegExp(`${token}:\\s*var\\(--color-bubble-user-ink\\)`));
    }
  });

  it("declares the bot's grey as a utility and a default", () => {
    expect(styles).toMatch(/--color-bubble-bot:\s*#[0-9a-f]{6};/i);
    expect(styles).toMatch(/\.bg-bubble-bot\s*\{/);
  });
});

function hueOf(hex: string): number {
  const [r, g, b] = parseHex(hex)!.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hslHex(h: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
