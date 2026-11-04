// A teammate's live approval belongs to its execution thread, but the person
// must be able to answer it where they asked for the work. A linked card in
// that human conversation is only a view: every answer uses the original
// thread's owner, security key, rule and resolver checks.
import type { Coordinator } from "../runtime/coordinator-types.ts";
import type { Message, Store, StoreChange } from "../store.ts";

type RelayStore = Pick<Store, "onChange" | "messagesFor" | "appendMessage" | "patchMessage" | "isConfidentialThread">;

export function humanApprovalRoot(coordinator: Pick<Coordinator, "assignerOf" | "node">, threadId: string): string | undefined {
  const parent = coordinator.assignerOf(threadId);
  const root = parent && coordinator.node(parent.rootId);
  // Outside/background work has no human chat to route to. A room can have
  // several people reading it, so its existing approval route stays in use.
  return root?.origin?.kind === "user" && !root.groupId && root.threadId !== threadId ? root.threadId : undefined;
}

export interface OriginApprovalsDeps {
  store: RelayStore;
  rootFor(threadId: string): string | undefined;
  /** Rechecked on every copy and answer: same answerer, current read access,
   * existing threads and bot visibility. Never derives authority from text. */
  mayRelay(source: string, destination: string, message: Message): boolean;
  speaker(threadId: string): Message["from"];
}

const open = (card: Message["card"]) => Boolean(card?.requestId && !card.answered && !card.dismissed && !card.expired);

export function createOriginApprovals(deps: OriginApprovalsDeps) {
  const { store } = deps;
  const copying = new Set<string>();
  const linked = new Map<string, { source: string; threadId: string; messageId: string }>();
  const allowed = (source: string, destination: string, message: Message) => source !== destination
    && !store.isConfidentialThread(source) && !store.isConfidentialThread(destination)
    && deps.mayRelay(source, destination, message);

  const observe = (change: StoreChange) => {
    if (change.type === "thread.deleted") {
      for (const [key, link] of linked) {
        if (link.source !== change.threadId && link.threadId !== change.threadId) continue;
        linked.delete(key);
        if (link.source !== change.threadId) continue;
        const mirror = store.messagesFor(link.threadId).find(row => row.id === link.messageId);
        if (open(mirror?.card)) store.patchMessage(link.threadId, link.messageId, { card: { ...mirror!.card!, dismissed: true } });
      }
      return;
    }
    if (change.type !== "message" && change.type !== "message.patch") return;
    const { threadId, message } = change;
    const card = message.card;
    if (message.kind !== "options" || !card?.requestId || card.approvalOrigin) return;
    const key = `${threadId}:${message.id}`;
    if (copying.has(key)) return;
    const existing = card.approvalDestination;
    if (existing && open(card)) linked.set(key, { source: threadId, ...existing });
    else if (!open(card)) linked.delete(key);
    const destination = existing?.threadId ?? (open(card) ? deps.rootFor(threadId) : undefined);
    if (!destination) return;
    if (!allowed(threadId, destination, message)) {
      // A revoked route receives no later words or private names. Its old
      // view becomes inert; the original owner keeps the ordinary route.
      if (existing) {
        const mirror = store.messagesFor(destination).find(row => row.id === existing.messageId);
        if (open(mirror?.card)) store.patchMessage(destination, existing.messageId, { card: { ...mirror!.card!, dismissed: true } });
      }
      return;
    }
    const { approvalDestination: _destination, ...content } = card;
    // Provider request ids need not be unique across threads. The view has
    // its own address; its backlink retains the exact underlying call.
    const mirrored = { ...content, requestId: `origin:${message.id}`,
      ...(card.allowKey ? { allowKey: `origin:${message.id}` } : {}),
      approvalOrigin: { threadId, messageId: message.id, requestId: card.requestId, ...(card.allowKey ? { allowKey: card.allowKey } : {}) } };
    copying.add(key);
    try {
      if (existing) {
        const mirror = store.messagesFor(destination).find(row => row.id === existing.messageId);
        if (mirror?.card?.approvalOrigin?.threadId === threadId && mirror.card.approvalOrigin.messageId === message.id) {
          store.patchMessage(destination, mirror.id, { card: mirrored });
        }
        return;
      }
      // Recover a view committed before its source backlink (a cut write or
      // restart), rather than appending another card for the same call.
      const saved = store.messagesFor(destination).find(row => row.card?.approvalOrigin?.threadId === threadId && row.card.approvalOrigin.messageId === message.id);
      // full-access: exempt (linked view, the original card already holds the turn)
      const mirror = saved ? store.patchMessage(destination, saved.id, { card: mirrored })!
        : store.appendMessage(destination, { role: "bot", kind: "options", from: deps.speaker(threadId), card: mirrored });
      linked.set(key, { source: threadId, threadId: destination, messageId: mirror.id });
      store.patchMessage(threadId, message.id, { card: { ...card, approvalDestination: { threadId: destination, messageId: mirror.id } } });
    } finally {
      copying.delete(key);
    }
  };

  return {
    subscribe: () => store.onChange(observe),
    observe,
    /** null: ordinary card; false: stale/revoked view; otherwise the exact
     * execution address, before the existing respond pipeline runs. */
    sourceFor(threadId: string, requestId: string): { threadId: string; requestId: string } | false | null {
      const mirror = store.messagesFor(threadId).find(row => row.card?.requestId === requestId);
      const origin = mirror?.card?.approvalOrigin;
      if (!origin) return null;
      const original = store.messagesFor(origin.threadId).find(row => row.id === origin.messageId);
      if (!open(mirror.card) || !original || !allowed(origin.threadId, threadId, original)) return false;
      const destination = original?.card?.approvalDestination;
      return open(original?.card) && original!.card!.requestId === origin.requestId
        && destination?.threadId === threadId && destination.messageId === mirror.id
        ? { threadId: origin.threadId, requestId: origin.requestId } : false;
    },
  };
}
