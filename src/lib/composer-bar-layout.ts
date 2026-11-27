// Message bar button order (owner 2026-11-26, D-20261126-014; unified store
// D-20261127-004, #5443): facade over sagax.uiLayout.v1. The movable buttons
// (+, model, usage, voice). The text field and Send stay fixed. Placement of
// the usage pill lives on the same store (usagePlacement). [choix d'agent]:
// the order stores a split so a button can sit left or right of the fixed field.
import { useSyncExternalStore } from "react";

import type { UsagePillPlacement } from "./usage-pill-preferences";
import {
  composerLayoutFromUi,
  getUiLayout,
  setUiLayout,
  subscribeUiLayout,
  resetUiLayoutStoreForTests,
} from "./ui-layout/preference";
import { COMPOSER_BAR_COMPONENT_IDS } from "./ui-layout/types";

export const COMPOSER_BAR_ITEMS = COMPOSER_BAR_COMPONENT_IDS;
export type ComposerBarItem = (typeof COMPOSER_BAR_ITEMS)[number];

export type ComposerBarLayout = {
  /** Movable buttons in left-to-right order (visible only). */
  order: readonly ComposerBarItem[];
  /** How many of the first items sit left of the fixed text field. */
  left: number;
};

export const COMPOSER_BAR_LAYOUT_KEY = "sagax.composerBarLayout.v1";

export const DEFAULT_COMPOSER_BAR_LAYOUT: ComposerBarLayout = Object.freeze({
  order: Object.freeze(["plus", "model", "usage", "voice"] as ComposerBarItem[]),
  left: 1,
});

const EMPTY_ORDER: readonly ComposerBarItem[] = Object.freeze([]);

function isItem(value: unknown): value is ComposerBarItem {
  return typeof value === "string" && (COMPOSER_BAR_ITEMS as readonly string[]).includes(value);
}

/** Parse the stored JSON (legacy shape). Missing or broken values become the default. */
export function parseComposerBarLayout(raw: string | null | undefined): ComposerBarLayout {
  if (!raw) return { order: [...DEFAULT_COMPOSER_BAR_LAYOUT.order], left: DEFAULT_COMPOSER_BAR_LAYOUT.left };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { order: [...DEFAULT_COMPOSER_BAR_LAYOUT.order], left: DEFAULT_COMPOSER_BAR_LAYOUT.left };
    }
    const record = parsed as { order?: unknown; left?: unknown };
    const seen = new Set<ComposerBarItem>();
    const order: ComposerBarItem[] = [];
    if (Array.isArray(record.order)) {
      for (const entry of record.order) {
        if (!isItem(entry) || seen.has(entry)) continue;
        seen.add(entry);
        order.push(entry);
      }
    }
    for (const item of COMPOSER_BAR_ITEMS) {
      if (!seen.has(item)) order.push(item);
    }
    const leftRaw = typeof record.left === "number" && Number.isFinite(record.left) ? Math.trunc(record.left) : DEFAULT_COMPOSER_BAR_LAYOUT.left;
    const left = Math.max(0, Math.min(order.length, leftRaw));
    return { order, left };
  } catch {
    return { order: [...DEFAULT_COMPOSER_BAR_LAYOUT.order], left: DEFAULT_COMPOSER_BAR_LAYOUT.left };
  }
}

export function serializeComposerBarLayout(layout: ComposerBarLayout): string {
  const seen = new Set<ComposerBarItem>();
  const order: ComposerBarItem[] = [];
  for (const item of layout.order) {
    if (!isItem(item) || seen.has(item)) continue;
    seen.add(item);
    order.push(item);
  }
  for (const item of COMPOSER_BAR_ITEMS) if (!seen.has(item)) order.push(item);
  const left = Math.max(0, Math.min(order.length, Math.trunc(layout.left)));
  return JSON.stringify({ order, left });
}

/** Move one button to an absolute index in the order (0..length-1). */
export function moveComposerBarItem(layout: ComposerBarLayout, id: ComposerBarItem, toIndex: number): ComposerBarLayout {
  const from = layout.order.indexOf(id);
  if (from < 0) return layout;
  const order = [...layout.order];
  order.splice(from, 1);
  const clamped = Math.max(0, Math.min(order.length, toIndex));
  order.splice(clamped, 0, id);
  let left = layout.left;
  if (from < layout.left && clamped >= layout.left) left = Math.max(0, left - 1);
  else if (from >= layout.left && clamped < layout.left) left = Math.min(order.length, left + 1);
  return { order, left: Math.max(0, Math.min(order.length, left)) };
}

