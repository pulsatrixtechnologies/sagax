// Instructions as a pushed page in the bot panel (2026-11-01, lot 3): same
// round back and title as TaskDetail. Escape goes back. Read-only here; the
// profile editor still edits the text in place.
import { BookOpen } from "lucide-react";
import { useCallback } from "react";

import { BotAvatar } from "./Avatar";
import { normalizeState } from "@/lib/mascot";
import { t } from "@/lib/i18n";
import { SettingsGroup } from "./SettingsPrimitives";
import type { Bot } from "@/state/store";
import { PanelPage } from "./bot-settings/PanelPage";

export function BotInstructionsDialog({ bot, onClose, onPanelClose }: {
  bot: Bot;
  onClose: () => void;
  /** Closes the whole bot panel (the header's panel button). Defaults to onClose. */
  onPanelClose?: () => void;
  /** Kept for callers; the page always renders in place. */
  inline?: boolean;
}) {
  const closePanel = useCallback(() => (onPanelClose ?? onClose)(), [onPanelClose, onClose]);

  return (
    <PanelPage
      name={bot.name}
      onBack={onClose}
      onClose={closePanel}
      data-bot-instructions-page=""
      bodyClassName="px-4 py-4"
      footer={
        <button type="button" onClick={onClose} className="ml-auto rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110">
          {t("botInstructions.done")}
        </button>
      }
    >
      <div className="mb-4 flex items-center gap-3">
        <BotAvatar
          bot={bot}
          state={normalizeState(bot.mascotExpression) ?? "idle"}
          size={36}
          motion="none"
          motionKey={0}
          animated={false}
        />
        <div className="min-w-0">
          <p className="truncate text-[13px] text-ink-secondary">{bot.title || t("botInstructions.title")}</p>
        </div>
      </div>
      <SettingsGroup groupId="bot-instructions" title={t("botInstructions.title")} plain>
        {bot.description.trim() ? (
          <div className="whitespace-pre-wrap break-words rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3 text-[13px] leading-6 text-ink">
            {bot.description}
          </div>
        ) : (
          <div className="rounded-xl border-[0.5px] border-dashed border-border bg-elevated px-5 py-10 text-center">
            <BookOpen size={20} aria-hidden="true" className="mx-auto text-ink-tertiary" />
            <p className="mt-3 text-[13px] text-ink">{t("botInstructions.empty")}</p>
            <p className="mt-1 text-[12px] text-ink-secondary">{t("botInstructions.emptyHint")}</p>
          </div>
        )}
      </SettingsGroup>
      <p className="mt-3 px-1 text-[12px] text-ink-secondary">{t("botInstructions.everyTurn")}</p>
    </PanelPage>
  );
}
