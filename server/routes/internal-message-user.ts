// POST /api/internal/message-user (#2118): a bot writes to one person of the
// organization. It posts in the group whose people are exactly its owner and
// that person, with the bot in it; the group is created when it does not
// exist yet. The person answers there, where the bot is a member, so their
// reply reaches it as in any group.
//
// Answers only behind the per-turn capability the internal block of
// server/index.ts checks first. Approval is the tool's own (the person's
// level and rules, member-tool-scope "own-account"); nothing extra here.
// This module never imports index.ts.
import { botPersonGroupName, findBotPersonGroup, resolveReachablePerson, type BotPersonGroupCandidate, type ReachablePerson } from "../people/bot-message-user.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

const MESSAGE_MAX_CHARS = 4_000;

export interface MessageUserBot {
  id: string;
  name: string;
  color: string;
  hidden?: boolean;
}

export interface MessageUserGroup extends BotPersonGroupCandidate {
  name: string;
  threadId: string;
  unreadFor?: string[];
}

export interface MessageUserStore {
  bot(id: string): MessageUserBot | null | undefined;
  readonly groups: readonly MessageUserGroup[];
  createGroup(
    name: string,
    memberIds: string[],
    dm: boolean,
    section: string | undefined,
    setup: { defaultResponder: { kind: "member"; botId: string } },
    humanIds: string[],
    extra: { createdBy: string },
  ): MessageUserGroup;
  patchGroup(groupId: string, patch: { unread?: boolean; unreadFor?: string[] }): MessageUserGroup | null | undefined;
  appendMessage(threadId: string, message: Record<string, unknown>): { id: string };
}

export interface MessageUserNotice {
  bot: MessageUserBot;
  group: MessageUserGroup;
  text: string;
  audience: string[];
  /** False when the bot chose to post without alerting (message_user `notify`). */
  notify?: boolean;
}

export interface MessageUserDeps {
  store: MessageUserStore;
  /** The bot's conversation this turn speaks in, null when it is not the bot's. */
  connectorThread(botId: string, threadId: string): { group?: { id: string } } | null;
  /** The person the bot works for (principal id). */
  ownerOf(bot: MessageUserBot): string;
  /** The people that owner can reach in the organization, the owner included. */
  reachablePeople(ownerId: string): readonly ReachablePerson[];
  /** How a person reads in a group name. */
  personName(id: string): string;
  /** Put the updated group on the wire. */
  broadcastGroup(group: MessageUserGroup): void;
  /** The usual message notification for the group's people. */
  notifyMessage(notice: MessageUserNotice): void;
}

export function createInternalMessageUserRoutes(deps: MessageUserDeps): InternalRouteHandler {
  return async (ctx) => {
    if (ctx.method !== "POST" || ctx.path !== "/api/internal/message-user") return PASS;
    const { res, json } = ctx;
    const body = await ctx.readBody();
    const { store } = deps;
    const bot = store.bot(ctx.capability.botId);
    const fromThreadId = ctx.capability.threadId;
    const source = bot ? deps.connectorThread(bot.id, fromThreadId) : null;
    if (!bot || !source) return json(res, 403, { error: "source conversation does not belong to sender" });
    const ref = typeof body.user === "string" ? body.user : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!ref.trim() || !text) return json(res, 400, { error: "message_user needs user (the person's name) and text." });
    if (text.length > MESSAGE_MAX_CHARS) {
      return json(res, 400, { error: `a message is at most ${MESSAGE_MAX_CHARS} characters: send the short version and keep the detail in your reply` });
    }
    const ownerId = deps.ownerOf(bot).trim().toLowerCase();
    if (!ownerId) return json(res, 403, { error: "This bot has no owner to write on behalf of." });
    const resolved = resolveReachablePerson(ref, deps.reachablePeople(ownerId), ownerId);
    if (!resolved.ok) return json(res, resolved.code === "unknown_person" ? 404 : 409, { error: resolved.error, code: resolved.code });
    const targetId = resolved.person.id.trim().toLowerCase();

    // Find and create run with no await between them: two calls at once
    // meet the same group instead of making two.
    let group = findBotPersonGroup(store.groups, bot.id, ownerId, targetId);
    const created = !group;
    if (!group) {
      const name = botPersonGroupName(deps.personName(ownerId), deps.personName(targetId) || ref.trim(), bot.name);
      // No section: the group stays private to its two people.
      group = store.createGroup(name, [bot.id], false, undefined, { defaultResponder: { kind: "member", botId: bot.id } }, [ownerId, targetId], { createdBy: ownerId });
    }
    if (group.id === source.group?.id) {
      return json(res, 409, { error: "you are already speaking in that group: say it in your reply instead" });
    }
    const message = store.appendMessage(group.threadId, {
      role: "bot",
      kind: "text",
      text,
      from: { botId: bot.id, name: bot.name, color: bot.color },
    });
    const audience = [targetId, ownerId];
    const unreadFor = [...new Set([...(group.unreadFor ?? []), ...audience])].sort();
    const updated = store.patchGroup(group.id, { unread: true, unreadFor }) ?? group;
    deps.broadcastGroup(updated);
    deps.notifyMessage({ bot, group: updated, text, audience, notify: body.notify !== false });
    // The bot's own conversation shows where the message went.
    store.appendMessage(fromThreadId, {
      role: "bot",
      kind: "activity",
      tool: { name: `Posted in ${updated.name}`, ok: true },
      comm: { groupId: updated.id, withBotId: bot.id, withName: updated.name, withColor: bot.color },
      ...(source.group ? { from: { botId: bot.id, name: bot.name, color: bot.color } } : {}),
    });
    return json(res, 201, { ok: true, groupId: updated.id, groupName: updated.name, created, messageId: message.id, person: deps.personName(targetId) });
  };
}
