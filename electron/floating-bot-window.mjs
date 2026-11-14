/**
 * Floating bots: any bot can be put "on the desktop" from its right-click menu.
 * It then stands in a small frameless, transparent, always-on-top window of
 * its own, like Trombi detached from the window (retro-assistant-window.mjs,
 * whose window options and screen clamping this module reuses), and can be
 * dragged anywhere on the screen. Several bots can float at once: one window
 * per bot.
 *
 * The main app window stays the brain. Its renderer holds the session, calls
 * the API, streams the reply and decides the pose and the balloon; it sends a
 * plain snapshot per bot here. A floating window only draws its snapshot and
 * reports clicks and typed text back. It never sees a token, a cookie value or
 * an API route: nothing but plain text and a picture as a data: URL.
 *
 *   main renderer  --floating-bots:update {botId, snapshot}-->  main  --floating-bot:state-->  that bot's window
 *   a bot's window  --floating-bots:event {event}-->  main  --floating-bots:event {botId, event}-->  main renderer
 *
 * The per-bot channel is the window itself: main knows which webContents is
 * which bot's window, so a window can only speak for its own bot (whatever id
 * it might claim) and a snapshot for a bot only ever reaches that bot's
 * window. Every payload is validated and every channel checks its sender: only
 * the local main page drives the windows, only a floating window may move,
 * size or report for itself. The windows load the app bundle's floating-only
 * page with contextIsolation, a sandbox, no Node, and their own tiny preload.
 */
import { assistantWindowOptions, clampToDisplays, displaySignature } from "./retro-assistant-window.mjs";

export const FLOATING_QUERY = "omb-floating-bot=1";

/**
 * The window the mascot stands in while it is home: the quick chat's room
 * (`chatHomeSize(mascotStage(120))` in window-frame.ts). The character stays
 * at the bottom-right corner, so opening the chat does not resize the window.
 * Kept equal by the window-frame test.
 */
export const FLOAT_HOME = Object.freeze({ width: 352, height: 716 });
/**
 * The character's own box in the FLOAT_HOME window (window coordinates): what
 * must stay on screen. The rest of the window is transparent room (for the
 * chat, hops and spread wings) and may hang off the screen's edge, so the
 * mascot itself can stand right in a corner. The page reports its real box
 * (`floating-bots:body`); this is the box until it does. Kept equal to
 * `homeBody` in window-frame.ts by the window-frame test.
 */
export const FLOAT_BODY = Object.freeze({ x: 177, y: 535, width: 120, height: 120 });
export const FLOAT_MIN = Object.freeze({ width: 60, height: 60 });
/** Room for the mascot and a resized, moved balloon (the balloon itself caps at about 60 % of the work area). */
export const FLOAT_MAX = Object.freeze({ width: 1100, height: 1100 });
/** More than this many floating windows is a mistake, not a desk. */
export const MAX_FLOATING = 12;
const MAX_MOVE = 4000;
/** A page that failed or died is reloaded this many times at most, a little later each time. */
const MAX_RELOADS = 3;
const RELOAD_DELAY_MS = 800;
/** A page that has not said it is ready after this long is reloaded. */
export const READY_TIMEOUT_MS = 12_000;
/** A drag's path (where the pointer took the window, unclamped) is forgotten after a pause this long. */
const DRAG_IDLE_MS = 400;
/** A move is saved once the window has stood still this long (macOS reports every step of a move). */
export const REMEMBER_DELAY_MS = 500;

/** Resolves once `url` answers (or after `tries`): a development page server may still be starting. */
export async function waitForPage(url, { fetchImpl = globalThis.fetch, tries = 40, delayMs = 250 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const response = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const clampNumber = (value, low, high) => Math.min(Math.max(value, low), high);

/** Bot ids as the server mints them; anything else never names a window. */
export const BOT_ID_RE = /^[a-zA-Z0-9:_-]{1,64}$/;
export const isBotId = (value) => typeof value === "string" && BOT_ID_RE.test(value);

/**
 * Where a new floating bot first lands: along the bottom of the primary
 * display, right to left, so a second and third bot do not stack on the first.
 */
export function floatingDefaultBounds(primaryWorkArea, index = 0, size = FLOAT_HOME) {
  const step = size.width + 8;
  const perRow = Math.max(1, Math.floor((primaryWorkArea.width - 48) / step));
  const column = index % perRow;
  const row = Math.floor(index / perRow) % 4;
  return {
    x: primaryWorkArea.x + primaryWorkArea.width - size.width - 24 - column * step,
    y: primaryWorkArea.y + primaryWorkArea.height - size.height - 24 - row * (size.height + 8),
    width: size.width,
    height: size.height,
  };
}

/**
 * Keeps the character fully visible and nothing more: the window moves so
 * that `body` (the character's box, in window coordinates) lies inside one
 * display's work area, the one it overlaps most, else the nearest. The
 * window's transparent room may hang off the screen, so the character can
 * stand in any corner or along any edge of any display.
 */
export function clampBodyToDisplays(bounds, body, workAreas) {
  if (!workAreas.length) return { ...bounds };
  const box = { x: bounds.x + body.x, y: bounds.y + body.y, width: body.width, height: body.height };
  const placed = clampToDisplays(box, workAreas);
  return { x: Math.round(bounds.x + placed.x - box.x), y: Math.round(bounds.y + placed.y - box.y), width: bounds.width, height: bounds.height };
}

/**
 * The box that must stay on screen: the character's own box, grown to take
 * in what hangs on it (the quick input pill under or over its feet, the
 * call's pill), both in window coordinates. Without `keep` it is the body.
 */
export function clusterBox(body, keep) {
  if (!keep) return body;
  const x = Math.min(body.x, keep.x);
  const y = Math.min(body.y, keep.y);
  return {
    x,
    y,
    width: Math.max(body.x + body.width, keep.x + keep.width) - x,
    height: Math.max(body.y + body.height, keep.y + keep.height) - y,
  };
}

/**
 * Keeps the whole floating cluster (the character and the pill hanging on it)
 * inside one display's work area: never under the macOS Dock, the Windows
 * taskbar, a Linux panel Electron reports in `workArea`, or the menu bar.
 * When the union is taller or wider than every work area, the character stays
 * inside and the pill may hang out.
 */
export function clampClusterToDisplays(bounds, body, keep, workAreas) {
  const cluster = clusterBox(body, keep);
  const fits = workAreas.some((area) => cluster.width <= area.width && cluster.height <= area.height);
  return clampBodyToDisplays(bounds, fits ? cluster : body, workAreas);
}

/**
 * Identifies a display independently of its resolution and scale: Electron's
 * display id and the origin of its frame (DIP). A scale or resolution change
 * on the same monitor keeps the same id and origin; the setup signature
 * (which includes the size) still changes.
 */
export function displayIdentity(display) {
  const b = display.bounds ?? display.workArea;
  const id = isFiniteNumber(display.id) ? Math.round(display.id) : 0;
  return `${id}@${Math.round(b.x)},${Math.round(b.y)}`;
}

export const DISPLAY_KEY_PREFIX = "display:";
/** Map a leaked `display:<frame>` key (an earlier mixed table) onto today's identity, or null. */
export function displayIdentityFromLegacyKey(key, displays) {
  const raw = key.startsWith(DISPLAY_KEY_PREFIX) ? key.slice(DISPLAY_KEY_PREFIX.length) : key;
  if (/^\d+@-?\d+,-?\d+$/.test(raw)) return raw;
  const match = /^(-?\d+),(-?\d+),(\d+)x(\d+)$/.exec(raw);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  const width = Number(match[3]);
  const height = Number(match[4]);
  const found = displays.find((d) => {
    const b = d.bounds ?? d.workArea;
    return b.x === x && b.y === y && b.width === width && b.height === height;
  });
  return found ? displayIdentity(found) : null;
}

export function displayKeyAt(point, displays) {
  const own = displays.find((d) => {
    const b = d.bounds ?? d.workArea;
    return point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height;
  });
  return own ? `${DISPLAY_KEY_PREFIX}${displayIdentity(own)}` : null;
}

/**
 * macOS (with "Displays have separate Spaces", its default) snaps a window
 * back when more than about a fifth of it reaches onto another display while
 * most of it is on the first: the move is undone a moment later. So there
 * the window's empty room may hang past a screen's edge into nothing, but
 * only this far onto a neighbouring display; past that the window (and the
 * character with it) stays on its own side of the seam.
 */
export const SEAM_SHARE = 0.18;
export function keepOffNeighbours(bounds, body, displays) {
  const box = { x: bounds.x + body.x, y: bounds.y + body.y, width: body.width, height: body.height };
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const own = displays.find((d) => centerX >= d.x && centerX < d.x + d.width && centerY >= d.y && centerY < d.y + d.height);
  if (!own) return { ...bounds };
  let { x, y } = bounds;
  const slackX = Math.floor(bounds.width * SEAM_SHARE);
  const slackY = Math.floor(bounds.height * SEAM_SHARE);
  for (const other of displays) {
    if (other === own) continue;
    const overX = Math.min(x + bounds.width, other.x + other.width) - Math.max(x, other.x);
    const overY = Math.min(y + bounds.height, other.y + other.height) - Math.max(y, other.y);
    if (overX <= 0 || overY <= 0) continue;
    // the neighbour beside the character's display (left or right) or above or below it
    const beside = other.x >= own.x + own.width || other.x + other.width <= own.x;
    if (beside && overX > slackX) x += other.x > own.x ? -(overX - slackX) : overX - slackX;
    else if (!beside && overY > slackY) y += other.y > own.y ? -(overY - slackY) : overY - slackY;
  }
  return { ...bounds, x: Math.round(x), y: Math.round(y) };
}

/**
 * How far a window of this size may reach from the display under the
 * character, on each side where a neighbouring display touches it (macOS):
 * that display's edge plus the share macOS lets through. Free sides are left
 * out. Null when no neighbour limits it.
 */
export function windowLimits(body, size, displays) {
  const centerX = body.x + body.width / 2;
  const centerY = body.y + body.height / 2;
  const own = displays.find((d) => centerX >= d.x && centerX < d.x + d.width && centerY >= d.y && centerY < d.y + d.height);
  if (!own) return null;
  const slackX = Math.floor(size.width * SEAM_SHARE);
  const slackY = Math.floor(size.height * SEAM_SHARE);
  const limits = {};
  for (const other of displays) {
    if (other === own) continue;
    const overlapsY = other.y < own.y + own.height && other.y + other.height > own.y;
    const overlapsX = other.x < own.x + own.width && other.x + other.width > own.x;
    if (overlapsY && other.x + other.width <= own.x) limits.left = Math.max(limits.left ?? -Infinity, own.x - slackX);
    if (overlapsY && other.x >= own.x + own.width) limits.right = Math.min(limits.right ?? Infinity, own.x + own.width + slackX);
    if (overlapsX && other.y + other.height <= own.y) limits.top = Math.max(limits.top ?? -Infinity, own.y - slackY);
    if (overlapsX && other.y >= own.y + own.height) limits.bottom = Math.min(limits.bottom ?? Infinity, own.y + own.height + slackY);
  }
  return Object.keys(limits).length ? limits : null;
}

/** The character's box as the page reports it: inside its window, a sane size, or null. */
export function sanitizeBody(value, size) {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(isFiniteNumber) || width < 8 || height < 8) return null;
  const left = clampNumber(Math.round(x), 0, Math.max(0, size.width - 8));
  const top = clampNumber(Math.round(y), 0, Math.max(0, size.height - 8));
  return {
    x: left,
    y: top,
    width: Math.round(clampNumber(width, 8, size.width - left)),
    height: Math.round(clampNumber(height, 8, size.height - top)),
  };
}

/**
 * Where the character's box lands after a resize that keeps one corner of
 * the window in place: it keeps its distance to that corner.
 */
export function bodyAfterResize(body, from, to, anchor = {}) {
  const x = anchor.x === "left" ? body.x : body.x + (to.width - from.width);
  const y = anchor.y === "top" ? body.y : body.y + (to.height - from.height);
  return sanitizeBody({ x, y, width: body.width, height: body.height }, to);
}

/* ---------------------------------------------------------------- payloads */

export const REPLY_MAX = 4000;
/** Earlier exchanges kept in a balloon, and how much of each. */
export const HISTORY_MAX = 4;
export const HISTORY_TEXT_MAX = 2000;
const ID_RE = /^[a-zA-Z0-9:_-]{1,64}$/;
const POSES = new Set(["idle", "think", "speak", "celebrate", "alert", "sleep"]);
const BALLOON_KINDS = new Set(["chat", "thinking", "approval", "error"]);
const TASKS = new Set(["idle", "working", "waiting", "error"]);
const LIVELINESS = new Set(["calm", "normal", "lively"]);
const MAX_TOKENS = 1e9;
const CHARACTERS = new Set(["owl", "shape", "trombi", "bunbu", "shiba", "grump", "ogre", "frog", "crab"]);
export const SHAPES = new Set([
  "circle", "bean", "squircle", "pill", "pick", "hexagon", "cloud", "drop", "pumpkin", "egg", "gem", "wedge", "diamond", "star", "clover", "flower",
  "blossom", "cat", "ghost", "jellyfish", "axolotl", "puff", "pin", "marker", "sprite", "flask", "tube", "potion", "chomp", "nibble", "shield", "bubble",
  // the object silhouettes (shared/mascot-look.ts OBJECT_MASCOT_SHAPES): without them the
  // desktop drew a plain circle for a sprout, a cup... (#desktop-pet-mascot); the test keeps
  // this list equal to MASCOT_SHAPES
  "pad", "cup", "bulb", "say", "sprout", "tin", "tome", "ship",
  // the open-bot-avatar engine's gallery (shared/mascot-look.ts GALLERY_SHAPES, #4145)
  "brain", "bull", "bunny", "camera", "magnifier", "paint-brush", "palette", "witch-hat", "barbell", "watering-can",
]);
/** A person's own shape (shared/shape-avatar-def.ts): passed on as plain JSON, bounded; the page validates it with the app's schema. */
const AVATAR_DEF_MAX = 64_000;
function avatarDef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const json = JSON.stringify(value);
    return json.length <= AVATAR_DEF_MAX ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}
