// Grouping a transcript's steps into one row per stretch of work.
//
// A bot working through a task emits one row per tool call, and a long
// stretch of them buries the thing you actually came to read: what the bot
// SAID. Every step between two visible messages (running, finished or
// failed, and a settled turn's narration) folds into a single group that
// names the work; text the bot left visible breaks the group, so the bot's
// words always separate one group from the next.
import type { Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { autoWorkerLine } from "@/lib/auto-model";
import { limitFailoverLineText } from "@/lib/limit-failover";
import { failedTurnCause } from "../../shared/failed-turn";
import { isStoppedTurnName } from "../../shared/client-cancel";
import { localDay } from "@/lib/transcript-derivations";
import { SANDBOX_WAKE_NOTICE, SANDBOX_WAKE_TIMEOUT_NOTICE } from "../../shared/sandbox-wake";
import { ONE_PASSWORD_WAITING } from "../../shared/credential-vault";
import { HOST_CONTROL_NOTICE } from "../../shared/host-control";
import { isQuietWorkspaceLine, parseWorkspaceLine, type WorkspaceLine } from "../../shared/workspace-line";
import { isTechnicalNoticeName } from "../../shared/chat-notices";
import type { SelectedComputer } from "../../shared/execution-target";
import type { LocaleKey } from "@/locales";
import type { SoloGoalLine, SoloGoalLineStatus } from "../../shared/solo-goal-line";
import type { FinishUntilLine, FinishUntilLineStatus } from "../../shared/finish-until-line";

export type ActivityTranscriptItem =
  | { kind: "message"; message: Message }
  /** one stretch of work: tool steps and a settled turn's narration, in
   * order. `elapsedMs` is how long the bot worked, when it is known. */
  | { kind: "run"; id: string; messages: Message[]; elapsedMs?: number };

export type TranscriptItem = ActivityTranscriptItem;

/** A status row rather than a tool step: `recovery:` when automatic recovery
 * changes this conversation's engine, `notice:` when the engine runs another
 * model than the saved one, `stopped:` when the person or the client stopped
 * the turn. All three must remain visible and are never folded. */
export function statusActivity(message: Message): { kind: "recovery" | "notice" | "stopped"; text: string } | null {
  const name = message.kind === "activity" ? message.tool?.name : undefined;
  // 2026-10-18: the bot left a provider the organization no longer offers
  // (shared/offered-engines.ts), in the reader's language.
  const move = message.kind === "activity" ? message.tool?.engineMove : undefined;
  if (move) return { kind: "notice", text: t("model.org.engineMoved", { from: move.from, to: move.to }) };
  // 2026-10-19: a usage limit sent the turn to another engine, or it came
  // back (shared/limit-failover.ts), in the reader's language.
  const limit = message.kind === "activity" ? message.tool?.limitFailover : undefined;
  if (limit) return { kind: "recovery", text: limitFailoverLineText(limit) };
  // 2026-10-21: a request ran on the engine that has its connector
  // (server/connector-switch.ts), in the reader's language.
  const switched = message.kind === "activity" ? message.tool?.connectorSwitch : undefined;
  if (switched) return { kind: "notice", text: t("chat.connectorSwitch", { engine: switched.engine, connector: switched.connector }) };
  // #1372: a 1:1 goal's status (server/solo-goal.ts), in the reader's language.
  const goal = message.kind === "activity" ? message.tool?.soloGoal : undefined;
  if (goal) return { kind: "notice", text: soloGoalLineLocalized(goal) };
  // #1329: a "do not finish until" check (relaunch x/N, met, bound), in the reader's language.
  const finish = message.kind === "activity" ? message.tool?.finishUntil : undefined;
  if (finish) return { kind: "notice", text: finishUntilLineLocalized(finish) };
  if (name?.startsWith("recovery:")) return { kind: "recovery", text: name.slice("recovery:".length).trim() };
  // The Kubernetes cluster of the server environments is starting
  // (server/sandbox-k8s-wake.ts): the server's fixed rows, in the person's language.
  if (name === SANDBOX_WAKE_NOTICE) return { kind: "notice", text: t("chat.sandboxWakingAsleep") };
  if (name === SANDBOX_WAKE_TIMEOUT_NOTICE) return { kind: "notice", text: t("chat.sandboxWakeTimeout") };
  // A fill reads 1Password, which may ask the person first (parité R10).
  if (name === ONE_PASSWORD_WAITING) return { kind: "notice", text: t("vault.onePassword.waiting") };
  // A bot took this computer's own screen (shared/host-control.ts).
  if (name === HOST_CONTROL_NOTICE) return { kind: "notice", text: t("hostControl.notice") };
  // Auto changed where the bot works (shared/workspace-line.ts).
  const workspace = parseWorkspaceLine(name);
  if (workspace) return { kind: "notice", text: workspaceLineText(workspace) };
  if (name?.startsWith("notice:")) {
    // Auto's worker row reads in the person's language (src/lib/auto-model.ts).
    if (message.autoModel?.role === "worker") return { kind: "notice", text: autoWorkerLine(message.autoModel) };
    return { kind: "notice", text: name.slice("notice:".length).trim() };
  }
  if (name && isStoppedTurnName(name)) return { kind: "stopped", text: name.slice("stopped:".length).trim() };
  return null;
}

const SOLO_GOAL_KEYS: Record<SoloGoalLineStatus, LocaleKey> = {
  none: "chat.soloGoal.none", working: "chat.soloGoal.working", blocked: "chat.soloGoal.blocked",
  stopped: "chat.soloGoal.stopped", completed: "chat.soloGoal.completed", paused: "chat.soloGoal.paused",
};

/** A 1:1 goal's status row in the reader's language (shared/solo-goal-line.ts). */
export function soloGoalLineLocalized(line: SoloGoalLine): string {
  const text = t(SOLO_GOAL_KEYS[line.status] ?? "chat.soloGoal.stopped", { goal: line.goal ?? "", rounds: String(line.rounds ?? 0) });
  return line.detail && (line.status === "completed" || line.status === "blocked") ? `${text} (${line.detail})` : text;
}

const FINISH_UNTIL_KEYS: Record<FinishUntilLineStatus, LocaleKey> = {
  relaunch: "chat.finishUntil.relaunch", met: "chat.finishUntil.met", blocked: "chat.finishUntil.blocked",
  limit: "chat.finishUntil.limit", stopped: "chat.finishUntil.stopped",
};

/** A "do not finish until" row in the reader's language (shared/finish-until-line.ts). */
export function finishUntilLineLocalized(line: FinishUntilLine): string {
  const text = t(FINISH_UNTIL_KEYS[line.status] ?? "chat.finishUntil.stopped", {
    condition: line.condition, round: String(line.round ?? 0), max: String(line.max ?? 0),
  });
  return line.detail && (line.status === "met" || line.status === "blocked") ? `${text} (${line.detail})` : text;
}

const WORKSPACE_ON: Record<SelectedComputer, LocaleKey> = {
  this_computer: "workspaceLine.computer", browser: "workspaceLine.browser", cloud: "workspaceLine.cloud", local_vm: "workspaceLine.localVm",
};
const WORKSPACE_PLACE: Record<SelectedComputer, LocaleKey> = {
  this_computer: "place.local", browser: "place.browser", cloud: "toolTarget.cloud", local_vm: "place.vm",
};

/** "Sur votre ordinateur", or "Passé sur Infonuagique : votre ordinateur est
 * hors ligne" when Auto could not work where it wanted. */
export function workspaceLineText(line: WorkspaceLine): string {
  if (!line.fallback) return t(WORKSPACE_ON[line.target]);
  const place = t(WORKSPACE_PLACE[line.target]);
  if (line.fallback.reason === "offline") return t("workspaceLine.fallbackOffline", { place });
  if (line.fallback.reason === "routine-not-allowed") return t("workspaceLine.fallbackRoutine", { place });
  if (line.fallback.reason === "routine-default") return t("workspaceLine.fallbackRoutineDefault", { place });
  return t("workspaceLine.fallbackUnavailable", { place, wanted: t(WORKSPACE_PLACE[line.fallback.wanted]) });
}

/** A status row the thread keeps but never draws: a technical notice
 * (shared/chat-notices.ts, the list iOS reads too: Auto's pick, the
 * Workspace line, an automatic recovery, a stored engine notice such as an
 * MCP server skipped) and the "On your computer" Workspace line
 * (shared/workspace-line.ts isQuietWorkspaceLine). A Data receipt is the
 * person's result. Older rows store the card title as the tool name, and
 * that title can start with "notice:". */
export function isHiddenStatusActivity(message: Message): boolean {
  if (message.kind !== "activity") return false;
  if (message.dataResult) return false;
  const name = message.tool?.name;
  // A usage-limit switch and the return after it are transparent (2026-10-29):
  // rows stored before as `recovery:` lines are left out too; a wait stays.
  const limit = message.tool?.limitFailover?.kind;
  return isQuietWorkspaceLine(name) || isTechnicalNoticeName(name) || limit === "switched" || limit === "back";
}

/** Recovery changes this conversation's engine and must remain visible. */
export function isRecoveryActivity(message: Message): boolean {
  return statusActivity(message)?.kind === "recovery";
}

export function isStatusActivity(message: Message): boolean {
  return statusActivity(message) !== null;
}

/** A stop the person asked for. It is not a failure row in the chat. */
export function isTurnStoppedNotice(message: Message): boolean {
  const name = message.kind === "activity" ? message.tool?.name : undefined;
  return name?.replace(/^error:\s*/, "").trim() === "turn stopped";
}

/** A tool the bot ran: an activity row with a tool, whether it is running,
 * finished or failed. Not a bot⇄bot or opened-thread chip (those are
 * navigation, not work), a status row, or a failed turn (that renders as an
 * error). One definition for every reader that must agree on what a step
 * is: the fold below and a call's record (call-record.ts). */
export function isToolStep(message: Message): message is Message & { tool: NonNullable<Message["tool"]> } {
  const tool = message.tool;
  if (message.kind !== "activity" || !tool) return false;
  if (message.comm || message.threadRef || message.dataResult || isStatusActivity(message)) return false;
  return failedTurnCause(tool.name) === null;
}

/** A settled turn's narration: the messages the bot wrote on its way to the
 * answer, folded into the turn's group, and how long the whole turn took. */
type TurnFold = { turnId: string; elapsedMs: number };

/** Settled providers may emit several ordinary assistant messages around
 * tool calls. Keep the terminal answer in the transcript and fold the
 * earlier narration into the turn's group of steps. */
function assistantTurnFolds(messages: Message[]): {
  byAnchorId: Map<string, TurnFold>;
  hiddenIds: Set<string>;
} {
  const byAnchorId = new Map<string, TurnFold>();
  const hiddenIds = new Set<string>();

  messages.forEach((terminal, terminalIndex) => {
    if (
      terminal.role !== "bot" ||
      terminal.kind !== "text" ||
      !terminal.turnId ||
      !terminal.turnTerminal
    ) return;

    const narration = messages.slice(0, terminalIndex).filter((message) =>
      message.role === "bot" &&
      message.kind === "text" &&
      message.turnId === terminal.turnId &&
      !message.turnTerminal
    );
    if (!narration.length) return;

    const anchor = narration[0];
    const anchorIndex = messages.findIndex((message) => message.id === anchor.id);
    let startedAt = anchor.at;
    for (let i = anchorIndex - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        startedAt = messages[i].at;
        break;
      }
    }
    byAnchorId.set(anchor.id, { turnId: terminal.turnId, elapsedMs: Math.max(0, terminal.at - startedAt) });
    for (const message of narration) hiddenIds.add(message.id);
  });

  return { byAnchorId, hiddenIds };
}

