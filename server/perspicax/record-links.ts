// Record links in a bot's words (#4507), the two halves around a turn:
//
// 1. During the turn, the Perspicax relay hands every tool result that names
//    records (`_meta["pulsatrix/records"]`) to `onRecords`: the records of a
//    product and kind the person's product list describes are kept for the
//    conversation (server/perspicax/seen-records.ts) and the result gains
//    one line with the ready-made link, so the bot only copies it. Nothing
//    goes into the system prompt or a tool description.
// 2. When the bot's message is final, `finishReply` turns a record link that
//    does not parse into its text, and links a plain number the
//    conversation's tool results hold for exactly one kind (records kept
//    only when the person's product list described their kind).
//
// The product list is the person's own (read as them, kept 30 s by
// server/perspicax/person-products.ts); the kinds it last listed are kept
// here so the end of a turn reads them without a call. No product and no
// kind is named in this file.
import type { PersonProduct } from "../../shared/person-products.ts";
import { linkSeenRecords, recordKindKey, recordsNote, unlinkUnknownRecords, type RecordKindInfo, type RecordsMetaGroup, type RecordRef } from "../../shared/record-cards.ts";
import type { SeenRecords } from "./seen-records.ts";

/** The most persons whose kinds are kept. */
const KNOWN_PERSONS_MAX = 2_000;

export interface RecordLinksDeps {
  seen: SeenRecords;
  /** The person's product list, or null when it cannot be read now. */
  products(principalId: string): Promise<PersonProduct[] | null>;
}

export interface RecordLinks {
  /** The relay's hook (PerspicaxMcpOptions.onRecords). */
  onRecords(turn: { threadId: string; generation: string; principalId: string }, groups: RecordsMetaGroup[]): Promise<string | null>;
  /** The person's product list as last read: its kinds are what links. */
  noteProducts(principalId: string, products: readonly PersonProduct[]): void;
  /** A bot's final message, its record links checked and its plain numbers
   * linked from the records the turn's own person read in this conversation. */
  finishReply(text: string, principalId: string | null | undefined, threadId: string): string;
}

export function createRecordLinks(deps: RecordLinksDeps): RecordLinks {
  const known = new Map<string, Map<string, RecordKindInfo>>();
  const noteProducts = (principalId: string, products: readonly PersonProduct[]) => {
    const kinds = new Map<string, RecordKindInfo>();
    for (const product of products) for (const kind of product.records ?? []) kinds.set(recordKindKey(product.id, kind.kind), kind);
    known.delete(principalId);
    known.set(principalId, kinds);
    while (known.size > KNOWN_PERSONS_MAX) known.delete(known.keys().next().value!);
  };
  const knows = (principalId: string) => {
    const kinds = known.get(principalId);
    return (ref: Pick<RecordRef, "product" | "kind">) => Boolean(kinds?.has(recordKindKey(ref.product, ref.kind)));
  };
  return {
    noteProducts,
    async onRecords(turn, groups) {
      const products = await deps.products(turn.principalId);
      if (products) noteProducts(turn.principalId, products);
      const isKnown = knows(turn.principalId);
      const kept = groups.filter(isKnown);
      if (!kept.length) return null;
      deps.seen.add(turn.principalId, turn.threadId, kept);
      return recordsNote(kept, (group) => deps.seen.firstSeveral(turn.threadId, turn.generation, group), () => deps.seen.firstSentence(turn.threadId, turn.generation));
    },
    finishReply(text, principalId, threadId) {
      if (!text) return text;
      // only a link that does not parse becomes its text: one whose product
      // or kind the person's list does not hold still draws, and its card says why
      const checked = unlinkUnknownRecords(text, () => true);
      const seen = principalId ? deps.seen.of(principalId, threadId) : [];
      if (!seen.length) return checked;
      const kinds = known.get(principalId!);
      return linkSeenRecords(checked, seen, (product, kind) => {
        const info = kinds?.get(recordKindKey(product, kind));
        return info ? [info.name.en, info.name.fr, info.plural?.en, info.plural?.fr].filter((name): name is string => Boolean(name)) : [];
      });
    },
  };
}
