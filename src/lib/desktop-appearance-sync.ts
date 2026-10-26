// The desktop's look, handed to the paired phone on a personal computer
// (shared/desktop-appearance.ts, server/routes/desktop-appearance.ts).
//
// The phone's Settings > Appearance > "Same as my computer" wears this
// computer's skin and font. An organization server keeps them in the
// person's preferences (user-preferences-sync.ts); a personal computer has no
// person record, so the desktop app keeps a copy of the appearance keys
// at /api/me/appearance:
//   1. at start the desktop is the authority: it saves what it wears now;
//   2. a local change (the skin picker, the font setting, Hibou 98) is saved
//      within WATCH_MS;
//   3. the record is read every POLL_MS; when it changed since this page last
//      saved or read it, and differs from what the page wears, the phone wrote
//      it: the page applies it, live.
// On an organization server the route answers 404 and nothing here runs.
import {
  DESKTOP_APPEARANCE_KEYS,
  DESKTOP_APPEARANCE_PATH,
  cleanDesktopAppearance,
  sameAppearance,
  type DesktopAppearance,
} from "../../shared/desktop-appearance";

const WATCH_MS = 1_500;
const POLL_MS = 5_000;

type Storage = Pick<globalThis.Storage, "getItem">;

export interface DesktopAppearanceSyncDeps {
  fetch: typeof fetch;
  storage: Storage;
  /** Wear what the phone chose: skin, font and the Hibou 98 switch. */
  apply: (next: DesktopAppearance, current: DesktopAppearance) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  timeoutMs?: number;
}

/** The appearance keys as this page holds them now. */
export function readDesktopAppearance(storage: Storage): DesktopAppearance {
  const raw: Record<string, string> = {};
  for (const key of DESKTOP_APPEARANCE_KEYS) {
    try {
      const value = storage.getItem(key);
      if (value !== null) raw[key] = value;
    } catch {
      /* storage refused: nothing to read */
    }
  }
  return cleanDesktopAppearance(raw);
}

async function put(deps: DesktopAppearanceSyncDeps, preferences: DesktopAppearance): Promise<boolean> {
  try {
    const response = await deps.fetch(DESKTOP_APPEARANCE_PATH, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferences }),
      credentials: "same-origin",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function get(deps: DesktopAppearanceSyncDeps): Promise<DesktopAppearance | null> {
  try {
    const response = await deps.fetch(DESKTOP_APPEARANCE_PATH, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 2_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { preferences?: unknown } | null;
    return cleanDesktopAppearance(body?.preferences);
  } catch {
    return null;
  }
}

/**
 * Runs step 1 and returns the two ticks (steps 2 and 3), or null when this
 * computer keeps no desktop appearance (an organization server, an older
 * server). Never throws.
 */
export async function startDesktopAppearanceSync(
  deps: DesktopAppearanceSyncDeps,
): Promise<{ push: () => Promise<void>; pull: () => Promise<void> } | null> {
  if ((await get(deps)) === null) return null;
  // The last value both sides agreed on.
  let known = readDesktopAppearance(deps.storage);
  if (!(await put(deps, known))) known = {};
  let busy = false;

  const push = async () => {
    if (busy) return;
    const local = readDesktopAppearance(deps.storage);
    if (sameAppearance(local, known)) return;
    busy = true;
    try {
      if (await put(deps, local)) known = local;
    } finally {
      busy = false;
    }
  };

  const pull = async () => {
    if (busy) return;
    busy = true;
    try {
      const remote = await get(deps);
      if (!remote || sameAppearance(remote, known)) return;
      const local = readDesktopAppearance(deps.storage);
      // A local change not saved yet wins; the next push sends it.
      if (!sameAppearance(local, known)) return;
      known = remote;
      if (!sameAppearance(remote, local)) deps.apply(remote, local);
    } finally {
      busy = false;
    }
  };

  const every = deps.setInterval ?? setInterval;
  every(() => void push(), WATCH_MS);
  every(() => void pull(), POLL_MS);
  return { push, pull };
}

/** The page's own wiring: real fetch and localStorage, the skin, font and retro modules. */
export async function syncDesktopAppearance(): Promise<void> {
  let storage: globalThis.Storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }
  const [{ applySkin, applySkinDepth, applySkinTexture, prefersDarkScheme, resolveStoredSkin, SKIN_IDS }, { isSkinTexture, isSkinTint, writeSkinAuto }, { applyFont, FONT_IDS }, retro] = await Promise.all([
    import("./skins"),
    import("./skin-families"),
    import("./fonts"),
    import("./retro98"),
  ]);
  await startDesktopAppearanceSync({
    fetch: window.fetch.bind(window),
    storage,
    apply: (next, current) => {
      const retroOn = next["omb.retro98.on"] === "1";
      if (next["omb.retro98.unlocked"] === "1") {
        try {
          storage.setItem("omb.retro98.unlocked", "1");
        } catch {
          /* private mode: the unlock lasts this session */
        }
      }
      if (retroOn !== (current["omb.retro98.on"] === "1")) retro.setRetroEnabled(retroOn);
      const auto = next["omb-skin-mode"] === "auto";
      writeSkinAuto(auto, storage);
      const skin = SKIN_IDS.find((id) => id === next["omb-skin"]);
      // a phone that does not send a tint chose a plain skin: the family's own look
      if (skin && !retroOn) applySkin(resolveStoredSkin(skin, auto, prefersDarkScheme()), isSkinTint(next["omb-skin-tint"]) ? next["omb-skin-tint"] : null);
      applySkinDepth(next["omb-skin-depth"] === "full" ? "full" : "accent");
      const texture = next["omb-skin-texture"];
      applySkinTexture(isSkinTexture(texture) ? texture : "none");
      const font = FONT_IDS.find((id) => id === (next["omb-font"] ?? "skin"));
      if (font) applyFont(font);
    },
  });
}
