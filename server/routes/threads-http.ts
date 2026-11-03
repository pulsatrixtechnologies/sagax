/**
 * Thread HTTP routes (#1388 wave 3 T1): post-gate /api/events, cw-actions,
 * read receipts (Seen by), scrollback/messages image/file, files listing,
 * export, reactions, and /api/threads/:id/events.
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { deliveredCopy } from "../bot-attachment.ts";
import type { ApprovalViewer } from "../approvals/approval-audience.ts";
import {
  listMessageFolder,
  messageAttachmentName,
  messageFileDisposition,
  messageFileDownloadName,
  messageFolderEntryName,
  messageImageTargetAt,
  messageReferencesFile,
  openMessageFile,
  openMessageFolderEntry,
  referencedFileName,
  statMessageFile,
} from "../message-file.ts";
import type { RequestAuth } from "../request-auth.ts";
import {
  personParticipant,
  roomReceiptMember,
} from "../read-receipts.ts";
import { PUSH_TOKEN_HEADER, pushTokenFromHeader } from "../push/devices.ts";
import { openSseHeartbeat } from "../sse-fanout.ts";
import type { BotRecord, GroupRecord, Message } from "../store.ts";
import { readThreadEvents } from "../thread-events.ts";
import {
  listThreadFiles,
  writtenFilesForMessage,
  type ThreadFileRef,
} from "../thread-files.ts";
import { THUMB_MAX_SOURCE_BYTES, thumbnailFor, thumbnailable } from "../thumbnail.ts";
import { screenVisibleToPrincipal } from "../user-sandbox-routing.ts";
import {
  normalizeReactions,
  reactionEmoji,
  type ReactionActor,
} from "../../shared/reactions.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ThreadsHttpStore {
  readonly bots: readonly BotRecord[];
  readonly groups: readonly GroupRecord[];
  bot(id: string): BotRecord | null | undefined;
  botByThread(threadId: string): BotRecord | null | undefined;
  groupByThread(threadId: string): GroupRecord | null | undefined;
  tasks(botId: string): ReadonlyArray<{ threadId: string }>;
  taskByThread(botId: string, threadId: string): { threadId: string; title?: string } | null | undefined;
  groupTaskByThread(groupId: string, threadId: string): { threadId: string; title?: string } | null | undefined;
  messagesFor(threadId: string): readonly Message[];
  activeLeaf(threadId: string): string | null | undefined;
  activePath(threadId: string): readonly Message[];
  markRead(threadId: string, viewer: string, messageId: string): void;
  threadReads(threadId: string): Record<string, unknown>;
  reactToMessage(
    threadId: string,
    messageId: string,
    emoji: string,
    actor: ReactionActor,
    opts: { mode: string; legacyUser?: ReactionActor },
  ): { message: Message; added: boolean; full?: boolean } | null | undefined;
}

export interface ThreadsHttpSseClient {
  res: ServerResponse;
  admin: boolean;
  screens: boolean;
  backpressured: boolean;
  pushToken: unknown;
  viewer: unknown;
  seen: { bots: Set<string>; groups: Set<string> } | { bots: Set<string>; groups: Set<string> };
  close: () => void;
  sessionId?: string;
  approvalUserId?: string;
  identity?: () => unknown;
  viewerId?: string;
  presence?: boolean;
}

export interface ThreadsHttpRouteDeps {
  store: ThreadsHttpStore | { [key: string]: any };
  identityKind: "solo" | "perspicax" | string;
  attachmentsDir: string;
  eventsDir: string;
  nativeDir: string;
  defaultPage: number;
  sseHeartbeatMs: number;
  streamId: string;
  cfg: { profile?: { name?: string } | null };
  actorPrincipalId(auth: RequestAuth): string;
  requestCwAction(auth: RequestAuth, threadId: string, body: unknown): Promise<{ status: number; body: unknown }>;
  threadReadsFor(threadId: string, viewerId: string | undefined): unknown;
  personSendsReadReceipts(personId: string): boolean;
  notePushRead(viewer: string, threadId: string): void;
  pageSize(raw: string | null): number | null | undefined;
  viewerForApproval(auth: RequestAuth): ApprovalViewer;
  messageWindow(threadId: string, messageId: string, limit: number, viewer: ApprovalViewer): object | null;
  messagePage(threadId: string, limit: number, before: string | null, viewer: ApprovalViewer): object;
  turnWorkplacePrincipal(threadId: string): string | undefined;
  messageFileRootsForThread(botId: string, threadId: string): string[];
  threadFileRefForPath(threadId: string, path: string, messageId?: string): { id: string } | null | undefined;
  threadFileRefsFor(threadId: string): ThreadFileRef[];
  threadFileRoots(threadId: string, ref: unknown): string[];
  threadFileRefForId(threadId: string, id: string): { id: string; path: string; source?: string; name?: string } | null | undefined;
  threadFilePins: { ids(threadId: string): ReadonlySet<string> | Set<string> };
  streamOpenedHttpFile(req: IncomingMessage, res: ServerResponse, file: unknown, headers: Record<string, string>): void;
  projectMessages(threadId: string, messages: readonly Message[], viewer: ApprovalViewer): Message[];
  reactionPersonFor(auth: RequestAuth): ReactionActor | null;
  legacyReactionUser(): ReactionActor | undefined;
  // /api/events SSE fan-out
  viewerFor(auth: RequestAuth, path: string): { kind: string; [key: string]: unknown };
  visibleTo(viewer: unknown): { bot(id: string): boolean; group(id: string): boolean };
  presenceViewer(auth: RequestAuth): { ok: true; id: string; sessionId: string } | { ok: false };
  presence: { connect(id: string, sessionId: string): (() => void) | null; touch(id: string, sessionId: string): void };
  listedBotVisible(bot: BotRecord, viewerId: string | undefined): boolean;
  groupVisible(group: GroupRecord, viewerId: string | undefined): boolean;
  /** Same as handleRequest's viewerId (channelFilterViewerId). */
  viewerId(auth: RequestAuth): string | undefined;
  channelViewerId(auth: RequestAuth): string | undefined;
  localPrincipalId(): string | undefined;
  viewerIdentity(auth: RequestAuth): unknown;
  sessions: { isLive(sessionId: string): boolean };
  sseClients: Set<any>;
  cursorSeq(raw: string | string[] | undefined): number | null;
  lastSeq(): number;
  audienceChangedAt(): number;
  replayBuffer: { covers(since: number, last: number): boolean; [Symbol.iterator](): Iterator<{ seq: number; kind: string; payload: unknown; frame: string | null; clientFrame: string | null }> };
  wants(client: any, kind: string): boolean;
  sseFrameFor(client: any, seq: number, payload: unknown, frame: string | null, clientFrame: string | null): string | null;
}

