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
  /** The bot's role (its title), said after the name as the sidebar, the
   * chat header's pill and the bot panel say it. */
  botTitle?: string;
}

/** What the empty composer says. A 1:1 chat names its bot and its role, idle
 * or working ("Message <name> · <role>", the reference's form, #4152; the
 * name alone when the bot has no role): how Enter behaves then is shown by
 * the chip or sheet that appears on send, not by a long line in the
 * placeholder.
 *
 * Measured Grok 0.78.1 HTML Pages (2026-10-31): visible placeholder stays
 * Message <botname> while a page is open. Source-derived j7O9JP "Message
 * about title" is the docked stage-chat aria-label, wired in Composer. */
export function composerPlaceholder(input: ComposerPlaceholderInput): string {
  if (input.approval) return t("composer.placeholder.approval");
  if (input.attachmentPending) return t("composer.placeholder.attaching");
  if (input.recording) return t("composer.placeholder.listening");
  if (input.question) return t("composer.placeholder.question");
  if (input.groupName === undefined) return botPlaceholder(input.botName, input.botTitle);
  if (input.busy) return t("composer.placeholder.write");
  return input.goalMode
    ? t("composer.placeholder.goal", { name: input.groupName })
    : t("composer.placeholder.group", { name: input.groupName, hint: input.groupHint?.() ?? "" });
}

/** "Name · Role" on one line, the form the sidebar's rows and the chat
 * header's pill draw; the name alone without a role. */
export function botNameAndTitle(name: string, title?: string): string {
  const role = title?.trim();
  return role ? `${name} · ${role}` : name;
}

function botPlaceholder(name: string, title?: string): string {
  return name.trim() ? t("composer.placeholder.bot", { name: botNameAndTitle(name.trim(), title) }) : t("composer.placeholder.write");
}
