// One fold for a long list in a card (#4075, #4104): the first rows, then the
// reference's grey "Show N more" line (SHOW_MORE_ROW) that unfolds the rest in
// place and becomes "Show less". The bot profile's Access card and its Skills
// card both use it, so the look, the count and the words live here once.
import { useState, type ReactNode } from "react";

import { t } from "@/lib/i18n";
import { SHOW_MORE_ROW } from "@/lib/grouped-card";

/** Splits a list into the rows shown while folded and the rows the fold
 * hides. Items `keep` marks (one that needs the person) are never hidden:
 * they come first, in their own order, and the shown part grows to hold them
 * all; the others follow in their order up to `shown`. */
export function foldItems<T>(items: readonly T[], shown: number, keep?: (item: T) => boolean): { head: T[]; rest: T[] } {
  const kept = keep ? items.filter(keep) : [];
  const others = keep ? items.filter((item) => !keep(item)) : [...items];
  const room = Math.max(0, shown - kept.length);
  return { head: [...kept, ...others.slice(0, room)], rest: others.slice(room) };
}

/** Renders `items` folded to `shown` rows, then the Show more / Show less line
 * when anything is hidden (a button with aria-expanded). `toggleAttr` names
 * the line's data attribute ("more" or "less"), for tests and captures. */
export function ShowMoreFold<T>({ items, shown, keep, render, toggleAttr }: {
  items: readonly T[];
  shown: number;
  keep?: (item: T) => boolean;
  render: (item: T) => ReactNode;
  toggleAttr: `data-${string}`;
}) {
  const [open, setOpen] = useState(false);
  const { head, rest } = foldItems(items, shown, keep);
  return (
    <>
      {head.map(render)}
      {open && rest.map(render)}
      {rest.length > 0 && (
        <button
          type="button"
          {...{ [toggleAttr]: open ? "less" : "more" }}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={SHOW_MORE_ROW}
        >
          {open ? t("fold.showLess") : t("fold.showMore", { count: rest.length })}
        </button>
      )}
    </>
  );
}
