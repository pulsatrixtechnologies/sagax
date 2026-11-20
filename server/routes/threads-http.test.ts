// Characterization of the T1 threads-http routes moved out of server/index.ts
// (#1388): /api/events, cw-actions, read receipts, scrollback, files, export,
// reactions, threads/:id/events. Auth gate already ran; fake deps cover PASS,
// refusals, and happy paths.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { BotRecord, GroupRecord, Message } from "../store.ts";
import {
  createThreadsHttpRoutes,
  type ThreadsHttpRouteDeps,
  type ThreadsHttpStore,
} from "./threads-http.ts";
import { PASS, type RouteContext } from "./table.ts";

type Sent = { status: number; body: unknown };

const bot = {
  id: "b1",
  name: "Ada",
  threadId: "t1",
} as unknown as BotRecord;

const room = {
  id: "g1",
  name: "Ops",
  threadId: "t-g1",
  memberIds: ["b1"],
  humanIds: ["pr_member"],
  peopleDm: false,
  dm: false,
} as unknown as GroupRecord;

const textMessage = {
  id: "m1",
  role: "user",
  kind: "text",
  text: "hello",
  reactions: {},
} as unknown as Message;

const sessionMember: RequestAuth = {
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: {
    id: "s1",
    label: "web",
    scopes: ["client"],
    createdAt: 0,
    expiresAt: 0,
    lastUsedAt: 0,
    principalId: "pr_member",
  } as never,
};

function storeStub(over: Partial<ThreadsHttpStore> = {}): ThreadsHttpStore {
  return {
    bots: [bot],
    groups: [room],
    bot: (id) => (id === "b1" ? bot : null),
    botByThread: (tid) => (tid === "t1" ? bot : null),
    groupByThread: (tid) => (tid === "t-g1" ? room : null),
    tasks: () => [{ threadId: "t1" }],
    taskByThread: () => ({ threadId: "t1", title: "Chat" }),
    groupTaskByThread: () => ({ threadId: "t-g1", title: "General" }),
    messagesFor: (tid) => (tid === "t1" || tid === "t-g1" ? [textMessage] : []),
    activeLeaf: () => "m1",
    activePath: () => [textMessage],
    markRead: () => undefined,
    threadReads: () => ({ "person:pr_member": { messageId: "m1" } }),
    reactToMessage: () => ({ message: textMessage, added: true }),
    ...over,
  };
}

function baseDeps(over: Partial<ThreadsHttpRouteDeps> = {}): ThreadsHttpRouteDeps {
  return {
    store: storeStub(),
    identityKind: "solo",
    attachmentsDir: "/tmp/attachments-synthetic",
    eventsDir: "/tmp/events-synthetic",
    nativeDir: "/tmp/native-synthetic",
    defaultPage: 50,
    sseHeartbeatMs: 15_000,
    streamId: "stream1",
    cfg: { profile: { name: "Ann" } },
    actorPrincipalId: () => "pr_member",
    requestCwAction: vi.fn(async () => ({ status: 200, body: { ok: true } })),
    threadReadsFor: () => ({ "person:pr_member": { messageId: "m1" } }),
    personSendsReadReceipts: () => true,
    notePushRead: () => undefined,
    pageSize: () => 50,
    viewerForApproval: () => ({ id: "pr_member" } as never),
    messageWindow: () => ({ messages: [textMessage] }),
    messagePage: () => ({ messages: [textMessage] }),
    turnWorkplacePrincipal: () => undefined,
    messageFileRootsForThread: () => ["/tmp"],
    threadFileRefForPath: () => ({ id: "a".repeat(24) }),
    threadFileRefsFor: () => [],
    threadFileRoots: () => ["/tmp"],
    threadFileRefForId: () => null,
    threadFilePins: { ids: () => new Set() },
    streamOpenedHttpFile: () => undefined,
    projectMessages: (_t, messages) => [...messages],
    reactionPersonFor: () => ({ id: "person:pr_member", kind: "person", name: "Ann" }),
    legacyReactionUser: () => undefined,
    viewerFor: () => ({ kind: "all" }),
    visibleTo: () => ({ bot: () => true, group: () => true }),
    presenceViewer: () => ({ ok: false }),
    presence: { connect: () => null, touch: () => undefined },
    listedBotVisible: () => true,
    groupVisible: () => true,
    viewerId: () => "pr_member",
    channelViewerId: () => "pr_member",
    localPrincipalId: () => "pr_member",
    viewerIdentity: () => ({ name: "Ann" }),
    sessions: { isLive: () => true },
    sseClients: new Set(),
    cursorSeq: () => null,
    lastSeq: () => 0,
    audienceChangedAt: () => 0,
    replayBuffer: {
      covers: () => false,
      [Symbol.iterator]: function* () {},
    },
    wants: () => true,
    sseFrameFor: () => null,
    ...over,
  };
}

