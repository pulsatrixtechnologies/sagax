// Who pays for this bot's replies (#1137, shared/turn-payer.ts), on an
// organization server: the owner (their engine, subscription or local
// model answers everyone who writes to the bot) or each person (each pays
// for their own messages; when the bot's engine is not available to them,
// it answers with their default model). The owner sets it without an
// admin (server/routes/bot-runtime-settings.ts). Who pays never changes
// who reads a conversation. Shown to the bot's owner or an admin (the
// server's gate, bots.behaviour is always a member's own), never tied to the
// automaticRecovery right. One place only: 2026-11-07 (#2625, the V6
// canvas) the "Who pays for replies" card of the Model sub-page, under the
// engine it pays for; Shared with no longer shows it.
import { useId } from "react";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { botTurnPayer } from "@/lib/bot-runtime-settings";
import { viewerOwnsBot } from "@/lib/bot-capabilities";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { useStore, type Bot, type ConfigStatus } from "@/state/store";
import type { TurnPayerMode } from "../../../shared/turn-payer";
import { HelpTip, PillSelect, SettingsGroup, useSettingsSurface } from "../SettingsPrimitives";
import { useBotRuntimeSettings } from "./useBotRuntimeSettings";
import { useBotEditor } from "./BotEditorContext";

type Choice = TurnPayerMode | "default";

export function payerLabel(mode: TurnPayerMode): string {
  return t(mode === "owner" ? "botPayer.owner" : "botPayer.speaker");
}

/** Whether this viewer chooses who pays for this bot: its owner or an
 * admin, on an organization server (the server sends turnPayerDefault),
 * for a bot that does not run on its owner's computer. */
export function canChooseBotPayer(config: ConfigStatus | null | undefined, bot: Bot): boolean {
  return bot.host?.kind !== "machine" && Boolean(bot.turnPayerDefault) && !viewerBotsReadOnly(config) && viewerOwnsBot(config, bot);
}

/** Who pays for replies: its own card of the Model sub-page, the one
 * place it lives (#2625). */
export function BotPayerCard({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const { draft } = useBotEditor();
  if (draft || !canChooseBotPayer(state.config, bot)) return null;
  return (
    <SettingsGroup title={t("botPayer.title")} groupId="botPayerModel">
      <BotPayerRow key={`payer:${bot.id}`} bot={bot} />
    </SettingsGroup>
  );
}

/** One row: who pays now ("Paid by: The owner") over what it means, the
 * menu that changes it at the right; help keeps the privacy note. */
function BotPayerRow({ bot }: { bot: Bot }) {
  const { shown, save, saving, error } = useBotRuntimeSettings(bot);
  const labelId = useId();
  // The bot's profile page (#2313): drawn like its Channels and Access
  // rows (icon, 14px name over a 12px subtitle, the menu at the right).
  const plain = useSettingsSurface() === "plain";
  const current = botTurnPayer(shown);
  if (!current || !shown.turnPayerDefault) return null;
  const fallback = shown.turnPayerDefault;
  const value: Choice = shown.turnPayer ?? "default";
  const title = t("botPayer.title");
  return (
    <div data-bot-payer={current} data-settings-row="botPayerMode" role="group" aria-labelledby={labelId} className={plain ? "px-4 py-2.5" : "px-3.5 py-2.5"}>
      <div className={cn("flex flex-wrap items-center justify-between gap-y-2", plain ? "min-h-[36px] gap-x-3" : "min-h-[28px] gap-x-5")}>
        <div className={cn("flex min-w-0 flex-1 basis-[240px]", plain ? "items-center gap-3" : "items-start gap-2")}>
          <Wallet aria-hidden="true" className={cn("size-5 shrink-0 text-ink-secondary", !plain && "mt-px")} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span id={labelId} data-bot-payer-label className={plain ? "text-[14px] leading-5 text-ink" : "text-[13px] leading-[18px] text-ink"}>{t("botModel.paidBy", { value: payerLabel(current) })}</span>
              <HelpTip label={t("settings.moreAbout", { title })}><p>{t("botPayer.privacy")}</p></HelpTip>
            </div>
            <div className={cn("text-[12px] leading-4 text-ink-secondary", !plain && "mt-0.5")}>{t(current === "owner" ? "botPayer.ownerHelp" : "botPayer.speakerHelp")}</div>
          </div>
        </div>
        <PillSelect<Choice>
          value={value}
          ariaLabel={title}
          disabled={saving}
          onChange={(next) => void save({ turnPayer: next === "default" ? null : next })}
          options={[
            { value: "default", label: t("botPayer.default", { value: payerLabel(fallback) }) },
            { value: "owner", label: payerLabel("owner") },
            { value: "speaker", label: payerLabel("speaker") },
          ]}
        />
      </div>
      {error && <p role="alert" className="pt-1 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
