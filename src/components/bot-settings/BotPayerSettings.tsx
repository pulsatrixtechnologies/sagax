// Who pays for this bot's replies (#1137, shared/turn-payer.ts), on an
// organization server: the owner (their engine, subscription or local
// model answers everyone who writes to the bot) or each person (each pays
// for their own messages; when the bot's engine is not available to them,
// it answers with their default model). The owner sets it without an
// admin (server/routes/bot-runtime-settings.ts). Who pays never changes
// who reads a conversation. #2080: a grey line under the model chip of
// Bot > Model ("Paid by the owner") with its one menu, no longer hidden
// under Advanced. 2026-11-06 hotfix: shown to the bot's owner or an admin
// (the server's gate, bots.behaviour is always a member's own), never tied
// to the automaticRecovery right, and also in Shared with.
import { t } from "@/lib/i18n";
import { botTurnPayer } from "@/lib/bot-runtime-settings";
import { viewerOwnsBot } from "@/lib/bot-capabilities";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { useStore, type Bot, type ConfigStatus } from "@/state/store";
import type { TurnPayerMode } from "../../../shared/turn-payer";
import { HelpTip, PillSelect, SettingsGroup } from "../SettingsPrimitives";
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

/** Who pays, in Shared with: the same line as Bot > Model, where people
 * look for it once the bot is shared. */
export function BotPayerCard({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const { draft } = useBotEditor();
  if (draft || !canChooseBotPayer(state.config, bot)) return null;
  return (
    <SettingsGroup title={t("botPayer.title")} groupId="botPayerSharing">
      <div className="pt-2.5"><BotPayerLine key={`payer:${bot.id}`} bot={bot} /></div>
    </SettingsGroup>
  );
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
