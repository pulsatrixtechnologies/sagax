import { Fragment } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { botMatches, type OrgLayout, type OrgLink } from "@/lib/team-map-layout";
import { orgState, type OrgState } from "@/lib/team-map-format";
import type { TeamMapPair } from "@/lib/team-map";
import { OrgBotAvatar, OrgCard } from "./OrgCard";
import { TeamMapBotPopover } from "./TeamMapBotPopover";
import { TeamMapDetail } from "./TeamMapDetail";

const tone = (state: OrgLink["state"]) => state === "running" ? "var(--color-success)" : state === "queued" ? "var(--color-warning)" : "color-mix(in srgb, var(--color-ink) 42%, transparent)";

/** A delegation (or review) between two cards: a line with its arrow and count. */
function Connector({ link, label }: { link: OrgLink; label?: string }) {
  const color = tone(link.state);
  return (
    <div className="flex h-[22px] items-center gap-2 pl-[22px]" data-mobile-link={link.id}>
      <svg width="12" height="22" aria-hidden="true"><line x1="6" y1="0" x2="6" y2="15" stroke={color} strokeWidth="1.6" strokeDasharray={link.reviews ? "3 3" : undefined} />{link.reviews ? <circle cx="6" cy="17" r="3" fill="var(--color-app)" stroke={color} strokeWidth="1.3" /> : <polygon points="6,22 2,14 10,14" fill={color} />}</svg>
      {link.badge && <span className={cn("rounded-full border bg-app px-1.5 text-[11px] leading-4 tabular-nums", link.state === "running" ? "border-success text-success" : "border-hairline text-ink-secondary")}>{link.badge.text}</span>}
      {label && <span className="truncate text-[11px] text-ink-tertiary">{label}</span>}
    </div>
  );
}

/** The org chart at phone width: the lead, then each team as a block in the
 * order of the work, links as connectors with their counts, "Sans équipe",
 * and the handoffs always listed below. A tapped bot opens in place. */
