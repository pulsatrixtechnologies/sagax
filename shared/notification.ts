/** The notification wire shape — what the harness decides is worth
 * interrupting someone for, emitted as the `notify` live frame. Single home
 * in shared/ so the server emitter and the client banner stack agree;
 * server/notify.ts re-exports under the historical name. */
export type NotifyKind =
  | "approval"
  | "question"
  | "done"
  | "routine-failed"
  | "routine-deferred"
  | "turn-failed"
  /** A run failed, stalled or could not start and no Primary Bot was
   * there to take it: the person is the one who has to look. */
  | "incident"
  | "takeover"
  /** A delegated room request settled and the coordinator auto-resumed with
   * the results. The delegated turn and the resume are both internal, so
   * without this frame the parent conversation can sit in silence for the
   * minutes a huge context takes to reach its first token. */
  | "delegation-settled"
  /** The workspace crossed its monthly spend warning or reached its cap.
   * Sent to admins only, at most once per month for each. */
  | "spend"
  /** A person wrote to another in a direct conversation between people
   * (server/people-dms.ts). Sent to the recipient only (`audience`); `botId` is empty. */
  | "message"
  /** An organization admin force-stopped or force-deleted a bot
   * (server/org-bot-force.ts). Sent to the bot's owner only (`audience`). */
  | "admin-action"
  /** Someone reported a message another person wrote (App Store 1.2,
   * server/moderation.ts). Sent to the organization's admins, or a solo
   * server's owner, only (`audience`); `botId` and `threadId` are empty. */
  | "report"
  /** Someone commented on, or replied on, a published page (2026-10-28,
   * Annotate). Sent to the page's person only (`audience`), never for their
   * own comment; opens the conversation the page came from. */
  | "page-comment"
  /** A wait_until condition fired: the person asked to be told when
   * something happened, and it did (server/waits.ts). */
  | "wait";

export interface Notification {
  kind: NotifyKind;
  botId: string;
  botName: string;
  threadId: string;
  title: string;
  body: string;
  /** The bot's stored profile image, when it has one; clients show it as
   * the OS notification's icon so every banner carries its bot's face. */
  avatarUrl?: string;
  /** The approval or question this is about: a tap opens its card, and the
   * banner is withdrawn once it is answered anywhere. */
  requestId?: string;
  /** The room this came out of, when the bot was speaking in one. Routing
   * already works off `threadId` alone; this is what lets a client say which
   * room, and stack a room's banners together instead of under the bot. */
  groupId?: string;
  /** Organization server: the only principals this notification reaches
   * (a refused turn's access card is private to its person). Absent: everyone
   * who sees the bot. */
  audience?: string[];
  /** Organization server: a routine run whose access card sits in another
   * person's private thread (the person it runs as) while this audience is
   * the bot's owner, who cannot read that thread. `threadId` is then empty
   * and the click opens this run in the bot's Coding activity, which shows
   * the same card to its audience only (server/routes/bot-activity.ts). */
  routineRunId?: string;
  /** A finished routine: the phone's banner can name it. */
  routineName?: string;
  /** Allow from the phone notification must open Sagax. This class needs
   * the person's security key. Absent means the lock-screen Allow may
   * answer in the background, after the phone itself has unlocked. */
  needsKey?: boolean;
  /** An approval's question in plain words, in the person's language
   * ("Publish version 2.4 to the team?"): the phone shows it first, under
   * the bot's name. Absent: `body` says it all. */
  ask?: string;
  /** A question's own choices, in order: the phone offers them as the
   * banner's buttons (up to its limit; past it, Open). */
  choices?: string[];
  /** Never on a phone or a watch (2026-10-29): a conversation an AI client
   * holds with a bot over MCP (shared/agent-conversation.ts) or a hidden
   * one (#291). The client that asked reads the answer and the approval;
   * the desktop still shows it. */
  quietOnPhones?: boolean;
}

