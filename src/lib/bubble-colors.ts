// The colours of the conversation bubbles (2026-10-28; white ink as the
// reference 2026-11-12, #4096). The person's own message is a bubble filled
// with the accent, so the skin, colour, duo-tone or mood they chose shows in
// the thread; a bot's reply (and another person's message in a room) is a
// quiet grey bubble, a little off the page.
//
//   - on a coloured accent the text is white, as the reference writes every
//     accent bubble; the fill is the accent itself where white reads on it at
//     4.5:1 (WCAG 1.4.3, normal text), else the same hue a step deeper until
//     it does, as the reference keeps its own deeper bubble shade of each
//     hue. One function decides it (`userBubble`); the desktop, the web and
//     the phone (ios/Sources/CompanionCore/BubbleColors.swift) follow it;
//   - a neutral accent (white, grey, black) keeps the accent exactly with the
//     accent button's ink (accentInk): white or near black, whichever reads;
//   - the grey is neutral in every skin, lighter than a dark page and darker
//     than a light one, and the page's own text reads on it.
//
// Pure: the stylesheet generator (scripts/gen-bubble-tokens.mjs), the brand
// accent (brand.ts), the bot accent (bot-accent.ts) and the tests call it;
// nothing here touches the DOM.
import { contrastRatio, mixSrgb, toneForSurface } from "./color-contrast.ts";
import { contrastHex, fromHsl, parseHex, toHex, toHsl, type Scheme } from "./switch-colors.ts";

export interface BubbleColors {
  /** The person's own bubble: the accent, deepened only where white would not read on it. */
  user: string;
  /** The text on that bubble: white on a coloured accent, the button's ink on a neutral one. */
  userInk: string;
  /** What the surfaces inside that bubble (a code span's well, a quote, a chip) mix toward (`bubbleWell`). */
  userWell: string;
  /** The bot's bubble: a neutral grey. */
  bot: string;
}

/** WCAG 1.4.3, normal text. */
export const BUBBLE_MIN_CONTRAST = 4.5;
const LIGHT_INK = "#ffffff";
const DARK_INK = "#111111";
const BLACK_INK = "#000000";

type Rgb = [number, number, number];

function round(c: Rgb): Rgb {
  return c.map((v) => Math.round(Math.min(255, Math.max(0, v)))) as Rgb;
}

/**
 * The text drawn on an accent fill (a button, the person's bubble): white or
 * near black, whichever contrasts more; black when the winner still falls
 * under 4.5:1 (a mid tone, where black always reaches it). One rule for the
 * brand's button, a bot's accent and the bubbles.
 */
export function accentInk(accent: string): string {
  if (!parseHex(accent)) return LIGHT_INK;
  const light = contrastHex(accent, LIGHT_INK);
  const dark = contrastHex(accent, DARK_INK);
  const best = light >= dark ? LIGHT_INK : DARK_INK;
  return Math.max(light, dark) >= BUBBLE_MIN_CONTRAST ? best : BLACK_INK;
}

/**
 * The fill of an accent bubble that carries white text: the accent itself
 * where white reads on it at 4.5:1, else the same hue a step deeper until it
 * does. The person's bubble and the coloured bubbles (user-bubble-tone.ts)
 * both cut their fill here.
 */
export function whiteInkFill(accent: string): string {
  return toneForSurface(accent, LIGHT_INK, BUBBLE_MIN_CONTRAST);
}

/**
 * The person's bubble and its text, for an accent (`#rrggbb`). A coloured
 * accent: white text, on the accent where white reads, else on the same hue
 * a step deeper (`whiteInkFill`), as the reference. A neutral accent: the
 * accent exactly with `buttonInk` (the ink a skin draws on its accent
 * buttons) when it reads at 4.5:1, else `accentInk`.
 */
export function userBubble(accent: string, buttonInk?: string): UserBubble {
  const rgb = parseHex(accent) ?? ([128, 128, 128] as Rgb);
  const hex = toHex(rgb);
  if (!isNeutralAccent(hex)) return withWell(whiteInkFill(hex), LIGHT_INK);
  const keep = buttonInk && parseHex(buttonInk) && contrastHex(hex, buttonInk) >= BUBBLE_MIN_CONTRAST;
  return withWell(hex, keep ? toHex(parseHex(buttonInk)!) : accentInk(hex));
}

export type UserBubble = { user: string; userInk: string; userWell: string };

/** The deepest mix the bubble's inner surfaces take (`--color-raised-hover` in styles.css). */
export const BUBBLE_WELL_DEPTH = 0.24;

/**
 * What the surfaces inside the person's bubble (panel, inset, raised: a code
 * span's well, a quote strip, a chip) mix toward, in styles.css
 * `.bg-bubble-user`: the bubble's ink while that ink still reads at 4.5:1 on
 * the deepest of them, else the opposite pole (black under white ink), which
 * only raises the contrast. White on an accent held at 4.5:1 would drop
 * under it on a lighter well, so those wells sink instead.
 */
export function bubbleWell(user: string, userInk: string): string {
  if (contrastRatio(userInk, mixSrgb(userInk, user, BUBBLE_WELL_DEPTH)) >= BUBBLE_MIN_CONTRAST) return userInk;
  return contrastRatio(userInk, BLACK_INK) >= contrastRatio(userInk, LIGHT_INK) ? BLACK_INK : LIGHT_INK;
}

