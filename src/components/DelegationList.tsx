// The work a bot handed to teammates, as one card of the coding job family
// (#2719, owner 2026-11-08: "it should be in a card, otherwise it looks
// weird in the chat"; 2026-11-06: Grok Bot's sub-agent list). Above the
// bubble, the provenance line every card here has (#2148): Teammates ·
// when · the state with its mark (spinning and "Waiting for ..." while any
// teammate works, Needs your answer, Completed, Failed). In the bubble, one
// row per teammate, always shown (owner 2026-11-08, #2947: no "Sent work
// to ..." title and no fold, the line and the rows already say it all): the
// task, then "bot · model" in grey, whole (nothing truncated), the live
// state and the time, the result note under it. A click on a row opens
// that teammate's work as the bot-to-bot sheet over this chat column
// (#3245: "Owner ⇄ Teammate" pill, bubbles, Close Chat; never a second chat
// with an X and a composer), in this conversation (unified chat: never a
// conversation switch, never "Open thread"); with onOpen (threads shown)
// the click opens what it always did.
import { lazy, Suspense, useState } from "react";
import { Check, CircleAlert, CircleDashed, Loader2, Users, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { chatBubbleWidth, useChatBubbleWidthClasses } from "@/lib/chat-bubble-width";
import { friendlyEffort } from "@/lib/model-friendly";
import { routineDateTime } from "@/lib/routine-display";
import { currentTaskBot, type Bot, type InstanceInfo } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { ThinkingSheen } from "./BotActivityIndicator";
import { DottedSpinner } from "./bot-settings/CodingSessionRow";
import { listNames, NamesLine, type LineParty } from "./BotNamesLine";

const TeammateExchangeSheet = lazy(() => import("./TeammateExchangeSheet"));

export interface DelegationEntry {
  botId: string;
  threadId: string;
  name?: string;
  status: string;
  task?: string;
  startedAt?: number;
  finishedAt?: number;
  note?: string;
}

export type DelegationState = "running" | "queued" | "waiting" | "completed" | "failed" | "ended";

const TERMINAL_FAILED = new Set(["failed", "cancelled", "expired", "refused", "stopped", "incomplete"]);

/** Where one hand-off stands: its recorded status, corrected by the
 * teammate's live conversation when the client holds it (a run records
 * its teammates when it ends; one still working then is not "Running"
 * forever). */
export function delegationState(entry: DelegationEntry, teammate?: Bot): DelegationState {
  if (entry.status === "completed") return "completed";
  if (TERMINAL_FAILED.has(entry.status)) return "failed";
  const task = teammate?.tasks?.find((candidate) => candidate.threadId === entry.threadId);
  if (teammate && task) {
    const live = currentTaskBot(teammate, entry.threadId);
    if (live.activity === "waiting-on-you") return "waiting";
    if (live.busy) return "running";
    return "ended";
  }
  if (entry.status === "queued") return "queued";
  if (entry.status === "needs_input") return "waiting";
  return "running";
}

const STATE_LINE: Record<DelegationState, LocaleKey> = {
  running: "delegation.state.running",
  queued: "delegation.state.queued",
  waiting: "delegation.state.waiting",
  completed: "delegation.state.completed",
  failed: "delegation.state.failed",
  ended: "delegation.state.ended",
};

/** The model a teammate runs on, as the model picker names it. */
export function delegateModelLabel(bot: Bot | undefined, instances: readonly InstanceInfo[] | undefined, threadId?: string): string | undefined {
  if (!bot?.modelSelection) return undefined;
  const selection = (threadId ? currentTaskBot(bot, threadId) : bot).modelSelection;
  if (!selection?.model) return undefined;
  const engine = instances?.find((instance) => instance.instanceId === selection.instanceId);
  const name = engine?.models.options.find((option) => option.id === selection.model)?.label ?? selection.model;
  if (selection.auto) return t("model.auto.label");
  return selection.effort ? `${name} ${friendlyEffort(selection.effort)}` : name;
}

/** The whole card's state: one teammate waiting on the person comes first,
 * then any still at work, then a failure, else done. */
export type DelegationCardState = "running" | "waiting" | "done" | "failed";

export function delegationCardState(states: ReadonlyArray<DelegationState>): DelegationCardState {
  if (states.includes("waiting")) return "waiting";
  if (states.some((state) => state === "running" || state === "queued")) return "running";
  if (states.includes("failed")) return "failed";
  return "done";
}

/** The card's status tone, the coding job card's (#2148): red for a
 * failure, the accent for a question, the line's grey otherwise. */
const CARD_TONE: Partial<Record<DelegationCardState, string>> = {
  failed: "text-danger",
  waiting: "text-accent-text",
};

/** A row's mark: the dotted spinner while it works, else a small icon. */
function StateMark({ state }: { state: DelegationState }) {
  if (state === "running") return <DottedSpinner size={14} />;
  const className = "size-[14px] shrink-0";
  if (state === "queued") return <CircleDashed aria-hidden="true" className={cn(className, "text-ink-tertiary")} />;
  if (state === "waiting") return <CircleAlert aria-hidden="true" className={cn(className, "text-accent-text")} />;
  if (state === "failed") return <X aria-hidden="true" className={cn(className, "text-danger")} />;
  return <Check aria-hidden="true" className={cn(className, state === "completed" ? "text-success" : "text-ink-tertiary")} />;
}

const ROW_BUTTON = "-mx-1.5 flex w-[calc(100%+0.75rem)] items-start gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-control/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

export function DelegationList({ entries, owner, botOf, modelOf, onOpen, inline = true }: {
  entries: ReadonlyArray<DelegationEntry>;
  /** The bot that handed the work: the left end of a teammate's sheet. */
  owner?: Pick<Bot, "id" | "name" | "color">;
  botOf?: (botId: string) => Bot | undefined;
  /** The model each teammate runs on, grey beside the name. */
  modelOf?: (botId: string, threadId: string) => string | undefined;
  /** What a click on a row opens when the conversation's threads are shown
   * (the teammate's work in its own column). Absent: see inline. */
  onOpen?: (botId: string, threadId: string) => void;
  /** Without onOpen: a click on a row opens that teammate's work as the
   * bot-to-bot sheet, here. false: the rows are plain (a static listing). */
  inline?: boolean;
}) {
  const bubbleWidths = useChatBubbleWidthClasses();
  // Which teammate's work is open (one sheet at a time).
  const [work, setWork] = useState<string | null>(null);
  if (entries.length === 0) return null;
  const rows = entries.map((entry) => {
    const teammate = botOf?.(entry.botId);
    const name = entry.name || teammate?.name || t("routineRun.aTeammate");
    return { entry, name, state: delegationState(entry, teammate), model: modelOf?.(entry.botId, entry.threadId) };
  });
  const running = rows.filter((row) => row.state === "running" || row.state === "queued");
  const cardState = delegationCardState(rows.map((row) => row.state));
  const settled = cardState !== "running";
  const waitingText = running.length === 1
    ? t("delegation.waitingFor", { name: running[0]!.name })
    : t("delegation.waitingForCount", { count: running.length });
  const statusText = cardState === "running"
    ? waitingText
    : cardState === "waiting"
      ? t("delegation.state.waiting")
      : cardState === "failed"
        ? t("delegation.state.failed")
        : t(rows.every((row) => row.state === "completed") ? "delegation.state.completed" : "delegation.state.ended");
  const starts = rows.map((row) => row.entry.startedAt).filter((at): at is number => typeof at === "number");
  const ends = rows.map((row) => row.entry.finishedAt).filter((at): at is number => typeof at === "number");
  const at = settled && ends.length === rows.length ? Math.max(...ends) : starts.length > 0 ? Math.min(...starts) : undefined;
  const names = rows.map((row) => row.name).join(", ");
  const revealing = !onOpen && inline;
  const shown = revealing ? rows.find((row) => row.entry.threadId === work) : undefined;
  const width = bubbleWidths[chatBubbleWidth({ terminal: false, wide: false })];
  return (
    <section
      data-delegation-card
      data-delegation-card-state={cardState}
      aria-label={t("delegation.card.aria", { title: names, status: statusText })}
      className="relative mt-2 w-full"
    >
      <div data-delegation-provenance className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-0.5 text-[11px] text-ink-secondary">
        <Users aria-hidden="true" className="size-3" />
        <span>{t("delegation.card.kind")}</span>
        {at !== undefined && (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={new Date(at).toISOString()}>{routineDateTime(at)}</time>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span
          data-delegation-card-status
          data-delegation-waiting={cardState === "running" ? "" : undefined}
          aria-live="polite"
          className={cn("inline-flex items-center gap-1", CARD_TONE[cardState])}
        >
          {cardState === "running" && <Loader2 aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />}
          {cardState === "running" ? <ThinkingSheen text={statusText} className="text-[11px]" /> : statusText}
        </span>
      </div>
      <div data-delegation-bubble className={cn("flex flex-col rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5 text-ink", width)}>
        <ul data-run-handed-to className="flex flex-col gap-0.5">
          {rows.map(({ entry, name, state, model }) => {
            const stateText = t(STATE_LINE[state]);
            const when = entry.finishedAt ?? entry.startedAt;
            const meta = [entry.task ? name : undefined, model].filter(Boolean).join(" · ");
            const tooltip = [name, entry.task, stateText, when ? routineDateTime(when) : undefined, entry.note].filter(Boolean).join(" · ");
            const body = (
              <>
                <span className="mt-[3px] flex shrink-0"><StateMark state={state} /></span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span data-delegation-title className="text-[13px] leading-5 text-ink">{entry.task || name}</span>
                  <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] leading-[18px] text-ink-secondary">
                    {meta && (
                      <>
                        <span data-delegation-meta>{meta}</span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span data-run-handoff-status>
                      {state === "running" ? <ThinkingSheen text={stateText} className="text-[12px]" /> : stateText}
                    </span>
                    {when !== undefined && (
                      <>
                        <span aria-hidden="true">·</span>
                        <time dateTime={new Date(when).toISOString()}>{routineDateTime(when)}</time>
                      </>
                    )}
                  </span>
                  {entry.note && <span data-delegation-note className="text-[12.5px] leading-[18px] text-ink-secondary">{entry.note}</span>}
                </span>
              </>
            );
            return (
              <li key={entry.threadId} data-run-handoff={entry.botId} data-delegation-state={state}>
                {onOpen ? (
                  <button
                    type="button"
                    data-run-teammate-thread={entry.threadId}
                    title={tooltip}
                    aria-label={t("delegation.open", { name, status: stateText })}
                    onClick={() => onOpen(entry.botId, entry.threadId)}
                    className={ROW_BUTTON}
                  >
                    {body}
                  </button>
                ) : inline ? (
                  <button
                    type="button"
                    data-delegation-reveal={entry.threadId}
                    aria-expanded={work === entry.threadId}
                    title={tooltip}
                    aria-label={t("delegation.open", { name, status: stateText })}
                    onClick={() => setWork((current) => (current === entry.threadId ? null : entry.threadId))}
                    className={ROW_BUTTON}
                  >
                    {body}
                  </button>
                ) : (
                  <div title={tooltip} className="flex items-start gap-2.5 py-1">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {shown && (
        // The sheet portals over the chat column (ExchangeSheet); the
        // region only marks which teammate is open.
        <div data-delegation-work={shown.entry.threadId} role="region" aria-label={t("delegation.workOf", { name: shown.name })} className="contents">
          <Suspense fallback={null}>
            <TeammateExchangeSheet
              key={shown.entry.threadId}
              owner={owner}
              teammate={{ id: shown.entry.botId, name: shown.name, color: botOf?.(shown.entry.botId)?.color }}
              threadId={shown.entry.threadId}
              task={shown.entry.task}
              bots={[owner && (botOf?.(owner.id) ?? owner), botOf?.(shown.entry.botId)].filter(Boolean) as Bot[]}
              onClose={() => setWork(null)}
            />
          </Suspense>
        </div>
      )}
    </section>
  );
}

/** #3289: the teammates a turn handed work to, as the quiet centered line
 * every bot-to-bot trace uses (BotNamesLine), never a "Teammates · Finished"
 * row over a card: "Asking [face] A, [face] B and [face] C" while any works,
 * "Asked ..." once all are done, the state the verb of the line. A teammate
 * waiting on the person, or one that stopped, is said on the same line. A
 * name opens that teammate's work (its task and its answer) as the
 * bot-to-bot sheet over this column; with onOpen (threads shown) the click
 * opens what it always did. The model, the times and the note stay in the
 * name's tooltip. */
export function DelegationLine({ entries, owner, botOf, modelOf, onOpen }: {
  entries: ReadonlyArray<DelegationEntry>;
  owner?: Pick<Bot, "id" | "name" | "color">;
  botOf?: (botId: string) => Bot | undefined;
  modelOf?: (botId: string, threadId: string) => string | undefined;
  onOpen?: (botId: string, threadId: string) => void;
}) {
  const [work, setWork] = useState<string | null>(null);
  if (entries.length === 0) return null;
  const rows = entries.map((entry) => {
    const teammate = botOf?.(entry.botId);
    const name = entry.name || teammate?.name || t("routineRun.aTeammate");
    return { entry, name, teammate, state: delegationState(entry, teammate), model: modelOf?.(entry.botId, entry.threadId) };
  });
  const cardState = delegationCardState(rows.map((row) => row.state));
  const asking = cardState === "running" || cardState === "waiting";
  const bots = rows.map((row) => row.teammate).filter((bot): bot is Bot => Boolean(bot));
  const parties: LineParty[] = rows.map(({ entry, name, teammate, state, model }) => {
    const when = entry.finishedAt ?? entry.startedAt;
    return {
      key: entry.threadId,
      botId: entry.botId,
      name,
      color: teammate?.color,
      title: [name, model, entry.task, t(STATE_LINE[state]), when ? routineDateTime(when) : undefined, entry.note].filter(Boolean).join(" · "),
      onOpen: onOpen ? () => onOpen(entry.botId, entry.threadId) : () => setWork(entry.threadId),
      label: t("delegation.open", { name, status: t(STATE_LINE[state]) }),
      data: { "data-run-handoff": entry.botId, "data-delegation-state": state, ...(onOpen ? { "data-run-teammate-thread": entry.threadId } : { "data-delegation-reveal": entry.threadId }) },
    };
  });
  const stopped = rows.filter((row) => row.state === "failed").map((row) => row.name);
  const waiting = cardState === "waiting";
  const tail = [
    waiting ? t("delegation.state.waiting") : "",
    stopped.length ? t("chat.askLine.stopped", { names: listNames(stopped) }) : "",
  ].filter(Boolean).join(" · ");
  const shown = work ? rows.find((row) => row.entry.threadId === work) : undefined;
  return (
    <NamesLine
      testId="delegation-line"
      verb={t(asking ? "chat.askLine.asking" : "chat.askLine.asked")}
      parties={parties}
      bots={bots}
      tail={tail || undefined}
      tailTone={stopped.length ? "danger" : waiting ? "accent" : undefined}
      data={{ "data-delegation-card-state": cardState }}
      className="mt-1 w-full self-stretch"
    >
      {shown && (
        <Suspense fallback={null}>
          <TeammateExchangeSheet
            key={shown.entry.threadId}
            owner={owner}
            teammate={{ id: shown.entry.botId, name: shown.name, color: shown.teammate?.color }}
            threadId={shown.entry.threadId}
            task={shown.entry.task}
            bots={[owner && (botOf?.(owner.id) ?? owner), shown.teammate].filter(Boolean) as Bot[]}
            onClose={() => setWork(null)}
          />
        </Suspense>
      )}
    </NamesLine>
  );
}
