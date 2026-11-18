import { ArrowRight, ExternalLink, X } from "lucide-react";
import { openBot, openThread, useStore, type Bot } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { agoLabel } from "@/lib/team-map-format";
import type { TeamMapPair } from "@/lib/team-map";
import { OrgBotAvatar } from "./OrgCard";
import { orgState } from "@/lib/team-map-format";

/** What a handoff row opens: the thread doing the work, the room it ran in,
 * else the bot it went to, the way that bot's own row would (the old row's rule). */
export function openPairTarget(
  pair: Pick<TeamMapPair, "groupId" | "threadId">,
  target: Bot,
  dispatch: Parameters<typeof openBot>[0],
  state: Parameters<typeof openThread>[2],
  showThreads: boolean,
) {
  if (!pair.groupId && pair.threadId) openThread(dispatch, { botId: target.id, threadId: pair.threadId }, state, showThreads);
  else if (pair.groupId) dispatch({ type: "select", id: pair.groupId });
  else openBot(dispatch, target, showThreads);
}

type Scope = { kind: "busiest" } | { kind: "bot"; bot: Bot } | { kind: "team"; key: string; name: string; botIds: string[] };

function PairRow({ pair, bots, bars, maxCount, onSelect }: {
  pair: TeamMapPair; bots: Map<string, Bot>; bars?: boolean; maxCount: number; onSelect: (bot: Bot) => void;
}) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const source = bots.get(pair.sourceBotId), target = bots.get(pair.targetBotId);
  if (!source || !target) return null;
  const reviews = pair.kind === "reviews";
  const tone = pair.live === "running" ? "bg-success" : pair.live === "queued" ? "bg-warning" : "bg-ink-tertiary";
  const open = () => openPairTarget(pair, target, dispatch, state, showThreads);
  const at = pair.lastAt ?? null;
  return (
    <div className="group relative flex flex-col gap-1 rounded-lg px-2.5 py-2 leading-4 hover:bg-raised/60" data-pair={`${pair.sourceBotId}:${pair.targetBotId}`}>
      <div className="flex items-center gap-2 text-[13px]">
        <span className={cn("size-1.5 shrink-0 rounded-full", tone)} aria-hidden="true" />
        <button type="button" onClick={() => onSelect(source)} className="truncate font-medium text-ink hover:underline">{source.name}</button>
        <span className="text-ink-secondary" aria-label={reviews ? t("teamMap.org.reviews") : t("teamMap.org.delegates")}>{reviews ? "◦→" : <ArrowRight size={12} />}</span>
        <button type="button" onClick={() => onSelect(target)} className="truncate font-medium text-ink hover:underline">{target.name}</button>
        <span className="ml-auto shrink-0 text-[11px] text-ink-tertiary">{at ? agoLabel(at) : pair.live === "running" ? t("teamMap.org.live.running") : pair.live === "queued" ? t("teamMap.org.live.queued") : ""}</span>
        <button type="button" aria-label={t("teamMap.org.openHandoff", { from: source.name, to: target.name })} onClick={open}
          className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-md bg-panel text-ink-secondary opacity-0 hover:bg-control hover:text-ink focus-visible:opacity-100 group-hover:opacity-100">
          <ExternalLink size={12} />
        </button>
      </div>
      {bars
        ? <div className="ml-3.5 h-1 rounded-full bg-control" role="presentation"><div className={cn("h-1 rounded-full", tone)} style={{ width: `${Math.max(6, (pair.count / Math.max(1, maxCount)) * 100)}%` }} /></div>
        : <div className="ml-3.5 truncate text-[11px] text-ink-tertiary">
            {pair.reason || (pair.connected && pair.count === 0 ? t("teamMap.org.connected") : reviews ? t("teamMap.org.reviews") : t("teamMap.org.delegates"))}
          </div>}
    </div>
  );
}

/** The selection's detail, in a narrow column that closes: the busiest pairs
 * with nothing selected, else a bot's or a team's handoffs. Counts live on
 * the links, so rows carry a bar, the reason and the time, not a second number. */
