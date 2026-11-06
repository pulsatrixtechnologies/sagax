// Who pays for this bot's replies (#1137, shared/turn-payer.ts), on an
// organization server: the owner (their engine, subscription or local
// model answers everyone who writes to the bot) or each person (each pays
// for their own messages; when the bot's engine is not available to them,
// it answers with their default model). The owner sets it without an
// admin (server/routes/bot-runtime-settings.ts). Who pays never changes
// who reads a conversation. #2080: a grey line under the model chip of
// Bot > Model ("Paid by the owner") with its one menu, no longer hidden
// under Advanced.
import { t } from "@/lib/i18n";
import { botTurnPayer } from "@/lib/bot-runtime-settings";
import type { Bot } from "@/state/store";
import type { TurnPayerMode } from "../../../shared/turn-payer";
import { HelpTip, PillSelect } from "../SettingsPrimitives";
import { useBotRuntimeSettings } from "./useBotRuntimeSettings";

type Choice = TurnPayerMode | "default";

export function payerLabel(mode: TurnPayerMode): string {
  return t(mode === "owner" ? "botPayer.owner" : "botPayer.speaker");
}

/** The payer under the model chip: who pays, in grey, and the menu that
 * changes it. Help keeps the full explanation and the privacy note. */
export function BotPayerLine({ bot }: { bot: Bot }) {
  const { shown, save, saving, error } = useBotRuntimeSettings(bot);
  const current = botTurnPayer(shown);
  if (!current || !shown.turnPayerDefault) return null;
  const fallback = shown.turnPayerDefault;
  const value: Choice = shown.turnPayer ?? "default";
  const title = t("botPayer.title");
  return (
    <div data-bot-payer={current} data-settings-row="botPayerMode" className="px-3.5 pb-2.5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1 text-[12px] leading-4 text-ink-secondary">
          <span data-bot-payer-label className="truncate">{t("botModel.paidBy", { value: payerLabel(current) })}</span>
          <HelpTip label={t("settings.moreAbout", { title })}>
            <p>{t(current === "owner" ? "botPayer.ownerHelp" : "botPayer.speakerHelp")}</p>
            <p className="mt-1.5">{t("botPayer.privacy")}</p>
          </HelpTip>
        </span>
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