export function TeamMapMobile({ layout, pairs, bots, query, selectedBotId, onSelect, stateOf, lastOf, teamName, dim, onComputer, onClose, onToggleExpanded, onToggleTray }: {
  layout: OrgLayout<Bot>;
  pairs: TeamMapPair[];
  bots: Bot[];
  query: string;
  selectedBotId: string | null;
  onSelect: (bot: Bot) => void;
  stateOf: (bot: Bot) => OrgState;
  lastOf: (id: string) => string | null;
  teamName: (key: string) => string;
  dim: (bot: Bot) => boolean;
  onComputer?: (bot: Bot) => void;
  onClose: () => void;
  onToggleExpanded: (key: string) => void;
  onToggleTray: () => void;
}) {
  const leadWeight = (key: string) => layout.links.find((link) => link.kind === "lead" && link.toKey === key)?.count ?? 0;
  const ordered = [...layout.blocks].sort((a, b) => a.tier - b.tier || leadWeight(b.key) - leadWeight(a.key) || a.col - b.col);
  const selected = selectedBotId ? bots.find((bot) => bot.id === selectedBotId) ?? null : null;
  const card = (bot: Bot, lead = false) => (
    <Fragment key={bot.id}>
      <OrgCard bot={bot} lead={lead} state={stateOf(bot)} selected={selectedBotId === bot.id} dim={dim(bot)} match={Boolean(query.trim()) && botMatches(bot, query)} last={lastOf(bot.id)}
        onSelect={onSelect} className="h-[48px] w-full" />
      {selected && selected.id === bot.id && (
        <div className="my-1 flex flex-col gap-2">
          <TeamMapBotPopover inline bot={bot} state={stateOf(bot)} last={lastOf(bot.id)} teamName={teamName(layout.blocks.find((block) => block.ordered.some((other) => other.id === bot.id))?.key ?? "")}
            side="right" left={0} top={0} arrowTop={0} onClose={onClose} onComputer={onComputer} />
          <TeamMapDetail fluid scope={{ kind: "bot", bot }} pairs={pairs} bots={bots} onSelect={onSelect} />
        </div>
      )}
    </Fragment>
  );
  return (
    <div className="flex shrink-0 flex-col gap-3 px-4 pb-8 pt-1" data-team-map-body="">
      {layout.lead && card(layout.lead.bot, true)}
      {ordered.map((block) => {
        const incoming = layout.links.filter((link) => link.kind !== "bot" && link.toKey === block.key);
        return (
          <section key={block.key} data-team-key={block.key} aria-label={t("canvas.teamRegion", { name: teamName(block.key) })} className="flex flex-col">
            {incoming.map((link) => (
              <div key={link.id} className="-mb-1 mt-0">
                <Connector link={link} label={`${link.kind === "lead" ? layout.lead?.bot.name ?? "" : teamName(link.fromKey)} → ${teamName(block.key)}`} />
              </div>
            ))}
            <div className="rounded-2xl border border-hairline/40 bg-panel p-2">
              <div className="flex h-9 items-center gap-2 px-2 text-[13px]"><span className="min-w-0 flex-1 truncate font-medium text-ink">{teamName(block.key)}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
                  {block.ordered.filter((bot) => orgState(bot) === "working").length > 0 && <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-success" />{block.ordered.filter((bot) => orgState(bot) === "working").length}</span>}
                  {block.ordered.filter((bot) => orgState(bot) === "waiting").length > 0 && <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-warning" />{block.ordered.filter((bot) => orgState(bot) === "waiting").length}</span>}
                  <span className="text-ink-tertiary">{block.total}</span></span></div>
              <div className="flex flex-col">
                {block.bots.map((placed, index) => {
                  const next = block.bots[index + 1];
                  const link = next ? layout.links.find((item) => item.kind === "bot" && item.fromBot === placed.bot.id && item.toBot === next.bot.id) : undefined;
                  return <Fragment key={placed.bot.id}>{card(placed.bot)}{next && (link ? <Connector link={link} /> : <div className="h-2" />)}</Fragment>;
                })}
                {block.total === 0 && <p className="rounded-xl border border-dashed border-hairline/70 px-4 py-3 text-center text-[12px] text-ink-secondary">{t("canvas.dropHere")}</p>}
              </div>
              {block.total > 4 && <button type="button" onClick={() => onToggleExpanded(block.key)} aria-expanded={block.expanded}
                className="mt-1 flex h-8 w-full items-center justify-center gap-1 rounded-lg text-[12px] text-ink-secondary hover:bg-control">{block.expanded ? <><ChevronUp size={13} />{t("teamMap.org.showLess")}</> : <>{t("teamMap.org.moreBots", { count: block.hidden })}<ChevronDown size={13} /></>}</button>}
            </div>
          </section>
        );
      })}
      {layout.tray && (
        <section data-team-key="" aria-label={t("teamMap.org.unassignedAria")} className="rounded-2xl border border-dashed border-hairline bg-panel/50 p-2">
          <button type="button" aria-expanded={layout.tray.open} onClick={onToggleTray} className="flex h-9 w-full items-center gap-2 px-2 text-left text-[13px]">
            <span className="font-medium text-ink">{t("sidebar.section.general")}</span><span className="text-[11px] text-ink-tertiary">{layout.tray.bots.length}</span>
            {layout.tray.open ? <ChevronUp size={14} className="ml-auto text-ink-tertiary" /> : <ChevronDown size={14} className="ml-auto text-ink-tertiary" />}
          </button>
          {layout.tray.open
            ? <div className="flex flex-col gap-2">{layout.tray.bots.map((bot) => card(bot))}</div>
            : <div className="flex flex-wrap gap-2 px-2 pb-1">{layout.tray.bots.map((bot) => <button key={bot.id} type="button" data-bot-id={bot.id} aria-label={t("canvas.editBot", { name: bot.name })} onClick={() => onSelect(bot)}><OrgBotAvatar bot={bot} size={28} state={stateOf(bot)} ring="var(--color-panel)" /></button>)}</div>}
          {!layout.tray.open && selected && layout.tray.bots.some((bot) => bot.id === selected.id) && <div className="mt-2">{card(selected)}</div>}
        </section>
      )}
      {!selected && <TeamMapDetail fluid scope={{ kind: "busiest" }} pairs={pairs} bots={bots} onSelect={onSelect} />}
    </div>
  );
}
