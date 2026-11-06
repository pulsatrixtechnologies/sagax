export type PeerAction = "ask_bot" | "delegate_bot" | "post_to_room" | "message_person";

/** Stable persisted grant for one peer action and one target — a bot for
 * the two peer actions, the room for post_to_room, the person for
 * message_person (#2118). */
export function peerAllowKey(action: PeerAction, targetId: string): string {
  return `${action}:${targetId}`;
}
