// Seen records (#4507): the records a conversation's tool results named
// (`_meta["pulsatrix/records"]`, read by the Perspicax relay), per person
// and conversation. Ids and labels only, never a record's content. Read by
// one thing: the end of a bot's turn, which links a plain number of its
// message when that exact id was seen for exactly one kind
// (shared/record-cards.ts linkSeenRecords). Kept in memory: at most
// SEEN_RECORDS_PER_CONVERSATION per conversation (oldest dropped) and
// SEEN_RECORDS_CONVERSATIONS conversations (least recently fed dropped).
//
// It also says whether a turn already had the "several records" line for a
// kind, so a turn that lists the same kind again reads it once.
import { recordKey, recordKindKey, type RecordsMetaGroup, type SeenRecord } from "../../shared/record-cards.ts";

export const SEEN_RECORDS_PER_CONVERSATION = 500;
export const SEEN_RECORDS_CONVERSATIONS = 2_000;
const TURNS_NOTED_MAX = 4_000;

export class SeenRecords {
  private readonly conversations = new Map<string, Map<string, SeenRecord>>();
  private readonly severalNoted = new Map<string, Set<string>>();

  private static key(principalId: string, threadId: string): string {
    return `${principalId}\u0001${threadId}`;
  }

  /** Remember the records one tool result named. */
  add(principalId: string, threadId: string, groups: readonly RecordsMetaGroup[]): void {
    if (!principalId || !threadId || !groups.length) return;
    const key = SeenRecords.key(principalId, threadId);
    const seen = this.conversations.get(key) ?? new Map<string, SeenRecord>();
    this.conversations.delete(key);
    this.conversations.set(key, seen);
    for (const group of groups) {
      for (const item of group.records) {
        const ref: SeenRecord = { product: group.product, kind: group.kind, id: item.id, label: item.label };
        const id = recordKey(ref);
        seen.delete(id);
        seen.set(id, ref);
      }
    }
    while (seen.size > SEEN_RECORDS_PER_CONVERSATION) seen.delete(seen.keys().next().value!);
    while (this.conversations.size > SEEN_RECORDS_CONVERSATIONS) this.conversations.delete(this.conversations.keys().next().value!);
  }

  /** The records this person's conversation saw, oldest first. */
  of(principalId: string, threadId: string): SeenRecord[] {
    return [...(this.conversations.get(SeenRecords.key(principalId, threadId))?.values() ?? [])];
  }

  /** True the first time a turn asks for this kind's "several" line. */
  firstSeveral(threadId: string, generation: string, group: Pick<RecordsMetaGroup, "product" | "kind">): boolean {
    const turn = `${threadId}\u0001${generation}`;
    const noted = this.severalNoted.get(turn) ?? new Set<string>();
    if (!this.severalNoted.has(turn)) {
      this.severalNoted.set(turn, noted);
      while (this.severalNoted.size > TURNS_NOTED_MAX) this.severalNoted.delete(this.severalNoted.keys().next().value!);
    }
    const kind = recordKindKey(group.product, group.kind);
    if (noted.has(kind)) return false;
    noted.add(kind);
    return true;
  }

  /** A deleted conversation forgets what it saw. */
  forgetThread(threadId: string): void {
    const suffix = `\u0001${threadId}`;
    for (const key of this.conversations.keys()) if (key.endsWith(suffix)) this.conversations.delete(key);
  }
}
