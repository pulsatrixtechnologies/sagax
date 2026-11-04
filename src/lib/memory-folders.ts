// Which bot a folder of the Memory explorer belongs to (Tools > Memory,
// TIERS, 2026-11-03), so the row can say it and its menu can offer to
// delete a folder no bot is linked to.
//   - A bot's own memory is linked to that bot while it is a current bot:
//     the sources route lists only bots, and marks a temporary agent's
//     memory (create_agent, never listed with the bots) `linked: false`.
//   - A Perspicax folder `sagax-<bot>` is that bot's memory as
//     scripts/memory/import-local.py imports it (docs/memory.md): linked to
//     the bot of that name while it exists.
//   - A team section's folders (its built-in groups) belong to no bot; the
//     bots of the section read them, which the menu says.
// What uses a linked bot's memory: its routines, by name. Skills do not
// name a memory folder, so nothing is said about them.
import type { MemoryManagerSource } from "./memory-manager";

export interface LinkBot {
  id: string;
  name: string;
  color?: string;
  avatarUrl?: string | null;
  avatarCrop?: string;
  section?: string;
  hidden?: boolean;
}

export interface LinkRoutine {
  name: string;
  botId: string;
}

export interface FolderLink {
  /** The bots this folder is the memory of (empty: not linked). */
  bots: LinkBot[];
  /** The routines of those bots, by name. */
  routines: string[];
  /** Bots that read it without owning it (a team section's). */
  readBy: string[];
}

const UNLINKED: FolderLink = { bots: [], routines: [], readBy: [] };

function routinesOf(bots: LinkBot[], routines: LinkRoutine[]): string[] {
  const ids = new Set(bots.map((bot) => bot.id));
  return [...new Set(routines.filter((routine) => ids.has(routine.botId)).map((routine) => routine.name))];
}

/** A bot's memory folder (a bot source of the page). */
export function botSourceLink(source: MemoryManagerSource, bots: LinkBot[], routines: LinkRoutine[]): FolderLink {
  if (source.kind !== "bot" || source.linked === false) return UNLINKED;
  // The server lists only current bots the person reaches; the page's own list gives its look.
  const bot = bots.find((candidate) => candidate.id === source.botId) ?? { id: source.botId ?? source.id, name: source.name };
  return { bots: [bot], routines: routinesOf([bot], routines), readBy: [] };
}

function slug(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** A Perspicax folder: `sagax-<bot>` is that bot's imported memory. */
export function pxFolderLink(folder: string, bots: LinkBot[], routines: LinkRoutine[]): FolderLink {
  const match = /^sagax-(.+)$/.exec(folder);
  if (!match) return UNLINKED;
  const linked = bots.filter((bot) => !bot.hidden && (slug(bot.name) === match[1] || bot.id.toLowerCase() === match[1]));
  return linked.length ? { bots: linked, routines: routinesOf(linked, routines), readBy: [] } : UNLINKED;
}

/** A team section's folder: no bot owns it; the section's bots read it. */
export function teamFolderLink(section: string, bots: LinkBot[]): FolderLink {
  const readBy = bots.filter((bot) => !bot.hidden && (bot.section ?? "") === section).map((bot) => bot.name);
  return { bots: [], routines: [], readBy };
}

export function isLinked(link: FolderLink): boolean {
  return link.bots.length > 0;
}

/** The names a "Linked to" line shows, in order. */
export function botNames(link: FolderLink): string {
  return link.bots.map((bot) => bot.name).join(", ");
}
