// @ts-nocheck
/** notify (#1388). Pure move from server/index.ts. */
import { quietForCall } from "../notify.ts";
import { CONFIDENTIAL_NOTICE_BODY } from "../threads/confidential-threads.ts";
export type Host = Record<string, any>;

export function createNotify(getHost: () => Host): any {
function notify(notification: Notification | null) {
  const host = getHost();

  // A confidential thread's notice says only that much: its words never
  // reach a lock screen, a push relay or a notification centre.
  if (notification && host.store.isConfidentialThread(notification.threadId)) notification = { ...notification, body: CONFIDENTIAL_NOTICE_BODY };
  // An AI client's hidden conversation (#291) never buzzes the person: the
  // client that started it reads the answer. An approval is the exception:
  // only the person can give it, and the conversation is in no sidebar.
  // 2026-11-03: so is a question (a routine run's ask_choice, in its hidden
  // task): dropped here, it reached nobody.
  if (notification && notification.kind !== "approval" && notification.kind !== "question" && host.notificationInHiddenThread(notification.threadId)) return;
  // a bot-to-bot thread never buzzes the person for its own replies
  if (notification && host.notificationIsInterBotChatter(notification)) return;
  // 2026-10-29: an outside agent's conversation (a person's AI client over
  // MCP) is silent for the person, but for what only they can answer
  if (notification && host.notificationInAgentConversation(notification)) return;
  // Routine and MCP decisions reach the person on every device (#1984).
  if (notification && host.notificationQuietOnPhones(notification)) notification = { ...notification, quietOnPhones: true };
  // the conversation on a live voice call is heard, not buzzed (notify.ts)
  if (notification && quietForCall(notification, host.lastPersonMessage(notification.threadId), Date.now(), Boolean(host.voiceCalls.active(notification.threadId)))) return;
  if (notification && host.QUIET_TURN_NEWS.has(notification.kind) && host.quietTurnThreads.has(notification.threadId)) return;
  // nested rather than spread — the frame's own `kind` names the frame,
  // exactly like {kind:"message", message} and {kind:"bot", bot}
  if (notification) host.broadcast({ kind: "notify", notification });

}
  return notify;
}
