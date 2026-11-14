// #4234: the widget a routine run drew for the person (show_widget) is
// drawn in the conversation the run reports to, at the run's row, and
// usable there. The run works in its own hidden task, so the widget row it
// wrote sits there, where nobody sees it and a press could not reach the
// person's conversation with the bot. When the run's row is written, its
// last open widget moves into that conversation (one copy: the hidden
// task's row is removed) and the run's card names it (`widgetId`). A press
// on it is then the person's own message to the bot in that conversation,
// on the route every widget press takes.
//
// Pure: server/index-leaves/syncRoutineRunToSource.ts hands in the store.
import type { WireMessage as Message } from "../../shared/wire.ts";

/** What moving a widget needs from the transcript store. */
export interface RoutineWidgetStore {
  messagesFor(threadId: string): Message[];
  appendMessage(threadId: string, message: Omit<Message, "id" | "at"> & { at?: number }): Message | null | undefined;
  removeMessage?(threadId: string, messageId: string): boolean;
}

/** A widget row the person has not answered yet. */
function openWidget(message: Message): boolean {
  return message.role === "bot" && message.kind === "widget" && Boolean(message.widget?.root) && !message.widget?.settled;
}

/** The widget row the run's card names in `conversationId`: the one it
 * already names when that row is still there, else the run's last open
 * widget moved there from its task `runThreadId`. Undefined when the run
 * drew none (or ran in the conversation itself, where its widget already
 * is). */
export function routineRunWidget(
  store: RoutineWidgetStore,
  input: { runThreadId?: string; conversationId: string; keptId?: string },
): string | undefined {
  const { runThreadId, conversationId, keptId } = input;
  if (keptId && store.messagesFor(conversationId).some((message) => message.id === keptId)) return keptId;
  if (!runThreadId || runThreadId === conversationId) return undefined;
  const drawn = store.messagesFor(runThreadId).findLast(openWidget);
  if (!drawn?.widget) return undefined;
  // a new row: its node ids are its own, so it starts at revision 0
  const { rev: _rev, ...tree } = drawn.widget;
  const moved = store.appendMessage(conversationId, { role: "bot", kind: "widget", text: drawn.text, widget: tree });
  if (!moved) return undefined;
  store.removeMessage?.(runThreadId, drawn.id);
  return moved.id;
}

/** #4234: a routine run's form answered or skipped away from its row (an AI
 * client, as the person: their words went to the bot, or a skip): the row
 * is drawn answered with those words, and it waits on no one any more.
 * False when it is not an open form. */
export function settleRoutineForm(
  patch: (messageId: string, widget: NonNullable<Message["widget"]>) => void,
  message: Pick<Message, "id" | "kind" | "widget">,
  settled: { label: string; skipped: boolean; at: number },
): boolean {
  if (!openWidget({ role: "bot", ...message } as Message)) return false;
  patch(message.id, { ...message.widget!, settled: { ref: "", label: settled.label, tone: settled.skipped ? "cancel" : "submit", at: settled.at } });
  return true;
}
