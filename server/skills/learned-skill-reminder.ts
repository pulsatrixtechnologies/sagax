// What the bot learned from use and still waits for a decision (#3400,
// owner decision 2026-11-10). A learning is approved or declined on its card
// in the chat or in the Knowledge tab of the bot's profile, and answering in
// one place settles the other: both answer the same card. This module finds
// that card for a staged learning (the tab's rows carry it), writes the quiet
// line a decision taken in the tab leaves in the chat, and sends the daily
// reminder: one quiet line in the bot's chat for everything that waits, at
// most once a day.
import {
  LEARNED_SKILL_REMINDER_AFTER_MS,
  LEARNED_SKILL_REMINDER_EVERY_MS,
  learnedSkillLineText,
  type LearnedSkillLine,
} from "../../shared/learned-skill-line.ts";

interface CardMessage {
  id: string;
  at?: number;
  kind?: string;
  tool?: { name?: string; learnedSkill?: LearnedSkillLine } | undefined;
  card?: {
    requestId?: string;
    answered?: string;
    dismissed?: boolean;
    skillRequest?: { botId: string; stagedId: string; createdAt?: number };
  } | undefined;
}

export interface LearnedSkillStore {
  readonly bots: ReadonlyArray<{ id: string; name: string; color: string; threadId: string; tasks?: ReadonlyArray<{ threadId: string }> }>;
  readonly groups?: ReadonlyArray<{ threadId: string; tasks?: ReadonlyArray<{ threadId: string }> }>;
  messagesFor(threadId: string): readonly CardMessage[];
  appendMessage(threadId: string, message: Record<string, unknown>): unknown;
}

/** Where a staged learning's open card sits: the tab answers it there. */
export interface OpenSkillCard {
  threadId: string;
  requestId: string;
  messageId: string;
  createdAt?: number;
}

function botThreads(store: LearnedSkillStore, botId: string): string[] {
  const bot = store.bots.find((entry) => entry.id === botId);
  if (!bot) return [];
  const threads = [bot.threadId, ...(bot.tasks ?? []).map((task) => task.threadId)];
  // a card the bot raised in a room carries its own bot id
  for (const group of store.groups ?? []) threads.push(group.threadId, ...(group.tasks ?? []).map((task) => task.threadId));
  return [...new Set(threads.filter(Boolean))];
}

/** Every open learned-skill card of one bot, by its staged id. */
export function openSkillCards(store: LearnedSkillStore, botId: string): Map<string, OpenSkillCard> {
  const found = new Map<string, OpenSkillCard>();
  for (const threadId of botThreads(store, botId)) {
    for (const message of store.messagesFor(threadId)) {
      const card = message.card;
      const request = card?.skillRequest;
      if (!card || !request || request.botId !== botId || !card.requestId) continue;
      if (card.answered || card.dismissed) continue;
      found.set(request.stagedId, {
        threadId,
        requestId: card.requestId,
        messageId: message.id,
        ...(typeof request.createdAt === "number" ? { createdAt: request.createdAt } : {}),
      });
    }
  }
  return found;
}

/** The quiet line itself, from the bot, in its chat. */
function appendLine(store: LearnedSkillStore, botId: string, threadId: string, line: LearnedSkillLine): void {
  const bot = store.bots.find((entry) => entry.id === botId);
  store.appendMessage(threadId, {
    role: "bot",
    kind: "activity",
    ...(bot ? { from: { botId: bot.id, name: bot.name, color: bot.color } } : {}),
    tool: { name: learnedSkillLineText(line), ok: true, learnedSkill: line },
  });
}

/** A learning decided in the Knowledge tab: one quiet line where its card is. */
export function noteLearnedSkillDecision(
  store: LearnedSkillStore,
  args: { botId: string; threadId: string; name: string; action: "create" | "update"; outcome: "enabled" | "declined" },
): void {
  appendLine(store, args.botId, args.threadId, { event: "decided", outcome: args.outcome, name: args.name, action: args.action });
}

/** When this bot's chat last reminded the person, or null. */
function lastReminderAt(store: LearnedSkillStore, threadId: string): number | null {
  const messages = store.messagesFor(threadId);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const line = messages[index]!.tool?.learnedSkill;
    if (messages[index]!.kind === "activity" && line?.event === "waiting") return messages[index]!.at ?? 0;
  }
  return null;
}

/** One pass: each bot with learnings waiting at least an hour on their card
 * gets one quiet line in its chat for all of them, when it had none in the
 * last day. Returns the bots reminded. */
export function remindWaitingLearnedSkills(
  store: LearnedSkillStore,
  stagedIds: (botId: string) => readonly string[],
  now: number = Date.now(),
): string[] {
  const reminded: string[] = [];
  for (const bot of store.bots) {
    const staged = stagedIds(bot.id);
    if (staged.length === 0 || !bot.threadId) continue;
    const cards = openSkillCards(store, bot.id);
    const waiting = staged.map((id) => cards.get(id)).filter((card): card is OpenSkillCard => card !== undefined);
    if (waiting.length === 0) continue;
    if (!waiting.some((card) => now - (card.createdAt ?? 0) >= LEARNED_SKILL_REMINDER_AFTER_MS)) continue;
    const last = lastReminderAt(store, bot.threadId);
    if (last !== null && now - last < LEARNED_SKILL_REMINDER_EVERY_MS) continue;
    appendLine(store, bot.id, bot.threadId, { event: "waiting", count: waiting.length });
    reminded.push(bot.id);
  }
  return reminded;
}
