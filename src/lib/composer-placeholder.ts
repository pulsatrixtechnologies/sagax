import { t } from "@/lib/i18n";

export interface ComposerPlaceholderInput {
  approval: boolean;
  /** A bot's question waits in the chat: answer it there or talk past it. */
  question?: boolean;
  attachmentPending: boolean;
  recording: boolean;
  /** The bot or room is working. */
  busy: boolean;
  /** A room or channel: its name, else this is a 1:1 chat. */
  groupName?: string;
  goalMode?: boolean;
  /** Lazy: only a room that is not working shows it. */
  groupHint?: () => string;
  botName: string;
}

/** What the empty composer says. A 1:1 chat names its bot, idle or working
 * ("Message <name>"): how Enter behaves then is shown by the chip or sheet
 * that appears on send, not by a long line in the placeholder.
 *
 * Measured Grok 0.78.1 HTML Pages (2026-10-31): visible placeholder stays
 * Message <botname> while a page is open. Source-derived j7O9JP "Message
 * about title" is the docked stage-chat aria-label, wired in Composer. */
export function composerPlaceholder(input: ComposerPlaceholderInput): string {
  if (input.approval) return t("composer.placeholder.approval");
  if (input.attachmentPending) return t("composer.placeholder.attaching");
  if (input.recording) return t("composer.placeholder.listening");
  if (input.question) return t("composer.placeholder.question");
  if (input.groupName === undefined) return botPlaceholder(input.botName);
  if (input.busy) return t("composer.placeholder.write");
  return input.goalMode
    ? t("composer.placeholder.goal", { name: input.groupName })
    : t("composer.placeholder.group", { name: input.groupName, hint: input.groupHint?.() ?? "" });
}

function botPlaceholder(name: string): string {
  return name.trim() ? t("composer.placeholder.bot", { name }) : t("composer.placeholder.write");
}
