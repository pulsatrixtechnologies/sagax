// The quiet row under the message box (owner 2026-11-25, M-20261125-071 to
// M-20261125-074, #5372): the context and usage meter, at its end, in small
// text. The model chip left it on 2026-11-26 (M-20261126-104): it sits inside
// the box again, just before the voice button (ComposerActionBar.tsx).
import type { ReactNode } from "react";

export function ComposerUnderRow({ meter }: {
  /** The context and usage meter, at the row's end. */
  meter?: ReactNode;
}) {
  return (
    // its own `composer` container: the meter's figures fold at the box's width
    <div data-composer-under-row="" className="@container/composer relative z-[1] w-full">
      <div className="flex min-h-7 items-center gap-2 px-2 pt-1">
        {meter && <span className="ml-auto flex min-w-0 items-center">{meter}</span>}
      </div>
    </div>
  );
}
