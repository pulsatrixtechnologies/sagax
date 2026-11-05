import type { Bot, Group, Message } from "@/state/store";
import type { RoomMentionPerson } from "@/lib/person-mentions";
import type { ComposerSendSnapshot } from "@/lib/drafts";

export type MentionChoice = { id: string; name: string; bot?: Bot; person?: RoomMentionPerson; all?: true };

export interface ComposerDraftSnapshot extends ComposerSendSnapshot {
  reply: Message | null;
}

export type ComposerProps = {
  bot?: Bot;
  group?: Group;
  members?: Bot[];
  onEditLast?: () => void;
  /** The other person, only on a person-to-person conversation. */
  /** `threadId`: the person conversation's thread on screen (the nudge line goes there). */
  nudgePeer?: { id: string; name: string; threadId?: string } | null;
  /** The group chat, when it names someone other than the viewer. */
  nudgeGroup?: { id: string; name: string } | null;
  replyTo?: Message | null;
  onClearReply?: () => void;
  onConsumeReply?: () => void;
  onRestoreReply?: (message: Message, threadId: string) => void;
  /** Title of the page this composer is docked on (stage chat, lot 5): its
   * accessible name becomes "Message about <title>"; the visible
   * placeholder keeps naming the bot (measured Grok). */
  aboutPage?: string;
  /** False when the conversation gives focus back elsewhere as this composer
   * mounts (ChatView after a page closes: back to what opened the page). */
  focusOnOpen?: boolean;
  /** #2013: send the conversation's last message again (the composer
   * line's Try again and Fix after an engine refused the turn). */
  onRetryLast?: () => void;
};
