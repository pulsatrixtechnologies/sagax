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
  /** Human-readable explanation of what the shortcut does. */
  description: string;
  /** Keys displayed on macOS (e.g. ["⌘", "K"]). */
  macKeys: string[];
  /** Keys displayed on Windows and Linux (e.g. ["Ctrl", "K"]). */
  winKeys: string[];
}

/** Group of related shortcuts displayed under a section heading. */
export interface ShortcutGroup {
  /** Category display name (e.g. "Navigation"). */
  category: string;
  /** List of shortcuts belonging to this group. */
  items: ShortcutItem[];
}

/** A row whose description follows the interface language: read through a
 * getter, so the catalog is one constant and every read is in the language
 * chosen now (src/locales, `shortcuts.item.<camelCase id>`, the keys the
 * shortcuts window uses too). */
function row(id: string, macKeys: string[], winKeys: string[]): ShortcutItem {
  const key = `shortcuts.item.${id === "shortcuts-cheat-sheet" ? "cheatSheet" : id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}` as LocaleKey;
  return {
    id,
    get description() {
      return t(key);
    },
    macKeys,
    winKeys,
  };
}

function group(id: "navigation" | "chat" | "calls" | "management", items: ShortcutItem[]): ShortcutGroup {
  return {
    get category() {
      return t(`shortcuts.group.${id}` as LocaleKey);
    },
    items,
  };
}

/**
 * Complete catalog of keyboard shortcuts available in Sagax,
 * organized logically into categories for quick reference.
 */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  group("navigation", [
    row("command-palette", ["⌘", "K"], ["Ctrl", "K"]),
    row("search-everything", ["⌘", "⇧", "F"], ["Ctrl", "Shift", "F"]),
    row("new-bot", ["⌘", "N"], ["Ctrl", "N"]),
    row("new-group", ["⌘", "⇧", "N"], ["Ctrl", "Shift", "N"]),
    row("jump-bot", ["⌘", "1–9"], ["Ctrl", "1–9"]),
    row("switch-bot", ["⌘", "⇧", "[ / ]"], ["Ctrl", "Shift", "[ / ]"]),
    row("toggle-sidebar", ["⌘", "B"], ["Ctrl", "B"]),
    row("find-conversation", ["⌘", "F"], ["Ctrl", "F"]),
  ]),
  group("chat", [
    row("send-message", ["Return"], ["Enter"]),
    row("focus-composer", ["⌘", "I"], ["Ctrl", "I"]),
    row("quote-selection", ["⌘", "L"], ["Ctrl", "L"]),
    row("dictate", ["⌘", "D"], ["Ctrl", "D"]),
    row("new-line", ["⇧", "Return"], ["Shift", "Enter"]),
    row("edit-last-message", ["↑"], ["↑"]),
    row("close-panel", ["Esc"], ["Esc"]),
    row("shortcuts-cheat-sheet", ["⌘", "/"], ["Ctrl", "/"]),
  ]),
  group("calls", [
    row("live-call-mute", ["⌘", "⇧", "M"], ["Ctrl", "Shift", "M"]),
    row("live-call-hang-up", ["⌘", "⇧", "H"], ["Ctrl", "Shift", "H"]),
  ]),
  group("management", [
    row("save-bulletin", ["⌘", "Return"], ["Ctrl", "Enter"]),
    row("reorder-section", ["⌥", "↑ / ↓"], ["Alt", "↑ / ↓"]),
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

/**
 * Filter shortcut groups by query matching item descriptions or keys.
 */
export function filterShortcutGroups(
  groups: readonly ShortcutGroup[],
  query: string,
  isMac: boolean = isMacPlatform(),
): ShortcutGroup[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...groups];

  return groups
    .map((group) => {
      const filteredItems = group.items.filter((item) => {
        const keys = shortcutKeysForPlatform(item, isMac).join(" ").toLowerCase();
        return (
          item.description.toLowerCase().includes(normalized) ||
          group.category.toLowerCase().includes(normalized) ||
          keys.includes(normalized)
        );
      });
      return { ...group, items: filteredItems };
    })
    .filter((group) => group.items.length > 0);
}
