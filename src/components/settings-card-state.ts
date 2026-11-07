// Remembered open state of the settings cards (split out of SettingsPrimitives.tsx).

import { useSyncExternalStore } from "react";

const CARD_STATE_KEY = "openmausbot.settingsCards.v1";

type CardStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): CardStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readCardStates(storage: CardStorage | null): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(CARD_STATE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

/** The remembered open state of a settings card, or `fallback` when this
 * device never toggled it (or storage is unavailable). */
export function loadCardOpen(id: string, fallback: boolean, storage: CardStorage | null = defaultStorage()): boolean {
  return readCardStates(storage)[id] ?? fallback;
}

export function saveCardOpen(id: string, open: boolean, storage: CardStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(CARD_STATE_KEY, JSON.stringify({ ...readCardStates(storage), [id]: open }));
  } catch {
    /* private windows and full quotas keep the in-memory state only */
  }
}

// One shared store of explicit choices (toggles, remembered states, deep
// links), read from storage once. A card without a choice follows its
// `defaultOpen`, which may change once the card's data loads. Keeping the
// state here rather than in component state lets a deep link open a card
// that has not mounted yet, with no event wiring.
let cardChoices: Record<string, boolean> | null = null;
export const ANONYMOUS_CARD = "anonymous:";
const cardListeners = new Set<() => void>();

function choices(): Record<string, boolean> {
  return (cardChoices ??= readCardStates(defaultStorage()));
}

function subscribeCards(listener: () => void): () => void {
  cardListeners.add(listener);
  return () => cardListeners.delete(listener);
}

function chooseCardOpen(id: string, open: boolean): void {
  cardChoices = { ...choices(), [id]: open };
  // A card without a cardId still folds, for this session only.
  if (!id.startsWith(ANONYMOUS_CARD)) saveCardOpen(id, open);
  for (const listener of cardListeners) listener();
}

/** Opens the collapsible settings card `id` and scrolls it into view, now if
 * it is mounted or as soon as it mounts (a deep link opens Settings first). */
export function requestSettingsCard(id: string): void {
  lastRequestedCard = id;
  chooseCardOpen(id, true);
  let frames = 0;
  const reveal = () => {
    try {
      const card = [...document.querySelectorAll<HTMLElement>("[data-settings-card]")].find((node) => node.dataset.settingsCard === id);
      if (card) {
        card.scrollIntoView?.({ block: "nearest" });
        if (lastRequestedCard === id) lastRequestedCard = null;
      } else if (++frames < 30) requestAnimationFrame(reveal);
      else if (lastRequestedCard === id) lastRequestedCard = null;
    } catch {
      /* no document outside the renderer */
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(reveal);
}

let lastRequestedCard: string | null = null;

/** The card a link asked for last, read once: Settings uses it to send a
 * link to a moved card where that card is shown on this computer. */
export function takeRequestedSettingsCard(): string | null {
  const id = lastRequestedCard;
  lastRequestedCard = null;
  return id;
}

/** Peek at the card a link asked for without clearing it (Vault filter). */
export function peekRequestedSettingsCard(): string | null {
  return lastRequestedCard;
}

/** Test seam: drop the in-memory choices so storage is read again. */
export function resetSettingsCards(): void {
  cardChoices = null;
  lastRequestedCard = null;
}

export function useCardOpen(id: string, defaultOpen: boolean) {
  const read = () => choices()[id];
  const chosen = useSyncExternalStore(subscribeCards, read, read);
  const open = chosen ?? defaultOpen;
  const toggle = () => chooseCardOpen(id, !open);
  return [open, toggle] as const;
}

/** A folding row's open state, remembered like a collapsible card's and
 * opened by `requestSettingsCard(id)` (a search, a deep link). */
export function useSettingsCardOpen(id: string, defaultOpen: boolean) {
  return useCardOpen(id, defaultOpen);
}
