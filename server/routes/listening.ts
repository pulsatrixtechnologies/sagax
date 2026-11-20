// Listening to a conversation (#4100), the person's own sessions:
//
//   POST /api/bots/:id/listening       { threadId?, sources?: { microphone?, computer? }, purpose?: "conversation" | "meeting" }
//        { session }   starts listening in the person's conversation with the bot
//                      (the one already live there is answered again); a
//                      meeting (#5130, the watch) ends in the meeting notes
//   POST /api/listening/:id/lines      { lines: [{ seq, at?, speaker, text }], speakers?: [{ key, label }] }
//        { session }   final lines, idempotent by seq; an empty batch is a heartbeat
//   POST /api/listening/:id/stop       { lines?, speakers? }
//        { session }   ends it, after the last lines when given (again: the ended session)
//   GET  /api/listening/:id?after=<seq>
//        { session, lines }   the transcript after that seq (all without it)
//
// A session answers only to the person who started it: anyone else, an
// administrator included, gets 404 (server/listening/listening-sessions.ts).
//
// The bot's read (listening_read), behind the turn's capability
// (INTERNAL_ROUTES, server/routes/internal-route.ts):
//
//   GET  /api/internal/listening/:id?after=<seq>&limit=<n>
//        { text, nextAfter? }   a page of a session of the conversation the turn runs in
import { LISTENING_SESSION_ID, type ListeningPurpose, type ListeningSources } from "../../shared/listening.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { listeningView, parseListeningBatch, type ListeningSessions } from "../listening/listening-sessions.ts";
import { listeningReadPage } from "../listening/listening-turn.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ListeningRouteDeps {
  sessions: Pick<ListeningSessions, "start" | "get" | "addLines" | "stop" | "linesAfter">;
  /** The person asking (principal id), or "" when the request speaks for no person. */
  person(auth: RequestAuth): string;
  /** The conversation of this bot the person may listen in: the one named
   * when they may post to it, else their own; or why not. Never a room, and
   * never an AI client's hidden conversation. */
  conversation(auth: RequestAuth, botId: string, threadId: string | undefined): { botId: string; threadId: string } | { status: number; error: string };
}

const START = /^\/api\/bots\/([\w-]+)\/listening$/;
const SESSION = /^\/api\/listening\/(ls_[a-f0-9]{20})(?:\/(lines|stop))?$/;
const THREAD_ID = /^[\w-]{1,200}$/;
const NOT_FOUND = { error: "no such listening session" } as const;

export function createListeningRoutes(deps: ListeningRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const start = START.exec(path);
    if (start) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const person = deps.person(auth);
      if (!person) return json(res, 403, { error: "sign in as a person first", code: "sign_in" });
      const body = await readBody(req, 4096).catch(() => null) as { threadId?: unknown; sources?: unknown; purpose?: unknown } | null;
      const threadId = body?.threadId;
      if (threadId !== undefined && (typeof threadId !== "string" || !THREAD_ID.test(threadId))) return json(res, 400, { error: "threadId must be a task id" });
      const sources = body?.sources;
      if (sources !== undefined && (!sources || typeof sources !== "object")) return json(res, 400, { error: "sources must be an object" });
      const purpose = body?.purpose;
      if (purpose !== undefined && purpose !== "conversation" && purpose !== "meeting") return json(res, 400, { error: "purpose must be conversation or meeting" });
      const target = deps.conversation(auth, start[1]!, threadId);
      if ("status" in target) return json(res, target.status, { error: target.error });
      const picked = sources as Partial<Record<keyof ListeningSources, unknown>> | undefined;
      const session = deps.sessions.start({
        botId: target.botId,
        threadId: target.threadId,
        principalId: person,
        sources: { microphone: picked?.microphone !== false, computer: picked?.computer === true },
        purpose: purpose as ListeningPurpose | undefined,
      });
      if (!session) return json(res, 404, { error: "no such conversation" });
      return json(res, 200, { session: listeningView(session) });
    }

    const match = SESSION.exec(path);
    if (!match) return PASS;
    const id = match[1]!;
    const action = match[2] as "lines" | "stop" | undefined;
    const expected = action ? "POST" : "GET";
    if (method !== expected) return json(res, 405, { error: "method not allowed" });
    const person = deps.person(auth);
    if (!person || !LISTENING_SESSION_ID.test(id)) return json(res, 404, NOT_FOUND);

    if (action === "lines") {
      if (!deps.sessions.get(id, person)) return json(res, 404, NOT_FOUND);
      const batch = parseListeningBatch(await readBody(req).catch(() => null));
      if ("error" in batch) return json(res, 400, { error: batch.error });
      const session = deps.sessions.addLines(id, person, batch);
      if (!session) return json(res, 404, NOT_FOUND);
      return json(res, 200, { session: listeningView(session) });
    }
    if (action === "stop") {
      // a window that closes sends its last lines with the stop, in one request
      const body = await readBody(req).catch(() => null) as { lines?: unknown } | null;
      if (body && body.lines !== undefined) {
        if (!deps.sessions.get(id, person)) return json(res, 404, NOT_FOUND);
        const batch = parseListeningBatch(body);
        if ("error" in batch) return json(res, 400, { error: batch.error });
        deps.sessions.addLines(id, person, batch);
      }
      const session = deps.sessions.stop(id, person);
      if (!session) return json(res, 404, NOT_FOUND);
      return json(res, 200, { session: listeningView(session) });
    }
    const rawAfter = url.searchParams.get("after");
    const after = rawAfter === null || rawAfter === "" ? undefined : Number(rawAfter);
    if (after !== undefined && (!Number.isSafeInteger(after) || after < -1)) return json(res, 400, { error: "after must be a seq" });
    const session = deps.sessions.get(id, person);
    if (!session) return json(res, 404, NOT_FOUND);
    return json(res, 200, { session: listeningView(session), lines: deps.sessions.linesAfter(session, after) });
  };
}

const INTERNAL_READ = /^\/api\/internal\/listening\/([^/]+)$/;

/** listening_read: a session of the conversation the turn runs in, by page.
 * Another conversation's session, or another bot's, is not found. */
export function createListeningInternalRoutes(deps: { sessions: Pick<ListeningSessions, "byId"> }): InternalRouteHandler {
  return async ({ res, path, method, json, capability, url }) => {
    const match = INTERNAL_READ.exec(path);
    if (!match) return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const number = (name: string): number | undefined => {
      const raw = url?.searchParams.get(name);
      if (raw === null || raw === undefined || raw === "") return undefined;
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    };
    const page = listeningReadPage(deps.sessions, { botId: capability.botId, threadId: capability.threadId }, decodeURIComponent(match[1]!), { after: number("after"), limit: number("limit") });
    if (!page.ok) return json(res, 404, { error: page.error });
    return json(res, 200, { text: page.text, ...(page.nextAfter !== undefined ? { nextAfter: page.nextAfter } : {}) });
  };
}