/**
 * The colour the person's bubble drifts toward on a duo-tone
 * (skin-duo.css, `.bg-bubble-user`): the duo's far end (`--accent-to`) in
 * the hue white reads on at 4.5:1 (`whiteInkFill`), so every point of the
 * gradient keeps white text readable (a mix of two fills that each read
 * under white reads too). The bubble's own fill (no drift) where its ink is
 * not white or there is no far end.
 */
export function bubbleDrift(user: string, userInk: string, toward?: string): string {
  if (!toward || !parseHex(toward) || userInk.toLowerCase() !== LIGHT_INK) return user;
  return whiteInkFill(toHex(parseHex(toward)!));
}

function withWell(user: string, userInk: string): UserBubble {
  return { user, userInk, userWell: bubbleWell(user, userInk) };
}

/** The bot's grey: the page's lightness, neutral, a step lighter (dark) or darker (light). */
export function botBubble(app: string, scheme: Scheme): string {
  const rgb = parseHex(app) ?? (scheme === "dark" ? [18, 18, 18] : [255, 255, 255]);
  const l = toHsl(rgb)[2];
  const next = scheme === "dark" ? Math.min(1, l + 0.075) : Math.max(0, l - 0.065);
  return toHex(round(fromHsl(0, 0, next)));
}

/**
 * The bubbles' colours for an accent on a skin.
 *
 * @param accent    the accent (`#rrggbb`); the person's bubble is cut from it
 * @param app       the page colour the bot's grey is cut from
 * @param buttonInk the skin's accent button ink, kept on a neutral accent when it reads at 4.5:1
 */
export function bubbleColors({ accent, app, scheme, buttonInk }: { accent: string; app: string; scheme: Scheme; buttonInk?: string }): BubbleColors {
  return { ...userBubble(accent, buttonInk), bot: botBubble(app, scheme) };
}

/** The custom properties a bubble reads, from its colours. */
export function bubbleVars(colors: BubbleColors): Record<string, string> {
  return {
    "--color-bubble-user": colors.user,
    "--color-bubble-user-ink": colors.userInk,
    "--color-bubble-user-well": colors.userWell,
    "--color-bubble-bot": colors.bot,
  };
}

/** The names of the brand's bubble properties, set or removed together. */
export const BRAND_BUBBLE_VARS = ["--brand-bubble-user", "--brand-bubble-user-ink", "--brand-bubble-user-well"] as const;

/**
 * A deployment's brand accent (brand.ts) replaces the skin's accent at run
 * time, so its bubble cannot come from the generated blocks. It does not
 * depend on the scheme (the accent alone decides it), and the generated
 * blocks read it first: `var(--brand-bubble-user, <skin's>)`.
 */
export function brandBubbleVars(accent: string | undefined): Record<string, string> {
  if (!accent || !parseHex(accent)) return {};
  const { user, userInk, userWell } = userBubble(accent);
  return { "--brand-bubble-user": user, "--brand-bubble-user-ink": userInk, "--brand-bubble-user-well": userWell };
}

/** The names a bot's (or a room's) colour sets on its own scope, set together. */
export const SCOPED_BUBBLE_VARS = ["--color-bubble-user", "--color-bubble-user-ink", "--color-bubble-user-well", "--color-bubble-user-to"] as const;

/**
 * The person's bubble in a bot's own colour (2026-10-28). A skin with a
 * neutral accent (Midnight's is #f5f5f5) left the bubble white; in a
 * conversation with a bot it takes the bot's colour instead, whatever the
 * "Use bot color as accent" setting says, like the switches in its panel.
 * Same rule as the skin's bubble (`userBubble`: white on the bot's colour,
 * deepened where white would not read), which does not depend on the
 * scheme, so one set serves light and dark. Set inline on the conversation's
 * root (ChatView, RunView, the floating bot), it outweighs the skin's and the brand's set
 * inherited from <html>; the bot's own bubble stays grey. Empty for a colour
 * that is not `#rrggbb`: the skin's bubble then stays. A duo-tone's drift
 * (`--color-bubble-user-to`) stops at the bot's own fill, so the skin's far
 * end never tints a bubble whose ink it was not cut for.
 */
export function botBubbleVars(color: string | null | undefined): Record<string, string> {
  if (!color || !parseHex(color)) return {};
  const { user, userInk, userWell } = userBubble(color);
  return { "--color-bubble-user": user, "--color-bubble-user-ink": userInk, "--color-bubble-user-well": userWell, "--color-bubble-user-to": user };
}

/** How far from grey (max minus min channel, 0 to 1) an accent must be to
 * count as a colour: below it (Midnight, Graphite, Linen, Daylight) the
 * accent is a neutral. */
const NEUTRAL_CHROMA = 0.1;

/** Whether an accent is a neutral (white, grey, black) rather than a colour. */
export function isNeutralAccent(accent: string): boolean {
  const rgb = parseHex(accent);
  if (!rgb) return false;
  return (Math.max(...rgb) - Math.min(...rgb)) / 255 < NEUTRAL_CHROMA;
}

/**
 * The person's bubble in a room (GroupView, `[data-room-bubble]`): the room's
 * colour when it has one (set inline, as a bot's), else the skin's bubble,
 * except on a skin whose accent is a neutral: there the brand's accent
 * (the deployment's, else Pulsatrix's of the same scheme) keeps the bubble a
 * colour. The generated stylesheet writes that rule per skin.
 */
export function roomBubbleColors({ accent, brand, buttonInk, brandInk }: { accent: string; brand: string; buttonInk?: string; brandInk?: string }): UserBubble {
  return isNeutralAccent(accent) ? userBubble(brand, brandInk) : userBubble(accent, buttonInk);
}
