// @ts-nocheck
/** The X draft card's Post and Discard (#4638, shared/x-post.ts has the rules).
 *
 * Post is the person's go. It writes no approval card: the draft's state sits
 * on the bot message that holds the ```x-post fence, the bot is asked, as the
 * person, to publish exactly the approved text, and one pass lets the bot's
 * own X tool call that carries exactly that text through (an organization
 * Refuse or Ask-first rule still holds it: see auto-approve.ts). When the
 * call ends, the state turns into posted (with the link) or failed. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { X_POST_PASS_MS, isXAccountTool, isXurlWhoAmI, isXMediaHost, isXPostTool, normalizeXDraft, parseXPostsFence, xAccountFromOutput, xAvatarSized, xDraftKey, xPostCallMatches, xPostInstruction, xPostTextOfInput, xPostUrlFromResult, xReplyFromInput, type XAccount, type XBrowserPost, type XPostRequest } from "../../shared/x-post.ts";
export type Host = Record<string, any>;

interface Pass { threadId: string; botId: string; messageId: string; draftKey: string; text: string; handle?: string; expires: number }

/** What is kept about the posting account of one bot: its identity and a small copy of its picture. */
interface KnownAccount extends XAccount { avatarData?: string; at: number }
const AVATAR_MAX_BYTES = 60_000;
const X_TOOL_WORD = /(^|[^a-z])(x|twitter)([^a-z]|$)/;

