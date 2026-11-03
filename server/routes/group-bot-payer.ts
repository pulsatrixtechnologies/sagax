// #1137: a group's override of who pays for one of its bots' replies
// (shared/turn-payer.ts), edited in the group panel.
//
//   PUT /api/groups/:id/bot-payer { botId, turnPayer: "owner" | "speaker" | null }
//       -> { group }   (null goes back to the bot's own choice)
//
// Who: the bot's owner (it is their bot's money, whoever owns the group), or
// an admin. The bot must be in the group. Every change is one row in the
// admin activity log. Member scope: request-auth.ts CLIENT_ALLOW lists the
// path; the handler decides.
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { TurnPayerMode } from "../../shared/turn-payer.ts";
import { PASS, type RouteHandler } from "./table.ts";

const PATH = /^\/api\/groups\/([\w-]+)\/bot-payer$/;

const body = z.object({
  botId: z.string().trim().min(1).max(200).regex(/^[\w-]+$/),
  turnPayer: z.enum(["owner", "speaker"]).nullable(),
}).strict();

export interface GroupBotPayerGroup {
  id: string;
  name?: string;
  dm?: boolean;
  peopleDm?: boolean;
  memberIds: string[];
  botPayers?: Record<string, TurnPayerMode>;
}

export interface GroupBotPayerRouteDeps {
  /** Organization server only: a solo server has one payer. */
  organization(): boolean;
  group(id: string): GroupBotPayerGroup | null | undefined;
  bot(id: string): { id: string; name?: string } | null | undefined;
  /** The bot's owner (or an admin) may change who pays for it. */
  mayChoose(auth: RequestAuth, botId: string): boolean;
  /** Store the map (absent when empty) and tell the clients. */
  save(groupId: string, botPayers: Record<string, TurnPayerMode> | undefined): unknown;
  audit(auth: RequestAuth, req: IncomingMessage, detail: { group: { id: string; name?: string }; bot: { id: string; name?: string }; before: TurnPayerMode | null; after: TurnPayerMode | null }): void;
}

export function createGroupBotPayerRoutes(deps: GroupBotPayerRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = path.match(PATH);
    if (!match) return PASS;
    res.setHeader("cache-control", "no-store");
    if (method !== "PUT") return json(res, 405, { error: "PUT" });
    if (!deps.organization()) return json(res, 404, { error: "who pays is an organization server setting" });
    if (auth.kind === "loopback" && auth.trust === "service") return json(res, 403, { error: "forbidden" });
    const group = deps.group(match[1]!);
    if (!group || group.dm || group.peopleDm) return json(res, 404, { error: "no such room" });
    const parsed = body.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "botId and turnPayer (owner, speaker or null) required" });
    const { botId, turnPayer } = parsed.data;
    const bot = deps.bot(botId);
    if (!bot || !group.memberIds.includes(botId)) return json(res, 404, { error: "this bot is not in this group" });
    if (!deps.mayChoose(auth, botId)) return json(res, 403, { error: "forbidden: only the bot's owner can choose who pays for its replies", code: "bot_payer_owner_only" });
    const before = group.botPayers?.[botId] ?? null;
    const next: Record<string, TurnPayerMode> = { ...group.botPayers };
    if (turnPayer) next[botId] = turnPayer;
    else delete next[botId];
    const saved = deps.save(group.id, Object.keys(next).length ? next : undefined);
    if (before !== turnPayer) {
      deps.audit(auth, req, {
        group: { id: group.id, ...(group.name ? { name: group.name } : {}) },
        bot: { id: bot.id, ...(bot.name ? { name: bot.name } : {}) },
        before, after: turnPayer,
      });
    }
    return json(res, 200, { group: saved });
  };
}
