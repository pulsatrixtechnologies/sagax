// The quiet row under the message box (owner 2026-11-25, M-20261125-071 to
// M-20261125-074, #5372): the box itself holds only the +, the field and the
// voice button; what the conversation runs on reads under it, in small text.
// At the left the model chip (the mode, or the model the person pinned, then
// the reasoning level); at the right the context and usage meter.
import type { ReactNode, RefObject } from "react";
import type { Bot } from "@/state/store";
import { ModelPicker, type ComposerModelMenuControl } from "../ModelPicker";
import { COMPOSER_WIDE_ONLY } from "../ComposerControls";

export function ComposerUnderRow({ bot, threadId, modelMenu, composerRowRef, meter }: {
  bot: Bot;
  threadId: string;
  modelMenu: RefObject<ComposerModelMenuControl | null>;
  composerRowRef: RefObject<HTMLDivElement | null>;
  /** The context and usage meter, at the row's end. */
  meter?: ReactNode;
}) {
  return (
    // its own `composer` container: the chip folds into the + menu at the
    // same width as before (#4093, COMPOSER_WIDE_ONLY)
    <div data-composer-under-row="" className="@container/composer relative z-[1] w-full">
      <div className="flex min-h-7 items-center gap-2 px-2 pt-1">
        {/* #2106: picking writes the bot's model for every thread; menuControl
            still serves the + menu's Model row of a narrow window */}
        <span data-composer-model-chip="" className={COMPOSER_WIDE_ONLY}>
          <ModelPicker inComposer key={bot.threadId} bot={bot} threadId={threadId}
            menuControl={modelMenu}
            fallbackAnchor={() => composerRowRef.current?.querySelector<HTMLElement>("[data-composer-plus]") ?? null} />
        </span>
        {meter && <span className="ml-auto flex min-w-0 items-center">{meter}</span>}
      </div>
    </div>
  );
}
