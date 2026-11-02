// Cloud-home conversation refusals. Personal Cloud home is gone (#1388 wave
// 0a); these always return null. Kept as a shared leaf so the bot/thread
// route slices (B1, B3, P4 and peers) import one place instead of copying
// the stubs. Never import index.ts from here.
import type { RequestAuth } from "./request-auth.ts";

/** Why this request may not act on a conversation, or null. Always null
 * outside a Cloud home (removed). */
export function cloudThreadRefusal(auth: RequestAuth, threadId: string): string | null {
  void auth;
  void threadId;
  return null;
}

/** Why a paired guest may not send into a conversation, or null. Always
 * null outside a Cloud home (removed). */
export function cloudGuestSendRefusal(auth: RequestAuth, threadId: string): string | null {
  void auth;
  void threadId;
  return null;
}
