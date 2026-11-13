// My bubble in a bot's colour (2026-10-28): on a skin whose accent is a
// neutral (Midnight's #f5f5f5) the person's bubble was white in every
// conversation. In a 1:1 with a bot it now takes the bot's colour (with
// white text as the reference since #4096, the hue a step deeper where white
// would not read at 4.5:1), whatever "Use bot color as accent" says, and
// the bot's own bubble stays grey. A room keeps the skin's accent, or the
// brand's when the skin's is a neutral.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { BUBBLE_MIN_CONTRAST, botBubbleVars, isNeutralAccent, roomBubbleColors, whiteInkFill } from "./bubble-colors";
import { contrastHex } from "./switch-colors";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const MIDNIGHT_USER = "#f5f5f5";

describe("my bubble in a 1:1 takes the bot's colour", () => {
  it("is not Midnight's white, is the bot's colour in white text and reads at 4.5:1", () => {
    const css = read("src/styles/skin-bubble.css");
    expect(css).toContain(`--color-bubble-user: var(--brand-bubble-user, ${MIDNIGHT_USER})`);
    for (const bot of ["#ff3b30", "#34c759", "#007aff", "#af52de", "#ff9500"]) {
      const vars = botBubbleVars(bot);
      const user = vars["--color-bubble-user"]!;
      const ink = vars["--color-bubble-user-ink"]!;
      expect(user).not.toBe(MIDNIGHT_USER);
      expect(user, bot).toBe(whiteInkFill(bot));
      expect(ink, bot).toBe("#ffffff");
      expect(contrastHex(user, ink)).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
    }
  });

  it("reads at 4.5:1 for every bot colour, white on every coloured one (#4096)", () => {
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const vars = botBubbleVars(hex);
      if (isNeutralAccent(hex)) expect(vars["--color-bubble-user"], name).toBe(hex.toLowerCase());
      else expect(vars["--color-bubble-user-ink"], name).toBe("#ffffff");
      expect(contrastHex(vars["--color-bubble-user"]!, vars["--color-bubble-user-ink"]!), name).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
    }
  });

  it("sets only the person's bubble, never the bot's grey; nothing for a colour that is not #rrggbb", () => {
    expect(Object.keys(botBubbleVars("#ff3b30")).sort()).toEqual(["--color-bubble-user", "--color-bubble-user-ink", "--color-bubble-user-to", "--color-bubble-user-well"]);
    expect(botBubbleVars(undefined)).toEqual({});
    expect(botBubbleVars("blue")).toEqual({});
  });

  it("is applied where my bubble shows next to a bot, without the accent setting", () => {
    const chat = [
      read("src/components/ChatView.tsx"),
      read("src/components/ChatView.tsx-parts/useChatViewPresence.tsx"),
      read("src/components/ChatView.tsx-parts/ChatViewShell.tsx"),
    ].join("\n");
    expect(chat).toMatch(/botBubbleVars\(MAUS_COLORS\[bot\.color\]\)/);
    expect(chat).toMatch(/style=\{bubbleStyle\}/);
    expect(read("src/components/code/RunTimeline.tsx")).toMatch(/style=\{botBubbleVars\(botColor\)/);
    expect(read("src/components/code/RunView.tsx")).toMatch(/botColor=\{botColor\}/);
    expect(read("src/components/floating-bots/FloatingBotView.tsx")).toMatch(/botBubbleVars\(owlHex\(snapshot\.color\)\)/);
    // the switch from "Use bot color as accent" never gates it
    expect(chat.slice(chat.indexOf("const bubbleStyle"), chat.indexOf("const bubbleStyle") + 200)).not.toMatch(/accentEnabled|useBotAccentEnabled/);
  });
});

describe("my bubble in a room", () => {
  it("takes the brand's accent on a neutral skin and the skin's otherwise", () => {
    expect(isNeutralAccent(MIDNIGHT_USER)).toBe(true);
    expect(isNeutralAccent("#2e6cf3")).toBe(false);
    expect(roomBubbleColors({ accent: MIDNIGHT_USER, brand: "#2e6cf3" }).user).toBe("#2e6cf3");
    expect(roomBubbleColors({ accent: "#a05f25", brand: "#2e6cf3" }).user).not.toBe("#2e6cf3");
    const css = read("src/styles/skin-bubble.css");
    const at = css.indexOf('[data-skin="midnight"][data-skin="midnight"] [data-room-bubble] {');
    expect(at).toBeGreaterThan(0);
    // Pulsatrix's dark accent, a step deeper so its white text reads (#4096)
    expect(css.slice(at, css.indexOf("}", at))).toContain(`var(--brand-bubble-user, ${whiteInkFill("#3c76f4")})`);
    expect(css.slice(at, css.indexOf("}", at))).toContain("var(--brand-bubble-user-ink, #ffffff)");
    expect(read("src/components/GroupView.tsx")).toMatch(/data-room-bubble=""/);
  });
});
