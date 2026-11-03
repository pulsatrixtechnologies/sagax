// POST /api/nudges { principalId, threadId? } shakes one person and leaves a
// line in the conversation those two share: in the thread named when it is
// one of theirs (the thread the sender has open), else its default thread.
// POST /api/nudges { groupId } shakes the other people of that group chat
// and leaves one line in the group. Exactly one of the two fields.
// An accepted nudge answers { ok, id, at } and also sends the sender's own
// streams a `nudge.sent` frame with the same id: every window of the sender
// shakes and rings too, and the window that clicked skips the echo of the
// nudge it already played.
// Organization servers only. The signed-in person must be an active person
// who can post in that chat. A service account, the sender, and a person
// who is out are not shaken. The 5 minute cooldown is this process's map
// (server/nudge.ts). A refusal does not write the line and does not start
// the clock when the chat has no one else to shake.
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { groupNudgeKey, groupNudgeTargets, nudgeCooldownError, type NudgeConversation, type NudgeCooldown, type NudgeDirectoryPerson } from "../nudge.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface NudgeGroupRoom {
  id: string;
  name: string;
  humanIds: readonly string[];
  section: { ownerPrincipalId?: string; members: readonly { target: string }[] } | null;
}

export interface NudgeRouteDeps {
  organization(): boolean;
  /** The signed-in person's principal id; none for loopback or a session
   * without one. */
  viewerId(auth: RequestAuth): string | undefined;
  /** An active person of the directory by principal id, or why not. */
  person(principalId: string): { ok: true; id: string; name: string } | { ok: false; code: "unknown_person" | "service_account" };
  /** A group chat this person may post in, or why not. A direct conversation
   * and a bot-to-bot dm are not a group chat. */
  group(groupId: string, senderId: string): { ok: true; room: NudgeGroupRoom } | { ok: false; code: "unknown_group" | "forbidden" | "not_a_room" };
  /** People the group may name. Service accounts and people who are out stay
   * in the list so they can be skipped. */
  people(): readonly NudgeDirectoryPerson[];
  displayName(principalId: string): string;
  now(): number;
  cooldown: NudgeCooldown;
  /** `open` is the conversation the line was written in, so the person
   * nudged can open it from the notification. */
  deliver(frame: { audience: string; id: string; fromId: string; fromName: string; at: number; open?: NudgeConversation }): void;
  /** The sender's own streams: the nudge they just sent (`nudge.sent`). */
  echo?(frame: { audience: string; id: string; toId: string; toName: string; at: number; open?: NudgeConversation }): void;
  /** The nudge's id, shared by the frames and the answer. */
  newId?(): string;
  /** Persist the accepted nudge. Not called when the nudge is refused.
   * `groupId` writes the line on that group chat. Returns the conversation
   * the line went to, when there is one. */
  record(line: { fromId: string; fromName: string; toId: string; toName: string; at: number; groupId?: string; threadId?: string }): NudgeConversation | undefined | void;
}

const personBody = z.object({ principalId: z.string().min(1).max(200), threadId: z.string().regex(/^[\w-]{1,128}$/).optional() }).strict();
const groupBody = z.object({ groupId: z.string().min(1).max(200) }).strict();
const bodySchema = z.union([personBody, groupBody]);

export function createNudgeRoutes(deps: NudgeRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/nudges" || method !== "POST") return PASS;
    if (!deps.organization()) return json(res, 404, { error: "Nudges need an organization server.", code: "identity_perspicax" });
    const self = deps.viewerId(auth);
    if (!self) return json(res, 403, { error: "Sign in with Pulsatrix to nudge someone.", code: "session_required" });
    const parsed = bodySchema.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "send { principalId } or { groupId }" });
    const at = deps.now();
    const id = deps.newId?.() ?? randomUUID();
    const fromName = deps.displayName(self).trim() || "Someone";
    if ("groupId" in parsed.data) {
      const found = deps.group(parsed.data.groupId, self);
      if (!found.ok) {
        const status = found.code === "forbidden" ? 403 : 400;
        const error = found.code === "forbidden"
          ? "You cannot post in this chat."
          : found.code === "not_a_room"
            ? "Nudge a person in a direct chat, or a group chat."
            : "Choose a group chat.";
        return json(res, status, { error, code: found.code });
      }
      const targets = groupNudgeTargets({
        senderId: self,
        humanIds: found.room.humanIds,
        section: found.room.section,
        people: deps.people(),
      });
      if (targets.length === 0) return json(res, 400, { error: "This chat has no one else to nudge.", code: "nobody" });
      const key = groupNudgeKey(found.room.id);
      const verdict = deps.cooldown.tryAcquire(key, key, at);
      if (!verdict.ok) {
        res.setHeader("retry-after", String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))));
        return json(res, 429, {
          error: nudgeCooldownError(verdict.retryAfterMs),
          code: "nudge_cooldown",
          retryAfterMs: verdict.retryAfterMs,
        });
      }
      const toName = found.room.name.trim() || found.room.id;
      const open = deps.record({ fromId: self, fromName, toId: found.room.id, toName, at, groupId: found.room.id }) || undefined;
      for (const person of targets) deps.deliver({ audience: person.id, id, fromId: self, fromName, at, ...(open ? { open } : {}) });
      deps.echo?.({ audience: self, id, toId: found.room.id, toName, at, ...(open ? { open } : {}) });
      return json(res, 200, { ok: true, id, at });
    }
    const target = deps.person(parsed.data.principalId);
    if (!target.ok) {
      return json(res, 400, {
        error: target.code === "service_account" ? "A service account cannot be nudged." : "Choose a person from the organization directory.",
        code: target.code,
      });
    }
    if (target.id.toLowerCase() === self.toLowerCase()) return json(res, 400, { error: "Choose someone other than yourself.", code: "self" });
    const verdict = deps.cooldown.tryAcquire(self, target.id, at);
    if (!verdict.ok) {
      res.setHeader("retry-after", String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))));
      return json(res, 429, {
        error: nudgeCooldownError(verdict.retryAfterMs),
        code: "nudge_cooldown",
        retryAfterMs: verdict.retryAfterMs,
      });
    }
    const toName = target.name.trim() || target.id;
    const open = deps.record({ fromId: self, fromName, toId: target.id, toName, at, ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}) }) || undefined;
    deps.deliver({ audience: target.id, id, fromId: self, fromName, at, ...(open ? { open } : {}) });
    deps.echo?.({ audience: self, id, toId: target.id, toName, at, ...(open ? { open } : {}) });
    return json(res, 200, { ok: true, id, at });
  };
}
