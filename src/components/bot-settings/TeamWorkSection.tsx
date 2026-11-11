// The Coding section of an orchestrator bot's panel (#3451 lot 2, #3462,
// #3575): the work it runs through its team, drawn as the Coding rows that
// were already there. Each piece of work is a CodingSessionRow (the status
// icon, the full title, one grey line: the working bot's small mascot and
// name, the progress "2/5" and its last action, the chevron). Unfolded, its
// grey line of what it spent (time, tokens) and its steps, rows of the same
// style one level in, each with its bot in its grey line. Then "Done today",
// the same row, which unfolds into what finished. The bot's own coding rows
// follow in the same card (AgentRows `lead`). A click on a step opens that
// team bot's coding chat where the chat is. A bot without a team never
// draws this: it keeps today's section.
//
// The states come from the live state (shared/team-work.ts teamLive), never
// from a plan. While the app's live stream is down no silent warning is
// drawn: the rows stay, the app does not claim what it cannot know.
import { useState, type ReactNode } from "react";

import type { Bot } from "@/state/store";
import type { BotActivityFilter, BotActivityStatus } from "@/lib/bot-activity";
import { cn } from "@/lib/cn";
import { PANEL_CARD, PANEL_LABEL, PANEL_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import {
  teamBotName,
  teamCount,
  teamDoneLabel,
  teamLineText,
  teamStepLine,
  teamToComeLine,
  teamWorkLine,
  teamWorkSpend,
  type TeamLine,
  type TeamName,
  type TeamWork,
  type TeamWorkItem,
  type TeamWorkStep,
} from "@/lib/team-work";
import { teamStepEnded, TEAM_WORK_STEPS_SHOWN } from "../../../shared/team-work";
import { BotAvatar } from "../Avatar";
import { avatarBot } from "../BotExchangeChip";
import { CodingSessionRow } from "./CodingSessionRow";
import { SectionHeader, stepActivityStatus } from "./ActivitySection";

/** What a click on a step opens. */
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
  /** The app's live stream is up: without it, no silent warning and no count. */
  streaming: boolean;
  bots: readonly Bot[];
  /** The orchestrator, for "next step not handed out yet". */
  orchestrator?: TeamName & { botId?: string };
  /** The step whose coding chat is open, marked like a current row. */
  openThreadId?: string;
  onOpenStep: (step: TeamOpenStep) => void;
  onOpenHistory: (filter: BotActivityFilter) => void;
  /** The card: the bot's own coding rows with the work rows leading them
   * (and, without a Coding tab, its code work under it). Absent: the work
   * rows alone in the panel card. */
  children?: (lead: ReactNode) => ReactNode;
  /** Steps a piece of work shows before "N more" (tests). */
  stepsShown?: number;
}

/** The row's status icon: the one the existing rows draw for that state; a
 * silent turn takes their warning tone, only while the stream says so. */
function liveStatus(state: TeamWorkItem["live"]["state"], streaming: boolean, idle: BotActivityStatus): BotActivityStatus {
  if (state === "working") return "running";
  if (state === "silent") return streaming ? "blocked" : "running";
  if (state === "waiting") return "waiting";
  return idle;
}

function workStatus(item: TeamWorkItem, streaming: boolean): BotActivityStatus {
  if (item.finished) return item.steps.some((step) => step.status === "failed") && !item.merged ? "failed" : "finished";
  return liveStatus(item.live.state, streaming, "queued");
}

function stepStatus(step: TeamWorkStep, streaming: boolean): BotActivityStatus {
  if (teamStepEnded(step.status)) return stepActivityStatus(step.status);
  return liveStatus(step.live.state, streaming, stepActivityStatus(step.status));
}

const MERGED = { state: "merged" } as const;

/** The grey line: the bot's small mascot and its name, then what it says. */
function Line({ line, bots }: { line: TeamLine; bots: readonly Bot[] }) {
  const bot = line.botId ? avatarBot({ id: line.botId, name: line.who ?? "" }, bots) : undefined;
  return (
    <>
      {bot && (
        <span data-team-face={line.botId} className="inline-flex shrink-0">
          <BotAvatar bot={bot as Bot} state="happy" size={16} animated={false} />
        </span>
      )}
      <span data-team-line className="min-w-0 truncate">{teamLineText(line)}</span>
    </>
  );
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
  const line = teamStepLine(step, nameOf, now);
  const threadId = step.threadId;
  return (
    <CodingSessionRow
      title={step.name}
      status={stepStatus(step, streaming)}
      pull={step.merged ? MERGED : undefined}
      attrs={{ "data-team-step": step.id, "data-team-step-of": item.key, "data-team-step-status": step.status, "data-team-step-open": threadId }}
      subtitle={<Line line={line} bots={bots} />}
      subtitleHint={teamLineText(line)}
      inset
      current={chosen}
      openLabel={t("teamWork.step.openAria", { name: teamBotName(nameOf(step.botId)), step: step.name })}
      onOpen={threadId ? () => onOpenStep({ botId: step.botId, threadId, name: step.name, work: item.name, index: index + 1, total: item.total, status: step.status, ...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}) }) : undefined}
    />
  );
}

