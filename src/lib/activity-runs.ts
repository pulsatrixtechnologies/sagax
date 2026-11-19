// Grouping a transcript's steps into one row per stretch of work.
//
// A bot working through a task emits one row per tool call, and a long
// stretch of them buries the thing you actually came to read: what the bot
// SAID. Every step between two visible messages (running, finished or
// failed) folds into a single group that names the work; every text the bot
// writes is a bubble of its own and breaks the group, so the bot's words
// always separate one group from the next (#4437).
import { isBusyElsewhereWait } from "@/lib/turn-tail";
import type { Message } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { autoWorkerLine } from "@/lib/auto-model";
import { limitFailoverRowText } from "@/lib/limit-failover";
import { failedTurnCause } from "../../shared/failed-turn";
import { isStoppedTurnName } from "../../shared/client-cancel";
import { localDay } from "@/lib/transcript-derivations";
import { SANDBOX_WAKE_NOTICE, SANDBOX_WAKE_TIMEOUT_NOTICE, type SandboxWakeLine } from "../../shared/sandbox-wake";
import { formatElapsed } from "@/lib/working-time";
import { ONE_PASSWORD_WAITING } from "../../shared/credential-vault";
import { HOST_CONTROL_NOTICE } from "../../shared/host-control";
import { isQuietWorkspaceLine, parseWorkspaceLine, workspaceLineWords, type WorkspaceLine } from "../../shared/workspace-line";
import { isTechnicalNoticeName } from "../../shared/chat-notices";
import type { LocaleKey } from "@/locales";
import type { SoloGoalLine, SoloGoalLineStatus } from "../../shared/solo-goal-line";
import type { LearnedSkillLine } from "../../shared/learned-skill-line";
import type { FinishUntilLine, FinishUntilLineStatus } from "../../shared/finish-until-line";

export type ActivityTranscriptItem =
  | { kind: "message"; message: Message }
  /** one stretch of work: tool steps, in order; the bot's words between two
   * stretches are bubbles of their own (#4437). `elapsedMs` is how long the
   * bot worked, when it is known; `closed`: the bot wrote after it, so this
   * stretch is over even while its turn still runs. */
  | { kind: "run"; id: string; messages: Message[]; elapsedMs?: number; closed?: true };

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
  if (limit && message.tool) return { kind: "recovery", text: limitFailoverRowText({ name: message.tool.name, limitFailover: limit }) };
  // 2026-10-21: a request ran on the engine that had its connector, in the
  // reader's language. The switch is retired (#3356); stored lines still render.
  const switched = message.kind === "activity" ? message.tool?.connectorSwitch : undefined;
  if (switched) return { kind: "notice", text: t("chat.connectorSwitch", { engine: switched.engine, connector: switched.connector }) };
  // #3400: a learning decided in the Knowledge tab, or the daily reminder
  // of the learnings that wait (shared/learned-skill-line.ts).
  const learned = message.kind === "activity" ? message.tool?.learnedSkill : undefined;
  if (learned) return { kind: "notice", text: learnedSkillLineLocalized(learned) };
  // #1372: a 1:1 goal's status (server/solo-goal.ts), in the reader's language.
  const goal = message.kind === "activity" ? message.tool?.soloGoal : undefined;
  if (goal) return { kind: "notice", text: soloGoalLineLocalized(goal) };
  // #1329: a "do not finish until" check (relaunch x/N, met, bound), in the reader's language.
  const finish = message.kind === "activity" ? message.tool?.finishUntil : undefined;
  if (finish) return { kind: "notice", text: finishUntilLineLocalized(finish) };
  if (name?.startsWith("recovery:")) return { kind: "recovery", text: name.slice("recovery:".length).trim() };
  // The Kubernetes cluster of the server environments is starting
  // (server/sandbox/sandbox-k8s-wake.ts): the server's fixed rows, in the person's language.
  if (name === SANDBOX_WAKE_NOTICE) {
    const wake = message.kind === "activity" ? message.tool?.sandboxWake : undefined;
    // Not the live row (StatusActivityRow draws that while its turn works):
    // a wait with no end is one whose turn is over, said in the past tense.
    if (!wake) return { kind: "notice", text: t("chat.sandboxWakingAsleep") };
    return { kind: "notice", text: sandboxWakeLineText(wake.endedAt === undefined ? { ...wake, endedAt: wake.checkedAt ?? wake.since, outcome: "interrupted" } : wake, Date.now()) };
  }
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

/** #3400: a learned-skill line in the reader's language. */
export function learnedSkillLineLocalized(line: LearnedSkillLine): string {
  if (line.event === "waiting") {
    return line.count === 1 ? t("chat.learnedSkill.waitingOne") : t("chat.learnedSkill.waitingMany", { count: String(line.count) });
  }
  if (line.outcome === "declined") return t("chat.learnedSkill.declined", { name: line.name });
  return t(line.action === "update" ? "chat.learnedSkill.updated" : "chat.learnedSkill.enabled", { name: line.name });
}

/** #3296: the live "environment is starting" row in the reader's language:
 * what the turn waits for, since when (the time of day and how long), and
 * how it ended. */
export function sandboxWakeLineText(line: SandboxWakeLine, now: number): string {
  const since = new Date(line.since).toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" });
  if (line.endedAt !== undefined) {
    if (line.outcome === "timeout") return t("chat.sandboxWakeTimeout");
    if (line.outcome === "interrupted") return t("chat.sandboxWake.interrupted", { since });
    return t("chat.sandboxWake.ready", { elapsed: formatElapsed(line.endedAt - line.since) });
  }
  const elapsed = formatElapsed(now - line.since);
  return line.waitingFor === "environment"
    ? t("chat.sandboxWake.environment", { since, elapsed })
    : t("chat.sandboxWake.cluster", { since, elapsed });
}

