// The Coding section of an orchestrator bot's panel (#3451 lot 2, #3462):
// the work it runs through its team, drawn from the panel's own parts
// (SectionHeader, PANEL_CARD, BotAvatar, StatusDot, the done mark of
// CodingSessionRow), with no colour, radius or shadow of its own.
//
// Top down, in the one panel card: the team row (each bot that holds a step
// of the listed work, its mascot lit with a live mark while it works, a
// warning mark while its turn is silent, dimmed while idle), one row per
// piece of work in progress (the bot working on it now, its name, steps done
// over the total, the time and tokens, a thin bar and one state line; a row
// unfolds into its steps), then "Done today", which unfolds into what
// finished. Under the card, the bot's own coding rows as before. A click on
// a step or a tile opens that team bot's coding chat where the chat is. A
// bot without a team never draws this: it keeps today's section.
//
// The marks come from the live state (shared/team-work.ts teamLive), never
// from a plan. While the app's live stream is down they are not drawn: the
// rows stay, the app does not claim what it cannot know.
import { useState, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";

import type { Bot } from "@/state/store";
import type { BotActivityFilter } from "@/lib/bot-activity";
import { cn } from "@/lib/cn";
import { PANEL_CARD, PANEL_LABEL } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import {
  teamBotName,
  teamCount,
  teamDoneLabel,
  teamStepNote,
  teamStepTime,
  teamTileAria,
  teamTileLabel,
  teamTileTitle,
  teamToComeNote,
  teamWorkMeta,
  teamWorkShare,
  teamWorkStateLine,
  type TeamLive,
  type TeamName,
  type TeamWork,
  type TeamWorkItem,
  type TeamWorkStep,
} from "@/lib/team-work";
import { TEAM_WORK_STEPS_SHOWN } from "../../../shared/team-work";
import { BotAvatar } from "../Avatar";
import { avatarBot } from "../BotExchangeChip";
import { StatusDot } from "../StatusDot";
import { DoneMark } from "./CodingSessionRow";
import { SectionHeader } from "./ActivitySection";

/** What a click on a step or a tile opens. */
export interface TeamOpenStep {
  botId: string;
  threadId: string;
  name: string;
  work?: string;
  index?: number;
  total?: number;
  status?: TeamWorkStep["status"];
  startedAt?: number;
}

export interface TeamWorkSectionProps {
  work: TeamWork;
  now: number;
  /** The app's live stream is up: without it, no live mark is drawn. */
  streaming: boolean;
  bots: readonly Bot[];
  /** The orchestrator, for "next step not handed out yet". */
  orchestrator?: TeamName;
  /** The step whose coding chat is open, marked like a current row. */
  openThreadId?: string;
  onOpenStep: (step: TeamOpenStep) => void;
  onOpenHistory: (filter: BotActivityFilter) => void;
  /** The bot's own coding rows (and, without a Coding tab, its code work). */
  children?: ReactNode;
  /** Steps a piece of work shows before "N more" (tests). */
  stepsShown?: number;
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60";
const RING = "border-[var(--bot-panel-card)]";

/** The corner mark of a live state: accent while it works, warning while silent. */
function LiveMark({ live, streaming, small }: { live: TeamLive; streaming: boolean; small?: boolean }) {
  if (!streaming || (live.state !== "working" && live.state !== "silent")) return null;
  return (
    <StatusDot
      tone={live.state === "working" ? "accent" : "warning"}
      ringClassName={RING}
      sizeClassName={small ? "size-2" : "size-2.5"}
      className="absolute -bottom-0.5 -right-0.5"
      data={{ "data-team-mark": live.state }}
    />
  );
}

/** A team bot's face, its own mascot when the reader holds it. */
function Face({ botId, name, bots, size, dim, children }: { botId: string; name: string; bots: readonly Bot[]; size: number; dim?: boolean; children?: ReactNode }) {
  const bot = avatarBot({ id: botId, name }, bots);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span data-team-face={dim ? "dim" : "lit"} className={cn("inline-flex", dim && "opacity-40")}>
        <BotAvatar bot={bot as Bot} state="happy" size={size} animated={false} />
      </span>
      {children}
    </span>
  );
}

function stepIsOpenable(step: TeamWorkStep): step is TeamWorkStep & { threadId: string } {
  return Boolean(step.threadId);
}

function StepRow({ step, index, item, nameOf, bots, now, streaming, chosen, onOpenStep }: {
  step: TeamWorkStep;
  index: number;
  item: TeamWorkItem;
  nameOf: (botId: string) => TeamName | undefined;
  bots: readonly Bot[];
  now: number;
  streaming: boolean;
  chosen: boolean;
  onOpenStep: (step: TeamOpenStep) => void;
}) {
  const who = teamBotName(nameOf(step.botId));
  const live = step.live.state === "working" || step.live.state === "silent";
  const note = teamStepNote(step, nameOf, now);
  const body = (
    <>
      <Face botId={step.botId} name={who} bots={bots} size={20} dim={!step.done && !live && step.live.state !== "waiting"}>
        {step.done ? <DoneMark small data={{ "data-team-done": "" }} className={cn("absolute -bottom-1 -right-1 border-2", RING)} /> : <LiveMark live={step.live} streaming={streaming} small />}
      </Face>
      <span data-team-step-name className="w-20 shrink-0 truncate text-[13px] font-medium leading-[18px] text-ink" title={step.name}>{step.name}</span>
      <span data-team-step-note className={cn("min-w-0 flex-1 truncate text-[12px] leading-4", step.live.state === "working" ? "text-ink" : "text-ink-secondary")} title={note}>{note}</span>
      <span data-team-step-time className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-tertiary">{teamStepTime(step)}</span>
    </>
  );
  const row = "flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left";
  return (
    <li data-team-step={step.id} data-team-step-status={step.status}>
      {stepIsOpenable(step) ? (
        <button
          type="button"
          data-team-step-open={step.threadId}
          aria-current={chosen ? "true" : undefined}
          aria-label={t("teamWork.step.openAria", { name: who, step: step.name })}
          onClick={() => onOpenStep({ botId: step.botId, threadId: step.threadId, name: step.name, work: item.name, index: index + 1, total: item.total, status: step.status, ...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}) })}
          className={cn(row, "hover:bg-hover", chosen && "bg-hover", FOCUS)}
        >
          {body}
        </button>
      ) : <div className={row}>{body}</div>}
    </li>
  );
}

