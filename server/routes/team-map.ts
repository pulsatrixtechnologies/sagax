// Live Team Map metadata (#1388 slice P1). Prompts and replies never leave
// their transcripts: this projection carries only ids, status relationships,
// optional delegation labels, and timestamps.
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface TeamMapBot {
  id: string;
  hidden?: boolean;
}

export interface TeamMapGroup {
  id: string;
  dm?: boolean;
  memberIds: string[];
  threadId: string;
  createdAt: number;
}

export interface TeamMapDelegationWatch {
  toBotId: string;
  channelId?: string;
  sourceBotId?: string;
}

export interface TeamMapHandoffEdge {
  state: "queued" | "running";
  sourceBotId: string;
  targetBotId: string;
  threadId: string;
  groupId?: string;
}

export interface TeamMapVisible {
  bot(id: string): boolean;
  group(id: string): boolean;
}

export interface TeamMapRouteDeps {
  bots(): readonly TeamMapBot[];
  groups(): readonly TeamMapGroup[];
  messagesFor(threadId: string): readonly { at?: number }[];
  group(id: string): TeamMapGroup | undefined;
  /** Request-scoped visibility (same filter handleRequest applied). */
  visibleFor(auth: RequestAuth): TeamMapVisible;
  delegationWatchEntries(): IterableIterator<[string, TeamMapDelegationWatch]>;
  liveHandoffEdges(): readonly TeamMapHandoffEdge[];
}

export function createTeamMapRoutes(deps: TeamMapRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    if (!(method === "GET" && path === "/api/team-map")) return PASS;

    const visible = deps.visibleFor(auth);
    const mapped = new Set(deps.bots().filter((bot) => !bot.hidden && visible.bot(bot.id)).map((bot) => bot.id));
    const collaborations = deps.groups()
      .filter(
        (group) =>
          group.dm === true &&
          group.memberIds.length === 2 &&
          group.memberIds.every((botId) => mapped.has(botId)),
      )
      .map((group) => ({
        groupId: group.id,
        botIds: [group.memberIds[0], group.memberIds[1]] as [string, string],
        lastAt: deps.messagesFor(group.threadId).at(-1)?.at ?? group.createdAt,
      }))
      .sort((a, b) => b.lastAt - a.lastAt);
    const running = [...deps.delegationWatchEntries()].flatMap(([threadId, watch]) => {
      if (!mapped.has(watch.toBotId)) return [];
      const channel = watch.channelId ? deps.group(watch.channelId) : undefined;
      const sourceBotId = watch.sourceBotId ??
        channel?.memberIds.find((botId) => botId !== watch.toBotId);
      if (!sourceBotId || !mapped.has(sourceBotId)) return [];
      return [{ sourceBotId, targetBotId: watch.toBotId, threadId, groupId: channel?.id }];
    });
    // Work sent with coordinate_bots lives in the room handoff tree, not in
    // the classic delegation queue above. Ids only, like everything here.
    const handoffs = deps.liveHandoffEdges()
      .filter((edge) =>
        mapped.has(edge.sourceBotId)
        && mapped.has(edge.targetBotId)
        && (!edge.groupId || visible.group(edge.groupId)));
    const links = (state: "queued" | "running") =>
      handoffs.flatMap(({ state: edgeState, ...link }) => edgeState === state ? [link] : []);
    return json(res, 200, {
      collaborations,
      queued: links("queued"),
      running: [...running, ...links("running")],
    });
  };
}
