/**
 * Keyboard shortcuts catalog and platform-specific key resolution.
 * Provides structured shortcut groups for navigation, chat, and workspace management.
 */
import type { SendKey } from "./send-key";
import type { LocaleKey } from "@/locales";
import { t } from "./i18n";
import { isMacPlatform } from "./is-mac-platform";

export { isMacPlatform };

/** Single keyboard shortcut entry with descriptions and platform-specific keys. */
export interface ShortcutItem {
  /** Stable identifier for the shortcut. */
  id: string;
  /** What it does, in a few words (#4097: the reference's short labels). */
  description: string;
  /** The grey words beside the label, when a few words need a precision. */
  hint?: string;
  /** Keys displayed on macOS (e.g. ["⌘", "K"]). */
  macKeys: string[];
  /** Keys displayed on Windows and Linux (e.g. ["Ctrl", "K"]); empty when
   * the shortcut exists on macOS only (the row is then not shown there). */
  winKeys: string[];
}

/** Group of related shortcuts displayed under a section heading. */
export interface ShortcutGroup {
  /** Stable identifier of the group. */
  id?: ShortcutGroupId;
  /** Category display name (e.g. "Navigation"). */
  category: string;
  /** List of shortcuts belonging to this group. */
  items: ShortcutItem[];
}

/** The groups in the reference's order (#4097): Essentials and Chat first,
 * then Navigation, Panels and Window, then this app's own Calls and Groups. */
export type ShortcutGroupId = "essentials" | "chat" | "navigation" | "panels" | "window" | "calls" | "management";

const camel = (id: string) => (id === "shortcuts-cheat-sheet" ? "cheatSheet" : id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

/** A row whose description follows the interface language: read through a
 * getter, so the catalog is one constant and every read is in the language
 * chosen now (src/locales, `shortcuts.item.<camelCase id>`, the keys the
 * shortcuts window uses too). `hint`: the row has `shortcuts.hint.<id>`. */
function row(id: string, macKeys: string[], winKeys: string[], hint = false): ShortcutItem {
  const key = `shortcuts.item.${camel(id)}` as LocaleKey;
  const hintKey = `shortcuts.hint.${camel(id)}` as LocaleKey;
  const item: ShortcutItem = {
    id,
    get description() {
      return t(key);
    },
    macKeys,
    winKeys,
  };
  // a getter too (a spread would read it once, before the language loads)
  if (hint) Object.defineProperty(item, "hint", { get: () => t(hintKey), enumerable: true });
  return item;
}

function group(id: ShortcutGroupId, items: ShortcutItem[]): ShortcutGroup {
  return {
    id,
    get category() {
      return t(`shortcuts.group.${id}` as LocaleKey);
    },
    items,
  };
}

/**
 * Complete catalog of keyboard shortcuts available in Sagax, in the
 * reference's groups (#4097). The new-line row is shown as the Send row's
 * grey hint by the shortcuts window; it stays here so its keys follow the
 * send key setting like Send's.
 */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  group("essentials", [
    row("command-palette", ["⌘", "K"], ["Ctrl", "K"], true),
    row("search-everything", ["⌘", "⇧", "F"], ["Ctrl", "Shift", "F"]),
    row("new-bot", ["⌘", "N"], ["Ctrl", "N"], true),
    row("send-message", ["Return"], ["Enter"]),
    row("jump-bot", ["⌘", "1–9"], ["Ctrl", "1–9"]),
    row("toggle-sidebar", ["⌘", "B"], ["Ctrl", "B"], true),
    // the macOS app menu's Settings item (electron/menu.mjs); no chord elsewhere
    row("settings", ["⌘", ","], []),
    row("shortcuts-cheat-sheet", ["⌘", "/"], ["Ctrl", "/"], true),
  ]),
  group("chat", [
    row("focus-composer", ["⌘", "I"], ["Ctrl", "I"]),
    row("find-conversation", ["⌘", "F"], ["Ctrl", "F"]),
    row("dictate", ["⌘", "D"], ["Ctrl", "D"], true),
    row("quote-selection", ["⌘", "L"], ["Ctrl", "L"]),
    row("new-line", ["⇧", "Return"], ["Shift", "Enter"]),
    row("edit-last-message", ["↑"], ["↑"], true),
  ]),
  group("navigation", [
    row("switch-bot", ["⌘", "⇧", "[ / ]"], ["Ctrl", "Shift", "[ / ]"]),
    row("new-group", ["⌘", "⇧", "N"], ["Ctrl", "Shift", "N"]),
  ]),
  group("panels", [
    row("close-panel", ["Esc"], ["Esc"], true),
  ]),
  // the View menu's roles (electron/menu.mjs `viewMenu`)
  group("window", [
    row("zoom", ["⌘", "+ / −"], ["Ctrl", "+ / −"], true),
    row("full-screen", ["⌃", "⌘", "F"], ["F11"]),
  ]),
  group("calls", [
    row("live-call-mute", ["⌘", "⇧", "M"], ["Ctrl", "Shift", "M"]),
    row("live-call-hang-up", ["⌘", "⇧", "H"], ["Ctrl", "Shift", "H"]),
  ]),
  group("management", [
    row("save-bulletin", ["⌘", "Return"], ["Ctrl", "Enter"], true),
    row("reorder-section", ["⌥", "↑ / ↓"], ["Alt", "↑ / ↓"], true),
  ]),
];

