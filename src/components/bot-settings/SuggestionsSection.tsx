// Details > Suggestions (reference design): next steps for this bot, from
// its setup checklist (GET /api/bots/:id/overview) and the conversations
// waiting on the person. Hide turns the card off for every bot (one
// preference per person, Settings > Appearance brings it back). Nothing to
// suggest: no card at all.
import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, openBotThread, useStore, type Bot } from "@/state/store";
import type { BotOverview } from "@/lib/bot-overview-types";
import { botSuggestions, type BotSuggestion } from "@/lib/bot-suggestions";
import { GROUPED_CARD, GROUPED_ROW } from "@/lib/grouped-card";
import { setShowSuggestions, useShowSuggestions } from "@/lib/panel-visibility";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";

export function SuggestionsSection({ bot, routineCount }: { bot: Bot; routineCount: number }) {
  const { dispatch } = useStore();
  const threadsShown = useShowThreads();
  const [setup, setSetup] = useState<BotOverview["setup"] | null>(null);
  const shown = useShowSuggestions();

  // The checklist follows what it reads: the name, title, instructions,
  // folder and schedules. Older servers without `setup` suggest no step.
  const soulFilled = Boolean(bot.soul?.trim());
  useEffect(() => {
    let live = true;
    void api<BotOverview>(`/api/bots/${encodeURIComponent(bot.id)}/overview`)
      .then((overview) => { if (live) setSetup(Array.isArray(overview.setup) ? overview.setup : null); })
      .catch(() => { if (live) setSetup(null); });
    return () => { live = false; };
  }, [bot.id, bot.name, bot.title, soulFilled, routineCount]);

  const items = useMemo(
    () => botSuggestions({ setup, tasks: bot.tasks, waitingApprovals: bot.waitingApprovals }),
    [setup, bot.tasks, bot.waitingApprovals],
  );
  if (!shown || !items.length) return null;

  const run = (item: BotSuggestion) => {
    if (item.action.kind === "openThread") openBotThread(dispatch, bot, item.action.threadId, threadsShown);
    else dispatch({ type: "openPersonaEditor", botId: bot.id, section: item.action.section });
  };

  return (
    <SuggestionsCard
      headingId={`bot-suggestions-${bot.id}`}
      rows={items.map((item) => ({ id: item.id, title: t(item.titleKey, item.vars), subtitle: t(item.subtitleKey, item.vars), onRun: () => run(item) }))}
    />
  );
}

/** The Suggestions card itself: its title with Hide, then one grouped card
 * of rows. Shared by the bot panel and the group panel (GroupDetailsTab). */
export function SuggestionsCard({ headingId, rows }: { headingId: string; rows: ReadonlyArray<{ id: string; title: string; subtitle: string; onRun: () => void }> }) {
  return (
    <section data-bot-settings-section="suggestions" aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-0.5">
        <h3 id={headingId} className="text-[12px] leading-[17px] text-ink-tertiary">{t("botPanel.suggestions.title")}</h3>
        <button
          type="button"
          data-suggestions-hide
          onClick={() => setShowSuggestions(false)}
          className="rounded px-1 text-[12.5px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {t("botPanel.suggestions.hide")}
        </button>
      </div>
      <ul className={GROUPED_CARD}>
        {rows.map((row) => (
          <li key={row.id} className={GROUPED_ROW}>
            <button
              type="button"
              data-suggestion={row.id}
              onClick={row.onRun}
              className="flex w-full min-w-0 items-start gap-2.5 text-left hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
            >
              <Sparkles size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-secondary" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold leading-5 text-ink" title={row.title}>{row.title}</span>
                <span className="line-clamp-2 text-[12px] leading-4 text-ink-secondary">{row.subtitle}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