export function createXPostCard(getHost: () => Host): any {
  const passes: Pass[] = [];
  let known: Record<string, KnownAccount> | undefined;
  const file = (host: Host) => join(host.DATA_DIR, "x-accounts.json");
  const accounts = (host: Host) => {
    if (!known) {
      try {
        known = JSON.parse(readFileSync(file(host), "utf8"));
      } catch {
        known = {};
      }
    }
    return known!;
  };
  const save = (host: Host) => {
    try {
      mkdirSync(host.DATA_DIR, { recursive: true });
      writeFileSync(file(host), JSON.stringify(known ?? {}));
    } catch {
      // the identity is a convenience: a disk that refuses it keeps the memory copy
    }
  };

  /** Keep who the bot posts as, and fetch its picture once so the card never waits on X's CDN. */
  function remember(host: Host, botId: string, account: XAccount) {
    const all = accounts(host);
    const before = all[botId];
    const sameAvatar = before && before.handle === account.handle && before.avatarUrl === account.avatarUrl;
    all[botId] = { ...account, ...(sameAvatar && before.avatarData ? { avatarData: before.avatarData } : {}), at: Date.now() };
    save(host);
    if (!sameAvatar || !before?.avatarData) void cacheAvatar(host, botId, account);
  }
  async function cacheAvatar(host: Host, botId: string, account: XAccount) {
    if (!account.avatarUrl || !isXMediaHost(account.avatarUrl)) return;
    try {
      const answer = await fetch(xAvatarSized(account.avatarUrl, "bigger"), { signal: AbortSignal.timeout(8000), redirect: "error" });
      const type = answer.headers.get("content-type") ?? "";
      if (!answer.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return;
      const bytes = Buffer.from(await answer.arrayBuffer());
      if (!bytes.length || bytes.length > AVATAR_MAX_BYTES) return;
      const current = accounts(host)[botId];
      if (!current || current.handle !== account.handle) return;
      current.avatarData = `data:${type};base64,${bytes.toString("base64")}`;
      save(host);
    } catch {
      // no picture kept: the card draws the remote one, then the initials
    }
  }
  /** The account a bot posts as, with its cached picture, or null when nothing is known yet. */
  function accountOf(host: Host, botId: string | undefined) {
    const row = botId ? accounts(host)[botId] : undefined;
    if (!row) return null;
    const { at: _at, avatarData, ...account } = row;
    return { ...account, ...(avatarData ? { avatarData } : {}) };
  }
  /** GET the posting account of a thread's bot. */
  function account(auth: any, threadId: string, botId: string | undefined): { status: number; body: Record<string, unknown> } {
    const host = getHost();
    const owner = host.store.botByThread(threadId);
    if (!owner && !host.store.groupByThread(threadId)) return { status: 404, body: { error: "no such conversation" } };
    const target = host.emailDraftBot(auth, threadId, botId ?? owner?.id);
    if (!("bot" in target)) return target.status === 400 ? { status: 404, body: { error: "no such conversation" } } : target;
    return { status: 200, body: { account: accountOf(host, target.bot.id) } };
  }
  /** An X tool answered: a "who am I" call or a post names the account. */
  function learn(host: Host, botId: string | undefined, tool: string, ok: boolean, output: string | undefined, input?: string) {
    // a shell tool running `xurl whoami` answers with the account the CLI is signed in as
    if (ok && botId && isXurlWhoAmI(input)) {
      const mine = xAccountFromOutput(output, true);
      if (mine) remember(host, botId, mine);
      return;
    }
    if (!ok || !botId || !X_TOOL_WORD.test(` ${tool.toLowerCase().replace(/__+/g, " ").replace(/[^a-z0-9]+/g, " ")} `)) return;
    const found = xAccountFromOutput(output, isXAccountTool(tool));
    if (found) remember(host, botId, found);
  }
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

  /** A post of the thread a reply answers, read back from the x-posts cards already in the chat. */
  function parentOf(host: Host, threadId: string, id: string | undefined) {
    if (!id) return undefined;
    for (const row of [...host.store.messagesFor(threadId)].reverse()) {
      for (const match of String(row.text ?? "").matchAll(/```x-posts\n([\s\S]*?)\n```/g)) {
        const found = parseXPostsFence(match[1]!)?.find((post) => post.id === id);
        if (found) return { ...found, replyTo: undefined };
      }
    }
    return undefined;
  }

  /** The card that shows a published post, as the account that posted it. Posts of one turn
   * (nothing but tool rows between them) join the same message: the chat draws them as a stack. */
  function showPosted(host: Host, threadId: string, from: any, text: string, url: string | undefined, input?: string) {
    const botId = from?.botId;
    // #5553: the status URL names the posting account when whoami never ran
    if (botId && url) learnHandleFromUrl(host, botId, url);
    const who = accountOf(host, botId);
    const id = url ? /status\/(\d{5,25})/.exec(url)?.[1] : undefined;
    const reply = xReplyFromInput(input);
    const parent = parentOf(host, threadId, reply?.id);
    const replyTo = reply || parent ? { ...(reply?.id ? { id: reply.id } : {}), ...((parent?.handle || reply?.handle) ? { handle: parent?.handle ?? reply?.handle } : {}), ...(parent ? { post: parent } : {}) } : undefined;
    const post = {
      ...(id ? { id } : {}),
      ...(url ? { url } : {}),
      name: who?.name ?? "",
      handle: who?.handle ?? "",
      verified: who?.verified ?? false,
      ...(who?.avatarUrl ? { avatarUrl: who.avatarUrl } : {}),
      createdAt: new Date().toISOString(),
      text,
      media: [],
      posted: true,
      ...(replyTo ? { replyTo } : {}),
    };
    const rows = host.store.messagesFor(threadId);
    let last: any;
    for (let index = rows.length - 1; index >= 0; index--) {
      if (rows[index].tool) continue;
      last = rows[index];
      break;
    }
    const open = last && last.role === "bot" && last.from?.botId === botId && Date.now() - (last.at ?? 0) < X_POST_PASS_MS * 3 ? /^```x-posts\n([\s\S]*)\n```$/.exec(String(last.text ?? "")) : null;
    if (open) {
      try {
        const body = JSON.parse(open[1]!);
        if (Array.isArray(body.posts) && body.posts.every((item: any) => item?.posted === true)) {
          host.store.patchMessage(threadId, last.id, { text: "```x-posts\n" + JSON.stringify({ posts: [...body.posts, post] }) + "\n```" });
          return;
        }
      } catch {
        // not a batch of ours: this post gets its own message
      }
    }
    host.store.appendMessage(threadId, { role: "bot", kind: "text", text: "```x-posts\n" + JSON.stringify({ posts: [post] }) + "\n```", from });
  }

  /** The X tool call ended: posted with its link, or failed with why. A call the person answered
   * on the held draft card (no state yet) gets its published-post card here. */
  function finish(threadId: string, tool: string, ok: boolean, output: string | undefined, input: string | undefined, speaker?: { botId: string; name: string; color?: string }) {
    const host = getHost();
    learn(host, speaker?.botId ?? host.store.botByThread(threadId)?.id, tool, ok, output, input);
    for (const row of host.store.messagesFor(threadId)) {
      for (const request of Object.values(row.xPosts ?? {}) as XPostRequest[]) {
        if (request.status !== "sending" || !xPostCallMatches(request.text, tool, input)) continue;
        const url = xPostUrlFromResult(output, accountOf(host, row.from?.botId ?? host.store.botByThread(threadId)?.id)?.handle);
        if (ok) patchState(host, threadId, row.id, request.draftKey, { status: "posted", ...(url ? { url } : {}) });
        else patchState(host, threadId, row.id, request.draftKey, { status: "failed", error: String(output ?? "").replace(/\s+/g, " ").slice(0, 300) || "The X tool refused the post." });
        // a held call's message is the approval card, not a draft fence: show the post on its own card
        if (ok && !String(row.text ?? "").includes("```x-post")) showPosted(host, threadId, row.from, request.text, url, input);
        return true;
      }
    }
    const text = ok && isXPostTool(tool) ? xPostTextOfInput(input) : undefined;
    // in a group the bot that made the call speaks for the card; in a 1:1 thread its bot does
    const owner = text && !speaker ? host.store.botByThread(threadId) : undefined;
    const from = speaker ?? (owner ? { botId: owner.id, name: owner.name, color: owner.color } : undefined);
    if (text && from) {
      showPosted(host, threadId, from, text, xPostUrlFromResult(output, accountOf(host, from.botId)?.handle), input);
      return true;
    }
    return false;
  }

  /** The browser showed who the bot is signed in as on x.com: keep it, and its picture. */
  function learnAccount(botId: string, found: XAccount) {
    remember(getHost(), botId, found);
  }

  /** A post made by clicking Post in the bot's own browser, with no X tool call: the same Posted card.
   * A draft the person approved on its card and the bot then posted by hand turns posted instead. */
  function browserPost(botId: string, threadId: string, found: XBrowserPost) {
    const host = getHost();
    const bot = host.store.bot(botId);
    if (!bot || !host.store.botByThread(threadId) && !host.store.groupByThread(threadId)) return;
    const rows = host.store.messagesFor(threadId);
    // told once: a card (or a draft state) already holds this post
    if (rows.slice(-40).some((row: any) => String(row.text ?? "").includes(`"id":"${found.id}"`) || Object.values(row.xPosts ?? {}).some((request: any) => request?.url === found.url))) return;
    learnHandleFromUrl(host, botId, found.url);
    const normal = (value: string) => value.replace(/\s+/g, " ").trim();
    for (const row of rows) {
      for (const request of Object.values(row.xPosts ?? {}) as XPostRequest[]) {
        if (request.status !== "sending" || (found.text && normal(request.text) !== normal(found.text))) continue;
        drop(threadId, request.draftKey);
        patchState(host, threadId, row.id, request.draftKey, { status: "posted", url: found.url });
        return;
      }
    }
    if (!found.text) return;
    showPosted(host, threadId, { botId: bot.id, name: bot.name, ...(bot.color ? { color: bot.color } : {}) }, found.text, found.url);
  }
  /** The link names the account that posted: enough for the card when the page showed no menu. */
  function learnHandleFromUrl(host: Host, botId: string, url: string) {
    const handle = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\//.exec(url)?.[1];
    if (!handle || accounts(host)[botId]?.handle?.toLowerCase() === handle.toLowerCase()) return;
    if (!accounts(host)[botId]) remember(host, botId, { handle, name: handle, verified: false });
  }

  return { post, discard, status, takePass, finish, account, learnAccount, browserPost, key: xDraftKey };
}
