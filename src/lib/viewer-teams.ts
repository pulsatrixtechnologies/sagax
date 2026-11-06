// Team names a person may pick in Create team, New bot, managed teams and
// Share team (#2045). On an organization server the person's own sidebar
// sections are the only source; another member's team name on a shared bot
// never appears. On a solo server the server's sections stay the source.
import { viewerOwnsBot } from "./primary-bot";

export type ViewerTeamBot = {
  section?: string | undefined;
  hidden?: boolean | undefined;
  ownerUserId?: string | undefined;
};

export type ViewerTeamGroup = {
  section?: string | undefined;
};

/** Unique team labels this viewer may choose, in first-seen order. */
export function viewerOwnTeamNames(input: {
  orgMode: boolean;
  viewerId: string;
  /** The person's own sidebar section names (org mode). */
  personalNames?: readonly string[];
  /** Sections the server listed for this viewer. */
  serverSections?: readonly string[];
  bots: readonly ViewerTeamBot[];
  groups?: readonly ViewerTeamGroup[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string | undefined) => {
    const name = raw?.trim() ?? "";
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };

  if (input.orgMode) {
    for (const name of input.personalNames ?? []) add(name);
    // Own bots still filed on the server under a name the person has not
    // put in personal folders yet: offer that name so Create bot can keep it.
    for (const bot of input.bots) {
      if (bot.hidden || !viewerOwnsBot(bot, input.viewerId)) continue;
      add(bot.section);
    }
    return out;
  }

  for (const name of input.serverSections ?? []) add(name);
  for (const bot of input.bots) {
    if (bot.hidden) continue;
    add(bot.section);
  }
  for (const group of input.groups ?? []) add(group.section);
  return out;
}

/** Bots this viewer owns (and may file into their teams). */
export function viewerOwnBots<T extends ViewerTeamBot & { id: string }>(
  bots: readonly T[],
  viewerId: string,
): T[] {
  return bots.filter((bot) => !bot.hidden && viewerOwnsBot(bot, viewerId));
}
