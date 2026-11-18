import type { KeyboardEvent, PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { orgStateLabel, type OrgState } from "@/lib/team-map-format";
import { useStore, type Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";

/** The small state dot on a bot's avatar: working pulses, waiting is orange,
 * no signal is red, idle is a hollow ring. */
export function StateDot({ state, ring = "var(--color-card)" }: { state: OrgState; ring?: string }) {
  const fill = state === "working" ? "var(--color-success)" : state === "waiting" ? "var(--color-warning)" : state === "noSignal" ? "var(--color-danger)" : "transparent";
  return <span aria-hidden="true" className="inline-block size-[9px] rounded-full" data-state-dot={state}
    style={{ background: fill, border: state === "idle" ? "1.5px solid var(--color-ink-tertiary)" : undefined,
      boxShadow: `0 0 0 2px ${ring}${state === "working" ? ", 0 0 0 5px color-mix(in srgb, var(--color-success) 26%, transparent)" : ""}` }} />;
}

/** The model's name the way the old card said it (Auto says so). */
export function useModelLabel(bot: Bot): string {
  const { state } = useStore();
  const instance = state.instances.find((item) => item.instanceId === bot.modelSelection.instanceId);
  if (bot.modelSelection.auto === true) return t("model.auto.label");
  return instance?.models.options.find((item) => item.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model;
}

export function OrgBotAvatar({ bot, size, state, lead, ring }: { bot: Bot; size: number; state: OrgState; lead?: boolean; ring?: string }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <BotAvatar bot={bot} size={size} primary={lead} primaryRingClassName="ring-card" motion="none" motionKey={0} animated={false} />
      <span className="absolute -bottom-0.5 -right-0.5"><StateDot state={state} ring={ring} /></span>
    </span>
  );
}

/** The readable bot card: avatar and live state, name, role and model. The last
 * handoff is the tooltip and the popover's line, not a third line. */
export function OrgCard({ bot, state, lead = false, arrangeable = false, selected = false, dim = false, match = false, moving = false, connected = false, last, style, className, tabIndex, onSelect, onPointerDown, onKeyDown }: {
  bot: Bot;
  state: OrgState;
  lead?: boolean;
  /** The card can be dragged to arrange or move: the tooltip says how. */
  arrangeable?: boolean;
  selected?: boolean;
  dim?: boolean;
  match?: boolean;
  moving?: boolean;
  connected?: boolean;
  last: string | null;
  style?: React.CSSProperties;
  className?: string;
  tabIndex?: number;
  onSelect: (bot: Bot) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>, bot: Bot) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, bot: Bot) => void;
}) {
  const model = useModelLabel(bot);
  const role = bot.title || (bot.chiefOfStaff ? t("chat.chiefOfStaff") : t("canvas.bot"));
  return (
    <button type="button" data-bot-id={bot.id} data-org-card="" aria-pressed={selected} tabIndex={tabIndex}
      aria-label={t("canvas.editBot", { name: bot.name })}
      title={`${orgStateLabel(state)} · ${last ?? t("teamMap.org.noHandoffYet")}${arrangeable ? `\n${t("canvas.reorderHint")}` : ""}`}
      onClick={() => onSelect(bot)}
      onPointerDown={onPointerDown ? (event) => onPointerDown(event, bot) : undefined}
      onKeyDown={onKeyDown ? (event) => onKeyDown(event, bot) : undefined}
      className={cn("flex items-center gap-2.5 rounded-xl border bg-card px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60",
        selected || match ? "border-accent/60 ring-2 ring-accent/30" : connected ? "border-accent/40" : "border-hairline/50 hover:border-ink-secondary/40",
        dim && "opacity-55", moving && "opacity-35", onPointerDown && "cursor-grab active:cursor-grabbing", className)}
      style={style}>
      <OrgBotAvatar bot={bot} size={lead ? 36 : 28} state={state} lead={lead} />
      <span className="min-w-0 flex-1 leading-4">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink">{bot.name}</span>
          {lead && <span className="text-[11px] text-ink-tertiary">{t("teamMap.org.lead")}</span>}
          {state === "waiting" && <span className="ml-auto shrink-0 text-[11px] font-medium text-warning">{t("teamMap.org.needsYou")}</span>}
        </span>
        <span className="block truncate text-[12px] text-ink-secondary">{role} <span className="text-ink-tertiary">· {model}</span></span>
      </span>
    </button>
  );
}
