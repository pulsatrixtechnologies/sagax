// The work a bot handed to teammates, as Grok Bot's sub-agent list (owner,
// 2026-11-06: "it should be a cute card like this"). No box, no border:
// one intro line, then a light row per teammate (a mark at the left, the
// task in ink with the model in grey beside it, the live state under it),
// and "Waiting for ..." with the same sheen while any of it still runs.
// The click is the one the rows always had (onOpen): it opens what that
// bot is doing, and nothing here adds a thread panel or "Open thread".
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { friendlyEffort } from "@/lib/model-friendly";
import { routineDateTime } from "@/lib/routine-display";
import { currentTaskBot, type Bot, type InstanceInfo } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { ThinkingSheen } from "./BotActivityIndicator";
import { DottedSpinner } from "./bot-settings/CodingSessionRow";

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

function StateMark({ state }: { state: DelegationState }) {
  if (state === "running") return <DottedSpinner size={14} />;
  return (
    <span aria-hidden="true" className="flex size-[14px] shrink-0 items-center justify-center">
      <span
        className={cn(
          "size-[9px] rounded-full",
          state === "completed" || state === "ended" ? "bg-ink-tertiary"
            : state === "failed" ? "bg-danger/70"
              : "border-[1.5px] border-ink-tertiary",
        )}
      />
    </span>
  );
}

export function DelegationList({ entries, botOf, modelOf, onOpen }: {
  entries: ReadonlyArray<DelegationEntry>;
  botOf?: (botId: string) => Bot | undefined;
  /** The model each teammate runs on, grey beside the task. */
  modelOf?: (botId: string, threadId: string) => string | undefined;
  /** What a click on a row opens (the teammate's work). Absent: rows are not buttons. */
  onOpen?: (botId: string, threadId: string) => void;
}) {
  if (entries.length === 0) return null;
  const rows = entries.map((entry) => {
    const teammate = botOf?.(entry.botId);
    const name = entry.name || teammate?.name || t("routineRun.aTeammate");
    return { entry, name, state: delegationState(entry, teammate), model: modelOf?.(entry.botId, entry.threadId) };
  });
  const running = rows.filter((row) => row.state === "running" || row.state === "queued");
  const waitingText = running.length === 1
    ? t("delegation.waitingFor", { name: running[0]!.name })
    : t("delegation.waitingForCount", { count: running.length });
  return (
    <div data-delegation-list className="mt-2 w-full max-w-[36rem] pl-1">
      <p data-delegation-intro className="mb-1 text-[13px] leading-5 text-ink-secondary">
        {t("routineRun.handedTo", { name: rows.map((row) => row.name).join(", ") })}
      </p>
      <ul data-run-handed-to className="flex flex-col">
        {rows.map(({ entry, name, state, model }) => {
          const stateText = t(STATE_LINE[state]);
          const at = entry.finishedAt ?? entry.startedAt;
          const tooltip = [name, entry.task, stateText, at ? routineDateTime(at) : undefined, entry.note].filter(Boolean).join(" · ");
          const body = (
            <>
              <span className="mt-[3px] flex shrink-0"><StateMark state={state} /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span data-delegation-title className="min-w-0 truncate text-[13.5px] leading-5 text-ink">{entry.task || name}</span>
                  <span data-delegation-meta className="min-w-0 shrink truncate text-[12.5px] leading-5 text-ink-tertiary">
                    {[entry.task ? name : undefined, model].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span data-run-handoff-status className="min-w-0 truncate text-[12.5px] leading-[18px] text-ink-tertiary">
                  {state === "running"
                    ? <ThinkingSheen text={stateText} className="text-[12.5px]" />
                    : stateText}
                </span>
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
                  className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-control/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {body}
                </button>
              ) : (
                <div title={tooltip} className="flex items-start gap-2.5 py-1.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {running.length > 0 && (
        <p data-delegation-waiting className="mt-1 text-[12.5px] leading-5">
          <ThinkingSheen text={waitingText} className="text-[12.5px]" />
        </p>
      )}
    </div>
  );
}
