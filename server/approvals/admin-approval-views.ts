// #4451: an approval that waits on the organization reaches each admin as a
// card in their conversation with their Primary Bot. The card is a view of
// the member's card, like a teammate's view (./origin-approvals.ts): its
// answer resolves to the original card, where the existing admin check
// (adminApprovalCheck) decides. One view per admin and per waiting card;
// the first answer settles the original, and every view follows it.
//
// The list of what waits is the one Settings > Organization reads
// (pendingAdminApprovals), so the row and the cards always agree. Views are
// reconciled from that list, not tracked in memory: a restart, a deleted
// conversation or an admin who lost the role all converge on the next pass.
import type { Message, Store } from "../store.ts";
import { redactSecretsInText } from "../redact.ts";

type ViewStore = Pick<Store, "appendMessage" | "patchMessage" | "isConfidentialThread">;
type Card = NonNullable<Message["card"]>;

/** A card that waits on an organization admin, with who it is for. */
export interface AdminApprovalSource {
  threadId: string;
  message: Message;
  botId: string;
  botName: string;
  /** The person whose turn asked, else the bot's owner. */
  personName?: string;
}

export interface AdminApprovalViewsDeps {
  store: ViewStore;
  /** Only an organization server has admin cards. */
  enabled(): boolean;
  /** The open admin cards: the rows of Settings > Organization. */
  sources(): AdminApprovalSource[];
  /** Every open request card row of the server (views among them). */
  openRows(): Array<{ threadId: string; message: Message }>;
  message(threadId: string, messageId: string): Message | undefined;
  /** The organization admins (principal ids), active ones only. */
  admins(): string[];
  /** The admin's conversation with their Primary Bot; opened when `start`. */
  home(principalId: string, start: boolean): string | null;
  speaker(threadId: string, message: Message): Message["from"];
  withdraw(threadId: string, requestId: string): void;
  /** Called on every change of a person's organization role: a new admin
   * gets the waiting cards right away, a former one loses them. */
  onAdminsChanged?(listener: () => void): void;
}

const open = (card: Card | undefined) => Boolean(card?.requestId && !card.answered && !card.dismissed && !card.expired);
export const ADMIN_VIEW_PREFIX = "admin:";

/** Addresses and names the answer resolves by: never rewritten. */
const ADDRESS_KEYS = new Set(["requestId", "allowKey", "approvalOrigin", "tool", "mcpTool", "requestType", "providerInstanceId"]);
/** Every text of the member's card through the same masking as the
 * Settings > Organization row (pendingAdminApprovals): the title, the
 * command line, the plain words, the rules and the Details (toolInput).
 * The answer resolves to the original card, so its rules stay whole there. */
function masked<T>(value: T, key?: string): T {
  if (key && ADDRESS_KEYS.has(key)) return value;
  if (typeof value === "string") return redactSecretsInText(value) as T;
  if (Array.isArray(value)) return value.map((item) => masked(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, masked(item, name)])) as T;
  }
  return value;
}

/** The view's card: the original card at its own address, with a backlink,
 * its texts masked (#4451 review: a token in a command never reaches the admins). */
export function adminViewCard(threadId: string, message: Message): Card {
  const card = message.card!;
  const { approvalDestination: _destination, adminNames: _names, ...content } = card;
  return {
    ...masked(content),
    requestId: `${ADMIN_VIEW_PREFIX}${message.id}`,
    ...(card.allowKey ? { allowKey: `${ADMIN_VIEW_PREFIX}${message.id}` } : {}),
    approvalOrigin: { threadId, messageId: message.id, requestId: card.requestId!, ...(card.allowKey ? { allowKey: card.allowKey } : {}), admin: true },
  };
}

export function createAdminApprovalViews(deps: AdminApprovalViewsDeps) {
  const { store } = deps;
  let timer: NodeJS.Timeout | null = null;

  /** A view whose card left the queue: it shows how the original ended
   * (answered, expired), else it is dismissed. */
  const close = (threadId: string, view: Message) => {
    const origin = view.card!.approvalOrigin!;
    const original = deps.message(origin.threadId, origin.messageId);
    const settled = original?.card && !open(original.card) && original.card.requestId === origin.requestId;
    const card = settled ? { ...adminViewCard(origin.threadId, original!), approvalOrigin: origin } : { ...view.card!, dismissed: true };
    deps.withdraw(threadId, view.card!.requestId!);
    store.patchMessage(threadId, view.id, { card });
  };

  const reconcile = () => {
    if (!deps.enabled()) return;
    const sources = deps.sources().filter((source) => !store.isConfidentialThread(source.threadId) && open(source.message.card));
    const bySource = new Map(sources.map((source) => [`${source.threadId}:${source.message.id}`, source]));
    const homes = new Set<string>();
    for (const admin of deps.admins()) {
      const home = deps.home(admin, sources.length > 0);
      if (home && !store.isConfidentialThread(home)) homes.add(home);
    }
    const shown = new Set<string>();
    for (const { threadId, message } of deps.openRows()) {
      const origin = message.card?.approvalOrigin;
      if (!origin?.admin || !open(message.card)) continue;
      const key = `${origin.threadId}:${origin.messageId}`;
      const source = bySource.get(key);
      // not an admin's home any more, no longer waiting, or a second copy
      if (!source || !homes.has(threadId) || shown.has(`${threadId}|${key}`)) {
        close(threadId, message);
        continue;
      }
      shown.add(`${threadId}|${key}`);
      const card = adminViewCard(source.threadId, source.message);
      if (JSON.stringify(card) !== JSON.stringify(message.card)) store.patchMessage(threadId, message.id, { card });
    }
    for (const source of sources) {
      const key = `${source.threadId}:${source.message.id}`;
      for (const home of homes) {
        if (home === source.threadId || shown.has(`${home}|${key}`)) continue;
        shown.add(`${home}|${key}`);
        // full-access: exempt (an admin's view, the original card already holds the turn)
        store.appendMessage(home, {
          role: "bot", kind: "options", from: deps.speaker(source.threadId, source.message),
          card: adminViewCard(source.threadId, source.message),
          relayVia: "organization",
          relayAsk: { text: "", by: source.botName, botId: source.botId, ...(source.personName ? { for: source.personName } : {}) },
        });
      }
    }
  };

  /** Debounced: a burst of changes is one pass. */
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; reconcile(); }, 50);
    timer.unref?.();
  };
  deps.onAdminsChanged?.(schedule);

  return { reconcile, schedule };
}
