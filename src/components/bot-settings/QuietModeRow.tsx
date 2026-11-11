import { BellOff } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { setQuietAll, setQuietBot } from "@/lib/quiet-mode";
import type { BotQuietState } from "../../../shared/quiet-mode";
import { DescribedRow, Switch } from "../SettingsPrimitives";

/** #3480: one bot's quiet mode, the first row of « Ce que ce bot suit pour
 * toi » on the bot's page. On because of the switch for all the person's
 * bots, it says so and stays readable: that switch turns it off. */
export function QuietModeRow({ state, name }: { state: BotQuietState; name: string }) {
  const byAll = state.all && !state.bot;
  const description = byAll ? `${t("quietMode.bot.hint")} ${t("quietMode.byAll")}` : t("quietMode.bot.hint");
  return (
    <div data-quiet-mode-bot={state.botId} data-quiet-mode-by-all={byAll ? "" : undefined}>
      <DescribedRow label={t("quietMode.label")} description={description} rowId="botQuietMode">
        <Switch
          checked={state.quiet}
          aria-label={t("quietMode.botSwitch", { name })}
          // on through the switch for all: that switch is the one that turns it off
          aria-disabled={byAll || undefined}
          className={cn(byAll && "cursor-default enabled:hover:brightness-100")}
          onClick={() => { if (!byAll) void setQuietBot(state.botId, !state.bot); }}
        />
      </DescribedRow>
    </div>
  );
}

/** #3480: the switch for all the person's bots, in Settings, Notifications,
 * under « Ce que je reçois ». */
export function QuietModeAllRow({ all }: { all: boolean }) {
  return (
    <div data-quiet-mode-all="">
      <DescribedRow label={t("quietMode.all.label")} description={t("quietMode.all.hint")} rowId="receive.quietMode">
        <Switch checked={all} aria-label={t("quietMode.all.label")} onClick={() => void setQuietAll(!all)} />
      </DescribedRow>
    </div>
  );
}

/** #3480: the bot page's mark, in the header's line beside who sees it:
 * the state without opening anything. Opens the switch. */
export function QuietModeMark({ state, onOpen }: { state: BotQuietState; onOpen?: () => void }) {
  if (!state.quiet) return null;
  const title = state.all && !state.bot ? t("quietMode.markAll") : t("quietMode.label");
  const body = <><BellOff size={13} aria-hidden="true" /> {t("quietMode.label")}</>;
  return onOpen ? (
    <button type="button" data-bot-profile-quiet="" title={title} onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-full text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
      {body}
    </button>
  ) : (
    <span data-bot-profile-quiet="" title={title} className="inline-flex items-center gap-1.5">{body}</span>
  );
}
