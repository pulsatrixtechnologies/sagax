// GET /api/team-board (#3409): person B never receives a card, repository,
// bot name or cached GitHub answer of person A.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { json, readBody } from "../harness/http.ts";
import type { BotActivityItem } from "../../shared/bot-activity.ts";
import type { TeamBoard } from "../../shared/team-board.ts";
import { createGithubBoardReader } from "../team-board/github-board.ts";
import type { BoardBot, BoardEntry, BoardTeam } from "../team-board/board.ts";
import type { TeamBoardSourceDeps } from "../pages/sources/team-board.ts";
import { createTeamBoardRoutes } from "./team-board.ts";
import { dispatchRoutes } from "./table.ts";

const NOW = 1_800_000_000_000;
const TOKEN_A = "ghp_tokenOfPersonA_xxxxxxxxxxxxxxxxxxxx";
const TOKEN_B = "ghp_tokenOfPersonB_yyyyyyyyyyyyyyyyyyyy";

const session = (principalId: string): RequestAuth =>
  ({ kind: "session", via: "cookie", scopes: ["client"], session: { principalId } }) as unknown as RequestAuth;

function item(botId: string, botName: string, threadId: string, code: BotActivityItem["code"]): BotActivityItem {
  return {
    id: `thread:${threadId}`, kind: "session", botId, botName, title: "work",
    status: "finished", startedAt: NOW - 5_000, updatedAt: NOW - 1_000, threadId, code,
  };
}

interface World {
  teams: BoardTeam[];
  bots: BoardBot[];
  entries: BoardEntry[];
  token?: string;
}

const PEOPLE: Record<string, World> = {
  "person-a": {
    teams: [{ sectionId: "team-a", name: "Alpha team", bots: [{ id: "bot-a", name: "Alpha bot" }] }],
    bots: [{ id: "bot-a", name: "Alpha bot" }, { id: "lead-a", name: "Alpha lead", managedSections: ["Alpha team"] }],
    entries: [{
      botId: "bot-a",
      item: item("bot-a", "Alpha bot", "thread-a", {
        repo: "acme/shared",
        pullRequests: [],
        branches: [{ name: "feat/7-secret", repo: "acme/a-only", pushed: true, at: NOW - 1_000 }],
        commits: [],
        issues: [{ repo: "acme/shared", number: 7, action: "commented", at: NOW - 1_000 }],
      }),
    }],
    token: TOKEN_A,
  },
  "person-b": {
    teams: [{ sectionId: "team-b", name: "Beta team", bots: [{ id: "bot-b", name: "Beta bot" }] }],
    bots: [{ id: "bot-b", name: "Beta bot" }],
    entries: [{
      botId: "bot-b",
      item: item("bot-b", "Beta bot", "thread-b", {
        repo: "acme/shared", pullRequests: [], branches: [], commits: [],
        issues: [{ repo: "acme/shared", number: 9, action: "viewed", at: NOW - 1_000 }],
      }),
    }],
    token: TOKEN_B,
  },
};

const repoAnswer = (issues: Array<{ number: number; title: string }>) => ({
  data: {
    repository: {
      issues: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: issues.map((issue) => ({ ...issue, url: `https://github.com/acme/shared/issues/${issue.number}` })),
      },
      pullRequests: { nodes: [] },
    },
  },
});

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

function world() {
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const auth = String((init!.headers as Record<string, string>).authorization);
    const name = (JSON.parse(String(init?.body)) as { variables: { name: string } }).variables.name;
    const body = name !== "shared" ? repoAnswer([])
      : auth.includes(TOKEN_A)
        ? repoAnswer([{ number: 7, title: "Secret A issue" }, { number: 8, title: "Another A only title" }])
        : repoAnswer([{ number: 9, title: "B issue" }]);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  const github = createGithubBoardReader({
    token: (person) => PEOPLE[person]?.token,
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => NOW,
  });
  const personId = (auth: RequestAuth) =>
    (auth as { session?: { principalId?: string } }).session?.principalId;
  const of = (auth: RequestAuth) => PEOPLE[personId(auth)!]!;
  const board: TeamBoardSourceDeps = {
    person: (auth) => personId(auth),
    viewerId: (auth) => personId(auth),
    teams: (auth) => of(auth).teams,
    bots: (auth) => of(auth).bots,
    entries: (bot, viewerId) => PEOPLE[viewerId!]!.entries.filter((entry) => entry.botId === bot.id),
    github,
    now: () => NOW,
  };
  return board;
}

async function serve(board: TeamBoardSourceDeps, auth: RequestAuth) {
  const routes = [createTeamBoardRoutes({ board })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody,
    })) json(res, 404, { error: "unrouted" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const get = async (path = "/api/team-board") => {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`);
    return { status: res.status, body: await res.json() as TeamBoard & { code?: string; error?: string } };
  };
  return { get };
}

describe("GET /api/team-board", () => {
  it("never gives person B a card, repository, bot name or cached GitHub answer of person A", async () => {
    const board = world();
    const a = await serve(board, session("person-a"));
    const boardA = await a.get();
    expect(boardA.status).toBe(200);
    expect(boardA.body.lanes.map((lane) => lane.name)).toEqual(["Alpha team"]);
    expect(JSON.stringify(boardA.body)).toContain("Secret A issue");
    expect(JSON.stringify(boardA.body)).toContain("Alpha bot");
    expect(JSON.stringify(boardA.body)).toContain("acme/a-only");

    const b = await serve(board, session("person-b"));
    const boardB = await b.get();
    expect(boardB.status).toBe(200);
    expect(boardB.body.lanes.map((lane) => lane.name)).toEqual(["Beta team"]);
    const text = JSON.stringify(boardB.body);
    expect(text).not.toContain("Secret A issue");
    expect(text).not.toContain("Alpha bot");
    expect(text).not.toContain("acme/a-only");
    expect(text).not.toContain("person-a");
    expect(text).toContain("B issue");
  });

  it("refuses a caller with no person", async () => {
    const board = world();
    const anon = await serve(board, { kind: "none" } as unknown as RequestAuth);
    const answer = await anon.get();
    expect(answer.status).toBe(401);
    expect(answer.body.code).toBe("sign_in");
  });

  it("refuses an unknown team filter", async () => {
    const board = world();
    const a = await serve(board, session("person-a"));
    const answer = await a.get("/api/team-board?team=not-mine");
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe("bad_request");
  });
});
