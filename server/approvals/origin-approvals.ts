// A teammate's live approval belongs to its execution thread, but the person
// must be able to answer it where they asked for the work. A linked card in
// that human conversation is only a view: every answer uses the original
// thread's owner, security key, rule and resolver checks.
import type { Coordinator, HandoffView } from "../runtime/coordinator-types.ts";
import type { Message, Store, StoreChange } from "../store.ts";

type RelayStore = Pick<Store, "onChange" | "messagesFor" | "appendMessage" | "patchMessage" | "isConfidentialThread">;

export function humanApprovalRoot(coordinator: Pick<Coordinator, "assignerOf" | "node"> & Partial<Pick<Coordinator, "active">>, threadId: string,
  humanRoomRequest: (root: HandoffView) => boolean = () => false, sourceBotId?: string): string | undefined {
  const parent = coordinator.assignerOf(threadId);
  // assignerOf covers direct work. A room's current speaker identifies its
  // exact running assignment, even when other bots also have queued work.
  const assignment = !parent && sourceBotId ? coordinator.active?.().find(row =>
    row.threadId === threadId && row.botId === sourceBotId && row.status === "running" && row.parentId) : undefined;
  const rootId = parent?.rootId ?? assignment?.rootId;
  const root = rootId ? coordinator.node(rootId) : undefined;
  // Room provenance stays separate from permission to act. Its exact human
  // request can prove where an approval belongs without granting anything.
  return root && (root.origin?.kind === "user" || Boolean(root.groupId && humanRoomRequest(root)))
    && root.threadId !== threadId ? root.threadId : undefined;
}

export interface OriginApprovalsDeps {
  store: RelayStore;
  rootFor(threadId: string, message: Message): string | undefined;
  /** Rechecked on every copy and answer: same answerer, current read access,
   * existing threads and bot visibility. Never derives authority from text. */
  mayRelay(source: string, destination: string, message: Message): boolean;
  speaker(threadId: string, message: Message): Message["from"];
  withdraw(threadId: string, requestId: string): void;
  /** #2901: provenance label of a view copied out of a background thread. */
  via?(threadId: string, message: Message): Message["relayVia"];
}

const open = (card: Message["card"]) => Boolean(card?.requestId && !card.answered && !card.dismissed && !card.expired);

export function createOriginApprovals(deps: OriginApprovalsDeps) {
  const { store } = deps;
  const copying = new Set<string>();
  const linked = new Map<string, { source: string; sourceMessageId: string; threadId: string; messageId: string; requestId: string }>();
  const allowed = (source: string, destination: string, message: Message) => source !== destination
    && !store.isConfidentialThread(source) && !store.isConfidentialThread(destination)
    && deps.mayRelay(source, destination, message);
  const detach = (threadId: string, message: Message) => {
    const key = `${threadId}:${message.id}`;
    const { approvalDestination: _destination, ...card } = message.card!;
    linked.delete(key);
    copying.add(key);
    try { store.patchMessage(threadId, message.id, { card }); }
    finally { copying.delete(key); }
  };

  const observe = (change: StoreChange) => {
    if (change.type === "thread.deleted") {
      for (const [key, link] of linked) {
        if (link.source !== change.threadId && link.threadId !== change.threadId) continue;
        linked.delete(key);
        deps.withdraw(link.threadId, link.requestId);
        if (link.source !== change.threadId) {
          const source = store.messagesFor(link.source).find(row => row.id === link.sourceMessageId);
          if (source?.card?.approvalDestination?.threadId === change.threadId) {
            detach(link.source, source);
          }
          continue;
        }
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
    if (existing && open(card)) linked.set(key, { source: threadId, sourceMessageId: message.id, ...existing, requestId: `origin:${message.id}` });
    else if (!open(card)) linked.delete(key);
    const destination = existing?.threadId ?? (open(card) ? deps.rootFor(threadId, message) : undefined);
    if (!destination) return;
    if (!allowed(threadId, destination, message)) {
      // A revoked route receives no later words or private names. Its old
      // view becomes inert; the original owner keeps the ordinary route.
      if (existing) {
        deps.withdraw(destination, `origin:${message.id}`);
        const mirror = store.messagesFor(destination).find(row => row.id === existing.messageId);
        if (open(mirror?.card)) store.patchMessage(destination, existing.messageId, { card: { ...mirror!.card!, dismissed: true } });
        // Also repairs a deletion interrupted before this observer ran.
        detach(threadId, message);
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
      // #2915: the label is read once per copy
      const via = saved ? undefined : deps.via?.(threadId, message);
      const mirror = saved ? store.patchMessage(destination, saved.id, { card: mirrored })!
        : store.appendMessage(destination, { role: "bot", kind: "options", from: deps.speaker(threadId, message), card: mirrored,
          ...(via ? { relayVia: via } : {}) });
      linked.set(key, { source: threadId, sourceMessageId: message.id, threadId: destination, messageId: mirror.id, requestId: mirrored.requestId });
      store.patchMessage(threadId, message.id, { card: { ...card, approvalDestination: { threadId: destination, messageId: mirror.id } } });
    } finally {
      copying.delete(key);
    }
  };

  return {
    subscribe: () => store.onChange(observe),
    observe,
    /** Re-read after asynchronous review: a deleted/revoked view must never
     * receive a late notification, and the original remains the fallback. */
    notificationFor(threadId: string, messageId: string): { threadId: string; requestId: string } | undefined {
      const source = store.messagesFor(threadId).find(row => row.id === messageId);
      if (!source || !open(source.card)) return undefined;
      const destination = source.card!.approvalDestination;
      const mirror = destination && store.messagesFor(destination.threadId).find(row => row.id === destination.messageId);
      return destination && mirror?.card?.requestId && open(mirror.card)
        && mirror.card.approvalOrigin?.threadId === threadId && mirror.card.approvalOrigin.messageId === messageId
        && allowed(threadId, destination.threadId, source)
        ? { threadId: destination.threadId, requestId: mirror.card.requestId }
        : { threadId, requestId: source.card!.requestId! };
    },
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
