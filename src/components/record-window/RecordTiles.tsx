// A record window's figures as tiles (M-20261127-140): a word, a number and a
// quiet line under it, each tile a quick filter of the list below (a board's
// Active, Urgent, Unscheduled and Waiting). Shared by every kind that leads
// with its figures (D-20261127-009). A tile is a contrasted surface with no
// border (M-20261127-135); the one chosen carries the focus ring's accent. A
// line's tone is a dot beside the words, the words staying in the secondary
// ink (4.5:1 in every skin).
import type { ReactNode } from "react";
import { TONE_DOT } from "@/components/RecordCard";
import { cn } from "@/lib/cn";

export interface RecordTile<T extends string> {
  id: T;
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: "alert" | "waiting";
}

export function RecordTiles<T extends string>({ tiles, selected, onSelect, label }: {
  tiles: readonly RecordTile<T>[];
  /** the tile whose filter is on */
  selected?: T;
  onSelect?: (id: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="grid min-w-0 grid-cols-2 gap-3 @min-[48rem]:grid-cols-4" data-record-tiles="">
      {tiles.map((tile) => {
        const on = tile.id === selected;
        const body = (
          <>
            <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{tile.label}</span>
            <span className="text-[22px] font-semibold leading-7 tabular-nums text-popover-ink" data-record-tile-value="">{tile.value}</span>
            {tile.detail && (
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-popover-ink-secondary">
                {tile.tone && <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tile.tone])} />}
                <span className="min-w-0 truncate">{tile.detail}</span>
              </span>
            )}
          </>
        );
        const look = cn("flex min-w-0 flex-col items-start gap-0.5 rounded-xl bg-popover-field p-3 text-start", on && "ring-2 ring-accent/70");
        return onSelect ? (
          <button key={tile.id} type="button" aria-pressed={on} className={cn(look, "hover:bg-popover-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus")} onClick={() => onSelect(tile.id)} data-record-tile={tile.id}>{body}</button>
        ) : (
          <div key={tile.id} className={look} data-record-tile={tile.id}>{body}</div>
        );
      })}
    </div>
  );
}