function call(
  deps: ThreadsHttpRouteDeps,
  opts: {
    method?: string;
    path?: string;
    auth?: RequestAuth;
    body?: unknown;
    query?: string;
    headers?: Record<string, string>;
    res?: Partial<ServerResponse>;
  } = {},
) {
  const sent: Sent[] = [];
  const path = opts.path ?? "/api/threads/t1/read";
  const url = new URL(`http://x${path}${opts.query ? `?${opts.query}` : ""}`);
  const route = createThreadsHttpRoutes(deps);
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    setHeader: () => undefined,
    writeHead: () => undefined,
    write: () => true,
    end: () => undefined,
    on: () => undefined,
    ...opts.res,
  } as unknown as ServerResponse;
  return (async () => {
    const out = await route({
      req: { headers: opts.headers ?? {}, socket: { setTimeout: () => undefined }, on: () => undefined } as unknown as IncomingMessage,
      res,
      url,
      path: url.pathname,
      method: opts.method ?? "GET",
      auth: opts.auth ?? sessionMember,
      json: ((_r, status, body) => { sent.push({ status, body }); }) as RouteContext["json"],
      readBody: (async () => opts.body ?? {}) as RouteContext["readBody"],
    });
    return { out, sent: sent[0], res };
  })();
}

describe("createThreadsHttpRoutes", () => {
  it("flushes pending stream deltas before honouring Last-Event-ID (#1971)", async () => {
    const flushed: string[] = [];
    const deps = baseDeps({
      lastSeq: () => 1,
      cursorSeq: () => 0,
      replayBuffer: {
        covers: () => true,
        [Symbol.iterator]: function* () {
          yield { seq: 1, kind: "runtime", payload: { kind: "runtime" }, frame: "id: s:1\ndata: {}\n\n", clientFrame: null };
        },
      },
      sseFrameFor: () => "id: s:1\ndata: {}\n\n",
      flushPendingStreamDeltas: () => { flushed.push("flush"); },
    });
    const writes: string[] = [];
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead: () => res,
      write: (chunk: string) => { writes.push(String(chunk)); return true; },
      end: () => res,
      on: () => res,
      setHeader: () => res,
      once: () => res,
    };
    await call(deps, {
      path: "/api/events",
      headers: { "last-event-id": "s:0" },
      res: res as never,
    });
    expect(flushed).toEqual(["flush"]);
    expect(writes.some((w) => w.includes('"resumed":true'))).toBe(true);
    // Stop the SSE heartbeat started by the route.
    for (const client of deps.sseClients) client.close();
  });

  it("returns PASS for foreign paths", async () => {
    const deps = baseDeps();
    expect((await call(deps, { path: "/api/bots" })).out).toBe(PASS);
    expect((await call(deps, { path: "/api/search" })).out).toBe(PASS);
    expect((await call(deps, { path: "/api/bots/b1/messages", method: "POST" })).out).toBe(PASS);
    expect((await call(deps, { path: "/api/groups/g1/messages", method: "POST" })).out).toBe(PASS);
  });

  it("answers read receipts on the happy path", async () => {
    const result = await call(baseDeps(), { path: "/api/threads/t1/read" });
    expect(result.sent?.status).toBe(200);
    expect(result.sent?.body).toMatchObject({ self: "pr_member" });
  });

  it("refuses a read receipt from a non-person", async () => {
    const deps = baseDeps({ actorPrincipalId: () => "" });
    const result = await call(deps, {
      path: "/api/threads/t1/read",
      method: "POST",
      body: { messageId: "m1" },
    });
    expect(result.sent?.status).toBe(403);
  });

  it("lists scrollback messages", async () => {
    const result = await call(baseDeps(), { path: "/api/threads/t1/messages" });
    expect(result.sent?.status).toBe(200);
    expect(result.sent?.body).toMatchObject({ messages: [textMessage], activeLeafId: "m1" });
  });

  it("404s scrollback for an unknown thread", async () => {
    const result = await call(baseDeps(), { path: "/api/threads/unknown/messages" });
    expect(result.sent?.status).toBe(404);
  });

  it("toggles a reaction on the happy path", async () => {
    const result = await call(baseDeps(), {
      path: "/api/threads/t1/messages/m1/reactions",
      method: "POST",
      body: { emoji: "👍" },
    });
    expect(result.sent?.status).toBe(200);
    expect(result.sent?.body).toMatchObject({ added: true });
  });

  it("refuses a reaction from a non-person", async () => {
    const deps = baseDeps({ reactionPersonFor: () => null });
    const result = await call(deps, {
      path: "/api/threads/t1/messages/m1/reactions",
      method: "POST",
      body: { emoji: "👍" },
    });
    expect(result.sent?.status).toBe(403);
  });

  it("forwards cw-actions", async () => {
    const requestCwAction = vi.fn(async () => ({ status: 200, body: { ok: true, id: "cw1" } }));
    const result = await call(baseDeps({ requestCwAction }), {
      path: "/api/threads/t1/cw-actions",
      method: "POST",
      body: { action: "approve" },
    });
    expect(requestCwAction).toHaveBeenCalled();
    expect(result.sent?.status).toBe(200);
  });

  it("lists conversation files", async () => {
    const result = await call(baseDeps(), { path: "/api/threads/t1/files" });
    expect(result.sent?.status).toBe(200);
    expect(result.sent?.body).toMatchObject({ files: [] });
  });

  it("reads thread events for a known thread", async () => {
    const result = await call(baseDeps(), { path: "/api/threads/t1/events" });
    // readThreadEvents reads from disk; empty dirs yield an empty page shape or throw.
    // A missing log answers as an empty inspector page (status 200).
    expect(result.out).not.toBe(PASS);
    expect(result.sent?.status === 200 || result.sent === undefined).toBe(true);
  });
});