export function TeamMapDetail({ scope, pairs, bots, onSelect, onClose, fluid = false }: {
  scope: Scope;
  pairs: TeamMapPair[];
  bots: Bot[];
  onSelect: (bot: Bot) => void;
  onClose?: () => void;
  /** On a phone the detail is a section of the page, not a column. */
  fluid?: boolean;
}) {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const counted = pairs.filter((pair) => pair.count > 0 || pair.live);
  let body;
  let title;
  if (scope.kind === "busiest") {
    const top = [...counted].sort((a, b) => b.count - a.count).slice(0, 5);
    const max = top[0]?.count ?? 1;
    title = <span className="font-medium text-ink">{t("teamMap.org.busiest")}</span>;
    body = top.length ? top.map((pair) => <PairRow key={`${pair.sourceBotId}:${pair.targetBotId}`} pair={pair} bots={byId} bars maxCount={max} onSelect={onSelect} />)
      : <p className="px-2.5 py-2 text-[12px] text-ink-secondary">{t("teamMap.org.noHandoffs")}</p>;
  } else {
    const ids = scope.kind === "bot" ? new Set([scope.bot.id]) : new Set(scope.botIds);
    const touching = pairs.filter((pair) => (pair.count > 0 || pair.live || pair.connected) && (ids.has(pair.sourceBotId) || ids.has(pair.targetBotId)));
    const received = touching.filter((pair) => ids.has(pair.targetBotId) && !ids.has(pair.sourceBotId) && (pair.count > 0 || pair.live));
    const sent = touching.filter((pair) => ids.has(pair.sourceBotId) && !ids.has(pair.targetBotId) && (pair.count > 0 || pair.live));
    const inside = scope.kind === "team" ? touching.filter((pair) => ids.has(pair.sourceBotId) && ids.has(pair.targetBotId) && (pair.count > 0 || pair.live)) : [];
    const talked = touching.filter((pair) => pair.count === 0 && !pair.live && pair.connected);
    const group = (label: string, list: TeamMapPair[]) => list.length ? (
      <div key={label}><div className="px-2.5 pb-0.5 pt-2 text-[11px] text-ink-tertiary">{label}</div>
        {list.map((pair) => <PairRow key={`${pair.sourceBotId}:${pair.targetBotId}`} pair={pair} bots={byId} maxCount={1} onSelect={onSelect} />)}</div>
    ) : null;
    title = scope.kind === "bot"
      ? <><OrgBotAvatar bot={scope.bot} size={20} state={orgState(scope.bot)} ring="var(--color-panel)" /><span className="font-medium text-ink">{scope.bot.name}</span></>
      : <span className="font-medium text-ink">{t("teamMap.org.teamHandoffs", { name: scope.name })}</span>;
    const sections = [
      group(t("teamMap.org.received", { count: received.length }), received), group(t("teamMap.org.sent", { count: sent.length }), sent),
      group(t("teamMap.org.within", { count: inside.length }), inside), group(t("teamMap.org.talked", { count: talked.length }), talked),
    ].filter(Boolean);
    body = sections.length ? sections : <p className="px-2.5 py-2 text-[12px] text-ink-secondary">{t("teamMap.org.noHandoffs")}</p>;
  }
  return (
    <aside data-team-map-detail="" aria-label={t("canvas.handoffs")} className={cn("flex flex-col overflow-hidden rounded-2xl border border-hairline/40 bg-panel", fluid ? "w-full" : "h-full w-[248px] shrink-0")}>
      <div className="flex shrink-0 items-start gap-2 px-4 pb-1 pt-3 text-[13px]">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-[18px]">
          <div className="flex min-w-0 items-center gap-2 [&>*:not(span:first-child)]:truncate">{title}</div>
          <span className="text-[11px] text-ink-tertiary">{t("teamMap.org.last7")}</span>
        </div>
        {onClose && <button type="button" aria-label={t("teamMap.org.detailHide")} onClick={onClose}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"><X size={15} /></button>}
      </div>
      <div className={cn("px-2 pb-2", !fluid && "min-h-0 flex-1 overflow-y-auto")}>{body}</div>
    </aside>
  );
}

export type { Scope as TeamMapDetailScope };
