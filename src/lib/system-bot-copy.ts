import { t } from "@/lib/i18n";

/** #3202: the server's own Feedback bot is created with one stored title and
 * description (server/feedback/service.ts), written once in French. What a
 * person reads follows the app language instead, so the header, the sidebar
 * row and the profile read the same words in English. A bot the person
 * renamed keeps their words: only the stored defaults are swapped. */
const STORED_DEFAULTS = {
  title: new Set(["Bogues, idées, questions", "Bugs, ideas, questions"]),
  description: new Set([
    "Signalez un bogue, proposez une idée ou posez une question à l'équipe Sagax. / Report a bug, suggest an idea or ask the Sagax team a question.",
  ]),
};

interface SystemBotCopyInput {
  systemBot?: "feedback";
  title?: string;
  description?: string;
}

export function botTitleText(bot: SystemBotCopyInput): string {
  const stored = bot.title ?? "";
  return bot.systemBot === "feedback" && STORED_DEFAULTS.title.has(stored.trim()) ? t("systemBot.feedback.title") : stored;
}

export function botDescriptionText(bot: SystemBotCopyInput): string {
  const stored = bot.description ?? "";
  return bot.systemBot === "feedback" && STORED_DEFAULTS.description.has(stored.trim()) ? t("systemBot.feedback.description") : stored;
}
