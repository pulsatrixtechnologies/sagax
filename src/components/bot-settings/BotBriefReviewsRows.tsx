// #5445 [M-20261127-070]: the reviews this bot holds, on the bot page
// (General > Notifications). Same storage as Settings > More notifications
// used to list (useProactiveReceive / PUT /api/bots/:id/background-brief
// with `reviews`). The daily brief stays in BackgroundBriefCard beside
// these rows (one place, no second switch).
import { t } from "@/lib/i18n";
import { DescribedRow, Switch } from "../SettingsPrimitives";
import { useProactiveReceive } from "../settings/ProactiveReceiveSettings";

/** End-of-day and weekly review switches when this bot holds them.
 * Absent fields (another bot holds the review, or the server omits them)
 * are not drawn. */
export function BotReviewRows({ botId, botName }: { botId: string; botName: string }) {
  const { state, setBot } = useProactiveReceive();
  const row = state?.receive.bots.find((entry) => entry.id === botId);
  if (!row) return null;
  const showEnd = row.endOfDay !== undefined;
  const showWeekly = row.weekly !== undefined;
  if (!showEnd && !showWeekly) return null;
  return (
    <div data-bot-review-rows="" className="flex flex-col">
      {showEnd && (
        <DescribedRow
          rowId={`receive.endOfDay.${botId}`}
          label={t("review.endOfDay.title")}
          description={t("settings.receive.carriedBy", { name: botName })}
        >
          <Switch
            checked={row.endOfDay === true}
            aria-label={t("settings.receive.endOfDay.switch", { name: botName })}
            onClick={() => setBot(botId, { endOfDay: !row.endOfDay })}
          />
        </DescribedRow>
      )}
      {showWeekly && (
        <DescribedRow
          rowId={`receive.weekly.${botId}`}
          label={t("review.weekly.title")}
          description={t("settings.receive.carriedBy", { name: botName })}
        >
          <Switch
            checked={row.weekly === true}
            aria-label={t("settings.receive.weekly.switch", { name: botName })}
            onClick={() => setBot(botId, { weekly: !row.weekly })}
          />
        </DescribedRow>
      )}
    </div>
  );
}
