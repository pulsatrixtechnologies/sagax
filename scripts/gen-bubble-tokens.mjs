#!/usr/bin/env node
// Writes src/styles/skin-bubble.css: the conversation bubbles for every skin,
// colour, Full colour, duo-tone, mood and Windows edition, derived by
// src/lib/bubble-colors.ts from the tokens each block resolves to (read with
// the contrast script's own parser, so nothing is copied by hand): the
// person's own bubble in the accent with white text (the hue a step deeper
// where white would not read at 4.5:1; a neutral accent keeps the button's
// ink), the well its inner surfaces mix toward, the bot's in a neutral grey.
//
//   pnpm gen:bubble          # rewrite the stylesheet after a palette change
//
// src/lib/bubble-colors.test.ts fails while the file is out of date.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { skinIds, skinTokens } from "./check-skin-contrast.mjs";
import { stylesheets } from "./gen-switch-tokens.mjs";
import { bubbleColors, bubbleDrift, isNeutralAccent, roomBubbleColors } from "../src/lib/bubble-colors.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BUBBLE_CSS = join(ROOT, "src/styles/skin-bubble.css");

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

const OPAQUE = /^#[0-9a-f]{6}$/i;

/** One context per skin block: its selector, the scheme, the page and ink and the bubbles. */
export function bubbleContexts(css = stylesheets()) {
  return skinIds(css).map((id) => {
    const tokens = skinTokens(css, id) ?? {};
    const pick = (name, fallback) => (OPAQUE.test(tokens[name] ?? "") ? tokens[name] : fallback);
    const app = pick("--color-app", "#ffffff");
    const ink = pick("--color-ink", "#000000");
    const accent = pick("--color-accent", app);
    // the ink the skin draws on its accent buttons: the bubble keeps it when it reads
    const buttonInk = pick("--color-accent-ink", undefined);
    // a duo-tone's far end, which the person's bubble drifts toward (skin-duo.css)
    const accentTo = pick("--accent-to", undefined);
    const scheme = luminance(app) < 0.2 ? "dark" : "light";
    const [skin, tint, full] = id.split("+");
    // `[data-skin]` is named twice: one step of specificity over the skin blocks
    // of styles.css, which come after this file's import and would win a tie.
    const selector = `[data-skin="${skin}"][data-skin="${skin}"]` + (tint ? `[data-skin-tint="${tint}"]` : "") + (full ? `[data-skin-depth="full"]` : "");
    const colors = bubbleColors({ accent, app, scheme, buttonInk });
    return { id, selector, scheme, app, ink, accent, accentTo, buttonInk, colors, userTo: bubbleDrift(colors.user, colors.userInk, accentTo) };
  });
}

/** The stylesheet text. */
export function bubbleStylesheet(css = stylesheets()) {
  // a brand accent (brand.ts) wins over the skin's own, except on Hibou 98
  // a brand's bubble does not drift: its far end is its own fill
  const block = ({ id, selector, colors: c, userTo }) => {
    const brand = !id.startsWith("retro98");
    const user = brand ? `var(--brand-bubble-user, ${c.user})` : c.user;
    const ink = brand ? `var(--brand-bubble-user-ink, ${c.userInk})` : c.userInk;
    const well = brand ? `var(--brand-bubble-user-well, ${c.userWell})` : c.userWell;
    const to = brand ? `var(--brand-bubble-user, ${userTo})` : userTo;
    return `${selector} {\n  --color-bubble-user: ${user};\n  --color-bubble-user-ink: ${ink};\n  --color-bubble-user-well: ${well};\n  --color-bubble-user-to: ${to};\n  --color-bubble-bot: ${c.bot};\n}\n`;
  };
  const contexts = bubbleContexts(css);
  const fallback = contexts.find((c) => c.id === "pulsatrix");
  // A room on a skin whose accent is a neutral: the person's bubble takes the
  // brand's accent (Pulsatrix's of the same scheme, a deployment's first).
  // Every variant of such a skin gets its own rule, so a coloured tint of it
  // keeps its own accent rather than the base's fallback.
  const light = contexts.find((c) => c.id === "pulsatrix-light") ?? fallback;
  const brandOf = { dark: fallback?.accent ?? "#2e6cf3", light: light?.accent ?? "#2e6cf3" };
  const brandInkOf = { dark: fallback?.buttonInk, light: light?.buttonInk };
  const neutralSkins = new Set(contexts.filter((c) => isNeutralAccent(c.accent)).map((c) => c.id.split("+")[0]));
  const room = ({ id, selector, scheme, accent, accentTo, buttonInk }) => {
    const c = roomBubbleColors({ accent, brand: brandOf[scheme], buttonInk, brandInk: brandInkOf[scheme] });
    const brand = !id.startsWith("retro98");
    const user = brand ? `var(--brand-bubble-user, ${c.user})` : c.user;
    const ink = brand ? `var(--brand-bubble-user-ink, ${c.userInk})` : c.userInk;
    const well = brand ? `var(--brand-bubble-user-well, ${c.userWell})` : c.userWell;
    const drift = bubbleDrift(c.user, c.userInk, accentTo);
    const to = brand ? `var(--brand-bubble-user, ${drift})` : drift;
    return `${selector} [data-room-bubble] {\n  --color-bubble-user: ${user};\n  --color-bubble-user-ink: ${ink};\n  --color-bubble-user-well: ${well};\n  --color-bubble-user-to: ${to};\n}\n`;
  };
  const lines = [
    "/* GENERATED by scripts/gen-bubble-tokens.mjs from the skin blocks: do not edit.",
    "   The conversation bubbles for every skin and variant (src/lib/bubble-colors.ts):",
    "   the person's own in the accent with white text (a step deeper where white would not read at",
    "   4.5:1; a neutral accent keeps the button's ink), the well its inner surfaces mix toward, the",
    "   bot's in a neutral grey, and the duo-tone's far end the bubble drifts toward (white still reads",
    "   on it at 4.5:1; skin-duo.css). Imported after every skin block so it wins over their own",
    "   --color-bubble-user. `pnpm gen:bubble` rewrites it. */",
    "",
    fallback ? block({ ...fallback, selector: ":root:root" }) : "",
    ...contexts.map(block),
    "/* A room on a skin whose accent is a neutral: the brand's accent (src/lib/bubble-colors.ts, roomBubbleColors). */",
    "",
    ...contexts.filter((c) => neutralSkins.has(c.id.split("+")[0])).map(room),
  ];
  return lines.join("\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  writeFileSync(BUBBLE_CSS, bubbleStylesheet());
  console.log(`wrote ${BUBBLE_CSS}`);
}
