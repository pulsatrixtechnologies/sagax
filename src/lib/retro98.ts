// The "Hibou 98" easter egg: the small, always-loaded half. It only knows how
// to notice the secret triggers, remember the switch per device, and swap the
// app skin. Everything that draws (the retro owl assistant, its balloons and
// dialogs, the late-90s skin layer) lives behind dynamic imports, so a device
// that never finds the egg never downloads or runs any of it.
import { applySkin, prefersDarkScheme, readSkin, readSkinTint, resolveStoredSkin, type SkinId } from "./skins";
import { isSkinTint, readRememberedVariants, readSkinAuto, SKIN_WINDOWS_TINTS, type SkinTintId } from "./skin-families";

/** Up up down down left right left right b a. */
export const KONAMI_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
] as const;

/** Typed alone in the composer, this toggles the mode and is never sent. */
export const RETRO_COMMAND = "/hibou98";

export const RETRO_SKIN: SkinId = "retro98";

const ON_KEY = "omb.retro98.on";
const UNLOCKED_KEY = "omb.retro98.unlocked";
const PREVIOUS_SKIN_KEY = "omb.retro98.previousSkin";
const PREVIOUS_TINT_KEY = "omb.retro98.previousTint";
const TOGGLE_EVENT = "omb:retro98-toggle";
const SIGNAL_EVENT = "omb:retro98-signal";

export type RetroStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): RetroStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string, storage = defaultStorage()): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null, storage = defaultStorage()): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    /* private mode or quota: the switch still works for this session */
  }
}

/** Normalizes a key the way the sequence is written ("B" with caps lock is "b"). */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * A stateful matcher fed one key at a time. It answers how much of the
 * sequence the keys typed so far end with: `sequence.length` means the key
 * just completed it (and the match starts over). Whatever came before does
 * not matter, so "up up up down..." still works.
 */
export function createKonamiDetector(sequence: readonly string[] = KONAMI_SEQUENCE): (key: string) => number {
  let recent: string[] = [];
  return (raw: string) => {
    recent.push(normalizeKey(raw));
    if (recent.length > sequence.length) recent.shift();
    for (let length = recent.length; length > 0; length -= 1) {
      const tail = recent.slice(recent.length - length);
      if (tail.every((key, i) => key === sequence[i])) {
        if (length === sequence.length) recent = [];
        return length;
      }
    }
    return 0;
  };
}

/** True when the composer holds only the secret command (spaces and case forgiven). */
export function isRetroCommand(text: string): boolean {
  return text.trim().toLowerCase() === RETRO_COMMAND;
}

/**
 * The composer's hook: when the draft is only the secret command (and nothing
 * is attached), toggle the mode and report the draft as consumed so it is
 * cleared instead of sent.
 */
export function consumeRetroCommand(text: string, attachmentCount: number, toggle: () => unknown = toggleRetro): boolean {
  if (attachmentCount > 0 || !isRetroCommand(text)) return false;
  toggle();
  return true;
}

export function readRetroEnabled(storage?: RetroStorage): boolean {
  return read(ON_KEY, storage) === "1";
}

export function readRetroUnlocked(storage?: RetroStorage): boolean {
  return read(UNLOCKED_KEY, storage) === "1" || readRetroEnabled(storage);
}

// Module state, so a signal can be a no-op without touching storage.
let enabled = readRetroEnabled();

export function retroEnabled(): boolean {
  return enabled;
}

export interface RetroSkinSwap {
  current: () => SkinId;
  /** The colour or edition worn over the current skin, or null. */
  currentTint?: () => SkinTintId | null;
  apply: (id: SkinId, tint?: SkinTintId | null) => void;
}

/** The Windows edition last picked under Hibou 98, or null for the classic look. */
function rememberedEdition(): SkinTintId | null {
  const edition = readRememberedVariants().retro98;
  return edition && (SKIN_WINDOWS_TINTS as readonly string[]).includes(edition) ? (edition as SkinTintId) : null;
}

const documentSkin: RetroSkinSwap = {
  current: () => {
    const stamped = typeof document === "undefined" ? undefined : document.documentElement.dataset.skin;
    return (stamped as SkinId | undefined) || readSkin();
  },
  currentTint: () => readSkinTint(),
  // under Auto, the skin put back is the one the system's scheme asks for
  apply: (id, tint) => applySkin(resolveStoredSkin(id, readSkinAuto(), prefersDarkScheme()), tint),
};

/**
 * Turns the mode on or off, remembers it, and swaps the skin: on keeps the
 * skin the person had and wears retro98; off puts that exact skin back.
 */
export function setRetroEnabled(
  on: boolean,
  options: { storage?: RetroStorage; skin?: RetroSkinSwap; notify?: boolean } = {},
): void {
  const storage = options.storage ?? defaultStorage();
  const skin = options.skin ?? documentSkin;
  if (on) {
    const current = skin.current();
    if (current !== RETRO_SKIN) {
      write(PREVIOUS_SKIN_KEY, current, storage);
      write(PREVIOUS_TINT_KEY, skin.currentTint?.() ?? null, storage);
    }
    write(UNLOCKED_KEY, "1", storage);
    write(ON_KEY, "1", storage);
    skin.apply(RETRO_SKIN, rememberedEdition());
  } else {
    const previous = read(PREVIOUS_SKIN_KEY, storage) as SkinId | null;
    const previousTint = read(PREVIOUS_TINT_KEY, storage);
    write(ON_KEY, null, storage);
    write(PREVIOUS_SKIN_KEY, null, storage);
    write(PREVIOUS_TINT_KEY, null, storage);
    if (skin.current() === RETRO_SKIN) {
      const back = previous && previous !== RETRO_SKIN ? previous : readDefaultSkin();
      skin.apply(back, isSkinTint(previousTint) ? previousTint : null);
    }
  }
  enabled = on;
  if (options.notify !== false && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { detail: { on } }));
  }
}

function readDefaultSkin(): SkinId {
  const stored = readSkin();
  return stored === RETRO_SKIN ? "pulsatrix" : stored;
}

export function toggleRetro(options?: Parameters<typeof setRetroEnabled>[1]): boolean {
  const next = !readRetroEnabled(options?.storage);
  setRetroEnabled(next, options);
  return next;
}

export function onRetroToggle(listener: (on: boolean) => void): () => void {
  const handler = (event: Event) => listener(Boolean((event as CustomEvent<{ on: boolean }>).detail?.on));
  window.addEventListener(TOGGLE_EVENT, handler);
  return () => window.removeEventListener(TOGGLE_EVENT, handler);
}

/** "send" comes from the composer; the rest from the retro menu bar. */
export type RetroSignal = "send" | "tip" | "gallery" | "options";

/** Tells the assistant something happened. Free when the mode is off. */
export function retroSignal(kind: RetroSignal): void {
  if (!enabled || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SIGNAL_EVENT, { detail: { kind } }));
}

export function onRetroSignal(listener: (kind: RetroSignal) => void): () => void {
  const handler = (event: Event) => {
    const kind = (event as CustomEvent<{ kind: RetroSignal }>).detail?.kind;
    if (kind) listener(kind);
  };
  window.addEventListener(SIGNAL_EVENT, handler);
  return () => window.removeEventListener(SIGNAL_EVENT, handler);
}

/** The assistant itself, fetched on first activation only. */
export const loadRetroAssistant = () => import("@/components/retro-assistant/RetroAssistant");
