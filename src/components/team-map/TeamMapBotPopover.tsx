import { useEffect, useRef } from "react";
import { ArrowRight, MessageCircle, Monitor, UserRound, X } from "lucide-react";
import { openBot, useStore, type Bot } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBotProfile } from "@/lib/open-bot-profile";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { orgStateLabel, type OrgState } from "@/lib/team-map-format";
import { InstanceProviderMark, ProviderMark } from "../ProviderIcons";
import { OrgBotAvatar, useModelLabel } from "./OrgCard";
import { PAGE_ACTION_BUTTON } from "../content-page";

export const POPOVER_W = 296;

/** A bot's card on the map: who it is, what it is doing, its last handoff, and
 * the actions the old card had (chat, page, model, computer). It is drawn
 * beside the card it points at, never in a free slot. */
export function TeamMapBotPopover({ bot, state, last, teamName, side, top, left, arrowTop, onClose, onComputer, onShowHandoffs, inline = false }: {
  bot: Bot;
  state: OrgState;
  last: string | null;
  teamName: string;
  side: "left" | "right";
  top: number;
  left: number;
  arrowTop: number;
  onClose: () => void;
  onComputer?: (bot: Bot) => void;
  /** The bot's own seven-day handoffs: the detail column (desktop) or the list in place (phone). */
  onShowHandoffs?: () => void;
  inline?: boolean;
}) {
  const { state: store, dispatch } = useStore();
  const showThreads = useShowThreads();
  const model = useModelLabel(bot);
  const instance = store.instances.find((item) => item.instanceId === bot.modelSelection.instanceId);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const tone = state === "working" ? "text-success" : state === "waiting" ? "text-warning" : state === "noSignal" ? "text-danger" : "text-ink-secondary";
  return (
    <div ref={root} role="dialog" aria-label={bot.name} data-team-map-popover="" data-side={inline ? undefined : side}
      className={cn("z-40 rounded-xl border-[0.5px] border-border p-3 popover-surface menu-surface bg-elevated text-ink", inline ? "relative w-full" : "absolute")}
      style={inline ? undefined : { left, top, width: POPOVER_W }}>
      {!inline && <span aria-hidden="true" className="absolute size-3 rotate-45 border-border bg-elevated"
        style={{ top: arrowTop, [side === "right" ? "left" : "right"]: -6, borderWidth: 0, ...(side === "right" ? { borderBottomWidth: 0.5, borderLeftWidth: 0.5 } : { borderTopWidth: 0.5, borderRightWidth: 0.5 }) }} />}
      <div className="flex items-center gap-2.5">
        <OrgBotAvatar bot={bot} size={36} state={state} lead={Boolean(bot.chiefOfStaff)} ring="var(--color-elevated)" />
        <div className="min-w-0 flex-1 leading-[18px]">
          <div className="truncate text-[14px] font-medium">{bot.name}</div>
          <div className="truncate text-[12px] text-ink-secondary">{bot.title || (bot.chiefOfStaff ? t("chat.chiefOfStaff") : t("canvas.bot"))} · {teamName}</div>
        </div>
        <button type="button" aria-label={t("common.close")} onClick={onClose} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"><X size={14} /></button>
      </div>
      <div className="mt-2 text-[12px]"><span className={cn("font-medium", tone)}>{orgStateLabel(state)}</span></div>
      <div className="mt-1 flex items-center gap-1">
        <button type="button" aria-label={t("canvas.changeModel", { name: bot.name })} title={`${t("canvas.defaultModel")}: ${model}`}
          onClick={() => dispatch({ type: "toggleSettings", botId: bot.id, section: "model", open: true })}
          className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
          <span className="flex size-3.5 shrink-0 items-center justify-center">{instance ? <InstanceProviderMark instance={instance} size={13} /> : <ProviderMark driverKind="" size={13} />}</span>
          <span className="truncate">{model || t("canvas.defaultModel")}</span>
        </button>
        {onComputer && <button type="button" className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent" aria-label={t("canvas.botComputer", { name: bot.name })} title={t("computer.tab.computer")} onClick={() => onComputer(bot)}><Monitor size={14} /></button>}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-ink-tertiary">{last ?? t("teamMap.org.noHandoffYet")}</div>
      {onShowHandoffs && <button type="button" data-team-map-show-handoffs="" onClick={onShowHandoffs} className="mt-1 flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">{t("teamMap.org.seeHandoffs")}<ArrowRight size={12} aria-hidden="true" /></button>}
      <div className="mt-2 flex gap-2">
        <button type="button" className={cn(PAGE_ACTION_BUTTON, "min-w-0 flex-1 justify-center whitespace-nowrap px-2")} aria-label={t("canvas.openBotChat", { name: bot.name })}
          onClick={() => openBot(dispatch, bot, showThreads)}><MessageCircle size={14} />{t("canvas.openChat")}</button>
        <button type="button" className={cn(PAGE_ACTION_BUTTON, "min-w-0 flex-1 justify-center whitespace-nowrap px-2")} onClick={() => openBotProfile(dispatch, bot.id)}><UserRound size={14} />{t("teamMap.org.openPage")}</button>
      </div>
    </div>
  );
}