/** How long a stretch of steps ran: from the first start to the last end.
 * Undefined while a step still runs or when nothing says. */
function stepSpan(messages: Message[]): number | undefined {
  const steps = messages.filter((message) => isToolStep(message));
  if (!steps.length || steps.some((step) => step.tool?.ok === undefined)) return undefined;
  const start = Math.min(...steps.map((step) => step.at));
  const end = Math.max(...steps.map((step) => step.at + (step.tool?.durationMs ?? 0)));
  const span = end - start;
  if (span >= 1_000) return span;
  // steps stamped at the same moment: their own durations, added up
  let total = 0;
  for (const step of steps) {
    const ms = step.tool?.durationMs;
    if (ms === undefined) return span > 0 ? span : undefined;
    total += ms;
  }
  return total;
}

function group(messages: Message[], foldAssistantTurns: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const folds = foldAssistantTurns
    ? assistantTurnFolds(messages)
    : { byAnchorId: new Map<string, TurnFold>(), hiddenIds: new Set<string>() };
  let run: Message[] = [];
  let turnElapsed: number | undefined;
  let narrated = false;
  const flush = () => {
    // one step on its own is cheaper to read than a fold that hides it;
    // narration is folded even alone, the answer under it is what shows
    if (run.length > 1 || narrated) {
      items.push({ kind: "run", id: `run:${run[0].id}`, messages: run, elapsedMs: turnElapsed ?? stepSpan(run) });
    } else {
      for (const message of run) items.push({ kind: "message", message });
    }
    run = [];
    turnElapsed = undefined;
    narrated = false;
  };
  const join = (message: Message) => {
    const first = run[0];
    if (
      first &&
      (first.role !== message.role ||
        first.from?.botId !== message.from?.botId ||
        localDay(first.at) !== localDay(message.at))
    ) {
      flush();
    }
    run.push(message);
  };
  for (const message of messages) {
    // "On your computer" is stored for the server, never drawn.
    if (isHiddenStatusActivity(message)) continue;
    if (folds.hiddenIds.has(message.id)) {
      join(message);
      narrated = true;
      const fold = folds.byAnchorId.get(message.id);
      if (fold) turnElapsed = fold.elapsedMs;
      continue;
    }
    if (isToolStep(message)) {
      join(message);
      continue;
    }
    flush();
    items.push({ kind: "message", message });
  }
  flush();
  return items;
}

export function groupActivityRuns(messages: Message[]): ActivityTranscriptItem[] {
  return group(messages, false);
}

export function groupTranscript(messages: Message[]): TranscriptItem[] {
  return group(messages, true);
}

const MAX_NAMES = 3;

/** The tooltip of a group: how many steps and which tools did them. */
export function describeRun(messages: Message[]): string {
  const counts = new Map<string, number>();
  const steps = messages.filter((message) => isToolStep(message));
  for (const message of steps) {
    const name = message.tool?.name ?? "";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
  const shown = names.slice(0, MAX_NAMES).join(", ");
  const rest = names.length > MAX_NAMES ? ` ${t("chat.run.more", { count: names.length - MAX_NAMES })}` : "";
  return t("chat.run.steps", { count: steps.length, tools: `${shown}${rest}` });
}
