import { findStructure, routineResultParts } from "../../shared/routine-result";
import { t } from "./i18n";
import type { BotActivityStep } from "../../shared/bot-activity";
import { groupActivitySteps, type ActivityStepPhase } from "./activity-step-groups";
import { routineRunLabel, routineRunPreview } from "./routine-display";
import type { RoutineRun } from "./routines";

const messages = {
  "Could not create a room task for this goal": "runHistory.roomTask",
  "Could not create a task for this run": "runHistory.runTask",
  "The room goal reached its turn limit": "runHistory.limit",
  "The room goal is blocked": "runHistory.blocked",
  "The room goal is paused": "runHistory.goalPaused",
  "The team needs your input": "runHistory.needsInput",
  "The assigned bot no longer exists": "runHistory.botMissing",
  "The assigned room or coordinator no longer exists": "runHistory.roomMissing",
  "The routine paused itself after failing several times in a row before this run started": "runHistory.autoPaused",
  "Skipped after a restart: a routine runs at most once when the server comes back": "runHistory.onceRestart",
  "Sagax restarted while this routine was running": "runHistory.restarted",
  "Starts again after the restart, in this task": "runHistory.restartTask",
  "The bot said it showed you a card, but no card was shown: nothing is waiting for your choice and nothing was written. Run the routine again.": "runHistory.noCard",
  "Waiting for delegated work to finish": "runHistory.teammates",
  "Waits for this bot's other proactive wake to finish": "runHistory.wake",
  "Perspicax is rate limiting this server; this run is skipped": "runHistory.limited",
  "Perspicax is unreachable for now; this run is retried in a moment": "runHistory.unreachable",
  "Perspicax stayed unreachable for several minutes; this run is skipped and the next one tries again": "runHistory.skipped",
  "The model provider sign-ins could not be loaded after the server started; this run is skipped and the next one tries again": "runHistory.signIns",
  "The loop guard stopped the run before it finished": "runHistory.loop",
  "The teammates' work for this run did not finish": "runHistory.work",
  "Waiting for your approval": "approval.status.waitingApproval",
  "Waiting for your answer": "question.status.waiting",
  "Stopped waiting: a new run of this routine started instead": "runHistory.newRun",
  "Stopped waiting: the next scheduled run of this routine started instead": "runHistory.nextRun",
  "Skipped because the previous run of this routine is still waiting": "runHistory.waiting",
  "The run's turn ended without a result: nothing has worked on it for 30 minutes": "runHistory.lost",
  "The routine was paused before this run started": "runHistory.paused",
  "The assigned bot was deleted": "runHistory.botGone",
  "The assigned room was deleted": "runHistory.roomGone",
  "The routine ended before this scheduled run could start": "runHistory.ended",
  "This computer was offline for more than 12 hours after the scheduled time": "runHistory.offline",
  "The goal's deadline passed before this run started": "runHistory.deadline",
} as const;

function localizeLine(line: string, serverReason = true): string {
  if (/^Nothing for you this time[.;]?(?: nothing was posted\.)?$/i.test(line)) return t("chat.peerOutcome.nothing");
  if (Object.hasOwn(messages, line)) return t(messages[line as keyof typeof messages]);
  const timeout = /^Stopped after reaching the (\d+)-minute run limit$/.exec(line);
  if (timeout) return t("runHistory.timeout", { count: timeout[1]! });
  const failed = /^(\d+) tool steps? failed(?: and the run ended without a final message)?[.]?$/i.exec(line);
  if (failed) return failedSteps(Number(failed[1]));
  if (!serverReason) return line;
  const prefix = line.split(": ", 1)[0]!;
  if (line.length > prefix.length && Object.hasOwn(messages, prefix)) return t(messages[prefix as keyof typeof messages]) + " " + line.slice(prefix.length + 2);
  const tool = /^(.+?) failed(?: (\d+) times(?: and never succeeded after)?)?(?:: (.+))?$/.exec(line);
  if (tool) return t(tool[2] ? "runHistory.failedRepeated" : "runHistory.failedTool", { tool: tool[1]!, count: tool[2] ?? 1 }) + (tool[3] ? " " + tool[3] : "");
  for (const [prefix, key] of [["Pre-check failed, the run did not start: ", "runHistory.precheck"], ["The engine reported an error during the run: ", "runHistory.engine"]] as const) {
    if (line.startsWith(prefix)) return t(key) + " " + line.slice(prefix.length);
  }
  return line;
}

function failedSteps(count: number) {
  return t(count === 1 ? "runHistory.stepsOne" : "runHistory.steps", { count });
}

export function historySummary(run: RoutineRun): string {
  if (run.redacted || run.status === "nothing_to_report") return routineRunLabel(run);
  if (run.completionNotes) {
    let count = 0;
    for (const line of run.completionNotes.split("\n")) {
      const note = /^- .+? failed(?: (\d+) times)?(?::|$)/.exec(line);
      if (note) count += Number(note[1] ?? 1);
    }
    return count ? failedSteps(count) : t("runHistory.notes");
  }
  if (run.quiet) return t("chat.peerOutcome.nothing");
  return localizeLine(routineRunPreview(run) || routineRunLabel(run), Boolean(run.problems || run.error || run.attention));
}

export function runOutcome(run: RoutineRun): string[] {
  if (run.redacted || run.status !== "completed") return [];
  const output = run.output?.replace(run.completionNotes ?? "", "").trim();
  if (run.quiet) return [t("chat.peerOutcome.nothing")];
  if (!output) return run.form ? [t("runHistory.cardsOne", { count: 1 })] : [];
  const object = findStructure(output)?.value;
  if (object && !Array.isArray(object)) {
    const counts: string[] = [];
    for (const key of ["placed", "cards", "pending"] as const) {
      const count = object[key];
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) continue;
      counts.push(t(count === 1 && key !== "pending" ? `runHistory.${key}One` : `runHistory.${key}`, { count }));
    }
    if (counts.length) return counts;
    const parts = routineResultParts(output);
    const items = [...parts.done, ...parts.blocked, ...parts.todo];
    if (items.length) return items;
  }
  const line = routineRunPreview({ status: "completed", output });
  return line ? [localizeLine(line, false)] : [];
}

interface HistoryStep {
  id: string;
  label: string;
  phase: ActivityStepPhase | "pending";
  count: number;
}

/** A recorded plan names future stages too. Otherwise the activity feed supplies actual tool calls. */
export function historySteps(events: readonly BotActivityStep[]): HistoryStep[] {
  const plan = events.filter(event => ["TodoWrite", "update_plan"].includes(event.name) && event.ok !== false).at(-1);
  if (plan?.input) {
    try {
      const input = JSON.parse(plan.input);
      const rows: unknown = input?.todos ?? input?.plan;
      if (Array.isArray(rows)) {
        const steps: HistoryStep[] = [];
        for (const row of rows) {
          const label = row?.step ?? row?.content;
          if (typeof label !== "string" || !label.trim() || !["completed", "in_progress", "pending"].includes(row.status)) continue;
          const phase = row.status === "completed" ? "done" : row.status === "in_progress" ? "running" : "pending";
          steps.push({ id: `${plan.id}-${steps.length}`, label, phase, count: 1 });
        }
        if (steps.length) return steps;
      }
    } catch { /* A truncated plan still has the activity feed. */ }
  }
  return groupActivitySteps(events);
}
