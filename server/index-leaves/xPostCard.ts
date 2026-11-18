// @ts-nocheck
/** The X draft card's Post and Discard (#4638, shared/x-post.ts has the rules).
 *
 * Post is the person's go. It writes no approval card: the draft's state sits
 * on the bot message that holds the ```x-post fence, the bot is asked, as the
 * person, to publish exactly the approved text, and one pass lets the bot's
 * own X tool call that carries exactly that text through (an organization
 * Refuse or Ask-first rule still holds it: see auto-approve.ts). When the
 * call ends, the state turns into posted (with the link) or failed. */
import { X_POST_PASS_MS, isXPostTool, normalizeXDraft, xDraftKey, xPostCallMatches, xPostInstruction, xPostTextOfInput, xPostUrlFromResult, type XPostRequest } from "../../shared/x-post.ts";
export type Host = Record<string, any>;

interface Pass { threadId: string; botId: string; messageId: string; draftKey: string; text: string; handle?: string; expires: number }

export function createXPostCard(getHost: () => Host): any {
  const passes: Pass[] = [];
  const live = () => {
    const now = Date.now();
    for (let index = passes.length - 1; index >= 0; index--) if (passes[index]!.expires <= now) passes.splice(index, 1);
    return passes;
  };
  const fr = (host: Host, auth: unknown) => String(host.languageOfRequest(auth) ?? "en").toLowerCase().startsWith("fr");

  function messageOf(host: Host, threadId: string, messageId: string) {
    return host.store.messagesFor(threadId).find((row: any) => row.id === messageId && row.role === "bot");
  }
  function setState(host: Host, threadId: string, messageId: string, request: XPostRequest | null) {
    const message = messageOf(host, threadId, messageId);
    if (!message) return;
    const next = { ...message.xPosts };
    if (request) next[request.draftKey] = request;
    host.store.patchMessage(threadId, messageId, { xPosts: next });
  }
  function patchState(host: Host, threadId: string, messageId: string, draftKey: string, patch: Partial<XPostRequest>) {
    const current = messageOf(host, threadId, messageId)?.xPosts?.[draftKey];
    if (current) setState(host, threadId, messageId, { ...current, ...patch });
  }

  /** Post: the person's go for this exact text. */
  async function post(auth: any, threadId: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    const host = getHost();
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    const draftKey = typeof body.draftKey === "string" && /^[\w-]{1,64}$/.test(body.draftKey) ? body.draftKey : "";
    const message = messageOf(host, threadId, messageId);
    if (!message || !draftKey) return { status: 404, body: { error: "no such draft", code: "no_draft" } };
    const target = host.emailDraftBot(auth, threadId, message.from?.botId ?? body.botId);
    if (!("bot" in target)) return target;
    const { bot } = target;
    const normalized = normalizeXDraft(body.draft);
    if ("problems" in normalized) return { status: 400, body: { error: normalized.problems.join("; "), code: "invalid_draft" } };
    const current = message.xPosts?.[draftKey];
    if (current && (current.status === "sending" || current.status === "posted")) return { status: 409, body: { error: "This post was already sent.", code: "already_posted" } };
    const actor = host.cwActionActor(auth);
    if (!actor) return { status: 403, body: { error: "Only the bot owner can post this.", code: "x_post_owner_only" } };
    const handle = typeof body.handle === "string" ? body.handle.replace(/^@/, "").slice(0, 15) : undefined;
    const request: XPostRequest = { draftKey, text: normalized.text, status: "sending", at: Date.now() };
    setState(host, threadId, messageId, request);
    live().push({ threadId, botId: bot.id, messageId, draftKey, text: normalized.text, ...(handle ? { handle } : {}), expires: Date.now() + X_POST_PASS_MS });
    host.appendDecision(host.DATA_DIR, { threadId, requestId: `xpost-${draftKey}`, botId: bot.id, botName: bot.name, tool: "x_post_card", summary: "Post to X from the draft card", decision: "user-approved", source: "user" });
    const text = xPostInstruction(normalized.text, fr(host, auth) ? "fr" : "en");
    const group = host.store.groupByThread(threadId);
    const asked = await host.performBotActRoute(actor, group
      ? { kind: "route", method: "POST", path: `/api/groups/${group.id}/messages`, body: { text: `@${bot.name} ${text}`, threadId } }
      : { kind: "route", method: "POST", path: `/api/bots/${bot.id}/messages`, body: { text, threadId } }, 8000, group ? {} : { continuation: threadId });
    if (asked.status >= 300) {
      drop(threadId, draftKey);
      patchState(host, threadId, messageId, draftKey, { status: "failed", error: fr(host, auth) ? "Le robot n'a pas pu recevoir la demande. Réessaie." : "The bot could not be asked to post it. Try again." });
      return { status: 502, body: { error: "The bot could not be asked to post this. Try again." } };
    }
    return { status: 200, body: { ok: true, status: "sending" } };
  }

  function drop(threadId: string, draftKey: string) {
    const list = live();
    const index = list.findIndex((pass) => pass.threadId === threadId && pass.draftKey === draftKey);
    if (index >= 0) list.splice(index, 1);
  }

  /** Discard: the card closes, nothing is posted. */
  function discard(auth: any, threadId: string, body: Record<string, unknown>): { status: number; body: Record<string, unknown> } {
    const host = getHost();
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    const draftKey = typeof body.draftKey === "string" && /^[\w-]{1,64}$/.test(body.draftKey) ? body.draftKey : "";
    const message = messageOf(host, threadId, messageId);
    if (!message || !draftKey) return { status: 404, body: { error: "no such draft", code: "no_draft" } };
    const target = host.emailDraftBot(auth, threadId, message.from?.botId ?? body.botId);
    if (!("bot" in target)) return target;
    const current = message.xPosts?.[draftKey];
    if (current && (current.status === "sending" || current.status === "posted")) return { status: 409, body: { error: "This post was already sent.", code: "already_posted" } };
    drop(threadId, draftKey);
    setState(host, threadId, messageId, { draftKey, text: typeof body.text === "string" ? body.text.slice(0, 1000) : "", status: "discarded", at: Date.now() });
    return { status: 200, body: { ok: true, status: "discarded" } };
  }

  /** The state of one draft as its card shows it. A hand-off that never reached a tool call reads as failed. */
  function status(auth: any, threadId: string, messageId: string, draftKey: string): { status: number; body: Record<string, unknown> } {
    const host = getHost();
    const owner = host.store.botByThread(threadId);
    if (!owner && !host.store.groupByThread(threadId)) return { status: 404, body: { error: "no such conversation" } };
    const message = messageOf(host, threadId, messageId);
    const target = host.emailDraftBot(auth, threadId, message?.from?.botId ?? owner?.id);
    if (!("bot" in target)) return target.status === 400 ? { status: 404, body: { error: "no such conversation" } } : target;
    const request: XPostRequest | undefined = message?.xPosts?.[draftKey];
    if (!message || !request) return { status: 200, body: { post: null } };
    let { status: state, error } = request;
    if (state === "sending" && !live().some((pass) => pass.threadId === threadId && pass.draftKey === draftKey) && Date.now() - request.at > 30_000) {
      state = "failed";
      error = fr(host, auth) ? "Le robot n'a pas publié ce post à temps. Réessaie." : "The bot did not post this in time. Try again.";
    }
    return { status: 200, body: { post: { status: state, text: request.text, ...(request.url ? { url: request.url } : {}), ...(error ? { error } : {}), at: request.at } } };
  }

  /** The bot's own tool call is the approved text: use its pass once. */
  function takePass(threadId: string, botId: string, tool: string, input: string | undefined): boolean {
    const list = live();
    const index = list.findIndex((pass) => pass.threadId === threadId && pass.botId === botId && xPostCallMatches(pass.text, tool, input));
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  }

  /** The card that shows the published post: a bot message holding the draft fence, in the state posted. */
  function showPosted(host: Host, threadId: string, from: any, text: string, url: string | undefined) {
    const draftKey = xDraftKey(text);
    host.store.appendMessage(threadId, {
      role: "bot",
      kind: "text",
      text: "```x-post\n" + JSON.stringify({ text }) + "\n```",
      from,
      xPosts: { [draftKey]: { draftKey, text, status: "posted", ...(url ? { url } : {}), at: Date.now() } },
    });
  }

  /** The X tool call ended: posted with its link, or failed with why. A call the person answered
   * on the held draft card (no state yet) gets its published-post card here. */
  function finish(threadId: string, tool: string, ok: boolean, output: string | undefined, input: string | undefined, speaker?: { botId: string; name: string; color?: string }) {
    const host = getHost();
    for (const row of host.store.messagesFor(threadId)) {
      for (const request of Object.values(row.xPosts ?? {}) as XPostRequest[]) {
        if (request.status !== "sending" || !xPostCallMatches(request.text, tool, input)) continue;
        const url = xPostUrlFromResult(output);
        if (ok) patchState(host, threadId, row.id, request.draftKey, { status: "posted", ...(url ? { url } : {}) });
        else patchState(host, threadId, row.id, request.draftKey, { status: "failed", error: String(output ?? "").replace(/\s+/g, " ").slice(0, 300) || "The X tool refused the post." });
        // a held call's message is the approval card, not a draft fence: show the post on its own card
        if (ok && !String(row.text ?? "").includes("```x-post")) showPosted(host, threadId, row.from, request.text, url);
        return true;
      }
    }
    const text = ok && isXPostTool(tool) ? xPostTextOfInput(input) : undefined;
    // in a group the bot that made the call speaks for the card; in a 1:1 thread its bot does
    const owner = text && !speaker ? host.store.botByThread(threadId) : undefined;
    const from = speaker ?? (owner ? { botId: owner.id, name: owner.name, color: owner.color } : undefined);
    if (text && from) {
      showPosted(host, threadId, from, text, xPostUrlFromResult(output));
      return true;
    }
    return false;
  }

  return { post, discard, status, takePass, finish, key: xDraftKey };
}