// #5152: the local operator's stream. On an organization server the operator
// is one person among others: their stream is filtered for them (their own
// bots), whether they come through loopback or through an admin session that
// is the local operator. On a one-person server it is not filtered at all.
describe("the local operator's live stream (#5152)", () => {
  const loopbackOwner: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
  const operatorSession: RequestAuth = {
    kind: "session",
    via: "bearer",
    scopes: ["admin", "client"],
    session: { id: "s-op", label: "phone", scopes: ["admin", "client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, principalId: "pr_local" } as never,
  };
  const memberSession: RequestAuth = {
    kind: "session",
    via: "cookie",
    scopes: ["client"],
    session: { id: "s-mb", label: "web", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, principalId: "pr_member" } as never,
  };
  // channelFilterViewerId: the local operator (loopback, or their own admin session) has none
  const filterViewer = (auth: RequestAuth) => auth.kind === "session" && auth.session.principalId !== "pr_local" ? auth.session.principalId : undefined;
  const streamOf = async (identityKind: "solo" | "perspicax", auth: RequestAuth) => {
    const deps = baseDeps({
      identityKind,
      viewerId: filterViewer,
      channelViewerId: (a) => (a.kind === "session" ? a.session.principalId : undefined),
      localPrincipalId: () => "pr_local",
    });
    const res = { headersSent: false, writableEnded: false, destroyed: false, writeHead: () => res, write: () => true, end: () => res, on: () => res, setHeader: () => res, once: () => res };
    await call(deps, { path: "/api/events", auth, res: res as never });
    const [client] = [...deps.sseClients];
    for (const open of deps.sseClients) open.close();
    return client as { viewerId?: string; admin: boolean };
  };

  it("an organization server filters the operator's stream for the operator, through loopback", async () => {
    const client = await streamOf("perspicax", loopbackOwner);
    expect(client.admin).toBe(true);
    expect(client.viewerId).toBe("pr_local");
  });

  it("an organization server filters the operator's own admin session for the operator", async () => {
    expect((await streamOf("perspicax", operatorSession)).viewerId).toBe("pr_local");
  });

  it("a member's stream stays filtered for the member", async () => {
    expect((await streamOf("perspicax", memberSession)).viewerId).toBe("pr_member");
    expect((await streamOf("solo", memberSession)).viewerId).toBe("pr_member");
  });

  it("a one-person server leaves the operator's stream unfiltered: every frame, computer and phone", async () => {
    expect((await streamOf("solo", loopbackOwner)).viewerId).toBeUndefined();
    expect((await streamOf("solo", operatorSession)).viewerId).toBeUndefined();
  });
});
