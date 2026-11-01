// Build an ExchangeRun from a routine run so the run opens in the same sheet
// as a bot-to-bot exchange: header "<routine> <-> <bot>", the instruction as
// the opening line from the routine, then the bot's report and tool steps.
import type { Message } from "@/state/store";
import type { ExchangeParty, ExchangeRun } from "@/lib/bot-exchange";
import type { BotActivityDetail, BotActivityStep } from "@/lib/bot-activity";
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
    },
  } as Message;
}

/** Messages for the exchange sheet: instruction, tool steps, then the report. */
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

  const steps = detail?.steps ?? [];
  for (let index = 0; index < steps.length; index += 1) {
    messages.push(stepMessage(steps[index]!, bot, index));
  }

  const botFrom = { botId: bot.id, name: bot.name, color: (bot.color ?? "blue") as NonNullable<Message["from"]>["color"] };
  const output = (run.output ?? "").trim();
  if (output && !run.redacted) {
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