/** The app-wide chords added for parity with the reference design (2026-10-16). None was
 * bound before: ⌘B, ⌘I and ⌘L had no handler and no menu accelerator, ⌘⇧F
 * and ⌘⇧N were free (⌘F and ⌘N take only the unshifted chord). */
export type AppShortcut = "toggle-sidebar" | "focus-composer" | "search-everything" | "quote-selection" | "new-group";

/** Which app-wide chord a key press is: ⌘ on macOS, Ctrl elsewhere (never
 * both, never with ⌥), so an input method's keys and another modifier's own
 * chords pass through. Works from inside the composer like ⌘K and ⌘N do. */
export function appShortcutFor(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing" | "defaultPrevented">,
  isMac: boolean = isMacPlatform(),
): AppShortcut | null {
  if (event.defaultPrevented || event.isComposing || event.altKey) return null;
  const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) {
    if (key === "f") return "search-everything";
    if (key === "n") return "new-group";
    return null;
  }
  if (key === "b") return "toggle-sidebar";
  if (key === "i") return "focus-composer";
  if (key === "l") return "quote-selection";
  return null;
}

type Keys = Pick<ShortcutItem, "macKeys" | "winKeys">;
const ENTER: Keys = { macKeys: ["Return"], winKeys: ["Enter"] };
const SHIFT_ENTER: Keys = { macKeys: ["⇧", "Return"], winKeys: ["Shift", "Enter"] };
/** [send, new line] for each choice but the catalog's own Enter. */
const SEND_ROWS: Record<Exclude<SendKey, "enter">, [Keys, Keys]> = {
  "shift-enter": [SHIFT_ENTER, ENTER],
  "mod-enter": [{ macKeys: ["⌘", "Return"], winKeys: ["Ctrl", "Enter"] }, ENTER],
};

/** The catalog with its send and new-line rows following Settings →
 * Appearance → Send messages with. */
export function shortcutGroupsFor(sendKey: SendKey): readonly ShortcutGroup[] {
  if (sendKey === "enter") return SHORTCUT_GROUPS;
  const [send, newLine] = SEND_ROWS[sendKey];
  return SHORTCUT_GROUPS.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.id === "send-message" ? { ...item, ...send }
        : item.id === "new-line" ? { ...item, ...newLine }
          : item),
  }));
}

/** Help chords must not interrupt editing, composition, or another dialog. */
export function shouldOpenKeyboardShortcuts(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.altKey) return false;
  const helpKey = event.key === "?" && !event.metaKey && !event.ctrlKey;
  const helpChord = event.key === "/" && (event.metaKey || event.ctrlKey) && !event.shiftKey;
  if (!helpKey && !helpChord) return false;
  const target = event.target;
  return !(target instanceof HTMLElement && (
    target.isContentEditable || target.closest("input, textarea, select, dialog, [role=dialog]")
  ));
}

/**
 * Resolve the appropriate key representation for a shortcut item based on the host OS.
 */
export function shortcutKeysForPlatform(
  item: ShortcutItem,
  isMac: boolean = isMacPlatform(),
): string[] {
  return isMac ? item.macKeys : item.winKeys;
}
