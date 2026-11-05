/**
 * POST /api/bots/:id/compact and /messages/:id/edit (#1388 B3).
 * Never imports server/index.ts.
 */
import { cloudThreadRefusal } from "../cloud-thread-refusal.ts";
import { parseDataContext } from "../data-context.ts";
import { parseDevPods } from "../dev-pods-prompt.ts";
import { speakerFor } from "../request-speaker.ts";
import {
  acceptedSendMatch,
  parseSendId,
} from "../messages/send-idempotency.ts";
import type { BotsMessagesRouteDeps } from "./bots-messages-deps.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

async function handleCompact(deps: BotsMessagesRouteDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { req, res, path, method, auth, json, readBody } = ctx;
  const { requirePinnedClientThread, requestedTaskBot, startTurn, usageTriggerFor } = deps;
  let m: RegExpMatchArray | null = null;

  // Compaction shares normal turn admission and Stop, but never executes
  // an agent turn or provisions a computer. It preserves the full history.
  m = path.match(/^\/api\/bots\/([\w-]+)\/compact$/);
  if (m && method === "POST") {
    const body = await readBody(req);
    requirePinnedClientThread(auth, req, m[1], body?.threadId);
    const bot = requestedTaskBot(m[1], body?.threadId);
    const notYours = cloudThreadRefusal(auth, bot.threadId);
    if (notYours) return json(res, 403, { error: notYours });
    await startTurn(bot.id, "Summarize conversation context", {
      threadId: bot.threadId, compactOnly: true, cardContinuation: true, trigger: usageTriggerFor(auth), speaker: speakerFor(auth),
    });
    return json(res, 202, { ok: true, threadId: bot.threadId });
  }
  return PASS;
}

async function handleEdit(deps: BotsMessagesRouteDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { req, res, path, method, auth, json, readBody } = ctx;
  const {
    devPodsThreads, engineReference, noteStreamSend, ownPageContext, phoneSecretSubmissions, policyModelRefusal,
    registry, requirePinnedClientThread, requestedTaskBot, resolveReplyTarget, startTurn, store, threadBusy,
    turnSelection, usageTriggerFor,
  } = deps;
  let m: RegExpMatchArray | null = null;

  // edit a user message → fork the conversation there and rerun the turn.
  // Rewinding a live thread is refused, exactly like switching versions
  // below: interrupting mid-flight and branching under the dying turn is
  // how a conversation ends up with two tails. Stop, then edit.
  m = path.match(/^\/api\/bots\/([\w-]+)\/messages\/([\w-]+)\/edit$/);
  if (m && method === "POST") {
    const messageId = m[2];
    const body = await readBody(req);
    requirePinnedClientThread(auth, req, m[1], body?.threadId);
    const bot = requestedTaskBot(m[1], body.threadId);
    const notYours = cloudThreadRefusal(auth, bot.threadId);
    if (notYours) return json(res, 403, { error: notYours });
    const text = String(body.text ?? "").trim();
    if (!text) return json(res, 400, { error: "text required" });
    const threadMessages = store.messagesFor(bot.threadId);
    const source = threadMessages.find((msg: any) => msg.id === messageId);
    if (!source || source.role !== "user" || source.kind !== "text") {
      return json(res, 404, { error: "only user messages can be edited" });
    }
    // The client's id for this edit. A retry of an edit the server already
    // forked answers with that fork instead of forking (and rerunning) again.
    // Checked before the busy guard: that fork's own turn is what is busy.
    const sendId = parseSendId(body.sendId);
    if (sendId) {
      const accepted = acceptedSendMatch(threadMessages, sendId, text, source.replyToId);
      if (accepted.kind === "conflict" || (accepted.kind === "match" && (accepted.message.parentId ?? null) !== (source.parentId ?? null))) {
        return json(res, 409, { error: "sendId already belongs to another message" });
      }
      if (accepted.kind === "match") return json(res, 202, { ok: true, message: accepted.message });
    }
    // everything from here down is synchronous, so two racing edits can
    // never both get past this check: startTurn flips busy before the
    // next request is handled
    if (threadBusy(bot.id, bot.threadId)) return json(res, 409, { error: "the thread is working — stop it before editing" });
    if (phoneSecretSubmissions.hasThread(bot.threadId)) {
      return json(res, 409, { error: "this task is securely saving a credential — try again when it finishes" });
    }
    // A thread's own model that can't run gives way to the bot's when the
    // rerun starts (healThreadModel), so check the model it will run on.
    const rerunSelection = turnSelection(bot.id, bot.threadId) ?? bot.modelSelection;
    if (!registry.get(rerunSelection.instanceId)) {
      return json(res, 409, {
        error: `${engineReference(rerunSelection.instanceId)} is unavailable — pick another model in settings`,
      });
    }
    const rerunInstance = registry.get(rerunSelection.instanceId)!;
    const rerunRefusal = policyModelRefusal(rerunInstance);
    if (rerunRefusal) return json(res, 409, { error: rerunRefusal });
    // startTurn admits the rerun before branching. A shared-resource or
    // concurrency-limit refusal must leave the original transcript intact.
    const replyTo = source.replyToId ? resolveReplyTarget(bot.threadId, source.replyToId) : undefined;
    // Regenerate resends the same words: the rerun gets the Data context
    // the message was sent with, so the model sees what it saw. Changed
    // words take the context the client sends now, if any.
    const dataContext = ownPageContext(parseDataContext(body.dataContext), bot.id, auth) ?? (text === source.text ? source.dataContext : undefined);
    devPodsThreads.note(bot.threadId, parseDevPods(body.devPods));
    if (typeof body.singleStream === "boolean") noteStreamSend(bot.id, bot.threadId, body.singleStream);
    // On a Cloud home an edit is its author's line, so the owner's own edit
    // keeps their conversation theirs for lending (server/cloud-lending.ts).
    const message = await startTurn(bot.id, text, { threadId: bot.threadId, editedMessageId: messageId, replyTo, sendId, trigger: usageTriggerFor(auth), speaker: speakerFor(auth), dataContext,
   });
    return json(res, 202, { ok: true, message });
  }
  return PASS;
}

export function createBotsMessagesCompactRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  return (ctx) => handleCompact(deps, ctx);
}

export function createBotsMessagesEditRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  return (ctx) => handleEdit(deps, ctx);
}