/** Shapes from earlier sets and the display names (shared/mascot-look.ts LEGACY_SHAPES). */
const LEGACY_SHAPES = { blob: "bean", pebble: "bean", triangle: "pick", capsule: "pill", droplet: "drop", sparkle: "squircle", house: "hexagon" };
const SHAPE_SKINS = new Set(["plain", "pastel", "glossy", "night", "outline", "gold", "neon", "chrome", "crystal", "circuit", "holo", "molten", "galaxy"]);
const TROMBI_SKINS = new Set(["classic", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"]);
const BUNBU_SKINS = new Set(["plain", "pastel", "night", "plush", "velvet", "gold", "neon", "chrome", "crystal", "holo", "galaxy", "molten"]);
const SHIBA_SKINS = new Set(["plain", "cream", "blacktan", "red", "sesame", "white", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"]);
const GRUMP_SKINS = new Set(["plain", "tuxedo", "calico", "tabby", "siamese", "void", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"]);
const OGRE_SKINS = new Set(["plain", "swamp", "moss", "stone", "lava", "armor", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"]);
const FROG_SKINS = new Set(["plain", "leaf", "tree", "poison", "bullfrog", "ghost", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"]);
const CRAB_SKINS = new Set(["plain", "coral", "sand", "ink", "mint", "gold", "pearl", "neon", "chrome", "crystal", "circuit", "holo", "molten", "galaxy"]);
/** Other names a stored skin may carry (shared/mascot-look.ts LEGACY_SHAPE_SKINS, LEGACY_TROMBI_SKINS, LEGACY_BUNBU_SKINS, LEGACY_SHIBA_SKINS, LEGACY_GRUMP_SKINS, LEGACY_OGRE_SKINS, LEGACY_FROG_SKINS, LEGACY_CRAB_SKINS). */
const LEGACY_SHAPE_SKINS = { ink: "outline", royal: "gold", metal: "chrome", "liquid-metal": "chrome", glass: "crystal", cyber: "circuit", iridescent: "holo", holographic: "holo", lava: "molten", nebula: "galaxy" };
const LEGACY_TROMBI_SKINS = { retro: "retro98", win98: "retro98", royal: "gold", metal: "chrome", cyber: "glitch", iridescent: "holo", holographic: "holo", lava: "molten" };
const LEGACY_BUNBU_SKINS = { fur: "plush", fuzzy: "plush", royal: "gold", metal: "chrome", glass: "crystal", iridescent: "holo", holographic: "holo", nebula: "galaxy", lava: "molten" };
const LEGACY_OGRE_SKINS = { bog: "swamp", marsh: "swamp", forest: "moss", granite: "stone", rock: "stone", grey: "stone", gray: "stone", magma: "lava", basalt: "lava", iron: "armor", steel: "armor", plate: "armor", knight: "armor", retro: "retro98", win98: "retro98", royal: "gold", metal: "chrome", cyber: "glitch", iridescent: "holo", holographic: "holo" };
const LEGACY_SHIBA_SKINS = { "black-and-tan": "blacktan", black_tan: "blacktan", kuro: "blacktan", aka: "red", goma: "sesame", shiro: "white", retro: "retro98", win98: "retro98", royal: "gold", metal: "chrome", cyber: "glitch", iridescent: "holo", holographic: "holo", lava: "molten" };
const LEGACY_GRUMP_SKINS = { tux: "tuxedo", "black-and-white": "tuxedo", tortie: "calico", tortoiseshell: "calico", tiger: "tabby", mackerel: "tabby", colorpoint: "siamese", colourpoint: "siamese", "seal-point": "siamese", black: "void", shadow: "void", retro: "retro98", win98: "retro98", royal: "gold", metal: "chrome", cyber: "glitch", iridescent: "holo", holographic: "holo", lava: "molten" };
const LEGACY_FROG_SKINS = { green: "leaf", "tree-frog": "tree", treefrog: "tree", "red-eyed": "tree", dart: "poison", "poison-dart": "poison", bull: "bullfrog", glass: "ghost", "glass-frog": "ghost", golden: "gold", retro: "retro98", win98: "retro98", royal: "gold", metal: "chrome", cyber: "glitch", iridescent: "holo", holographic: "holo", lava: "molten" };
const LEGACY_CRAB_SKINS = { classic: "coral", orange: "coral", cream: "sand", black: "ink", green: "mint", royal: "gold", treasure: "gold", nacre: "pearl", opal: "pearl", frost: "pearl", metal: "chrome", "liquid-metal": "chrome", glass: "crystal", cyber: "circuit", iridescent: "holo", holographic: "holo", lava: "molten", nebula: "galaxy" };
/** The app's skins (src/lib/skins.ts SKIN_IDS): the balloon wears the one the app wears. */
export const APP_SKINS = new Set(["pulsatrix", "pulsatrix-light", "midnight", "atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight", "retro98", "meadow"]);
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

/** The app's theme for the balloon: a known skin and a plain hex accent, or nothing. */
export function appTheme(value) {
  if (!value || typeof value !== "object" || !APP_SKINS.has(value.skin)) return null;
  return { skin: value.skin, ...(typeof value.accent === "string" && ACCENT_RE.test(value.accent) ? { accent: value.accent } : {}) };
}
const skinOf = (value, legacy) => (typeof value === "string" && Object.hasOwn(legacy, value) ? legacy[value] : value);

/** The bot's character and its look (shared/mascot-look.ts): known values only. */
export function mascotLook(value) {
  if (!value || typeof value !== "object" || !CHARACTERS.has(value.character)) return null;
  const skins = value.skins && typeof value.skins === "object" ? value.skins : {};
  const cleanSkins = {
    ...(SHAPE_SKINS.has(skinOf(skins.shape, LEGACY_SHAPE_SKINS)) ? { shape: skinOf(skins.shape, LEGACY_SHAPE_SKINS) } : {}),
    ...(TROMBI_SKINS.has(skinOf(skins.trombi, LEGACY_TROMBI_SKINS)) ? { trombi: skinOf(skins.trombi, LEGACY_TROMBI_SKINS) } : {}),
    ...(BUNBU_SKINS.has(skinOf(skins.bunbu, LEGACY_BUNBU_SKINS)) ? { bunbu: skinOf(skins.bunbu, LEGACY_BUNBU_SKINS) } : {}),
    ...(SHIBA_SKINS.has(skinOf(skins.shiba, LEGACY_SHIBA_SKINS)) ? { shiba: skinOf(skins.shiba, LEGACY_SHIBA_SKINS) } : {}),
    ...(GRUMP_SKINS.has(skinOf(skins.grump, LEGACY_GRUMP_SKINS)) ? { grump: skinOf(skins.grump, LEGACY_GRUMP_SKINS) } : {}),
    ...(OGRE_SKINS.has(skinOf(skins.ogre, LEGACY_OGRE_SKINS)) ? { ogre: skinOf(skins.ogre, LEGACY_OGRE_SKINS) } : {}),
    ...(FROG_SKINS.has(skinOf(skins.frog, LEGACY_FROG_SKINS)) ? { frog: skinOf(skins.frog, LEGACY_FROG_SKINS) } : {}),
    ...(CRAB_SKINS.has(skinOf(skins.crab, LEGACY_CRAB_SKINS)) ? { crab: skinOf(skins.crab, LEGACY_CRAB_SKINS) } : {}),
  };
  return {
    character: value.character,
    ...(value.style === "2d" || value.style === "3d" ? { style: value.style } : {}),
    ...(SHAPES.has(LEGACY_SHAPES[value.shape] ?? value.shape) ? { shape: LEGACY_SHAPES[value.shape] ?? value.shape } : {}),
    ...(value.character === "shape" && avatarDef(value.avatarDef) ? { avatarDef: avatarDef(value.avatarDef) } : {}),
    ...(Object.keys(cleanSkins).length ? { skins: cleanSkins } : {}),
  };
}


/** The followed thread's context use, for the mascot's energy bar: numbers and two short texts. */
function context(value) {
  if (!value || typeof value !== "object" || !isFiniteNumber(value.tokens) || value.tokens < 0) return null;
  return {
    ...(isFiniteNumber(value.percent) ? { percent: clampNumber(Math.round(value.percent), 0, 999) } : {}),
    tokens: clampNumber(Math.round(value.tokens), 0, MAX_TOKENS),
    ...(isFiniteNumber(value.window) && value.window > 0 ? { window: clampNumber(Math.round(value.window), 1, MAX_TOKENS) } : {}),
    detail: text(value.detail, 120) ?? "",
    label: text(value.label, 60) ?? "",
  };
}
const CROPS = new Set(["circle", "rounded", "square"]);
const COLOR_RE = /^#?[a-zA-Z0-9-]{1,24}$/;
const SKIN_RE = /^[a-z0-9-]{1,32}$/;
/** Only a picture, inline, of a bounded size: no URL the window could fetch. */
const AVATAR_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const AVATAR_MAX = 400_000;

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : undefined);
const flag = (value) => value === true;

/** A menu item's id: "switch:" and a bot id fit. */
export const MENU_ID_RE = /^[a-zA-Z0-9:_-]{1,80}$/;
/** Items at the menu's top level, and in a submenu (the person's bots, a character's moves). */
export const MENU_MAX = 16;
export const SUBMENU_MAX = 32;
/** A move asked of the mascot by name (a clip of clips.ts); the window checks it against its character's list. */
export const MOVE_RE = /^[a-zA-Z]{1,24}$/;

function menuItems(value, depth = 0) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, depth ? SUBMENU_MAX : MENU_MAX)
    .filter((item) => item && typeof item === "object" && MENU_ID_RE.test(item.id) && typeof item.label === "string")
    .map((item) => {
      if (item.type === "separator") return { id: item.id, label: "", type: "separator" };
      const items = depth === 0 && Array.isArray(item.items) ? menuItems(item.items, 1) : null;
      return {
        id: item.id,
        label: item.label.slice(0, 80),
        ...(typeof item.checked === "boolean" ? { checked: item.checked } : {}),
        ...(item.enabled === false ? { enabled: false } : {}),
        ...(items ? { items } : {}),
      };
    });
}

/**
 * The native menu's template for the snapshot's items: separators, checks,
 * greyed items and one level of submenus. `choose` gets the item's id.
 */
export function menuTemplate(items, choose) {
  return items.map((item) => {
    if (item.type === "separator") return { type: "separator" };
    if (item.items) return { label: item.label, ...(item.enabled === false ? { enabled: false } : {}), submenu: menuTemplate(item.items, choose) };
    return {
      label: item.label,
      ...(typeof item.checked === "boolean" ? { type: "checkbox", checked: item.checked } : {}),
      ...(item.enabled === false ? { enabled: false } : {}),
      click: () => choose(item.id),
    };
  });
}

/** Menu choices that bring the app's window forward (the brain then shows the thread, the settings, the composer). */
const FOCUS_IDS = new Set(["open", "settings", "attach", "model"]);

function avatar(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.src !== "string" || value.src.length > AVATAR_MAX || !AVATAR_RE.test(value.src)) return null;
  return {
    src: value.src,
    crop: CROPS.has(value.crop) ? value.crop : "circle",
    zoom: isFiniteNumber(value.zoom) ? clampNumber(value.zoom, 1, 3) : 1,
    focusX: isFiniteNumber(value.focusX) ? clampNumber(value.focusX, 0, 1) : 0.5,
    focusY: isFiniteNumber(value.focusY) ? clampNumber(value.focusY, 0, 1) : 0.5,
  };
}

const CALL_PHASES = new Set(["connecting", "listening", "hearing", "thinking", "speaking", "interrupted", "held", "ended"]);
const CALL_LINES = 8;
const CALL_TEXT_MAX = 1200;
const VOICE_ID_RE = /^[a-zA-Z0-9._-]{0,64}$/;
const LANGUAGE_RE = /^[a-zA-Z-]{2,16}$/;

/** The live voice call as the mascot shows it: states, short texts and the call's settings, nothing else. */
export function sanitizeCall(value) {
  if (!value || typeof value !== "object" || !CALL_PHASES.has(value.phase)) return null;
  const settings = value.settings && typeof value.settings === "object" ? value.settings : {};
  const callSettings = value.callSettings && typeof value.callSettings === "object" ? value.callSettings : {};
  const enrollment = value.enrollment && typeof value.enrollment === "object" ? value.enrollment : {};
  return {
    phase: value.phase,
    muted: flag(value.muted),
    botAudible: flag(value.botAudible),
    push: flag(value.push),
    startedAt: isFiniteNumber(value.startedAt) && value.startedAt > 0 ? value.startedAt : 0,
    line: text(value.line, CALL_TEXT_MAX) ?? "",
    transcript: Array.isArray(value.transcript)
      ? value.transcript.slice(-CALL_LINES).filter((line) => line && typeof line === "object" && typeof line.text === "string").map((line, index) => ({
          id: typeof line.id === "string" && ID_RE.test(line.id) ? line.id : `line-${index}`,
          who: line.who === "you" ? "you" : "bot",
          text: line.text.slice(0, CALL_TEXT_MAX),
          ...(line.interrupted === true ? { interrupted: true } : {}),
        }))
      : [],
    note: text(value.note, 300) ?? null,
    notice: text(value.notice, 300) ?? null,
    settings: {
      voice: typeof settings.voice === "string" && VOICE_ID_RE.test(settings.voice) ? settings.voice : "",
      speed: isFiniteNumber(settings.speed) ? clampNumber(settings.speed, 0.5, 2) : 1,
      language: typeof settings.language === "string" && (settings.language === "auto" || LANGUAGE_RE.test(settings.language)) ? settings.language : "auto",
    },
    callSettings: {
      input: callSettings.input === "push" ? "push" : "auto",
      onlyMyVoice: flag(callSettings.onlyMyVoice),
      earcons: callSettings.earcons !== false,
      pause: callSettings.pause === "short" || callSettings.pause === "patient" ? callSettings.pause : "normal",
    },
    voices: Array.isArray(value.voices)
      ? value.voices.slice(0, 64).filter((voice) => voice && typeof voice.id === "string" && VOICE_ID_RE.test(voice.id) && typeof voice.label === "string").map((voice) => ({ id: voice.id, label: voice.label.slice(0, 80) }))
      : null,
    voicesError: text(value.voicesError, 200) ?? null,
    enrollment: enrollment.state === "recording"
      ? { state: "recording", share: isFiniteNumber(enrollment.share) ? clampNumber(enrollment.share, 0, 1) : 0 }
      : { state: enrollment.state === "enrolled" || enrollment.state === "failed" ? enrollment.state : "none" },
    previewing: value.previewing && typeof value.previewing.id === "string" && VOICE_ID_RE.test(value.previewing.id)
      ? { id: value.previewing.id, loading: flag(value.previewing.loading) }
      : null,
    // live captions beside the mascot (the call settings' switch)
    captions: value.captions !== false,
  };
}

/** A tray row's id: "a0".."a99" (an approval), "r0".."r99" (running work); the brain keeps what each stands for. */
export const TRAY_ID_RE = /^[ar][0-9]{1,2}$/;
export const TRAY_MAX = 8;

/** The activity tray: short texts and opaque ids, nothing else. */
export function sanitizeTray(value) {
  if (!value || typeof value !== "object") return null;
  const items = Array.isArray(value.items)
    ? value.items
        .filter((item) => item && typeof item === "object" && typeof item.id === "string" && TRAY_ID_RE.test(item.id) && (item.kind === "approval" || item.kind === "running"))
        .slice(0, TRAY_MAX)
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          title: text(item.title, 80) ?? "",
          detail: text(item.detail, 140) ?? "",
          canStop: flag(item.canStop),
          canOpen: flag(item.canOpen),
        }))
    : [];
  return { loading: flag(value.loading), items };
}

/**
 * Where the mascot's native menu opens, for Menu.popup (window coordinates,
 * DIP): exactly at the click, which the page reports in CSS pixels (times the
 * page's zoom to get DIP; the display's scale factor is the OS's business),
 * kept inside the work area of the display under it (or the nearest one), so
 * it never opens under the menu bar or the Dock or off a screen.
 */
export function menuPopupPoint(click, zoom, bounds, areas) {
  const factor = isFiniteNumber(zoom) && zoom > 0 ? zoom : 1;
  const sx = bounds.x + (isFiniteNumber(click?.x) ? click.x : 0) * factor;
  const sy = bounds.y + (isFiniteNumber(click?.y) ? click.y : 0) * factor;
  const distance = (area) => Math.hypot(sx - clampNumber(sx, area.x, area.x + area.width - 1), sy - clampNumber(sy, area.y, area.y + area.height - 1));
  const area = (areas ?? []).reduce((best, candidate) => (!best || distance(candidate) < distance(best) ? candidate : best), null);
  const x = area ? clampNumber(sx, area.x, area.x + area.width - 1) : sx;
  const y = area ? clampNumber(sy, area.y, area.y + area.height - 1) : sy;
  return { x: Math.round(x - bounds.x), y: Math.round(y - bounds.y) };
}

/** The call's two levels, 0..1. */
export function sanitizeLevels(value) {
  if (!value || typeof value !== "object" || !isFiniteNumber(value.bot) || !isFiniteNumber(value.mic)) return null;
  return { bot: clampNumber(value.bot, 0, 1), mic: clampNumber(value.mic, 0, 1) };
}

const CUES = new Set(["nudge", "achievement", "snooze"]);

/** The last nudge or achievement (src/components/floating-bots/protocol.ts FloatingCue): a known kind and a time, or nothing. */
export function sanitizeCue(value) {
  if (!value || typeof value !== "object" || !CUES.has(value.kind) || !isFiniteNumber(value.at) || value.at < 0) return null;
  return { kind: value.kind, at: value.at };
}

/**
 * What the brain may tell a floating bot's window: who it is, how it looks, a
 * pose and, when talking, a balloon of short plain texts. Anything else is
 * dropped; a malformed snapshot is refused outright (null).
 */
export function sanitizeFloatingSnapshot(value) {
  if (!value || typeof value !== "object" || value.v !== 1) return null;
  if (!POSES.has(value.pose) || typeof value.name !== "string") return null;
  const snapshot = {
    v: 1,
    // the bot's id, so the balloon can remember its size and place per bot
    id: isBotId(value.id) ? value.id : "",
    name: value.name.slice(0, 80),
    label: text(value.label, 200) ?? value.name.slice(0, 80),
    color: typeof value.color === "string" && COLOR_RE.test(value.color) ? value.color : "blue",
    skin: typeof value.skin === "string" && SKIN_RE.test(value.skin) ? value.skin : "none",
    avatar: avatar(value.avatar),
    pose: value.pose,
    reduced: flag(value.reduced),
    retro: flag(value.retro),
    sparkle: Number.isSafeInteger(value.sparkle) && value.sparkle >= 0 ? value.sparkle : 0,
    locale: /^[a-zA-Z-]{2,16}$/.test(value.locale ?? "") ? value.locale : "en",
    menu: menuItems(value.menu),
    balloon: null,
    // the mascot: what its bot is doing, its mood, and whether it flies off meanwhile
    task: TASKS.has(value.task) ? value.task : "idle",
    mood: isFiniteNumber(value.mood) ? clampNumber(value.mood, 0, 1) : 0.6,
    flyAway: value.flyAway !== false,
    hints: {
      mood: text(value.hints?.mood, 80) ?? "",
      working: text(value.hints?.working, 200) ?? "",
      ...(typeof value.hints?.hoot === "string" ? { hoot: value.hints.hoot.slice(0, 40) } : {}),
      ...(typeof value.hints?.pin === "string" ? { pin: value.hints.pin.slice(0, 80) } : {}),
      // present when the bot takes voice calls: the call button's label
      ...(typeof value.hints?.call === "string" ? { call: value.hints.call.slice(0, 80) } : {}),
    },
    liveliness: LIVELINESS.has(value.liveliness) ? value.liveliness : "normal",
    context: context(value.context),
    mascot: mascotLook(value.mascot) ?? { character: "owl" },
  };
  const theme = appTheme(value.theme);
  if (theme) snapshot.theme = theme;
  snapshot.call = sanitizeCall(value.call);
  snapshot.cue = sanitizeCue(value.cue);
  snapshot.tray = sanitizeTray(value.tray);
  const balloon = value.balloon;
  if (balloon && typeof balloon === "object" && BALLOON_KINDS.has(balloon.kind)) {
    snapshot.balloon = {
      kind: balloon.kind,
      title: text(balloon.title, 160),
      asked: text(balloon.asked, 300),
      text: text(balloon.text, REPLY_MAX) ?? "",
      // earlier exchanges of this conversation, oldest first (a few, bounded)
      history: Array.isArray(balloon.history)
        ? balloon.history.slice(-HISTORY_MAX).filter((item) => item && typeof item === "object").map((item) => ({
            asked: text(item.asked, 300) ?? "",
            text: text(item.text, HISTORY_TEXT_MAX) ?? "",
          }))
        : [],
      streaming: flag(balloon.streaming),
      truncated: flag(balloon.truncated),
      open: text(balloon.open, 80) ?? "",
      close: text(balloon.close, 40) ?? "",
      input: balloon.input && typeof balloon.input === "object"
        ? {
            label: text(balloon.input.label, 160) ?? "",
            placeholder: text(balloon.input.placeholder, 160) ?? "",
            send: text(balloon.input.send, 40) ?? "",
            // the composer row's clip and model chip (labels only; both open the app's composer)
            ...(typeof balloon.input.attach === "string" ? { attach: balloon.input.attach.slice(0, 80) } : {}),
            ...(typeof balloon.input.model === "string" && balloon.input.model ? { model: balloon.input.model.slice(0, 80) } : {}),
            ...(typeof balloon.input.modelTitle === "string" ? { modelTitle: balloon.input.modelTitle.slice(0, 160) } : {}),
          }
        : null,
    };
  }
  return snapshot;
}

const EVENT_TYPES = new Set(["click", "context", "dismiss", "open", "menu", "send", "play", "pet", "call", "tray", "work"]);
const WORK_ACTIONS = new Set(["allow", "stop", "open"]);
const CALL_ACTIONS = new Set(["start", "end", "mute", "unmute", "hold", "resume", "interrupt", "retry", "talk", "release", "voices", "enroll", "forget", "preview", "settings", "call-settings"]);
/** The settings a mascot's call may change, and how each is checked. */
const CALL_PATCH = {
  settings: { voice: (v) => typeof v === "string" && VOICE_ID_RE.test(v), speed: (v) => isFiniteNumber(v) && v >= 0.5 && v <= 2, language: (v) => typeof v === "string" && (v === "auto" || LANGUAGE_RE.test(v)) },
  "call-settings": { input: (v) => v === "auto" || v === "push", onlyMyVoice: (v) => typeof v === "boolean", earcons: (v) => typeof v === "boolean", pause: (v) => v === "short" || v === "normal" || v === "patient" },
};
export const SEND_MAX = 4000;

/** What a floating window may report back: a click, a menu choice, or typed text. */
export function sanitizeFloatingEvent(value) {
  if (!value || typeof value !== "object" || !EVENT_TYPES.has(value.type)) return null;
  if (value.type === "menu") return MENU_ID_RE.test(value.id ?? "") ? { type: "menu", id: value.id } : null;
  if (value.type === "send") {
    if (typeof value.text !== "string") return null;
    const typed = value.text.slice(0, SEND_MAX);
    return typed.trim() ? { type: "send", text: typed } : null;
  }
  // the hover controls' bell, and a tray row's buttons (the brain checks the id against what it listed)
  if (value.type === "tray") return typeof value.open === "boolean" ? { type: "tray", open: value.open } : null;
  if (value.type === "work") return WORK_ACTIONS.has(value.action) && typeof value.id === "string" && TRAY_ID_RE.test(value.id) ? { type: "work", action: value.action, id: value.id } : null;
  if (value.type === "call") {
    if (!CALL_ACTIONS.has(value.action)) return null;
    if (value.action === "preview") return typeof value.voice === "string" && VOICE_ID_RE.test(value.voice) ? { type: "call", action: "preview", voice: value.voice } : null;
    const rules = CALL_PATCH[value.action];
    if (rules) {
      const patch = {};
      if (value.patch && typeof value.patch === "object") for (const [key, check] of Object.entries(rules)) if (Object.hasOwn(value.patch, key) && check(value.patch[key])) patch[key] = value.patch[key];
      return Object.keys(patch).length ? { type: "call", action: value.action, patch } : null;
    }
    return { type: "call", action: value.action };
  }
  return { type: value.type };
}

/**
 * Positions on disk (`floating-bot-positions.json`): per display setup, per
 * bot, a bottom-right corner. With `v: 2` it is the character's own box's;
 * without, an older save of the window's corner. The first 32 keys only,
 * same as older builds (`slice(0, 32)`): per-display spots never live here.
 */
export const SETUP_POSITIONS_MAX = 32;
export function sanitizePositions(value) {
  const clean = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return clean;
  for (const [signature, bots] of Object.entries(value).slice(0, SETUP_POSITIONS_MAX)) {
    if (typeof signature !== "string" || signature.length > 512 || signature.startsWith(DISPLAY_KEY_PREFIX) || !bots || typeof bots !== "object") continue;
    const entry = sanitizeBotSpots(bots, { keepTime: false });
    if (Object.keys(entry).length) clean[signature] = entry;
  }
  return clean;
}

/**
 * Pull `display:…` keys out of a mixed setups table (a build that wrote them
 * in the same file). The leftover setups table is what an older build reads.
 */
export function purgeDisplayKeys(value) {
  const setups = {};
  const leaked = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return { setups, leaked };
  for (const [key, bots] of Object.entries(value)) {
    if (typeof key === "string" && key.startsWith(DISPLAY_KEY_PREFIX)) leaked[key.slice(DISPLAY_KEY_PREFIX.length)] = bots;
    else setups[key] = bots;
  }
  return { setups, leaked };
}

function sanitizeBotSpots(bots, { keepTime }) {
  const entry = {};
  if (!bots || typeof bots !== "object") return entry;
  for (const [botId, spot] of Object.entries(bots).slice(0, 64)) {
    if (isBotId(botId) && spot && isFiniteNumber(spot.x) && isFiniteNumber(spot.y)) {
      entry[botId] = { x: spot.x, y: spot.y, ...(spot.v === 2 ? { v: 2 } : {}), ...(keepTime && isFiniteNumber(spot.t) && spot.t > 0 ? { t: spot.t } : {}) };
    }
  }
  return entry;
}

/** Per-display spots (`floating-bot-display-spots.json`), keyed by `displayIdentity`. */
export const DISPLAY_SPOTS_MAX = 64;
export function sanitizeDisplaySpots(value) {
  const clean = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return clean;
  for (const [key, bots] of Object.entries(value).slice(0, DISPLAY_SPOTS_MAX)) {
    if (typeof key !== "string" || key.length > 128 || !bots || typeof bots !== "object") continue;
    const identity = key.startsWith(DISPLAY_KEY_PREFIX) ? key.slice(DISPLAY_KEY_PREFIX.length) : key;
    if (!/^\d+@-?\d+,-?\d+$/.test(identity)) continue;
    const entry = sanitizeBotSpots(bots, { keepTime: true });
    if (Object.keys(entry).length) clean[identity] = entry;
  }
  return clean;
}

/**
 * The saved spot for a bot: the one kept for this exact display setup, else
 * the latest one kept on a display that is still connected (same id and
 * origin; resolution and scale may have changed). Null when neither is known.
 */
export function savedSpotFor(positions, displaySpots, botId, displays) {
  const exact = positions[displaySignature(displays)]?.[botId];
  if (exact) return exact;
  let best = null;
  for (const display of displays) {
    const spot = displaySpots[displayIdentity(display)]?.[botId];
    if (spot && (!best || (spot.t ?? 0) > (best.t ?? 0))) best = spot;
  }
  return best;
}

/* -------------------------------------------------------------- controller */

/**
 * @param {object} deps
 * @param {typeof import("electron").BrowserWindow} deps.BrowserWindow
 * @param {{ getAllDisplays(): any[]; getPrimaryDisplay(): any; getCursorScreenPoint?(): {x:number,y:number} }} deps.screen
 * @param {{ handle: Function; on: Function; removeHandler?: Function; removeListener?: Function }} deps.ipcMain
 * @param {() => (import("electron").BrowserWindow | null)} deps.getMainWindow
 * @param {() => string} deps.pageUrl       the app origin's floating-only page
 * @param {string} deps.preload             path to floating-bot-preload.cjs
 * @param {() => unknown} [deps.readPositions]
 * @param {(positions: Record<string, Record<string, {x:number,y:number}>>) => void} [deps.writePositions]
 * @param {() => unknown} [deps.readDisplaySpots]
 * @param {(spots: Record<string, Record<string, {x:number,y:number,v?:number,t?:number}>>) => void} [deps.writeDisplaySpots]
 * @param {(event: any) => boolean} [deps.isTrustedMain]  the sender is this app's own UI (local, or bundled on an organization server)
 * @param {() => Promise<unknown>} [deps.whenReady]  resolves once Electron's app is ready (the screen module needs it)
 * @param {typeof import("electron").Menu} [deps.Menu]  native right-click menu (required for the mascot's menu to pop)
 * @param {() => void} [deps.focusMain]     bring the app window forward ("Open in the app")
 * @param {() => (import("electron").Session | null)} [deps.session]  the session for the page (server mode without a local server)
 * @param {string} [deps.platform]          process.platform by default
 * @param {(line: string) => void} [deps.log]
 */
export function createFloatingBotWindows(deps) {
  const { BrowserWindow, screen, ipcMain, getMainWindow, pageUrl, preload } = deps;
  // Linux cannot forward pointer moves through an ignoring window, so there
  // the small window simply stays clickable rather than becoming unreachable.
  const clickThrough = (deps.platform ?? process.platform) !== "linux";
  const seams = (deps.platform ?? process.platform) === "darwin";
  const log = deps.log ?? (() => {});
  /** botId -> { win, snapshot, onTop, autopilot } */
  const floats = new Map();
  /**
   * The latest snapshot for a bot whose window is not open (yet): the brain
   * may send it a moment before the window exists, and only sends again when
   * something changes, so it is kept for the window that opens next.
   */
  const pending = new Map();
  /** A diagnostic said once, not on every update. */
  const noted = new Set();
  const note = (line) => {
    if (noted.has(line) || noted.size > 50) return;
    noted.add(line);
    log(`floating bots: ${line}`);
  };
  let positions = null;
  let displaySpots = null;
  let silent = false;

  const persistSetups = (next) => {
    positions = next;
    try {
      deps.writePositions?.(next);
    } catch {
      /* the spot is only a convenience */
    }
  };
  const persistDisplaySpots = (next) => {
    displaySpots = next;
    try {
      deps.writeDisplaySpots?.(next);
    } catch {
      /* the spot is only a convenience */
    }
  };

  const savedDisplaySpots = () => {
    if (displaySpots) return displaySpots;
    try {
      displaySpots = sanitizeDisplaySpots(deps.readDisplaySpots?.());
    } catch {
      displaySpots = {};
    }
    return displaySpots;
  };

  const savedPositions = () => {
    if (positions) return positions;
    let raw = {};
    try {
      raw = deps.readPositions?.() ?? {};
    } catch {
      raw = {};
    }
    const { setups, leaked } = purgeDisplayKeys(raw);
    positions = sanitizePositions(setups);
    if (Object.keys(leaked).length) {
      const mapped = {};
      for (const [key, bots] of Object.entries(leaked)) {
        const identity = displayIdentityFromLegacyKey(key, screen.getAllDisplays());
        if (identity) mapped[identity] = bots;
      }
      persistDisplaySpots(sanitizeDisplaySpots({ ...savedDisplaySpots(), ...mapped }));
      persistSetups(positions);
    }
    return positions;
  };

  const workAreas = () => screen.getAllDisplays().map((display) => display.workArea);
  const signature = () => displaySignature(screen.getAllDisplays());
  const live = (entry) => Boolean(entry && entry.win && !entry.win.isDestroyed());
  /** The floating window that sent this event, or null: this is how a window's channel is its own. */
  const senderFloat = (event) => {
    if (!event?.sender) return null;
    for (const [botId, entry] of floats) {
      if (live(entry) && entry.win.webContents === event.sender) return { botId, entry };
    }
    return null;
  };
  const isMain = (event) => {
    const main = getMainWindow();
    if (!main || main.isDestroyed() || event?.sender !== main.webContents) return false;
    // a remote server's page in the main window never drives these windows
    return deps.isTrustedMain ? deps.isTrustedMain(event) : true;
  };

  const notifyMain = (channel, payload) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send(channel, payload);
  };

  /** The character's box in its window: as the page reported it, else the home window's. */
  const bodyOf = (entry) => {
    if (entry.body) return entry.body;
    const { width, height } = entry.win.getBounds();
    return width === FLOAT_HOME.width && height === FLOAT_HOME.height ? FLOAT_BODY : null;
  };
  /** A window spot, moved so the character and its pill are fully on a screen (the whole window when its box is not known yet). */
  const clampFor = (entry, bounds) => {
    const own = entry ? bodyOf(entry) : null;
    if (!own) return clampToDisplays(bounds, workAreas());
    const keep = entry.keep ?? null;
    const areas = workAreas();
    const placed = clampClusterToDisplays(bounds, own, keep, areas);
    if (!seams) return placed;
    // macOS undoes a move that puts too much of the window on a neighbouring display
    const cluster = clusterBox(own, keep);
    const fits = areas.some((area) => cluster.width <= area.width && cluster.height <= area.height);
    const box = fits ? cluster : own;
    const displays = screen.getAllDisplays().map((display) => display.bounds ?? display.workArea);
    return clampBodyToDisplays(keepOffNeighbours(placed, box, displays), box, areas);
  };
  /** The id a window speaks for now (a switch may have given it another bot). */
  const idOf = (entry) => {
    for (const [botId, candidate] of floats) if (candidate === entry) return botId;
    return null;
  };

  const remember = (botId) => {
    const entry = floats.get(botId);
    // the mascot flying off or wandering is not the person choosing a spot
    if (!live(entry) || entry.autopilot) return;
    const { x, y, width, height } = entry.win.getBounds();
    const body = bodyOf(entry) ?? { x: 0, y: 0, width, height };
    const all = savedPositions();
    const key = signature();
    // the character's own corner, whatever the balloon and the window's room do
    const spot = { x: x + body.x + body.width, y: y + body.y + body.height, v: 2 };
    const next = { ...all, [key]: { ...all[key], [botId]: spot } };
    // keep 32 setup keys: an older build reads slice(0, 32) in insertion order
    const setupKeys = Object.keys(next);
    if (setupKeys.length > SETUP_POSITIONS_MAX) {
      const drop = setupKeys.find((name) => name !== key);
      if (drop) delete next[drop];
    }
    persistSetups(next);
    // and for the display it stands on (a separate table: older builds never see it)
    const own = displayKeyAt({ x: x + body.x + body.width / 2, y: y + body.y + body.height / 2 }, screen.getAllDisplays());
    if (own) {
      const identity = own.slice(DISPLAY_KEY_PREFIX.length);
      const spots = savedDisplaySpots();
      const nextSpots = { ...spots, [identity]: { ...spots[identity], [botId]: { ...spot, t: Date.now() } } };
      const spotKeys = Object.keys(nextSpots);
      if (spotKeys.length > DISPLAY_SPOTS_MAX) {
        const drop = spotKeys.find((name) => name !== identity);
        if (drop) delete nextSpots[drop];
      }
      persistDisplaySpots(nextSpots);
    }
  };

  const startBounds = (botId) => {
    const saved = savedSpotFor(savedPositions(), savedDisplaySpots(), botId, screen.getAllDisplays());
    // the spot kept for this display setup, exactly, else the last one on a display still there
    // (a setup with none of its displays starts from the default spot)
    const bounds = saved
      ? saved.v === 2
        ? { x: saved.x - FLOAT_BODY.x - FLOAT_BODY.width, y: saved.y - FLOAT_BODY.y - FLOAT_BODY.height, ...FLOAT_HOME }
        : { x: saved.x - FLOAT_HOME.width, y: saved.y - FLOAT_HOME.height, ...FLOAT_HOME }
      : floatingDefaultBounds(screen.getPrimaryDisplay().workArea, floats.size);
    return clampBodyToDisplays(bounds, FLOAT_BODY, workAreas());
  };

  /** Move or size a window only when that changes something; a move alone keeps its size untouched. */
  const place = (win, next) => {
    const now = win.getBounds();
    if (now.x === next.x && now.y === next.y && now.width === next.width && now.height === next.height) return;
    if (now.width === next.width && now.height === next.height) win.setPosition(next.x, next.y);
    else win.setBounds(next);
  };

  const applyOnTop = (win, on) => {
    try {
      if (on) win.setAlwaysOnTop(true, "floating");
      else win.setAlwaysOnTop(false);
    } catch {
      /* platform without levels: the window still works */
    }
  };

  function open(botId, { alwaysOnTop = true } = {}) {
    const existing = floats.get(botId);
    if (live(existing)) {
      if (existing.onTop !== alwaysOnTop) {
        existing.onTop = alwaysOnTop;
        applyOnTop(existing.win, alwaysOnTop);
      }
      return existing.win;
    }
    if (floats.size >= MAX_FLOATING) return null;
    const start = startBounds(botId);
    const options = assistantWindowOptions({ preload, bounds: start, title: "Floating bot", session: deps.session?.() ?? undefined });
    // throttled when hidden or covered, so the 3D mascot stops drawing (and spending battery) there;
    // larger than the screen allowed, so macOS lets its transparent room hang past a screen's edge
    // (above the menu bar too) while the character stands in a corner
    const created = new BrowserWindow({ ...options, alwaysOnTop, enableLargerThanScreen: true, webPreferences: { ...options.webPreferences, backgroundThrottling: true } });
    // a window created partly off screen may be pulled back on by the system: put it where it belongs
    const made = created.getBounds();
    if (made.x !== start.x || made.y !== start.y) created.setBounds(start);
    // interactive and focusable as last set, so a repeated request costs nothing (and never flickers)
    const entry = { win: created, snapshot: existing?.snapshot ?? pending.get(botId) ?? null, onTop: alwaysOnTop, autopilot: false, interactive: !clickThrough, focusable: false, body: null, keep: null };
    pending.delete(botId);
    floats.set(botId, entry);
    applyOnTop(created, alwaysOnTop);
    try {
      created.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
      // transparent pixels let clicks through until the pointer is over the art
      if (clickThrough) created.setIgnoreMouseEvents(true, { forward: true });
    } catch {
      /* platform without one of these: the window still works */
    }
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.once("ready-to-show", () => {
      if (created.isDestroyed()) return;
      created.showInactive();
      // showing a window partly off screen may pull it back on: the character goes back where it was left
      const shown = created.getBounds();
      if (shown.x !== start.x || shown.y !== start.y) created.setBounds({ ...shown, x: start.x, y: start.y });
    });
    // on macOS "moved" fires for every step of a move: save once it stops, never per frame
    created.on("moved", () => {
      clearTimeout(entry.rememberTimer);
      // a step of the mascot's own flight is not a spot to keep
      if (entry.autopilot) return;
      entry.rememberTimer = setTimeout(() => {
        const id = idOf(entry);
        if (id) remember(id);
      }, REMEMBER_DELAY_MS);
    });
    created.once("closed", () => {
      clearTimeout(entry.watchdog);
      clearTimeout(entry.rememberTimer);
      const id = idOf(entry);
      if (!id) return;
      floats.delete(id);
      // closed from outside the brain (a window shortcut): the bot goes back in the app
      if (!silent) notifyMain("floating-bots:closed", { botId: id });
    });
    keepAlive(botId, entry);
    void load(entry);
    return created;
  }

  /*
   * A window whose page never loads, or dies, is an invisible mascot: the
   * window is there, transparent and empty. So a failed load is retried, a
   * dead page reloaded, a page that never says it is ready reloaded once,
   * and every error of the page reaches main's log.
   */
  const load = async (entry) => {
    if (!live(entry)) return;
    const url = pageUrl();
    // in development the page comes from Vite: wait until it answers rather than fail the first load
    if (deps.waitForPage) await deps.waitForPage(url).catch(() => undefined);
    if (!live(entry)) return;
    void entry.win.loadURL(url).catch((error) => log(`floating bot window failed to load: ${error?.message ?? error}`));
  };

  function keepAlive(botId, entry) {
    const { win } = entry;
    entry.ready = false;
    entry.retries = 0;
    const retry = (why) => {
      if (!live(entry) || entry.retries >= MAX_RELOADS) return;
      entry.retries += 1;
      log(`floating bot ${botId}: ${why}; reloading (${entry.retries}/${MAX_RELOADS})`);
      entry.ready = false;
      setTimeout(() => void load(entry), RELOAD_DELAY_MS * entry.retries);
    };
    win.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      // -3 is an aborted load (a reload, or the window closing), not a failure
      if (isMainFrame !== false && code !== -3) retry(`page failed to load (${code} ${description})`);
    });
    win.webContents.on("render-process-gone", (_event, details) => retry(`page process gone (${details?.reason ?? "unknown"})`));
    win.webContents.on("console-message", (...args) => {
      // Electron passes one event object (newer) or (event, level, message, line, source)
      const [first, level, message] = args;
      const text = typeof first?.message === "string" ? first.message : message;
      const severity = typeof first?.level === "string" ? first.level : level;
      if (severity === "error" || severity === 3) log(`floating bot ${botId} page error: ${String(text).slice(0, 500)}`);
    });
    entry.watchdog = setTimeout(function check() {
      if (!live(entry) || entry.ready) return;
      retry("page never became ready");
      entry.watchdog = setTimeout(check, READY_TIMEOUT_MS);
    }, READY_TIMEOUT_MS);
  }

  /** A display was removed, added or resized: every character back inside what is left (its room may hang off). */
  const reclamp = () => {
    for (const [botId, entry] of floats) {
      if (!live(entry)) continue;
      const bounds = entry.win.getBounds();
      const next = clampFor(entry, bounds);
      if (next.x !== bounds.x || next.y !== bounds.y || next.width !== bounds.width || next.height !== bounds.height) {
        entry.win.setBounds(next);
        log(`floating bot ${botId}: moved back on screen after a display change`);
      }
    }
  };
  // The screen module exists only after app "ready"; createFloatingBotWindows
  // can run earlier, so the display listeners wait for it.
  const listenDisplays = () => {
    for (const change of ["display-added", "display-removed", "display-metrics-changed"]) screen.on?.(change, reclamp);
  };
  if (deps.whenReady) void deps.whenReady().then(listenDisplays);
  else listenDisplays();

  function close(botId) {
    const entry = floats.get(botId);
    floats.delete(botId);
    // the same bot's next window starts from its last state (the brain may not send it again)
    if (entry?.snapshot) pending.set(botId, entry.snapshot);
    if (live(entry)) entry.win.destroy();
  }

  /** Close every window without telling the brain: it is gone, or the app is quitting. */
  function closeAll() {
    silent = true;
    try {
      for (const botId of floats.keys()) close(botId);
    } finally {
      silent = false;
    }
  }

  /* ---------------------------------------------------------------- IPC */

  const handlers = {
    "floating-bots:open": (event, request) => {
      if (!isMain(event) || !request || !isBotId(request.botId)) return false;
      return Boolean(open(request.botId, { alwaysOnTop: request.alwaysOnTop !== false }));
    },
    "floating-bots:close": (event, request) => {
      if (!isMain(event) || !request || !isBotId(request.botId)) return false;
      close(request.botId);
      return true;
    },
    "floating-bots:set-top": (event, request) => {
      if (!isMain(event) || !request || !isBotId(request.botId) || typeof request.on !== "boolean") return false;
      const entry = floats.get(request.botId);
      if (!live(entry)) return false;
      entry.onTop = request.on;
      applyOnTop(entry.win, request.on);
      return true;
    },
    // "Switch bot": the window (and its spot) now stands for another bot; the brain sends that bot's state next
    "floating-bots:rekey": (event, request) => {
      if (!isMain(event) || !request || !isBotId(request.from) || !isBotId(request.to) || request.from === request.to) return false;
      const entry = floats.get(request.from);
      if (!live(entry) || floats.has(request.to)) return false;
      floats.delete(request.from);
      floats.set(request.to, entry);
      entry.snapshot = pending.get(request.to) ?? null;
      pending.delete(request.to);
      if (entry.snapshot) entry.win.webContents.send("floating-bot:state", entry.snapshot);
      // the new bot keeps this spot
      remember(request.to);
      return true;
    },
    "floating-bots:list": (event) => {
      if (!isMain(event)) return [];
      return [...floats.keys()];
    },
    "floating-bots:move-by": (event, delta) => {
      const found = senderFloat(event);
      if (!found || !delta || !isFiniteNumber(delta.dx) || !isFiniteNumber(delta.dy)) return null;
      const { win } = found.entry;
      const bounds = win.getBounds();
      // A drag follows the pointer's own path, not the clamped spot: held at a screen's edge the
      // character does not lose ground, and past a seam between displays it goes onto the next one
      // (small steps from a clamped spot never would). A pause ends that path.
      const now = Date.now();
      const drag = found.entry.drag && now - found.entry.drag.at < DRAG_IDLE_MS ? found.entry.drag : { x: bounds.x, y: bounds.y };
      const wanted = { x: drag.x + clampNumber(delta.dx, -MAX_MOVE, MAX_MOVE), y: drag.y + clampNumber(delta.dy, -MAX_MOVE, MAX_MOVE) };
      found.entry.drag = { ...wanted, at: now };
      const next = clampFor(found.entry, { ...bounds, ...wanted });
      place(win, next);
      return { x: next.x, y: next.y };
    },
    "floating-bots:move-to": (event, point) => {
      const found = senderFloat(event);
      if (!found || !point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;
      const { win } = found.entry;
      found.entry.drag = null;
      const next = clampFor(found.entry, { ...win.getBounds(), x: Math.round(point.x), y: Math.round(point.y) });
      place(win, next);
      return next;
    },
    "floating-bots:geometry": (event) => {
      const found = senderFloat(event);
      if (!found) return null;
      const bounds = found.entry.win.getBounds();
      const areas = workAreas();
      if (!areas.length) return null;
      // the display the character stands on (its box, else the window): clamping a copy picks the same area main would
      const known = bodyOf(found.entry);
      const box = known ? { x: bounds.x + known.x, y: bounds.y + known.y, width: known.width, height: known.height } : bounds;
      const clamped = clampToDisplays(box, areas);
      const workArea = areas.find((area) =>
        clamped.x >= area.x && clamped.y >= area.y && clamped.x + clamped.width <= area.x + area.width && clamped.y + clamped.height <= area.y + area.height,
      ) ?? areas[0];
      let cursor = null;
      try {
        const point = screen.getCursorScreenPoint?.();
        if (point && isFiniteNumber(point.x) && isFiniteNumber(point.y)) cursor = { x: point.x, y: point.y };
      } catch {
        /* no pointer to follow: the mascot looks ahead */
      }
      // on macOS, how far the window may reach next to a neighbouring display (its room then opens the other way)
      const limits = seams && known ? windowLimits(box, bounds, screen.getAllDisplays().map((display) => display.bounds ?? display.workArea)) : null;
      return { bounds, workArea: { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height }, cursor, ...(known ? { body: box } : {}), ...(limits ? { limits } : {}) };
    },
    "floating-bots:resize": (event, size) => {
      const found = senderFloat(event);
      if (!found || !size || !isFiniteNumber(size.width) || !isFiniteNumber(size.height)) return null;
      const { win } = found.entry;
      const bounds = win.getBounds();
      // never larger than the largest display's work area (macOS would cut it there anyway)
      const areas = workAreas();
      const most = { width: Math.max(FLOAT_MIN.width, ...areas.map((area) => area.width)), height: Math.max(FLOAT_MIN.height, ...areas.map((area) => area.height)) };
      const width = Math.round(clampNumber(size.width, FLOAT_MIN.width, Math.min(FLOAT_MAX.width, most.width)));
      const height = Math.round(clampNumber(size.height, FLOAT_MIN.height, Math.min(FLOAT_MAX.height, most.height)));
      // the character's corner stays where it was: by default the bottom-right (the window grows
      // up and to the left); a balloon flipped below or to the right asks for the other corner
      const fromLeft = size.anchorX === "left";
      const fromTop = size.anchorY === "top";
      const sized = {
        x: fromLeft ? bounds.x : bounds.x + bounds.width - width,
        y: fromTop ? bounds.y : bounds.y + bounds.height - height,
        width,
        height,
      };
      // the character keeps its distance to that corner until the page reports where it really is
      const body = bodyOf(found.entry);
      const corner = { x: fromLeft ? "left" : "right", y: fromTop ? "top" : "bottom" };
      found.entry.body = body ? bodyAfterResize(body, bounds, sized, corner) : null;
      found.entry.keep = found.entry.keep ? bodyAfterResize(found.entry.keep, bounds, sized, corner) : null;
      // a drag's path was the window's old frame: the next step starts from this one
      found.entry.drag = null;
      const next = clampFor(found.entry, sized);
      place(win, next);
      return next;
    },
    /*
     * The page laid the window out again (the chat's room moved to another
     * side of the character): the window takes this size and moves so the
     * character stays exactly where it is on the screen.
     */
    "floating-bots:frame": (event, frame) => {
      const found = senderFloat(event);
      if (!found || !frame || !isFiniteNumber(frame.width) || !isFiniteNumber(frame.height)) return null;
      const { entry } = found;
      const bounds = entry.win.getBounds();
      const size = {
        width: Math.round(clampNumber(frame.width, FLOAT_MIN.width, FLOAT_MAX.width)),
        height: Math.round(clampNumber(frame.height, FLOAT_MIN.height, FLOAT_MAX.height)),
      };
      const body = sanitizeBody(frame.body, size);
      if (!body) return null;
      // where it was drawn just before, as the page measured it (else what main last heard)
      const was = sanitizeBody(frame.from, bounds) ?? bodyOf(entry) ?? body;
      entry.body = body;
      // the pill moves with the new layout: the page reports it again
      entry.keep = null;
      entry.drag = null;
      const next = clampFor(entry, { x: bounds.x + was.x - body.x, y: bounds.y + was.y - body.y, ...size });
      place(entry.win, next);
      return next;
    },
  };

  const listeners = {
    "floating-bots:update": (event, message) => {
      if (!isMain(event) || !message || !isBotId(message.botId)) {
        note(`update refused (${!isMain(event) ? "not the app page" : "bad bot id"})`);
        return;
      }
      const clean = sanitizeFloatingSnapshot(message.snapshot);
      if (!clean) {
        note(`state for ${message.botId} refused as malformed`);
        return;
      }
      const entry = floats.get(message.botId);
      if (!live(entry)) {
        // the window is about to open: keep it for then (a few bots at most)
        pending.delete(message.botId);
        pending.set(message.botId, clean);
        while (pending.size > MAX_FLOATING) pending.delete(pending.keys().next().value);
        return;
      }
      entry.snapshot = clean;
      entry.win.webContents.send("floating-bot:state", clean);
    },
    // a right click (or a long press) on the mascot: its menu, natively, right at the pointer
    "floating-bots:menu": (event, at) => {
      const found = senderFloat(event);
      const items = found?.entry.snapshot?.menu ?? [];
      if (!found || !items.length) return;
      if (!deps.Menu) {
        note("right-click menu skipped: Menu was not given");
        return;
      }
      const win = found.entry.win;
      let zoom = 1;
      try {
        zoom = win.webContents.getZoomFactor?.() ?? 1;
      } catch {
        /* the default zoom */
      }
      const point = menuPopupPoint(at, zoom, win.getBounds(), workAreas());
      const entry = found.entry;
      const choose = (id) => {
        // a move is the mascot's own business: straight to its window, the brain has nothing to decide
        if (id.startsWith("move:")) {
          const clip = id.slice(5);
          if (MOVE_RE.test(clip) && live(entry)) entry.win.webContents.send("floating-bot:move", clip);
          return;
        }
        if (FOCUS_IDS.has(id)) {
          try {
            deps.focusMain?.();
          } catch {
            /* the brain still switches the thread */
          }
        }
        // the bot id comes from which window asked (now: a switch may have given it another), never from the payload
        const botId = idOf(entry);
        if (botId) notifyMain("floating-bots:event", { botId, event: { type: "menu", id } });
      };
      const menu = deps.Menu.buildFromTemplate(menuTemplate(items, choose));
      menu.popup({ window: win, x: point.x, y: point.y });
    },
    // the call's levels, many times a second: straight to that bot's window, never kept
    "floating-bots:level": (event, message) => {
      if (!isMain(event) || !message || !isBotId(message.botId)) return;
      const levels = sanitizeLevels(message.levels);
      const entry = floats.get(message.botId);
      if (levels && live(entry)) entry.win.webContents.send("floating-bot:level", levels);
    },
    "floating-bots:ready": (event) => {
      const found = senderFloat(event);
      if (found) found.entry.ready = true;
      if (found && !found.entry.snapshot) {
        note(`${found.botId} is ready but no state has come from the app yet; asking the app`);
        // pull, not only push: the app page sends this bot's state again
        notifyMain("floating-bots:want", { botId: found.botId });
      }
      if (found?.entry.snapshot) found.entry.win.webContents.send("floating-bot:state", found.entry.snapshot);
    },
    "floating-bots:event": (event, value) => {
      const found = senderFloat(event);
      if (!found) return;
      const clean = sanitizeFloatingEvent(value);
      if (!clean) return;
      // "Open in the app" (and the settings, the composer's clip and model chip) bring the app forward from here: the window is not focused
      if (clean.type === "open" || (clean.type === "menu" && FOCUS_IDS.has(clean.id)) || (clean.type === "work" && clean.action === "open")) {
        try {
          deps.focusMain?.();
        } catch {
          /* the brain still switches the thread */
        }
      }
      // the bot id comes from which window spoke, never from the payload
      notifyMain("floating-bots:event", { botId: found.botId, event: clean });
    },
    "floating-bots:set-interactive": (event, on) => {
      const found = senderFloat(event);
      if (!found || typeof on !== "boolean" || !clickThrough || found.entry.interactive === on) return;
      found.entry.interactive = on;
      try {
        found.entry.win.setIgnoreMouseEvents(!on, { forward: true });
      } catch {
        /* keep the last state */
      }
    },
    "floating-bots:set-focusable": (event, on) => {
      const found = senderFloat(event);
      if (!found || typeof on !== "boolean") return;
      const { entry } = found;
      // focus can nudge a transparent window for a frame: put it back before the next paint
      const held = entry.win.getBounds();
      try {
        // each call is a round trip to the window server: only a change, and focus only when it is not already there
        if (entry.focusable !== on) entry.win.setFocusable(on);
        entry.focusable = on;
        if (on && !entry.win.isFocused()) entry.win.focus();
        const now = entry.win.getBounds();
        if (now.x !== held.x || now.y !== held.y || now.width !== held.width || now.height !== held.height) place(entry.win, held);
      } catch {
        /* keep the last state */
      }
    },
    // where the character is drawn in its window: what main keeps on screen
    "floating-bots:body": (event, value) => {
      const found = senderFloat(event);
      if (!found) return;
      const bounds = found.entry.win.getBounds();
      const body = sanitizeBody(value, bounds);
      if (!body) return;
      found.entry.body = body;
      // what hangs on the character (the input pill): kept on screen with it, never under the Dock or taskbar
      found.entry.keep = value && typeof value === "object" ? sanitizeBody(value.keep, bounds) : null;
      // a pill that just opened past the work area's edge brings the cluster back in (never mid-drag or mid-flight)
      if (found.entry.keep && !found.entry.autopilot && !found.entry.drag) {
        const next = clampFor(found.entry, bounds);
        if (next.x !== bounds.x || next.y !== bounds.y) place(found.entry.win, next);
      }
    },
    "floating-bots:autopilot": (event, on) => {
      const found = senderFloat(event);
      if (!found || typeof on !== "boolean") return;
      found.entry.autopilot = on;
      if (on) clearTimeout(found.entry.rememberTimer);
    },
    "floating-bots:moved": (event) => {
      const found = senderFloat(event);
      if (!found) return;
      // the drag is over: the next one starts from where the window stands, the whole cluster on screen
      found.entry.drag = null;
      const bounds = found.entry.win.getBounds();
      const next = clampFor(found.entry, bounds);
      if (next.x !== bounds.x || next.y !== bounds.y) place(found.entry.win, next);
      clearTimeout(found.entry.rememberTimer);
      remember(found.botId);
    },
  };

  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  for (const [channel, handler] of Object.entries(listeners)) ipcMain.on(channel, handler);

  return {
    /** For tests and for main's lifecycle hooks. */
    window(botId) {
      const entry = floats.get(botId);
      return live(entry) ? entry.win : null;
    },
    get botIds() {
      return [...floats.keys()];
    },
    open,
    close,
    closeAll,
    /** The main window is gone (closed or crashed): its brain went with it. */
    mainWindowGone: closeAll,
    dispose() {
      closeAll();
      for (const channel of Object.keys(handlers)) ipcMain.removeHandler?.(channel);
      for (const change of ["display-added", "display-removed", "display-metrics-changed"]) screen.removeListener?.(change, reclamp);
      for (const [channel, handler] of Object.entries(listeners)) ipcMain.removeListener?.(channel, handler);
    },
  };
}