function ToComeRow({ name, botId, nameOf, bots }: { name: string; botId?: string; nameOf: (botId: string) => TeamName | undefined; bots: readonly Bot[] }) {
  const named = botId ? nameOf(botId) : undefined;
  return (
    <li data-team-step-to-come="" className="flex w-full min-w-0 items-center gap-2.5 px-2 py-1.5 opacity-60">
      {botId ? <Face botId={botId} name={teamBotName(named)} bots={bots} size={20} dim /> : <span className="size-5 shrink-0" aria-hidden="true" />}
      <span className="w-20 shrink-0 truncate text-[13px] font-medium leading-[18px] text-ink" title={name}>{name}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-ink-secondary">{teamToComeNote(named)}</span>
    </li>
  );
}

function barTone(item: TeamWorkItem): string {
  if (item.finished) return item.steps.some((step) => step.status === "failed") && !item.merged ? "bg-danger" : "bg-success";
  if (item.live.state === "working") return "bg-accent";
  if (item.live.state === "silent") return "bg-warning";
  return "bg-ink-tertiary";
}

function WorkRow({ item, nameOf, bots, now, streaming, openThreadId, orchestrator, onOpenStep, stepsShown }: {
  item: TeamWorkItem;
  nameOf: (botId: string) => TeamName | undefined;
  bots: readonly Bot[];
  now: number;
  streaming: boolean;
  openThreadId?: string;
  orchestrator?: TeamName;
  onOpenStep: (step: TeamOpenStep) => void;
  stepsShown: number;
}) {
  const holdsOpen = Boolean(openThreadId && item.steps.some((step) => step.threadId === openThreadId));
  const [open, setOpen] = useState(holdsOpen);
  const [all, setAll] = useState(false);
  const currentId = item.current?.botId ?? item.steps.at(-1)?.botId;
  const who = currentId ? teamBotName(nameOf(currentId)) : teamBotName(orchestrator);
  const line = teamWorkStateLine(item, nameOf, now, orchestrator);
  const rows = item.steps.length + item.toCome.length;
  const hidden = all ? 0 : Math.max(0, rows - stepsShown);
  const steps = hidden > 0 ? item.steps.slice(0, stepsShown) : item.steps;
  const toCome = hidden > 0 ? item.toCome.slice(0, Math.max(0, stepsShown - item.steps.length)) : item.toCome;
  const share = `${Math.round(teamWorkShare(item) * 100)}%`;
  const live = item.live.state === "working" || item.live.state === "silent";
  return (
    <li data-team-work-item={item.key} data-team-work-state={item.finished ? "finished" : item.live.state} className={cn("flex flex-col rounded-lg", open && "bg-hover/60")}>
      <button
        type="button"
        data-team-work-toggle
        aria-expanded={open}
        aria-label={t("teamWork.work.aria", { name: item.name, done: item.done, total: item.total })}
        onClick={() => setOpen((value) => !value)}
        className={cn("flex w-full min-w-0 flex-col gap-1.5 rounded-lg px-2 py-2 text-left hover:bg-hover", FOCUS)}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          {currentId ? (
            <Face botId={currentId} name={who} bots={bots} size={22} dim={!item.finished && !live && item.live.state !== "waiting"}>
              <LiveMark live={item.live} streaming={streaming} small />
            </Face>
          ) : null}
          <span data-team-work-name className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[18px] text-ink" title={item.name}>{item.name}</span>
          <span data-team-work-meta className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-secondary">{teamWorkMeta(item)}</span>
          <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform motion-reduce:transition-none", open && "rotate-90")} />
        </span>
        <span className="flex w-full min-w-0 items-center gap-2">
          <span aria-hidden="true" className="block h-[3px] min-w-8 flex-1 overflow-hidden rounded-full bg-raised">
            <span data-team-work-bar className={cn("block h-full rounded-full", barTone(item))} style={{ width: share }} />
          </span>
          <span data-team-state-line className={cn("min-w-0 max-w-[70%] shrink truncate text-[12px] leading-4", streaming && item.live.state === "silent" ? "text-warning" : "text-ink-secondary")} title={line}>{line}</span>
        </span>
      </button>
      {open && (
        <div className="flex flex-col pb-1">
          <ul data-team-steps aria-label={item.name} className="flex flex-col">
            {steps.map((step, index) => (
              <StepRow key={step.id} step={step} index={index} item={item} nameOf={nameOf} bots={bots} now={now} streaming={streaming} chosen={Boolean(openThreadId) && step.threadId === openThreadId} onOpenStep={onOpenStep} />
            ))}
            {toCome.map((planned, index) => <ToComeRow key={`plan:${index}:${planned.name}`} name={planned.name} botId={planned.botId} nameOf={nameOf} bots={bots} />)}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              data-team-steps-more
              onClick={() => setAll(true)}
              className={cn("w-full rounded-md px-3 py-1.5 text-center text-[13px] leading-[18px] text-ink-secondary hover:text-ink", FOCUS)}
            >
              ↓ {t("botPanel.coding.more", { count: hidden })}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Tile({ bot, now, streaming, bots, chosen, open }: { bot: TeamWork["team"][number]; now: number; streaming: boolean; bots: readonly Bot[]; chosen: boolean; open?: () => void }) {
  const names: TeamName | undefined = bot.name ? { name: bot.name, ...(bot.title ? { title: bot.title } : {}) } : undefined;
  const label = teamTileAria(names, bot.live, now);
  const title = teamTileTitle(names);
  const tip = [label, title].filter(Boolean).join("\n");
  const body = (
    <>
      <Face botId={bot.botId} name={teamBotName(names)} bots={bots} size={28} dim={bot.live.state === "idle"}>
        <LiveMark live={bot.live} streaming={streaming} />
      </Face>
      <span className="flex w-full min-w-0 flex-col">
        <span data-team-tile-label className="w-full truncate text-center text-[12px] leading-4 text-ink-secondary">{teamTileLabel(names)}</span>
        {title && <span data-team-tile-title className="w-full truncate text-center text-[11px] leading-[14px] text-ink-tertiary">{title}</span>}
      </span>
    </>
  );
  const tile = "flex w-16 flex-col items-center gap-1 rounded-lg px-0.5 py-1";
  return (
    <li data-team-bot={bot.botId} data-team-live={bot.live.state}>
      {open ? (
        <button
          type="button"
          data-team-bot-open={bot.threadId}
          aria-label={label}
          aria-current={chosen ? "true" : undefined}
          title={tip}
          onClick={open}
          className={cn(tile, "hover:bg-hover", chosen && "bg-hover", FOCUS)}
        >
          {body}
        </button>
      ) : <div role="img" aria-label={label} title={tip} className={tile}>{body}</div>}
    </li>
  );
}

function DoneToday({ items, children }: { items: readonly TeamWorkItem[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li data-team-done-today={items.length} className="flex flex-col">
      <button
        type="button"
        data-team-done-toggle
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn("flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink-secondary hover:bg-hover hover:text-ink", FOCUS)}
      >
        <Check size={14} strokeWidth={2.2} aria-hidden="true" className="shrink-0 text-success" />
        <span className="min-w-0 flex-1 truncate">{teamDoneLabel(items)}</span>
        <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform motion-reduce:transition-none", open && "rotate-90")} />
      </button>
      {open && <ul data-team-done-list className="flex flex-col">{children}</ul>}
    </li>
  );
}

export function TeamWorkSection({ work, now, streaming, bots, orchestrator, openThreadId, onOpenStep, onOpenHistory, children, stepsShown = TEAM_WORK_STEPS_SHOWN }: TeamWorkSectionProps) {
  const names = new Map<string, TeamName>();
  for (const bot of work.team) if (bot.name) names.set(bot.botId, { name: bot.name, ...(bot.title ? { title: bot.title } : {}) });
  const nameOf = (botId: string) => names.get(botId);
  // a tile opens the step of its strongest state (the read's stepId)
  const openOf = (bot: TeamWork["team"][number]) => {
    if (!bot.threadId) return undefined;
    for (const item of [...work.live, ...work.doneToday]) {
      const index = item.steps.findIndex((step) => step.id === bot.stepId);
      const step = item.steps[index];
      if (step?.threadId) {
        const threadId = step.threadId;
        return () => onOpenStep({ botId: step.botId, threadId, name: step.name, work: item.name, index: index + 1, total: item.total, status: step.status, ...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}) });
      }
    }
    return undefined;
  };
  const count = streaming ? teamCount(work.team) : "";
  const row = (item: TeamWorkItem) => (
    <WorkRow key={item.key} item={item} nameOf={nameOf} bots={bots} now={now} streaming={streaming} openThreadId={openThreadId} orchestrator={orchestrator} onOpenStep={onOpenStep} stepsShown={stepsShown} />
  );
  return (
    <section data-bot-settings-section="coding" data-team-work="" className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <SectionHeader title={t("botPanel.coding.title")} name="coding" onOpenHistory={onOpenHistory} />
        {count && <span data-team-count className={cn(PANEL_LABEL, "min-w-0 truncate")}>{count}</span>}
      </div>
      <div data-team-work-card className={cn(PANEL_CARD, "gap-0.5 p-1.5")}>
        <ul data-team-row aria-label={t("teamWork.team.aria")} className="flex flex-wrap gap-1 px-0.5 pb-1.5 pt-1">
          {work.team.map((bot) => (
            <Tile key={bot.botId} bot={bot} now={now} streaming={streaming} bots={bots} chosen={Boolean(openThreadId) && bot.threadId === openThreadId} open={openOf(bot)} />
          ))}
        </ul>
        <ul data-team-live-list aria-label={t("teamWork.list.aria")} className="flex flex-col gap-0.5">
          {work.live.map(row)}
          {work.doneToday.length > 0 && <DoneToday items={work.doneToday}>{work.doneToday.map(row)}</DoneToday>}
        </ul>
      </div>
      {children}
    </section>
  );
}