export function createThreadsHttpRoutes(deps: ThreadsHttpRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const isThreadPath = path.startsWith("/api/threads/");
    const isEvents = path === "/api/events";
    if (!isThreadPath && !isEvents) return PASS;

    const {
      store,
      identityKind,
      attachmentsDir: ATTACHMENTS_DIR,
      eventsDir: EVENTS_DIR,
      nativeDir: NATIVE_DIR,
      defaultPage: DEFAULT_PAGE,
      sseHeartbeatMs: SSE_HEARTBEAT_MS,
      streamId: STREAM_ID,
      cfg,
      actorPrincipalId,
      requestCwAction,
      threadReadsFor,
      personSendsReadReceipts,
      notePushRead,
      pageSize,
      viewerForApproval,
      messageWindow,
      messagePage,
      turnWorkplacePrincipal,
      messageFileRootsForThread,
      threadFileRefForPath,
      threadFileRefsFor,
      threadFileRoots,
      threadFileRefForId,
      threadFilePins,
      streamOpenedHttpFile,
      projectMessages,
      reactionPersonFor,
      legacyReactionUser,
      viewerFor,
      visibleTo,
      presenceViewer,
      presence,
      listedBotVisible,
      groupVisible,
      viewerId: viewerIdOf,
      channelViewerId,
      localPrincipalId,
      viewerIdentity,
      sessions,
      sseClients,
      cursorSeq,
      lastSeq,
      audienceChangedAt,
      replayBuffer,
      wants,
      sseFrameFor,
    } = deps;

    // IDENTITY.kind used in original; bind locally
    const IDENTITY = { kind: identityKind };
    const pushHub = { noteRead: notePushRead };
    const turnWorkplaces = {
      get(threadId: string) {
        const principal = turnWorkplacePrincipal(threadId);
        return principal ? { decision: { principal } } : undefined;
      },
    };
    const viewerId = viewerIdOf(auth);

    let m: RegExpMatchArray | null = null;

    if (method === "GET" && path === "/api/events") {
      const viewer = viewerFor(auth, path);
      const visibleNow = visibleTo(viewer);
      // A person of the organization: this stream is one of their clients.
      const presenceOf = presenceViewer(auth);
      const presenceClose = presenceOf.ok ? presence.connect(presenceOf.id, presenceOf.sessionId) : null;
      const client: any = {
        res,
        admin: auth.scopes.includes("admin"),
        screens: url.searchParams.get("screens") !== "off",
        backpressured: false,
        pushToken: pushTokenFromHeader(req.headers[PUSH_TOKEN_HEADER]),
        viewer,
        // What this person's hydration (GET /api/bots, narrowed the same way) showed them.
        seen: viewer.kind === "all" ? { bots: new Set(), groups: new Set() } : {
          bots: new Set(store.bots.filter((bot: any) => visibleNow.bot(bot.id) && listedBotVisible(bot, viewerId)).map((bot: any) => bot.id)),
          groups: new Set(store.groups.filter((group: any) => visibleNow.group(group.id) && groupVisible(group, viewerId)).map((group: any) => group.id)),
        },
        // A comment keeps intermediaries from idling the connection, while a
        // data frame is visible to EventSource clients and resets their own
        // liveness watchdog. Heartbeats carry no id and never advance replay.
        // An expired session's stream ends at the next heartbeat.
        close: openSseHeartbeat(res, {
          everyMs: SSE_HEARTBEAT_MS,
          live: () => !client.sessionId || sessions.isLive(client.sessionId),
          onBeat: () => { if (presenceOf.ok) presence.touch(presenceOf.id, presenceOf.sessionId); },
          onClose: () => {
            sseClients.delete(client);
            presenceClose?.();
          },
        }),
      };
      if (auth.kind === "session") {
        client.sessionId = auth.session.id;
        client.approvalUserId = channelViewerId(auth) ?? "";
      } else if (auth.kind === "loopback" && auth.trust !== "service") {
        client.approvalUserId = localPrincipalId();
      }
      if (!(auth.kind === "loopback" && auth.trust === "service")) client.identity = () => viewerIdentity(auth);
      if (viewerId) client.viewerId = viewerId;
      if (presenceOf.ok) client.presence = true;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        // Honoured by nginx-compatible reverse proxies; harmless elsewhere.
        // Remote clients need each frame now, not when a proxy buffer fills.
        "x-accel-buffering": "no",
      });

      // Resume, if the client offered a cursor we can honour. `?since=` is
      // for clients that read the stream by hand; Last-Event-ID is what a
      // browser EventSource sends by itself.
      // Once EventSource has received a numbered frame, its automatic
      // reconnect carries a newer Last-Event-ID even though the original
      // URL may still contain an older manual `since` cursor. Prefer the
      // valid browser cursor or the stale query would replay forever.
      const since =
        cursorSeq(req.headers["last-event-id"]) ??
        cursorSeq(url.searchParams.get("since") ?? undefined);
      // The buffer only reaches so far back. If the client's cursor fell off
      // the end, saying so is the only honest answer — a partial replay
      // would leave a permanent hole in its state.
      const resumed =
        since !== null &&
        since <= lastSeq() &&
        replayBuffer.covers(since, lastSeq()) &&
        // A member whose cursor predates a bot's audience change gets a fresh
        // snapshot: a replay is judged by today's audience and could neither
        // withdraw what the change hid nor bring back whole what it showed.
        !(viewer.kind === "member" && audienceChangedAt() > 0 && since <= audienceChangedAt());
      res.write(
        `data: ${JSON.stringify({
          kind: "hello",
          cursor: `${STREAM_ID}:${lastSeq()}`,
          // false means "I could not give you what you missed — hydrate".
          // A client that offered no cursor gets false too, which is exactly
          // what a cold start should do.
          resumed,
        })}\n\n`,
      );
      if (resumed) {
        for (const buffered of replayBuffer) {
          if (buffered.seq <= since || !wants(client, buffered.kind)) continue;
          const frame = sseFrameFor(client, buffered.seq, buffered.payload, buffered.frame, buffered.clientFrame);
          if (frame) res.write(frame);
        }
      }

      // A stream that already failed (its close ran) never joins the fan-out.
      if (!res.writableEnded && !res.destroyed) sseClients.add(client);
      // Keep this long-lived response out of socket idle-timeout handling
      // without weakening timeouts for every other API request.
      req.socket.setTimeout(0);
      req.on("close", client.close);
      return;
    }

    m = path.match(/^\/api\/threads\/([\w-]+)\/cw-actions$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
      const asked = await requestCwAction(auth, m[1], body);
      return json(res, asked.status, asked.body);
    }

    // Read receipts (server/read-receipts.ts): GET answers the positions
    // this person may see and which one is theirs; POST moves their own,
    // forward only, to a message their app showed them.
    m = path.match(/^\/api\/threads\/([\w-]+)\/read$/);
    if (m && (method === "GET" || method === "POST")) {
      const threadId = m[1];
      const group = store.groupByThread(threadId);
      if (!group && !store.botByThread(threadId)) return json(res, 404, { error: "no such conversation" });
      const viewer = personParticipant(actorPrincipalId(auth));
      if (method === "GET") return json(res, 200, { reads: threadReadsFor(threadId, viewer || undefined), self: viewer || null });
      const body = await readBody(req);
      const messageId = typeof body?.messageId === "string" ? body.messageId : "";
      if (!messageId) return json(res, 400, { error: "messageId is required" });
      if (!viewer) return json(res, 403, { error: "only a person leaves a read receipt" });
      // A room's receipts are its members' (a bot-to-bot channel has none).
      if (group && !group.peopleDm && (group.dm || (IDENTITY.kind === "perspicax" && !roomReceiptMember(group, viewer)))) {
        return json(res, 403, { error: "only a member of this conversation leaves a read receipt", code: "not_member" });
      }
      if (!store.messagesFor(threadId).some((message: any) => message.id === messageId)) return json(res, 404, { error: "no such message" });
      // Someone who sends no receipts leaves no position to show later.
      if (group?.peopleDm && !personSendsReadReceipts(viewer)) return json(res, 200, { read: null });
      store.markRead(threadId, viewer, messageId);
      pushHub.noteRead(viewer, threadId);
      return json(res, 200, { read: store.threadReads(threadId)[viewer] ?? null });
    }
    // scrollback: the page before a message the client already holds
    m = path.match(/^\/api\/threads\/([\w-]+)\/messages$/);
    if (m && method === "GET") {
      const threadId = m[1];
      if (!store.botByThread(threadId) && !store.groupByThread(threadId)) {
        return json(res, 404, { error: "no such conversation" });
      }
      const limit = pageSize(url.searchParams.get("limit"));
      if (limit === null) return json(res, 400, { error: "limit must be a non-negative whole number" });
      const before = url.searchParams.get("before");
      const around = url.searchParams.get("around");
      const approvalViewer = viewerForApproval(auth);
      if (before && around) return json(res, 400, { error: "before and around cannot be combined" });
      if (around) {
        const window = messageWindow(threadId, around, limit ?? DEFAULT_PAGE, approvalViewer);
        if (!window) return json(res, 404, { error: "no such message" });
        return json(res, 200, { ...window, activeLeafId: store.activeLeaf(threadId) });
      }
      // An unknown cursor must not silently answer with the newest page —
      // the client would paginate in a circle and never reach the top.
      if (before && !store.messagesFor(threadId).some((msg: any) => msg.id === before)) {
        return json(res, 404, { error: "no such message" });
      }
      return json(res, 200, { ...messagePage(threadId, limit ?? DEFAULT_PAGE, before, approvalViewer), activeLeafId: store.activeLeaf(threadId) });
    }

    // the pixels of one screen message, fetched only when something shows it
    m = path.match(/^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/image$/);
    if (m && method === "GET") {
      // Same guard as the page route above, and for the same reason twice
      // over: an unknown id should 404 deliberately rather than by accident,
      // and `messagesFor` materialises and caches a ThreadState for whatever
      // it is handed. Without this, a client asking for images on ids that
      // do not exist grows the thread map for as long as it keeps asking.
      if (!store.botByThread(m[1]) && !store.groupByThread(m[1])) {
        return json(res, 404, { error: "no such conversation" });
      }
      const message = store.messagesFor(m[1]).find((msg: any) => msg.id === m![2]);
      if (!message?.png) return json(res, 404, { error: "no image on that message" });
      // A shared room's screen belongs to the person whose turn it is, and
      // only while that turn still holds the workplace. A private 1:1 thread
      // is already per person, so its settled screen stays.
      if (message.kind === "screen" && store.groupByThread(m[1]) && !screenVisibleToPrincipal({
        organization: IDENTITY.kind === "perspicax",
        viewerId: auth.kind === "session" ? auth.session.principalId : undefined,
        workplacePrincipal: turnWorkplaces.get(m[1])?.decision.principal ?? undefined,
      })) {
        return json(res, 404, { error: "no image on that message" });
      }
      const bytes = Buffer.from(message.png, "base64");
      res.writeHead(200, {
        "content-type": message.mime ?? "image/png",
        "content-length": String(bytes.byteLength),
        // Never cached: a room's screen is shown only to the person whose
        // turn holds the workplace, and access to a thread can be withdrawn;
        // a browser cache would keep the image past both.
        "cache-control": "private, no-store",
      });
      res.end(bytes);
      return;
    }

    // Download one local file only when this exact stored message grants it:
    // a bot must render a Markdown link or carry a generated-image attachment,
    // while a user message must carry the standalone composer tag. The bot
    // branch derives conversation/workspace roots; the user branch is limited
    // to Sagax's private attachment directory. This is deliberately not
    // a general path reader.
    m = path.match(/^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/file$/);
    const streamsMessageImage = Boolean(
      m && method === "GET" && url.searchParams.get("preview") === "1",
    );
    if (m && (method === "POST" || streamsMessageImage)) {
      if (method === "POST" && !String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const threadId = m[1]!;
      const directBot = store.botByThread(threadId);
      const group = directBot ? undefined : store.groupByThread(threadId);
      if (!directBot && !group) return json(res, 404, { error: "no such conversation" });

      const message = store.messagesFor(threadId).find((candidate: any) => candidate.id === m![2]);
      if (!message) return json(res, 404, { error: "no such message" });
      const body = method === "POST" ? await readBody(req) : null;
      // A file the bot's own tool wrote is granted by that tool's activity
      // message, the same way a Markdown link is by its text message.
      const writtenGrant = method === "POST" && message.role === "bot" && typeof body.path === "string" &&
        writtenFilesForMessage(message).includes(body.path);
      if (!writtenGrant && (message.kind !== "text" || (!message.text && !message.attachments?.length))) {
        return json(res, 403, { error: "that message does not share this file" });
      }
      const messageText = message.text ?? "";
      const rawReference = streamsMessageImage ? url.searchParams.get("ref") : null;
      if (streamsMessageImage && (!rawReference || !/^\d+$/.test(rawReference))) {
        return json(res, 400, { error: "ref must identify a rendered image" });
      }
      const href = method === "POST"
        ? (typeof body.path === "string" ? body.path : "")
        : messageImageTargetAt(messageText, Number(rawReference));
      if (!href) return json(res, 400, { error: "path is required" });

      let roots: string[];
      let downloadName: string | undefined;
      // A file the bot attached with attach_file lives in the private
      // attachment store; the message itself is the grant, exactly as a
      // user's attachment tag is for their own uploads.
      const botAttachment = message.role === "bot"
        ? message.attachments?.find((attachment: any) => attachment.path === href)
        : undefined;
      if (message.role === "user") {
        downloadName = messageAttachmentName(messageText, href) ?? undefined;
        if (!downloadName) {
          return json(res, 403, { error: "that message does not share this file" });
        }
        roots = [ATTACHMENTS_DIR];
      } else if (botAttachment) {
        // Files and images alike: the stored message is the grant, so the
        // mobile clients can fetch an attached image through this route too.
        downloadName = botAttachment.kind === "file" ? botAttachment.name : undefined;
        roots = [ATTACHMENTS_DIR];
      } else if (writtenGrant) {
        const senderId = directBot?.id ?? message.from?.botId;
        if (!senderId) return json(res, 403, { error: "the file's bot author could not be verified" });
        roots = messageFileRootsForThread(senderId, threadId);
      } else {
        if (!messageReferencesFile(messageText, href)) {
          return json(res, 403, { error: "that bot message does not link to this file" });
        }
        const senderId = directBot?.id ?? message.from?.botId;
        // The persisted bot-role message is the author record. Membership is
        // intentionally not consulted: removing a bot must not break files it
        // already shared in channel history.
        if (!senderId) {
          return json(res, 403, { error: "the file's bot author could not be verified" });
        }
        roots = messageFileRootsForThread(senderId, threadId);
      }

      // A link to a folder answers with its files; each one is then fetched
      // by plain name under the same message grant and file checks.
      const folderEntry = method === "POST" && body.entry !== undefined
        ? messageFolderEntryName(body.entry)
        : undefined;
      if (folderEntry === null) return json(res, 400, { error: "entry must be one file name" });
      const wantsLocation = method === "POST" && body?.location === true;
      if (wantsLocation && folderEntry !== undefined) {
        return json(res, 400, { error: "a folder entry has no streaming URL" });
      }
      let servedHref = href;
      let file: Awaited<ReturnType<typeof openMessageFile>>;
      try {
        file = folderEntry
          ? await openMessageFolderEntry(href, folderEntry, roots)
          : await openMessageFile(href, roots);
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        const status = (error as { status?: unknown } | null)?.status;
        if (wantsLocation && code === "directory") {
          return json(res, 400, { error: "the link points to a folder", code: "directory" });
        }
        // A reply's file outside the conversation's folders, or gone, that
        // its bot delivered with attach_file this turn: the stored copy is
        // what the reply shows and saves, as a chat link's would be.
        const name = message.role === "bot" && !botAttachment && !folderEntry && (code === "outside_workspace" || status === 404)
          ? referencedFileName(href)
          : null;
        const copy = name ? deliveredCopy(store.messagesFor(threadId), message, name) : null;
        if (copy) {
          file = await openMessageFile(copy.path, [ATTACHMENTS_DIR]);
          downloadName = copy.name;
          servedHref = copy.path;
        } else {
          // Only a client that asks for listings gets one; older clients keep the 400.
          if (body?.listFolder !== true || folderEntry || code !== "directory") throw error;
          const listing = await listMessageFolder(href, roots);
          res.setHeader("x-openmausbot-folder", "1");
          res.setHeader("cache-control", "private, no-store");
          return json(res, 200, listing);
        }
      }
      if ((streamsMessageImage || botAttachment?.kind === "image") && !file.mime.startsWith("image/")) {
        await file.handle.close();
        return json(res, 415, { error: "only images can be previewed here" });
      }
      if (wantsLocation) {
        // HTML media and the browser download manager need a GET URL. Return
        // only the opaque file-list capability, never the host path from the
        // POST body. The GET rechecks current thread and person visibility.
        const ref = threadFileRefForPath(threadId, servedHref, servedHref === href ? message.id : undefined);
        if (!ref) {
          await file.handle.close();
          return json(res, 404, { error: "this file is not on the visible conversation branch" });
        }
        const downloadUrl = `/api/threads/${encodeURIComponent(threadId)}/files/${encodeURIComponent(ref.id)}`;
        const name = messageFileDownloadName(downloadName, file.name);
        const answer = { downloadUrl, previewUrl: `${downloadUrl}?preview=1`, name, mime: file.mime, bytes: file.bytes };
        await file.handle.close();
        return json(res, 200, answer);
      }
      res.writeHead(200, {
        "content-type": file.mime,
        "content-length": String(file.bytes),
        ...(streamsMessageImage
          ? { "content-disposition": "inline" }
          : { "content-disposition": messageFileDisposition(messageFileDownloadName(downloadName, file.name)) }),
        // previews too: access to the thread can be withdrawn
        "cache-control": "private, no-store",
        "cdn-cache-control": "no-store",
        "cloudflare-cdn-cache-control": "no-store",
        pragma: "no-cache",
        vary: "Authorization",
        "x-content-type-options": "nosniff",
        ...(streamsMessageImage
          ? {
              "cross-origin-resource-policy": "same-origin",
              "referrer-policy": "no-referrer",
            }
          : {}),
      });
      if (file.bytes === 0) {
        await file.handle.close();
        res.end();
      return;
      }
      // The client may have gone while the file was opening: its "close"
      // already fired, so nothing would ever close the handle, and Node
      // fails the process when it collects an open FileHandle.
      if (res.destroyed) {
        await file.handle.close().catch(() => undefined);
        return;
      }
      const stream = file.stream();
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
      return;
    }

    // The conversation's files for the bot panel's Files tab: every upload,
    // attachment, linked file and tool-written file on the visible branch,
    // newest first, with size and whether this server can serve it.
    m = path.match(/^\/api\/threads\/([\w-]+)\/files$/);
    if (m && method === "GET") {
      const threadId = m[1]!;
      if (!store.botByThread(threadId) && !store.groupByThread(threadId)) {
        return json(res, 404, { error: "no such conversation" });
      }
      const files = await listThreadFiles(
        threadFileRefsFor(threadId),
        (ref) => statMessageFile(ref.path, threadFileRoots(threadId, ref)),
      );
      const pinned = threadFilePins.ids(threadId);
      return json(res, 200, { files: files.map((file: any) => pinned.has(file.id) ? { ...file, pinned: true } : file) });
    }

    // One of those files by its opaque id. Downloads and opt-in image/audio/
    // video previews stream from the authorized handle and honor one byte
    // range, so a 1 GiB video can seek without becoming a server or browser
    // buffer. The listing entry is the grant and no host path enters the URL.
    m = path.match(/^\/api\/threads\/([\w-]+)\/files\/([a-f0-9]{24})$/);
    if (m && method === "GET") {
      const threadId = m[1]!;
      if (!store.botByThread(threadId) && !store.groupByThread(threadId)) {
        return json(res, 404, { error: "no such conversation" });
      }
      const ref = threadFileRefForId(threadId, m![2]!);
      if (!ref) return json(res, 404, { error: "no such file in this conversation" });
      const preview = url.searchParams.get("preview") === "1";
      const thumb = url.searchParams.get("thumb") === "1";
      const file = await openMessageFile(ref.path, threadFileRoots(threadId, ref));
      if (thumb) {
        // Library row: a small square PNG, never the picture itself. Same
        // grant as the download (the listing entry and the roots above).
        try {
          if (!thumbnailable(file.mime) || file.bytes > THUMB_MAX_SOURCE_BYTES) {
            return json(res, 415, { error: "no thumbnail for this file" });
          }
          const stamp = (await file.handle.stat()).mtimeMs;
          const png = await thumbnailFor(`${threadId}:${ref.id}:${file.bytes}:${stamp}`, () => file.read(), file.mime);
          if (!png) return json(res, 415, { error: "no thumbnail for this file" });
          res.writeHead(200, {
            "content-type": "image/png",
            "content-length": String(png.length),
            "content-disposition": "inline",
            "cache-control": "private, no-store",
            "cdn-cache-control": "no-store",
            "cloudflare-cdn-cache-control": "no-store",
            pragma: "no-cache",
            vary: "Authorization",
            "x-content-type-options": "nosniff",
            "cross-origin-resource-policy": "same-origin",
            "referrer-policy": "no-referrer",
          });
          res.end(png);
      return;
        } finally {
          await file.handle.close().catch(() => undefined);
        }
      }
      const previewable = file.mime.startsWith("image/") || file.mime.startsWith("audio/") || file.mime.startsWith("video/");
      if (preview && !previewable) {
        await file.handle.close();
        return json(res, 415, { error: "this file format has no streaming preview" });
      }
      streamOpenedHttpFile(req, res, file, {
        "content-type": file.mime,
        "content-disposition": preview
          ? "inline"
          : messageFileDisposition(messageFileDownloadName(ref.source === "upload" || ref.source === "attachment" ? ref.name : undefined, file.name)),
        // previews too: access to the thread can be withdrawn
        "cache-control": "private, no-store",
        "cdn-cache-control": "no-store",
        "cloudflare-cdn-cache-control": "no-store",
        pragma: "no-cache",
        vary: "Authorization",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
        "referrer-policy": "no-referrer",
      });
      return;
    }

    // ── transcript export (the visible branch, human-readable) ──────────
    m = path.match(/^\/api\/threads\/([\w-]+)\/export$/);
    if (m && method === "GET") {
      const threadId = m[1];
      const bot = store.botByThread(threadId);
      const group = bot ? undefined : store.groupByThread(threadId);
      if (!bot && !group) return json(res, 404, { error: "no such conversation" });
      const format = url.searchParams.get("format") ?? "markdown";
      if (format !== "markdown" && format !== "json") {
        return json(res, 400, { error: "format must be markdown or json" });
      }
      const title = bot
        ? (store.taskByThread(bot.id, threadId)?.title || bot.name)
        : (store.groupTaskByThread(group!.id, threadId)?.title || group!.name);
      const filename = (title.replace(/[^\w\- ]+/g, "").trim() || "conversation").slice(0, 60);
      const messages = projectMessages(threadId, store.activePath(threadId), viewerForApproval(auth));
      if (format === "json") {
        // pixels stripped — an export is for reading and archiving, and a
        // base64 desktop frame is neither
        const slim = messages.map(({ png: _png, mime: _mime, ...rest }) => rest);
        res.writeHead(200, {
          "content-type": "application/json",
          "content-disposition": `attachment; filename="${filename}.json"`,
        });
        res.end(JSON.stringify({ name: title, threadId, messages: slim }, null, 2));
      return;
      }
      const userName = cfg.profile?.name?.trim() || "User";
      const lines: string[] = [`# ${title}`, ""];
      for (const msg of messages) {
        const sentBy = msg.sender?.name ?? userName;
        const who = msg.role === "user"
          ? msg.via === "api" ? `${sentBy} (via the local API)` : sentBy
          : (msg.from?.name ?? bot?.name ?? "Bot");
        // A widget exports as its text fallback (shared/widget.ts widgetToText).
        if ((msg.kind === "text" || msg.kind === "widget") && msg.text) lines.push(`**${who}:**`, "", msg.text, "");
        else if (msg.kind === "activity" && msg.tool) lines.push(`> ${msg.tool.name}`, "");
        else if (msg.kind === "screen") lines.push("> [screen capture]", "");
        else if (msg.kind === "options" && msg.card) {
          lines.push(`> ${msg.card.title}${msg.card.answered ? ` — answered: ${msg.card.answered}` : ""}`, "");
        }
      }
      res.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}.md"`,
      });
      res.end(lines.join("\n"));
      return;
    }

    // Emoji reactions (shared/reactions.ts, docs/messages-reactions.md): the
    // caller toggles their own on any text message of a thread they can
    // read, a 1:1 with a bot, a room or a conversation between people. Who
    // may reach the thread was decided above, as for reading it. The change
    // is a message patch: live to everyone who sees the thread, quiet (no
    // notification, no unread).
    m = path.match(/^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/reactions$/);
    if (m && method === "POST") {
      const [, threadId, messageId] = m;
      if (!store.botByThread(threadId!) && !store.groupByThread(threadId!)) return json(res, 404, { error: "no such conversation" });
      const body = await readBody(req);
      const emoji = reactionEmoji(body?.emoji);
      if (!emoji) return json(res, 400, { error: "emoji must be one emoji", code: "reaction_emoji" });
      const target = store.messagesFor(threadId!).find((message: any) => message.id === messageId);
      if (!target) return json(res, 404, { error: "no such message" });
      if (target.kind !== "text") return json(res, 400, { error: "only a chat message takes reactions", code: "reaction_kind" });
      const actor = reactionPersonFor(auth);
      if (!actor) return json(res, 403, { error: "only a person reacts here", code: "reaction_actor" });
      const mode = body?.mode === "add" || body?.mode === "remove" ? body.mode : "toggle";
      const result = store.reactToMessage(threadId!, messageId!, emoji, actor, { mode, legacyUser: legacyReactionUser() });
      if (!result) return json(res, 404, { error: "no such message" });
      if (result.full) return json(res, 409, { error: "this message has too many different reactions", code: "reaction_full" });
      return json(res, 200, { message: result.message, added: result.added, reactions: normalizeReactions(result.message.reactions) });
    }

    m = path.match(/^\/api\/threads\/([\w-]+)\/events$/);
    if (m && method === "GET") {
      const threadId = m[1];
      const known =
        store.bots.some((b: any) => store.tasks(b.id).some((t: any) => t.threadId === threadId)) ||
        Boolean(store.groupByThread(threadId));
      if (!known) return json(res, 404, { error: "no such thread" });
      const rawLimit = url.searchParams.get("limit");
      const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);
      if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit <= 0)) {
        return json(res, 400, { error: "limit must be a positive whole number" });
      }
      const limit = parsedLimit;
      return json(res, 200, readThreadEvents({ eventsDir: EVENTS_DIR, nativeDir: NATIVE_DIR, threadId, limit }));
    }

        return PASS;
      };
    }

