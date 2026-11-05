// Who pays for this bot's replies (#1137, shared/turn-payer.ts), on an
// organization server: the owner (their engine, subscription or local
// model answers everyone who writes to the bot) or each person (each pays
// for their own messages; when the bot's engine is not available to them,
// it answers with their default model). The owner sets it without an
// admin (server/routes/bot-runtime-settings.ts). Who pays never changes
// who reads a conversation. One row of Bot > Model > Advanced (#2050).
import { t } from "@/lib/i18n";
import { botTurnPayer } from "@/lib/bot-runtime-settings";
import type { Bot } from "@/state/store";
import type { TurnPayerMode } from "../../../shared/turn-payer";
import { DescribedRow, PillSelect } from "../SettingsPrimitives";
import { useBotRuntimeSettings } from "./useBotRuntimeSettings";

type Choice = TurnPayerMode | "default";

export function payerLabel(mode: TurnPayerMode): string {
  return t(mode === "owner" ? "botPayer.owner" : "botPayer.speaker");
}

export function BotPayerRow({ bot }: { bot: Bot }) {
  const { shown, save, saving, error } = useBotRuntimeSettings(bot);
  const current = botTurnPayer(shown);
  if (!current || !shown.turnPayerDefault) return null;
  const fallback = shown.turnPayerDefault;
  const value: Choice = shown.turnPayer ?? "default";
  const title = t("botPayer.title");
  return (
    <div data-bot-payer={current}>
      <DescribedRow label={title} description={t(current === "owner" ? "botPayer.ownerHelp" : "botPayer.speakerHelp")} help={t("botPayer.privacy")} rowId="botPayerMode">
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
      </DescribedRow>
      {error && <p role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
