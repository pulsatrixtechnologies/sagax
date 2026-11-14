// The bot panel's Suggestions card (reference design): a short list of next
// steps for this bot, built from what the app already knows. In order:
//   1. the server's open fix cards in the bot's conversations (a routine's
//      lasting problem, a product or the phone line failing: keys of
//      shared/fix-card-keys.ts, read from the one waiting list,
//      GET /api/approvals?waiting=1&botId=);
//   2. what each of its routines needs from the person (`Routine.needsPerson`,
//      #4098), unless that routine's fix card already says it;
//   3. the bot's conversations waiting on the person (a task whose activity
//      is "waiting-on-you", or a bot-to-bot conversation in
//      `waitingApprovals`), unless a row above already opens it;
//   4. a saving the server proposed (#4250 S6: a routine that could run
//      without waking its bot);
//   5. the server's setup checklist (GET /api/bots/:id/overview `setup`).
// Pure: the card draws the words, this decides which rows and in what order.
import type { BotSettingsSection } from "@/state/store";
import type { SetupStep } from "@/lib/bot-overview-types";
import type { LocaleKey } from "@/locales";
import type { RoutineNeedsPerson } from "../../shared/routines";
import { serverCardKind, serverCardRoutineId } from "../../shared/fix-card-keys";

export type BotSuggestionAction =
  | { kind: "openThread"; threadId: string }
  | { kind: "openSection"; section: BotSettingsSection }
  | { kind: "openRun"; runId: string }
  | { kind: "openRoutine"; routineId: string };

export interface BotSuggestion {
  /** Stable across reloads: what Hide remembers. */
  id: string;
  /** i18n key of the bold title, or the title itself (a card's own). */
  titleKey?: LocaleKey;
  title?: string;
  /** i18n key of the muted line under it. */
  subtitleKey?: LocaleKey;
  /** A routine's need: the muted line is its sentence (needSentence). */
  need?: RoutineNeedsPerson;
  /** Values for both keys (a conversation's title). */
  vars?: Record<string, string>;
  action: BotSuggestionAction;
}

/** A server card waiting on the person, as the waiting list serves it. */
export interface ServerCardInput {
  id: string;
  threadId: string;
  title: string;
  /** The card's ask key (message.card.askKey). */
  key?: string;
}

export interface BotSuggestionInput {
  setup?: readonly SetupStep[] | null;
  tasks?: ReadonlyArray<{ threadId: string; title?: string; activity?: string; hidden?: true; routineRunId?: string }>;
  waitingApprovals?: ReadonlyArray<{ threadId: string; openedByName?: string }>;
  routines?: ReadonlyArray<{ id: string; name: string; needsPerson?: RoutineNeedsPerson | null }>;
  cards?: readonly ServerCardInput[];
}

const MAX = 4;

const STEP_SECTION: Record<SetupStep["id"], BotSettingsSection> = {
  identity: "overview",
  soul: "soul",
  folder: "access",
  apps: "access",
  schedule: "routines",
};

/** The waiting list's items that are the server's own cards, with their key. */
export function serverCards(items: ReadonlyArray<{ id: string; threadId: string; title: string; message?: unknown }>): ServerCardInput[] {
  const out: ServerCardInput[] = [];
  for (const item of items) {
    const card = (item.message as { card?: { askKey?: unknown } } | undefined)?.card;
    const key = typeof card?.askKey === "string" ? card.askKey : "";
    if (serverCardKind(key)) out.push({ id: item.id, threadId: item.threadId, title: item.title, key });
  }
  return out;
}

export function botSuggestions(input: BotSuggestionInput): BotSuggestion[] {
  const out: BotSuggestion[] = [];
  const threads = new Set<string>();
  const cards = input.cards ?? [];
  const fixes = cards.filter((card) => serverCardKind(card.key) === "fix");
  const savings = cards.filter((card) => serverCardKind(card.key) === "saving");
  // 1. the server's fix cards: something only the person can put right
  const fixedRoutines = new Set<string>();
  for (const card of fixes) {
    const routineId = serverCardRoutineId(card.key);
    if (routineId) fixedRoutines.add(routineId);
    threads.add(card.threadId);
    out.push({
      id: `fix:${card.key}`,
      title: card.title,
      subtitleKey: "botPanel.suggestions.fix.subtitle",
      action: { kind: "openThread", threadId: card.threadId },
    });
  }
  // 2. what a routine needs from the person, said once
  const needRuns = new Set<string>();
  for (const routine of input.routines ?? []) {
    const need = routine.needsPerson;
    if (!need || fixedRoutines.has(routine.id)) continue;
    if (need.runId) needRuns.add(need.runId);
    out.push({
      id: `needs:${routine.id}`,
      titleKey: "botPanel.suggestions.needs.title",
      vars: { routine: routine.name.trim() || routine.id },
      need,
      action: need.runId ? { kind: "openRun", runId: need.runId } : { kind: "openRoutine", routineId: routine.id },
    });
  }
  // 3. the conversations waiting on the person: a turn is blocked on it
  for (const task of input.tasks ?? []) {
    if (task.activity !== "waiting-on-you" || task.hidden || threads.has(task.threadId)) continue;
    if (task.routineRunId && needRuns.has(task.routineRunId)) continue;
    threads.add(task.threadId);
    const title = task.title?.trim();
    out.push({
      id: `approval:${task.threadId}`,
      titleKey: "botPanel.suggestions.approval.title",
      subtitleKey: title ? "botPanel.suggestions.approval.inThread" : "botPanel.suggestions.approval.subtitle",
      ...(title ? { vars: { title } } : {}),
      action: { kind: "openThread", threadId: task.threadId },
    });
  }
  for (const row of input.waitingApprovals ?? []) {
    if (threads.has(row.threadId)) continue;
    threads.add(row.threadId);
    const name = row.openedByName?.trim();
    out.push({
      id: `approval:${row.threadId}`,
      titleKey: "botPanel.suggestions.approval.title",
      subtitleKey: name ? "botPanel.suggestions.approval.fromBot" : "botPanel.suggestions.approval.subtitle",
      ...(name ? { vars: { name } } : {}),
      action: { kind: "openThread", threadId: row.threadId },
    });
  }
  // 4. a cheaper way to run a routine, proposed by the server
  for (const card of savings) {
    out.push({
      id: `saving:${card.key}`,
      title: card.title,
      subtitleKey: "botPanel.suggestions.saving.subtitle",
      action: { kind: "openThread", threadId: card.threadId },
    });
  }
  // 5. the setup checklist
  for (const step of input.setup ?? []) {
    if (step.done || !(step.id in STEP_SECTION)) continue;
    out.push({
      id: `setup:${step.id}`,
      titleKey: `botPanel.suggestions.setup.${step.id}.title` as LocaleKey,
      subtitleKey: `botPanel.suggestions.setup.${step.id}.subtitle` as LocaleKey,
      action: { kind: "openSection", section: STEP_SECTION[step.id] },
    });
  }
  return out.slice(0, MAX);
}