/** #3296: the live row of a wait that is not over keeps counting while its
 * turn works, whatever came after it; the server ends it. */
export function sandboxWakeLiveLine(message: Message, busy: boolean): SandboxWakeLine | null {
  if (!busy || message.kind !== "activity" || message.tool?.name !== SANDBOX_WAKE_NOTICE) return null;
  const line = message.tool.sandboxWake;
  return line && line.endedAt === undefined ? line : null;
}

/** QA 0.8.66 F1: the "environment is starting" row of a turn still waiting
 * on it (busy, and nothing came after the row) counts its seconds, so a cold
 * start never reads as a silent chat. Null when the row is not that notice
 * or the wait is over. A live row (#3296) is drawn by sandboxWakeLineText. */
export function sandboxWakeElapsed(message: Message, transcript: readonly Message[], busy: boolean, now: number): number | null {
  if (!busy || message.kind !== "activity" || message.tool?.name !== SANDBOX_WAKE_NOTICE) return null;
  if (message.tool.sandboxWake) return null;
  const index = transcript.findIndex((m) => m.id === message.id);
  if (index < 0 || index !== transcript.length - 1) return null;
  if (typeof message.at !== "number" || !Number.isFinite(message.at)) return null;
  return Math.max(0, Math.floor((now - message.at) / 1000));
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

/** "Sur ton ordinateur", or "Passé sur Infonuagique : ton ordinateur est
 * hors ligne" when Auto could not work where it wanted (shared/workspace-line.ts). */
export function workspaceLineText(line: WorkspaceLine): string {
  return workspaceLineWords(line, (key, vars) => t(key as LocaleKey, vars));
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
  // the wait on a busy member speaks through the working line (turn-tail.ts)
  if (isBusyElsewhereWait(message)) return true;
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

/** One stretch of a turn's work behind one row, and how long it took.
 * `closed`: the bot wrote a text of the same turn after it, so the
 * stretch is over even while the turn still runs. */
type TurnFold = { turnId: string; elapsedMs: number; messages: Message[]; closed: boolean };

/** A person's chat draws every text the bot writes during a turn as its own
 * bubble, in order, from the moment it is written and after the turn ends
 * (#4437: "C'est un message ultra pertinent"). Only the work folds: each
 * stretch of steps between two of the bot's texts (or between the person's
 * message and the bot's first text) goes behind one row at its place, so
 * the Working group holds tool calls and never the bot's words. A failed
 * step stays where it was (a failed hand-off is why no answer came). */
function chatTurnFolds(messages: Message[]): { byAnchorId: Map<string, TurnFold>; hiddenIds: Set<string> } {
  const byAnchorId = new Map<string, TurnFold>();
  const hiddenIds = new Set<string>();
  // the newest text each turn wrote: a stretch before it is over
  const lastText = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.role === "bot" && message.kind === "text" && message.turnId) lastText.set(message.turnId, index);
  });
  let stretch: Message[] = [];
  let lastIndex = 0;
  let startedAt = 0;
  let previous: Message | undefined;
  const close = (next?: Message) => {
    const first = stretch[0];
    if (!first) return;
    const last = stretch.at(-1)!;
    const closed = (lastText.get(first.turnId!) ?? -1) > lastIndex;
    const endedAt = next !== undefined && next.turnId === first.turnId ? next.at : last.at + (last.tool?.durationMs ?? 0);
    byAnchorId.set(first.id, { turnId: first.turnId!, elapsedMs: Math.max(0, endedAt - startedAt), messages: stretch, closed });
    for (const message of stretch) hiddenIds.add(message.id);
    stretch = [];
  };
  messages.forEach((message, index) => {
    // "On your computer" is stored for the server, never drawn: it splits nothing
    if (isHiddenStatusActivity(message)) return;
    const work = message.turnId !== undefined && isToolStep(message) && message.tool.ok !== false;
    if (!work) {
      close(message);
    } else {
      if (stretch.length && stretch[0]!.turnId !== message.turnId) close(message);
      if (!stretch.length) {
        // the stretch starts with what came just before it in this turn,
        // or with the person's message that started the turn
        const from = previous && (previous.role === "user" || previous.turnId === message.turnId) ? previous.at : message.at;
        startedAt = Math.min(from, message.at);
      }
      stretch.push(message);
      lastIndex = index;
    }
    previous = message;
  });
  close();
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

function group(messages: Message[], foldTurns: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const folds = foldTurns
    ? chatTurnFolds(messages)
    : { byAnchorId: new Map<string, TurnFold>(), hiddenIds: new Set<string>() };
  let run: Message[] = [];
  const flush = () => {
    // one step on its own is cheaper to read than a fold that hides it
    if (run.length > 1) {
      items.push({ kind: "run", id: `run:${run[0].id}`, messages: run, elapsedMs: stepSpan(run) });
    } else {
      for (const message of run) items.push({ kind: "message", message });
    }
    run = [];
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
    const fold = folds.byAnchorId.get(message.id);
    if (fold) {
      flush();
      items.push({ kind: "run", id: `run:${fold.messages[0]!.id}`, messages: fold.messages, elapsedMs: fold.elapsedMs, ...(fold.closed ? { closed: true } : {}) });
      continue;
    }
    if (folds.hiddenIds.has(message.id)) continue;
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
