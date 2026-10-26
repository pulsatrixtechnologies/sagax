// The Approvals screen's keys: Y yes, N no, J / K (or the arrows) to move,
// Enter to open the card, Escape to step back, X to tick a row for a bulk
// answer. Plain keys only, and never while typing or choosing inside a
// question card (its letters pick its own options there).

export type InboxKeyAction = "next" | "previous" | "open" | "close" | "allow" | "deny" | "toggle";

interface KeyLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  target?: EventTarget | null;
  defaultPrevented?: boolean;
}

/** Where Enter belongs to the focused control (it presses it), not the screen. */
const OWN_ENTER = "button, a, [role='button'], [role='tab']";

/** Where a key belongs to the control, not the screen. */
const OWN_KEYS = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-ask-choice], [data-question-sheet], [role='dialog'], [role='menu']";

export function inboxKeyAction(event: KeyLike): InboxKeyAction | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const target = event.target as { closest?: (selector: string) => unknown } | null | undefined;
  if (target && typeof target.closest === "function" && target.closest(OWN_KEYS)) return null;
  switch (event.key) {
    case "j": case "J": case "ArrowDown": return "next";
    case "k": case "K": case "ArrowUp": return "previous";
    case "Enter":
      if (target && typeof target.closest === "function" && target.closest(OWN_ENTER)) return null;
      return event.shiftKey ? null : "open";
    case "Escape": return "close";
    case "y": case "Y": return "allow";
    case "n": case "N": return "deny";
    case "x": case "X": return "toggle";
    default: return null;
  }
}

/** The next selection after a move, clamped to the list. */
export function moveSelection(keys: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (!keys.length) return null;
  const at = current ? keys.indexOf(current) : -1;
  if (at < 0) return step === 1 ? keys[0]! : keys[keys.length - 1]!;
  return keys[Math.max(0, Math.min(keys.length - 1, at + step))]!;
}

/** What to show once the selected card leaves the list: the one that took
 * its place, else the one above it, else nothing. */
export function selectionAfterRemoval(keys: readonly string[], removed: string): string | null {
  const at = keys.indexOf(removed);
  const rest = keys.filter((key) => key !== removed);
  if (!rest.length) return null;
  if (at < 0) return rest[0]!;
  return rest[Math.min(at, rest.length - 1)]!;
}
