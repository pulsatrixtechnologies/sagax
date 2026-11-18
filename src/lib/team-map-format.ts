// Words and times the Team map's org chart shows for a bot and a handoff.
import { activeLocale, t } from "./i18n";
import type { TeamMapBot, TeamMapPair } from "./team-map";

export type OrgState = "working" | "waiting" | "idle" | "noSignal";

/** A bot's live state, from what the store already knows. */
export function orgState(bot: TeamMapBot): OrgState {
  if (bot.activity === "waiting-on-you") return "waiting";
  if (bot.activity === "dead" || bot.activity === "no-signal") return "noSignal";
  if (bot.busy || bot.activity === "working") return "working";
  return "idle";
}

export function orgStateLabel(state: OrgState): string {
  return t(`teamMap.org.state.${state}` as "teamMap.org.state.working");
}

/** "1 min ago", "3 h ago", "2 d ago", in the page's language. */
export function agoLabel(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const formatter = new Intl.RelativeTimeFormat(activeLocale(), { numeric: "auto", style: "short" });
  if (seconds < 45) return formatter.format(0, "second");
  if (seconds < 3_600) return formatter.format(-Math.max(1, Math.round(seconds / 60)), "minute");
  if (seconds < 86_400) return formatter.format(-Math.round(seconds / 3_600), "hour");
  return formatter.format(-Math.round(seconds / 86_400), "day");
}

/** The latest handoff that touches a bot: "-> Echo, 1 min ago" or null. */
export function lastHandoffOf(botId: string, pairs: TeamMapPair[], nameOf: (id: string) => string | undefined, now: number = Date.now()): string | null {
  let best: TeamMapPair | null = null;
  for (const pair of pairs) {
    if (pair.sourceBotId !== botId && pair.targetBotId !== botId) continue;
    if (pair.count <= 0 && !pair.live) continue;
    const at = pair.lastAt ?? (pair.live ? now : 0);
    if (!best || at > (best.lastAt ?? (best.live ? now : 0))) best = pair;
  }
  if (!best) return null;
  const out = best.sourceBotId === botId;
  const other = nameOf(out ? best.targetBotId : best.sourceBotId);
  if (!other) return null;
  const at = best.lastAt ?? (best.live ? now : null);
  return `${out ? "→" : "←"} ${other}${at ? ` · ${agoLabel(at, now)}` : ""}`;
}