/** Move one step left or right in the order (keyboard arrows). */
export function nudgeComposerBarItem(layout: ComposerBarLayout, id: ComposerBarItem, delta: -1 | 1): ComposerBarLayout {
  const from = layout.order.indexOf(id);
  if (from < 0) return layout;
  const to = from + delta;
  if (to < 0 || to >= layout.order.length) return layout;
  return moveComposerBarItem(layout, id, to);
}

/** Put the button on the left or right of the text field without changing its relative neighbours when possible. */
export function setComposerBarSide(layout: ComposerBarLayout, id: ComposerBarItem, side: "left" | "right"): ComposerBarLayout {
  const from = layout.order.indexOf(id);
  if (from < 0) return layout;
  const onLeft = from < layout.left;
  if (side === "left" && onLeft) return layout;
  if (side === "right" && !onLeft) return layout;
  if (side === "left") {
    const order = [...layout.order];
    order.splice(from, 1);
    order.splice(layout.left, 0, id);
    return { order, left: layout.left + 1 };
  }
  const order = [...layout.order];
  order.splice(from, 1);
  const insertAt = Math.max(0, layout.left - 1);
  order.splice(insertAt, 0, id);
  return { order, left: Math.max(0, layout.left - 1) };
}

export function resetComposerBarLayout(): ComposerBarLayout {
  return { order: [...DEFAULT_COMPOSER_BAR_LAYOUT.order], left: DEFAULT_COMPOSER_BAR_LAYOUT.left };
}

/** Items drawn left of the text field, then right. Usage is omitted from the
 * bar when its placement is above or below. */
export function composerBarSlots(
  layout: ComposerBarLayout,
  placement: UsagePillPlacement,
): { left: ComposerBarItem[]; right: ComposerBarItem[] } {
  const visible = layout.order.filter((item) => item !== "usage" || placement === "inBar");
  let leftCount = 0;
  for (let i = 0; i < layout.left; i++) {
    const item = layout.order[i];
    if (item && (item !== "usage" || placement === "inBar")) leftCount += 1;
  }
  leftCount = Math.max(0, Math.min(visible.length, leftCount));
  return {
    left: visible.slice(0, leftCount) as ComposerBarItem[],
    right: visible.slice(leftCount) as ComposerBarItem[],
  };
}

function fromStore(): ComposerBarLayout {
  const { order, left } = composerLayoutFromUi(getUiLayout());
  // Visible-only: drop ids that are hidden in uiLayout.
  const hidden = new Set(getUiLayout().zones.composerBar.hidden);
  const visible = order.filter((id): id is ComposerBarItem => isItem(id) && !hidden.has(id));
  // Recount left against the visible list.
  let visibleLeft = 0;
  for (let i = 0; i < left; i++) {
    const id = order[i];
    if (id && isItem(id) && !hidden.has(id)) visibleLeft += 1;
  }
  const filled = visible.length ? visible : [...DEFAULT_COMPOSER_BAR_LAYOUT.order];
  return {
    order: filled,
    left: Math.max(0, Math.min(filled.length, visibleLeft || (hidden.size ? 0 : DEFAULT_COMPOSER_BAR_LAYOUT.left))),
  };
}

export function getComposerBarLayout(): ComposerBarLayout {
  return fromStore();
}

export function setComposerBarLayout(next: ComposerBarLayout): void {
  const normalized = parseComposerBarLayout(serializeComposerBarLayout(next));
  const current = getUiLayout();
  const hidden = current.zones.composerBar.hidden.filter((id) => isItem(id));
  // Keep hidden ids out of the new visible order; preserve them in hidden.
  const visible = normalized.order.filter((id) => !hidden.includes(id));
  setUiLayout({
    ...current,
    zones: {
      ...current.zones,
      composerBar: {
        ...current.zones.composerBar,
        order: [...visible],
        hidden: [...hidden],
        left: Math.max(0, Math.min(visible.length, normalized.left)),
        usagePlacement: current.zones.composerBar.usagePlacement ?? "inBar",
      },
    },
  });
}

export function subscribeComposerBarLayout(listener: () => void): () => void {
  return subscribeUiLayout(listener);
}

export function useComposerBarLayout(): ComposerBarLayout {
  return useSyncExternalStore(subscribeComposerBarLayout, getComposerBarLayout, () => DEFAULT_COMPOSER_BAR_LAYOUT);
}

/** Test helper: drop the unified store so localStorage is the source again. */
export function resetComposerBarLayoutStoreForTests(): void {
  resetUiLayoutStoreForTests();
}

void EMPTY_ORDER;
