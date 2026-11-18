// Build an ExchangeRun from a routine run so the run opens in the same sheet
// as a bot-to-bot exchange: header "<routine> <-> <bot>", the instruction as
// the opening line from the routine, then the bot's report and tool steps.
import type { Message } from "@/state/store";
import type { ExchangeParty, ExchangeRun } from "@/lib/bot-exchange";
import type { BotActivityDetail, BotActivityStep, BotActivityText } from "@/lib/bot-activity";
import type { Routine, RoutineRun } from "@/lib/routines";
import { routineDateTime, routineRunDuration, routineRunLabel } from "@/lib/routine-display";
import { formatUsd } from "@/lib/usage";
import { t } from "@/lib/i18n";

export type RoutineExchangeBot = {
  id: string;
  name: string;
  color?: string;
};

/** Quiet status line under the header pill (when, duration, cost). */
export function routineRunExchangeMeta(run: RoutineRun, now = Date.now()): string {
  const parts: string[] = [routineRunLabel(run), routineDateTime(run.scheduledFor)];
  const duration = routineRunDuration(run, now);
  if (duration) parts.push(duration);
  if (run.cost != null && run.cost > 0) parts.push(formatUsd(run.cost));
  if (run.manual) parts.push(t("routines.trigger.manual"));
  else if (run.triggerSource) parts.push(t(`routines.trigger.${run.triggerSource}`));
  return parts.join(" · ");
}

function party(bot: RoutineExchangeBot): ExchangeParty {
  return { id: bot.id, name: bot.name, ...(bot.color ? { color: bot.color } : {}) };
}

function routineParty(name: string): ExchangeParty {
  return { name };
}

function stepMessage(step: BotActivityStep, bot: RoutineExchangeBot, index: number): Message {
  return {
    id: `routine-step:${index}`,
    role: "bot",
    kind: "activity",
    text: "",
    at: step.at || Date.now(),
    from: { botId: bot.id, name: bot.name, color: (bot.color ?? "blue") as NonNullable<Message["from"]>["color"] },
    tool: {
      id: `step-${index}`,
      name: step.name,
      summary: step.summary,
      ok: step.ok,
      input: step.input,
      at: step.at,
      // A failed step keeps its own words: without them the opened row read
      // "The tool failed and returned no error message" though the server
      // sent the reason (Apple Mail routine, 2026-11-17).
      ...(step.ok === false && step.error ? { output: step.error } : {}),
      ...(step.product ? { product: step.product } : {}),
    },
  } as Message;
}

/** The record's text is a clip of the bot's newest text (clipReadable, which
 * may end it with "…"): the same words, drawn once. */
function sameWords(text: string, record: string): boolean {
  const clip = record.replace(/…$/, "").trimEnd();
  return text === record || (clip.length > 0 && text.startsWith(clip));
}

/** Messages for the exchange sheet: instruction, then every text the bot
 * wrote and every tool step, in the order they came (#4437: each text its
 * own bubble, never one bubble rewritten with the newest text), then the
 * report. */
export function routineRunExchangeMessages(args: {
  run: RoutineRun;
  routine: Routine | null;
  bot: RoutineExchangeBot;
  detail?: BotActivityDetail | null;
}): Message[] {
  const { run, routine, bot, detail } = args;
  const routineName = routine?.name ?? run.routineName;
  const started = run.startedAt ?? run.scheduledFor;
  const finished = run.finishedAt ?? run.scheduledFor;
  const messages: Message[] = [];

  // Message ids stay opaque (no raw run / routine ids in the DOM).
  const prompt = (routine?.prompt ?? run.prompt ?? "").trim();
  if (prompt) {
    messages.push({
      id: "routine-prompt",
      role: "bot",
      kind: "text",
      text: prompt,
      at: started,
      // Name only: never put a raw routine id in from.botId (it can surface in the UI).
      from: { name: routineName },
    } as Message);
  }

  const botFrom = { botId: bot.id, name: bot.name, color: (bot.color ?? "blue") as NonNullable<Message["from"]>["color"] };
  // #3581: the whole report when the single-run read gave it (the card's
  // "Details"), else the record's own text.
  const output = (run.report ?? run.output ?? "").trim();
  const live = run.status === "queued" || run.status === "running" || run.status === "waiting";
  const reported = Boolean(output) && !run.redacted;
  // #4437: the texts the run's turn wrote, each its own bubble. The final
  // one is the report, drawn below (whole when the single-run read gave it);
  // so is the newest one of a finished run whose record holds the same words.
  const said: BotActivityText[] = run.redacted ? [] : (detail?.said ?? []).filter((entry) => !(reported && entry.final));
  if (reported && !live && said.length && sameWords(said.at(-1)!.text, output)) said.pop();
  const steps = detail?.steps ?? [];
  let next = 0;
  said.forEach((entry, index) => {
    while (next < steps.length && steps[next]!.at <= entry.at) {
      messages.push(stepMessage(steps[next]!, bot, next));
      next += 1;
    }
    messages.push({ id: `routine-said:${index}`, role: "bot", kind: "text", text: entry.text, at: entry.at, from: botFrom } as Message);
  });
  for (; next < steps.length; next += 1) messages.push(stepMessage(steps[next]!, bot, next));

  // while the run goes, its record is only the newest text, already drawn
  if (live && said.length) return messages;
  if (reported) {
    messages.push({
      id: "routine-report",
      role: "bot",
      kind: "text",
      text: output,
      at: finished,
      from: botFrom,
    } as Message);
  } else if (run.redacted) {
    messages.push({
      id: "routine-redacted",
      role: "bot",
      kind: "text",
      text: t("routines.scope.redacted"),
      at: finished,
      from: botFrom,
    } as Message);
  } else if (run.error?.trim() && run.status !== "waiting") {
    messages.push({
      id: "routine-error",
      role: "bot",
      kind: "text",
      text: run.error.trim(),
      at: finished,
      from: botFrom,
    } as Message);
  } else if (run.status === "completed" && run.quiet) {
    messages.push({
      id: "routine-quiet",
      role: "bot",
      kind: "text",
      text: t("routineRun.quiet"),
      at: finished,
      from: botFrom,
    } as Message);
  }

  return messages;
}

export function routineRunToExchange(args: {
  run: RoutineRun;
  routine: Routine | null;
  bot: RoutineExchangeBot;
  detail?: BotActivityDetail | null;
}): ExchangeRun {
  const { run, routine, bot, detail } = args;
  const routineName = routine?.name ?? run.routineName;
  return {
    id: "routine-run",
    messages: routineRunExchangeMessages({ run, routine, bot, detail }),
    party: party(bot),
    ends: [routineParty(routineName), party(bot)],
  };
}

/** #2272: the window of a run not loaded yet (older than the app's window):
 * same header (routine, bot), no line until the run arrives. */
export function routineRunPendingExchange(args: { routineName: string; bot: RoutineExchangeBot }): ExchangeRun {
  return { id: "routine-run", messages: [], party: party(args.bot), ends: [routineParty(args.routineName), party(args.bot)] };
}
