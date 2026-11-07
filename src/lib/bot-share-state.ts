// How far the viewer's own bot reaches other people, for the mark after its
// name in the sidebar (#2615). "shared": the owner gave someone access to the
// bot itself (Bot settings > Sharing). "partial": nobody holds the bot, but
// it sits in a group with another person, so it talks with them there and
// only there. Shared wins. A bot someone else owns has neither: it wears its
// sharer's face instead (bot-sharer.ts).

export type BotShareState =
  | { kind: "shared" }
  | { kind: "partial"; count: number; names: string[] };

interface ShareBot {
  id: string;
  ownerUserId?: string;
  grants?: readonly unknown[];
  directGrants?: readonly unknown[];
}

interface ShareGroup {
  name: string;
  memberIds: readonly string[];
  humanIds?: readonly string[];
}

function principal(entry: string): string {
  const raw = entry.trim().toLowerCase();
  return raw.startsWith("user:") ? raw.slice(5) : raw;
}

export function botShareState(bot: ShareBot, groups: readonly ShareGroup[] | undefined, viewerId: string): BotShareState | null {
  const viewer = principal(viewerId);
  const owner = principal(bot.ownerUserId ?? "");
  if (owner && owner !== "local-owner" && owner !== viewer) return null;
  if ((bot.grants?.length ?? 0) > 0 || (bot.directGrants?.length ?? 0) > 0) return { kind: "shared" };
  const names = (groups ?? [])
    .filter((group) => (group.memberIds ?? []).includes(bot.id)
      && (group.humanIds ?? []).some((entry) => {
        const id = principal(entry);
        return Boolean(id) && id !== viewer && id !== owner;
      }))
    .map((group) => group.name.trim());
  return names.length ? { kind: "partial", count: names.length, names } : null;
}

/** Equal states draw the same mark: a store selector keeps the row still. */
export function sameBotShareState(a: BotShareState | null, b: BotShareState | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "shared" || (b.kind === "partial" && a.count === b.count && a.names.join("\n") === b.names.join("\n"));
}
