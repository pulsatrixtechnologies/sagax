import type { ComputerHelpRef } from "../../shared/wire";
import { api } from "@/state/store";

/** Done or Cancel on a sign-in card, from the card in the chat or the
 * Computer panel's banner: the server hands back what the person held for
 * it and resumes the bot (server/index.ts settleSignIn). A computer's live
 * desktop, opened to sign in, closes with it. */
export async function answerSignIn(ref: Pick<ComputerHelpRef, "botId" | "threadId" | "messageId" | "place">, answer: "done" | "cancel"): Promise<void> {
  await api(`/api/bots/${encodeURIComponent(ref.botId)}/sign-in-cards/${encodeURIComponent(ref.messageId)}/${answer}`, {
    method: "POST",
    body: JSON.stringify({ threadId: ref.threadId }),
  });
  if (ref.place === "vm" || ref.place === "cloud") void window.ogb?.desktopViewer?.close(ref.botId).catch(() => false);
}

/** "This computer" is the person's own only in the desktop app that runs
 * the bots; a browser tab, a Cloud home or a desktop paired to another host
 * shows a computer somewhere else. */
export function signInHostIsHere(): boolean {
  return Boolean(window.ogb) && window.ogb?.remoteClient?.active !== true;
}
