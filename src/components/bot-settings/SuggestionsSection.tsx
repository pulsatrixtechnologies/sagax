// Activity > Suggested (reference design, #2125): next steps for this bot,
// the server's open fix cards and what its routines need from the person
// first (#4250 S6, from the one waiting list and `Routine.needsPerson`),
// then the conversations waiting on the person, a saving the server
// proposed and its setup checklist (GET /api/bots/:id/overview), then Add to Slack (the Admin link,
// when the server has one) and Add to meeting (a new routine for the
// calendar). Each row ends with a chevron. The title row has Hide on the
// right (bot panel and group panel): it turns the one person-wide preference
// off at once, and Settings > Appearance > Sidebar > Show suggestions brings
// the card back.
import { CalendarPlus, ChevronRight, Sparkles } from "lucide-react";
import type { ComponentType } from "react";
import { SlackLogo } from "../SlackLogo";
import { useEffect, useMemo, useState } from "react";
import { api, openBotThread, openRoutineRun, type Bot } from "@/state/store";
import { useStoreDispatch } from "@/state/store-selector";
import type { BotOverview } from "@/lib/bot-overview-types";
import { botSuggestions, serverCards, type BotSuggestion } from "@/lib/bot-suggestions";
import { useServerWaitingItems, waitingStamp } from "@/lib/pinned-waiting";
import { needSentence } from "@/lib/routine-display";
import type { Routine } from "@/lib/routines";
import { GROUPED_CARD, GROUPED_ROW, PANEL_CARD, PANEL_LABEL, PANEL_ROW } from "@/lib/grouped-card";
import { cn } from "@/lib/cn";
import { setShowSuggestions, useShowSuggestions } from "@/lib/panel-visibility";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";

const NO_ROUTINES: readonly Routine[] = [];
const NO_THREADS: readonly string[] = [];

export function SuggestionsSection({ bot, routineCount, routines = NO_ROUTINES, slackUrl = null, onAddToMeeting }: {
  bot: Bot;
  routineCount: number;
  /** The bot's routines: what each needs from the person (`needsPerson`). */
  routines?: readonly Routine[];
  /** The Admin link that adds this bot to Slack (useBotSectionAvailability). */
  slackUrl?: string | null;
  /** Add to meeting: a new routine in the panel's Upcoming card. */
  onAddToMeeting?: () => void;
}) {
  const dispatch = useStoreDispatch();
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

  // the server's own cards waiting in the bot's conversations: the one list
  // the pinned row and Today read
  const waiting = useServerWaitingItems(shown ? bot.id : undefined, NO_THREADS, waitingStamp(bot));
  const cards = useMemo(() => serverCards(waiting), [waiting]);
  const items = useMemo(
    () => botSuggestions({ setup, tasks: bot.tasks, waitingApprovals: bot.waitingApprovals, routines, cards }),
    [setup, bot.tasks, bot.waitingApprovals, routines, cards],
  );
  const extra: SuggestionRow[] = [
    // Add to Slack only where the server offers the Admin link (#3398: an
    // option that cannot work is hidden; Slack as a channel is removed for
    // now, shared/team-chat-channels.ts).
    ...(slackUrl ? [{ id: "slack", title: t("botPanel.suggestions.slack.title"), icon: SlackLogo, href: slackUrl }] : []),
    ...(onAddToMeeting ? [{ id: "meeting", title: t("botPanel.suggestions.meeting.title"), icon: CalendarPlus, onRun: onAddToMeeting }] : []),
  ];
  if (!shown || (!items.length && !extra.length)) return null;

  const run = (item: BotSuggestion) => {
    const action = item.action;
    if (action.kind === "openThread") openBotThread(dispatch, bot, action.threadId, threadsShown);
    else if (action.kind === "openRun") openRoutineRun(dispatch, { runId: action.runId, botId: bot.id });
    else if (action.kind === "openRoutine") dispatch({ type: "openRoutine", botId: bot.id, routineId: action.routineId });
    else dispatch({ type: "openPersonaEditor", botId: bot.id, section: action.section });
  };

  return (
    <SuggestionsCard
      headingId={`bot-suggestions-${bot.id}`}
      panel
      rows={[...items.map((item) => ({ id: item.id, title: suggestionTitle(item), subtitle: suggestionSubtitle(item), onRun: () => run(item) })), ...extra]}
    />
  );
}

function suggestionTitle(item: BotSuggestion): string {
  return item.title ?? (item.titleKey ? t(item.titleKey, item.vars) : "");
}

function suggestionSubtitle(item: BotSuggestion): string | undefined {
  if (item.need) return needSentence(item.need);
  return item.subtitleKey ? t(item.subtitleKey, item.vars) : undefined;
}

type SuggestionRow = { id: string; title: string; subtitle?: string; icon?: ComponentType<{ size?: number | string; className?: string }>; onRun?: () => void; href?: string };

/** The Suggested card itself: its title with Hide, then one grouped card of
 * rows, each with a chevron. A row with `href` opens it in a new tab. Shared
 * by the bot panel and the group panel (GroupDetailsTab). */
export function SuggestionsCard({ headingId, rows, panel = false }: {
  headingId: string;
  rows: ReadonlyArray<SuggestionRow>;
  /** The bot panel (#2125): flat card, 14px rows. */
  panel?: boolean;
}) {
  return (
    <section data-bot-settings-section="suggestions" aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 id={headingId} className={panel ? PANEL_LABEL : "text-[12px] leading-[17px] text-ink-tertiary"}>{t("botPanel.suggestions.title")}</h3>
        <button
          type="button"
          data-suggestions-hide
          onClick={() => setShowSuggestions(false)}
          className={cn("rounded px-1 text-ink-tertiary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", panel ? "text-[13px] leading-[18px]" : "text-[12.5px]")}
        >
          {t("botPanel.suggestions.hide")}
        </button>
      </div>
      <ul className={panel ? PANEL_CARD : GROUPED_CARD}>
        {rows.map((row) => (
          <li key={row.id} className={panel ? cn(PANEL_ROW, "hover:bg-hover") : GROUPED_ROW}>
            <SuggestionRowBody row={row} panel={panel} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SuggestionRowBody({ row, panel }: { row: SuggestionRow; panel: boolean }) {
  const Icon = row.icon ?? Sparkles;
  const className = "flex w-full min-w-0 items-center gap-2.5 text-left hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60";
  const body = <>
    <Icon size={panel ? 16 : 15} className="shrink-0 text-ink-secondary" />
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={cn("truncate leading-5 text-ink", panel ? "text-[14px] font-normal" : "text-[13px] font-semibold")} title={row.title}>{row.title}</span>
      {row.subtitle && <span className="line-clamp-2 text-[12px] leading-4 text-ink-secondary">{row.subtitle}</span>}
    </span>
    <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
  </>;
  if (row.href) return <a data-suggestion={row.id} href={row.href} target="_blank" rel="noopener noreferrer" className={className}>{body}</a>;
  return <button type="button" data-suggestion={row.id} onClick={row.onRun} className={className}>{body}</button>;
}
