// The sidebar's lists once a person's hidden entries (src/lib/sidebar-hidden.ts)
// are applied, and the names Settings > Appearance lists them under.
import type { Bot, Group } from "@/state/store";
import { peopleDmPeer } from "@/lib/people-dm";
import { hiddenKey, type HiddenEntry } from "@/lib/sidebar-hidden";

/** The sidebar key of a group: a direct conversation with a person is
 * hidden as that person (it follows them), any other group by its id. */
export function groupHiddenKey(group: Group, viewerId: string): string {
  const peer = group.peopleDm ? peopleDmPeer(group, viewerId, new Map()) : null;
  return peer ? hiddenKey("person", peer.id) : hiddenKey("group", group.id);
}

/** The key of a closed direct conversation that selecting `selected` brings
 * back, or null (not a direct conversation, or not closed). */
export function closedDmToReopen(selected: Group | undefined, hidden: ReadonlySet<string>, viewerId: string): string | null {
  if (!selected?.peopleDm) return null;
  const key = groupHiddenKey(selected, viewerId);
  return key.startsWith("person:") && hidden.has(key) ? key : null;
}

/** What the sidebar lists once the person's hidden entries are left out.
 * Nothing is removed from the store: search, the command palette and the
 * To: picker still reach them. */
export function withoutHiddenEntries<B extends Bot, G extends Group>(bots: readonly B[], groups: readonly G[], hidden: ReadonlySet<string>, viewerId: string): { bots: B[]; groups: G[] } {
  if (hidden.size === 0) return { bots: [...bots], groups: [...groups] };
  return {
    bots: bots.filter((bot) => !hidden.has(hiddenKey("bot", bot.id))),
    groups: groups.filter((group) => !hidden.has(groupHiddenKey(group, viewerId))),
  };
}

/** The hidden entries as Settings > Appearance > Hidden from the sidebar
 * lists them: the bots and groups that still exist, with their names. A
 * closed person conversation is not listed. */
export function hiddenSidebarRows(
  items: readonly HiddenEntry[],
  input: { bots: readonly Bot[]; groups: readonly Group[]; viewerId: string; people: ReadonlyMap<string, { name: string; login: string }> },
): { key: string; kind: HiddenEntry["kind"]; id: string; name: string }[] {
  const rows: { key: string; kind: HiddenEntry["kind"]; id: string; name: string }[] = [];
  for (const item of items) {
    const key = hiddenKey(item.kind, item.id);
    if (item.kind === "bot") {
      const bot = input.bots.find((candidate) => candidate.id === item.id && !candidate.hidden);
      if (bot) rows.push({ key, kind: item.kind, id: item.id, name: bot.name });
    } else if (item.kind === "group") {
      const group = input.groups.find((candidate) => candidate.id === item.id);
      if (group) rows.push({ key, kind: item.kind, id: item.id, name: group.name });
    }
    // A closed direct conversation (kind "person") is simply gone from the
    // sidebar: no row here. Only bots and groups are listed as hidden.
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

