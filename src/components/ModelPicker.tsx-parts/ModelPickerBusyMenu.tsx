// Model menu while the bot works (omb #4395): only the effort. The chat bar
// no longer opens it (M-20261126-104): its mode menu keeps its Effort row.
import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { EffortRow } from "./EffortControls";

/** The model menu while the bot works: only the effort, no help text (the trigger tooltip says why the model is locked). */
export function BusyModelMenu({
  bot,
  threadId,
  updateBotDefault,
}: {
  bot: Bot;
  threadId?: string;
  updateBotDefault: boolean;
}) {
  return (
    <div data-model-busy className="flex flex-col py-1">
      <EffortRow
        compact
        bot={bot}
        threadId={threadId}
        updateBotDefault={updateBotDefault}
        className="px-3.5 py-[5px]"
        label={(
          <span className="text-[13px] leading-[18px] text-ink">
            {t("model.effort")}
          </span>
        )}
      />
    </div>
  );
}