function WorkRow({ item, nameOf, bots, now, streaming, openThreadId, orchestrator, onOpenStep, stepsShown }: {
  item: TeamWorkItem;
  nameOf: (botId: string) => TeamName | undefined;
  bots: readonly Bot[];
  now: number;
  streaming: boolean;
  openThreadId?: string;
  orchestrator?: TeamName & { botId?: string };
  onOpenStep: (step: TeamOpenStep) => void;
  stepsShown: number;
}) {
  const holdsOpen = Boolean(openThreadId && item.steps.some((step) => step.threadId === openThreadId));
  const [open, setOpen] = useState(holdsOpen);
  const [all, setAll] = useState(false);
  const line = teamWorkLine(item, nameOf, now, orchestrator);
  const rows = item.steps.length + item.toCome.length;
  const hidden = all ? 0 : Math.max(0, rows - stepsShown);
  const steps = hidden > 0 ? item.steps.slice(0, stepsShown) : item.steps;
  const toCome = hidden > 0 ? item.toCome.slice(0, Math.max(0, stepsShown - item.steps.length)) : item.toCome;
  return (
    <>
      <CodingSessionRow
        title={item.name}
        status={workStatus(item, streaming)}
        pull={item.merged ? MERGED : undefined}
        attrs={{ "data-team-work-item": item.key, "data-team-work-state": item.finished ? "finished" : item.live.state }}
        subtitle={<Line line={line} bots={bots} />}
        subtitleHint={teamLineText(line)}
        expanded={open}
        openLabel={t("teamWork.work.aria", { name: item.name, done: item.done, total: item.total })}
        onOpen={() => setOpen((value) => !value)}
      />
      {open && (
        <>
          <li data-team-work-spend={item.key} className={cn(PANEL_ROW, "pl-11 text-[14px] leading-[20px] text-ink-secondary")}>{teamWorkSpend(item)}</li>
          {steps.map((step, index) => (
            <StepRow key={step.id} step={step} index={index} item={item} nameOf={nameOf} bots={bots} now={now} streaming={streaming} chosen={Boolean(openThreadId) && step.threadId === openThreadId} onOpenStep={onOpenStep} />
          ))}
          {toCome.map((planned, index) => {
            const toComeLine = teamToComeLine(planned, nameOf);
            return (
              <CodingSessionRow
                key={`plan:${index}:${planned.name}`}
                title={planned.name}
                status="queued"
                attrs={{ "data-team-step-to-come": "", "data-team-step-of": item.key }}
                subtitle={<Line line={toComeLine} bots={bots} />}
                subtitleHint={teamLineText(toComeLine)}
                inset
              />
            );
          })}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                data-team-steps-more
                onClick={() => setAll(true)}
                className="w-full rounded-md px-3 py-2 text-center text-[13px] leading-[18px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
              >
                ↓ {t("botPanel.coding.more", { count: hidden })}
              </button>
            </li>
          )}
        </>
      )}
    </>
  );
}

function DoneToday({ items, children }: { items: readonly TeamWorkItem[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const label = teamDoneLabel(items);
  return (
    <>
      <CodingSessionRow
        title={label}
        status="finished"
        attrs={{ "data-team-done-today": String(items.length) }}
        subtitle={null}
        expanded={open}
        openLabel={label}
        onOpen={() => setOpen((value) => !value)}
      />
      {open && children}
    </>
  );
}

const ownCard = (lead: ReactNode) => <ul aria-label={t("botPanel.coding.title")} className={PANEL_CARD}>{lead}</ul>;

export function TeamWorkSection({ work, now, streaming, bots, orchestrator, openThreadId, onOpenStep, onOpenHistory, children = ownCard, stepsShown = TEAM_WORK_STEPS_SHOWN }: TeamWorkSectionProps) {
  const names = new Map<string, TeamName>();
  for (const bot of work.team) if (bot.name) names.set(bot.botId, { name: bot.name, ...(bot.title ? { title: bot.title } : {}) });
  const nameOf = (botId: string) => names.get(botId);
  const count = streaming ? teamCount(work.team) : "";
  const row = (item: TeamWorkItem) => (
    <WorkRow key={item.key} item={item} nameOf={nameOf} bots={bots} now={now} streaming={streaming} openThreadId={openThreadId} orchestrator={orchestrator} onOpenStep={onOpenStep} stepsShown={stepsShown} />
  );
  const lead = (
    <>
      {work.live.map(row)}
      {work.doneToday.length > 0 && <DoneToday items={work.doneToday}>{work.doneToday.map(row)}</DoneToday>}
    </>
  );
  return (
    <section data-bot-settings-section="coding" data-team-work="" className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <SectionHeader title={t("botPanel.coding.title")} name="coding" onOpenHistory={onOpenHistory} />
        {count && <span data-team-count className={cn(PANEL_LABEL, "min-w-0 truncate")}>{count}</span>}
      </div>
      {children(lead)}
    </section>
  );
}
