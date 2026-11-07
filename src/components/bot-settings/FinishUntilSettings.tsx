// "Do not finish until" (#1329, 2026-10-29): the bot's own condition and how
// many times Sagax may relaunch it on its own while the condition is not met
// (server/finish-until.ts). The bot's owner writes or clears both here; Save
// sends them through the bot's normal PATCH, the server's bot frame brings
// the stored values back.
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { FINISH_UNTIL_DEFAULT_ROUNDS, FINISH_UNTIL_MAX_ROUNDS, finishUntilRounds } from "../../../shared/finish-until-line";
import { useBotEditor } from "./BotEditorContext";
import { DescribedRow, HelpTip, PILL, PillSelect, PLAIN_FIELD, SettingsGroup, useSettingsSurface } from "../SettingsPrimitives";

/** Same cap as the server (server/finish-until.ts FINISH_UNTIL_MAX). */
const CONDITION_MAX = 400;
const ROUND_CHOICES = [1, 2, 3, 5, 8, 10, 15, 20, 30, FINISH_UNTIL_MAX_ROUNDS];

const inputCls = "min-h-8 w-full min-w-0 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 text-[13px] text-ink focus:border-focus";
const buttonCls = "rounded-lg border border-hairline/50 px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-raised disabled:opacity-40";

export function FinishUntilSettings({ bot }: { bot: Bot }) {
  const { request } = useBotEditor();
  // The bot's profile page (#2313): the condition a row of the card, its
  // field filled with no outline, Save and Clear pills.
  const plain = useSettingsSurface() === "plain";
  const stored = bot.finishUntil ?? "";
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // A new bot, or the server's stored value, replaces the draft.
  useEffect(() => { setDraft(stored); }, [bot.id, stored]);
  const rounds = finishUntilRounds(bot.finishUntilMaxRounds);
  const choices = ROUND_CHOICES.includes(rounds) ? ROUND_CHOICES : [...ROUND_CHOICES, rounds].sort((a, b) => a - b);
  const oneLine = draft.replace(/[\r\n]+/g, " ");
  const changed = oneLine.trim() !== stored;

  const save = async (patch: { finishUntil?: string; finishUntilMaxRounds?: number | null }) => {
    setSaving(true);
    setError("");
    try {
      await request(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPanel.finishUntil.error"));
    } finally {
      setSaving(false);
    }
  };

  const title = t("botPanel.finishUntil.title");
  return (
    <div data-bot-finish-until="">
      <SettingsGroup
        title={title}
        groupId="botFinishUntil"
        accessory={<HelpTip label={t("settings.moreAbout", { title })}>{t("botPanel.finishUntil.help")}</HelpTip>}
      >
        <div className={plain ? "flex flex-col gap-2 px-4 py-2.5" : "flex flex-col gap-2 px-3.5 py-2"}>
          <label className="flex flex-col gap-1">
            <span className={plain ? "text-[14px] leading-5 text-ink" : "text-[13px] leading-[18px] text-ink"}>{t("botPanel.finishUntil.condition")}</span>
            <input
              data-finish-until-input=""
              className={plain ? PLAIN_FIELD : inputCls}
              value={draft}
              maxLength={CONDITION_MAX}
              placeholder={t("botPanel.finishUntil.placeholder")}
              aria-label={t("botPanel.finishUntil.condition")}
              onChange={(event) => setDraft(event.target.value.replace(/[\r\n]+/g, " "))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && changed && !saving) void save({ finishUntil: oneLine.trim() });
                if (event.key === "Escape") setDraft(stored);
              }}
            />
          </label>
          <p className="text-[12px] leading-4 text-ink-secondary">
            {stored ? t("botPanel.finishUntil.onNote", { rounds: String(rounds) }) : t("botPanel.finishUntil.offNote")}
          </p>
          {error && <p role="alert" className="text-[12px] leading-4 text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              data-finish-until-save=""
              disabled={!changed || saving}
              onClick={() => void save({ finishUntil: oneLine.trim() })}
              className={plain ? PILL : cn(buttonCls, "border-transparent bg-accent text-accent-ink hover:brightness-110")}
            >
              {t("botPanel.finishUntil.save")}
            </button>
            {stored && (
              <button type="button" data-finish-until-clear="" disabled={saving} onClick={() => void save({ finishUntil: "" })} className={plain ? PILL : buttonCls}>
                {t("botPanel.finishUntil.clear")}
              </button>
            )}
          </div>
        </div>
        <DescribedRow label={t("botPanel.finishUntil.rounds")} help={t("botPanel.finishUntil.roundsHelp")} rowId="botFinishUntilRounds">
          <PillSelect
            value={String(rounds)}
            ariaLabel={t("botPanel.finishUntil.rounds")}
            disabled={saving}
            onChange={(next) => {
              const limit = Number(next);
              if (limit !== rounds) void save({ finishUntilMaxRounds: limit === FINISH_UNTIL_DEFAULT_ROUNDS ? null : limit });
            }}
            options={choices.map((limit) => ({ value: String(limit), label: String(limit) }))}
          />
        </DescribedRow>
      </SettingsGroup>
    </div>
  );
}
