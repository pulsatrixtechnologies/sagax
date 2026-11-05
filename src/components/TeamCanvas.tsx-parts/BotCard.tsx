import { MessageCircle, Monitor } from "lucide-react";
import { openBot, useStore, type Bot } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { teamMapStatus } from "@/lib/team-map";
import { BotAvatar } from "../Avatar";
import { InstanceProviderMark, ProviderMark } from "../ProviderIcons";

const iconButton = "flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent";

export function BotCard({ bot, selected, moving, connected, onComputer, onArrange }: {
  bot: Bot;
  selected: boolean;
  moving: boolean;
  connected: boolean;
  onComputer?: (bot: Bot) => void;
  onArrange?: (bot: Bot, delta: number) => void;
}) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const status = teamMapStatus(bot);
  const instance = state.instances.find((item) => item.instanceId === bot.modelSelection.instanceId);
  // Auto (docs/plans/2026-10-08-auto-model.md) picks per turn: the card says so.
  const model = bot.modelSelection.auto === true ? t("model.auto.label")
    : instance?.models.options.find((item) => item.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model;
  return <article className={cn("relative h-[126px] w-[236px] shrink-0 rounded-xl border bg-card shadow-sm transition-colors",
    selected ? "border-accent/60 ring-1 ring-accent/15" : connected ? "border-accent/40" : "border-hairline/50 hover:border-ink-secondary/40", moving && "opacity-35")}>
    <button data-bot-id={bot.id} aria-label={t("canvas.editBot", { name: bot.name })}
      onClick={() => dispatch({ type: "toggleSettings", botId: bot.id, section: "details", open: true })}
      title={onArrange ? t("canvas.reorderHint") : undefined}
      onKeyDown={(event) => {
        if (!onArrange || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault(); event.stopPropagation();
        onArrange(bot, event.key === "ArrowUp" ? -1 : 1);
      }}
      className="flex h-[82px] w-full cursor-grab items-center gap-3 rounded-t-xl px-4 text-left active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent">
      <BotAvatar bot={bot} primary={Boolean(bot.chiefOfStaff)} primaryRingClassName="ring-card" size={38} motion="none" motionKey={0} animated={false} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5"><span className="truncate text-[14px] font-semibold">{bot.name}</span></span>
        <span className="mt-1 block truncate text-[11px] text-ink-secondary">{bot.title || (bot.chiefOfStaff ? t("chat.chiefOfStaff") : t("canvas.bot"))}</span>
      </span>
    </button>
    <div className="flex h-[43px] items-center gap-1 border-t border-hairline/30 px-2">
      <button className={cn(iconButton, "size-8")} aria-label={t("canvas.openBotChat", { name: bot.name })} title={t("canvas.openChat")}
        onClick={() => openBot(dispatch, bot, showThreads)}><MessageCircle size={13} /></button>
      {status.tone !== "idle" && <span className="flex items-center gap-1.5 text-[10px] text-ink-secondary" title={status.label}>
        <span className={cn("size-1.5 rounded-full", status.tone === "success" ? "bg-success" : status.tone === "warning" ? "bg-warning" : status.tone === "danger" ? "bg-danger" : "bg-ink-secondary/35")} />
        {status.label}
      </span>}
      {selected && onComputer && <button className={cn(iconButton, "size-8")} aria-label={t("canvas.botComputer", { name: bot.name })} title={t("computer.tab.computer")}
        onClick={() => onComputer(bot)}><Monitor size={13} /></button>}
      <button aria-label={t("canvas.changeModel", { name: bot.name })} title={`${t("canvas.defaultModel")}: ${model}`}
        onClick={() => dispatch({ type: "toggleSettings", botId: bot.id, section: "model", open: true })}
        className="ml-auto flex h-8 min-w-0 max-w-[130px] items-center gap-1.5 rounded-md px-2 text-[10px] text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
        <span className="flex size-3.5 shrink-0 items-center justify-center">{instance
          ? <InstanceProviderMark instance={instance} size={13} />
          : <ProviderMark driverKind="" size={13} />}</span>
        <span className="truncate">{model || t("canvas.defaultModel")}</span>
      </button>
    </div>
  </article>;
}

