// Model menu while the bot works (omb #4395): only the reasoning level.
import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { EffortRow } from "./EffortControls";

/** The model menu while the bot works: only the reasoning level can change, for the next turn. */
export function BusyModelMenu({
  bot,
  threadId,
  updateBotDefault,
  variants,
}: {
  bot: Bot;
  threadId?: string;
  updateBotDefault: boolean;
  variants: boolean;
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
            {variants ? t("model.simple.reasoning") : t("model.effort")}
          </span>
        )}
      />
      {threadId && (
        <p data-model-busy-scope className="px-3.5 py-1 text-[12px] leading-4 text-ink-tertiary">
          {t(updateBotDefault ? "model.scope.botHelp" : "model.scope.threadHelp")}
        </p>
      )}
      <p className="px-3.5 py-1 text-[12px] leading-4 text-ink-tertiary">{t("model.reasoningNextTurn")}</p>
      <p className="px-3.5 py-1 text-[12px] leading-4 text-ink-tertiary">
        {t(threadId ? "model.threadBusy" : "model.busy")}
      </p>
    </div>
  );
}
