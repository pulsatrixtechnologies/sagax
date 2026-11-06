// POST /api/internal/message-person (#2118): a bot writes to another person
// through a triad group chat (owner + person + bot). Find or create that
// room, ask with Always allow, then post on the group's main thread.
import { peerApprovalFailure, requestPeerApproval } from "../peers/peer-approval.ts";
import { findMessagePersonGroup, MESSAGE_PERSON_MAX_CHARS } from "../people/message-person.ts";
import { summarize, type Notification } from "../notify.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export interface MessagePersonBot {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string;
  threadId?: string;
  alwaysAllow?: string[];
}

export interface MessagePersonGroup {
  id: string;
  name: string;
  threadId: string;
  memberIds: string[];
  humanIds?: string[];
  dm?: boolean;
  peopleDm?: boolean;
  archivedAt?: number;
  unreadFor?: string[];
}

export interface MessagePersonDeps {
  organization(): boolean;
  store: {
    bot(id: string): MessagePersonBot | null | undefined;
    readonly groups: readonly MessagePersonGroup[];
    group(id: string): MessagePersonGroup | null | undefined;
    appendMessage(threadId: string, message: Record<string, unknown>): { id: string };
    patchGroup(id: string, patch: Record<string, unknown>): MessagePersonGroup | null | undefined;
  };
  approvalBus: Parameters<typeof requestPeerApproval>[0];
  connectorThread(botId: string, threadId: string): { group?: unknown } | null;
  effectiveBotOwner(bot: MessagePersonBot): string;
  resolvePerson(principalId: string): { ok: true; id: string; name: string } | { ok: false; code: "unknown_person" | "service_account" };
  displayName(principalId: string): string;
  createChannel(input: {
    name: string;
    memberIds: string[];
    humanIds: string[];
    setup: { bulletin: string; defaultResponder: { kind: "mentions" } };
  }): MessagePersonGroup;
  markCreatedBy(groupId: string, ownerId: string): void;
  notify(notification: Notification): void;
  isUnattended(botId: string, threadId: string): boolean;
  requireActive(capability: { botId: string; threadId: string }): void;
  /** Same Full / peer-review gate post_to_room uses (feeds autoApply). */
  peerReviewRequired(bot: MessagePersonBot, threadId: string): boolean;
}

export function createInternalMessagePersonRoutes(deps: MessagePersonDeps): InternalRouteHandler {
  return async (ctx) => {
    const { res, path, method, json, capability, readBody } = ctx;
    if (!(method === "POST" && path === "/api/internal/message-person")) return PASS;
    if (!deps.organization()) {
      return json(res, 404, { error: "Messaging another person needs an organization server.", code: "identity_perspicax" });
    }
    const body = await readBody();
    const from = deps.store.bot(capability.botId);
    if (!from) return json(res, 404, { error: "no such bot" });
    const fromThreadId = capability.threadId;
    if (!deps.connectorThread(from.id, fromThreadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const principalId = String(body.principalId ?? body.principal_id ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!principalId || !message) {
      return json(res, 400, { error: "message_person needs principal_id and message" });
    }
    if (message.length > MESSAGE_PERSON_MAX_CHARS) {
      return json(res, 400, {
        error: `a person message is at most ${MESSAGE_PERSON_MAX_CHARS} characters - send the short version and keep the detail in your own reply`,
      });
    }
    const ownerId = deps.effectiveBotOwner(from).trim();
    if (!ownerId) {
      return json(res, 403, { error: "this bot has no owner to open a group chat with" });
    }
    const target = deps.resolvePerson(principalId);
    if (!target.ok) {
      return json(res, 400, {
        error: target.code === "service_account"
          ? "A service account cannot receive messages."
          : "Choose a person from the organization directory.",
        code: target.code,
      });
    }
    if (target.id.toLowerCase() === ownerId.toLowerCase()) {
      return json(res, 400, {
        error: "That person is your owner - write to them in this conversation instead.",
        code: "self",
      });
    }

    // Writing to another person always asks below Full, even when peer review
    // for bots is off. Full access is the same autoApply peerReviewRequired
    // feeds; Always allow is remembered inside requestPeerApproval.
    let verdict: "allow" | "deny" | "expired" | "cancelled" = "allow";
    const needsCard = deps.peerReviewRequired(from, fromThreadId)
      || !deps.approvalBus.autoApply?.(from.id, fromThreadId);
    if (needsCard) {
      // full-access: peer-contact
      verdict = await requestPeerApproval(
        deps.approvalBus,
        from as never,
        { id: target.id, name: target.name || deps.displayName(target.id) || target.id },
        message,
        "message_person",
        fromThreadId,
      );
      deps.requireActive(capability);
      if (verdict !== "allow") return json(res, 200, peerApprovalFailure(verdict));
    }

    const freshFrom = deps.store.bot(capability.botId);
    if (!freshFrom) return json(res, 404, { error: "that bot no longer exists" });
    const owner = deps.effectiveBotOwner(freshFrom).trim() || ownerId;

    let room = findMessagePersonGroup(deps.store.groups, owner, target.id, freshFrom.id);
    let created = false;
    if (!room) {
      const ownerName = deps.displayName(owner) || "You";
      const personName = target.name || deps.displayName(target.id) || "Person";
      const createdRoom = deps.createChannel({
        name: `${ownerName}, ${personName}`.slice(0, 100),
        memberIds: [freshFrom.id],
        humanIds: [owner, target.id],
        setup: { bulletin: "", defaultResponder: { kind: "mentions" } },
      });
      deps.markCreatedBy(createdRoom.id, owner);
      room = deps.store.group(createdRoom.id) ?? createdRoom;
      created = true;
    }
    if (!room.memberIds.includes(freshFrom.id)) {
      return json(res, 403, { error: "you are not a member of that group chat" });
    }

    const unattended = deps.isUnattended(freshFrom.id, fromThreadId);
    const posted = deps.store.appendMessage(room.threadId, {
      role: "bot",
      kind: "text",
      text: message,
      from: { botId: freshFrom.id, name: freshFrom.name, color: freshFrom.color },
      peerPost: unattended ? { unattended: true } : {},
    });
    const unreadFor = [...new Set([...(room.unreadFor ?? []), target.id.toLowerCase()])].sort();
    deps.store.patchGroup(room.id, { unread: true, unreadFor });

    const chip: Record<string, unknown> = {
      role: "bot",
      kind: "activity",
      tool: { name: `Messaged ${target.name || "person"}`, ok: true },
      comm: { groupId: room.id, withBotId: freshFrom.id, withName: room.name, withColor: freshFrom.color },
    };
    deps.store.appendMessage(fromThreadId, chip);

    deps.notify({
      kind: "message",
      botId: freshFrom.id,
      botName: freshFrom.name,
      threadId: room.threadId,
      groupId: room.id,
      title: freshFrom.name,
      body: summarize(message),
      audience: [target.id],
      ...(freshFrom.avatarUrl ? { avatarUrl: freshFrom.avatarUrl } : {}),
    });

    return json(res, created ? 201 : 200, {
      ok: true,
      messageId: posted.id,
      groupId: room.id,
      roomName: room.name,
      created,
    });
  };
}
