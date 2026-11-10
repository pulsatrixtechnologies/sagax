// The quiet lines a bot's chat keeps about what it learned from use (#3400,
// owner decision 2026-11-10): a learning approved or declined in the
// Knowledge tab of the bot's profile leaves one line in the chat (nothing
// invisible), and when learnings wait for a decision the chat reminds the
// person on its own, one line for everything that waits, at most once a
// day (server/skills/learned-skill-reminder.ts). The row's name carries the
// English words every client can show; the app draws `tool.learnedSkill` in
// the reader's language (src/lib/activity-runs.ts).

export type LearnedSkillLine =
  /** One learning decided in the Knowledge tab: its card in the chat is settled too. */
  | { event: "decided"; outcome: "enabled" | "declined"; name: string; action: "create" | "update" }
  /** The daily reminder: how many learnings wait for a decision. */
  | { event: "waiting"; count: number };

/** At most one reminder a day per bot. */
export const LEARNED_SKILL_REMINDER_EVERY_MS = 24 * 60 * 60_000;
/** A learning waits this long after its card before a reminder names it:
 * the card itself is the first word. */
export const LEARNED_SKILL_REMINDER_AFTER_MS = 60 * 60_000;

/** The English line, for clients that do not draw `tool.learnedSkill`. */
export function learnedSkillLineText(line: LearnedSkillLine): string {
  if (line.event === "waiting") {
    return line.count === 1
      ? "1 learned skill waits for your decision in the Knowledge tab of the bot's profile."
      : `${line.count} learned skills wait for your decision in the Knowledge tab of the bot's profile.`;
  }
  const verb = line.outcome === "declined" ? "declined" : line.action === "update" ? "updated" : "enabled";
  return `Learned skill "${line.name}" ${verb} from the Knowledge tab.`;
}
