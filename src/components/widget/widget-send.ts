// A press on a chat widget reaches the bot as the person's next message, on
// the route a typed message already uses: no new route and no store action.
// The server writes the message text from the widget, sends it as a reply to
// the widget row, and patches that row (a `message.patch` frame) when the
// press settles it. Nothing is drawn optimistically here.
import { api, type Message } from "@/state/store";
import type { WidgetValues } from "../../../shared/widget";

export interface WidgetPress {
  botId: string;
  threadId?: string;
  /** The widget row the press belongs to. */
  messageId: string;
  /** "confirm", "cancel", or the node id of the button or list item. */
  ref: string;
  /** The revision of the tree the press was made on (0 before any update_widget).
   * An update renumbers node ids, so the server refuses a press on an older one. */
  rev: number;
  /** The fields in the press's scope. Left out for `cancel`, which sends none. */
  values?: WidgetValues;
  /** Client identity for an at-most-once retry, as on a typed send. */
  sendId: string;
}

export type WidgetSendResult =
  | { ok: true; message?: Message; queued?: boolean }
  /** `refused` is the server saying no, in the sentence `error`. Without it
   * the request got no answer at all, and the same `sendId` may be sent again. */
  | { ok: false; refused: boolean; error?: string };

/** Minted the way the store mints one for a typed send. */
export const newWidgetSendId = (): string => crypto.randomUUID();

export async function sendWidgetAction(press: WidgetPress): Promise<WidgetSendResult> {
  try {
    const body = await api<{ message?: Message; queued?: boolean }>(`/api/bots/${press.botId}/messages`, {
      method: "POST",
      // no `text`: the server writes it from the widget and the pressed action
      body: JSON.stringify({
        threadId: press.threadId,
        sendId: press.sendId,
        widgetAction: { messageId: press.messageId, ref: press.ref, rev: press.rev, ...(press.values ? { values: press.values } : {}) },
      }),
    });
    // #4489: the press is already the person's message. Hand that row back
    // so the thread can show it as the card folds, not on a later frame.
    return { ok: true, ...(body?.message ? { message: body.message } : {}), ...(body?.queued ? { queued: true } : {}) };
  } catch (error) {
    // api() throws an ApiError that carries the status when the server answered
    const refused = typeof (error as { status?: unknown } | null)?.status === "number";
    return { ok: false, refused, ...(refused && error instanceof Error && error.message ? { error: error.message } : {}) };
  }
}
