// The `team-board` page source (#3413, from #3409). Blocking guard first:
// one person never receives a card, repository, bot name or cached GitHub
// answer of another, even when both work on the same repository.
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../../auth/request-auth.ts";
import type { BotActivityItem } from "../../../shared/bot-activity.ts";
import type { TeamBoard } from "../../../shared/team-board.ts";
import { createGithubBoardReader, TEAM_BOARD_GITHUB_TTL_MS } from "../../team-board/github-board.ts";
import type { BoardBot, BoardEntry, BoardTeam } from "../../team-board/board.ts";
import { createTeamBoardSource, teamBoardExits, type TeamBoardSourceDeps } from "./team-board.ts";

const NOW = 1_800_000_000_000;
const TOKEN_A = "ghp_tokenOfPersonA_xxxxxxxxxxxxxxxxxxxx";
const TOKEN_B = "ghp_tokenOfPersonB_yyyyyyyyyyyyyyyyyyyy";

const session = (principalId: string) => ({ kind: "session", via: "cookie", scopes: ["client"], session: { principalId } }) as unknown as RequestAuth;

function item(botId: string, botName: string, threadId: string, code: BotActivityItem["code"], over: Partial<BotActivityItem> = {}): BotActivityItem {
  return { id: `thread:${threadId}`, kind: "session", botId, botName, title: "work", status: "finished", startedAt: NOW - 5_000, updatedAt: NOW - 1_000, threadId, code, ...over };
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
      item: item("bot-b", "Beta bot", "thread-b", { repo: "acme/shared", pullRequests: [], branches: [], commits: [], issues: [{ repo: "acme/shared", number: 9, action: "viewed", at: NOW - 1_000 }] }),
    }],
    token: TOKEN_B,
  },
};

const repoAnswer = (issues: Array<{ number: number; title: string }>) => ({
  data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: issues.map((issue) => ({ ...issue, url: `https://github.com/acme/shared/issues/${issue.number}` })) }, pullRequests: { nodes: [] } } },
});

function world(options: { failFor?: string } = {}) {
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const auth = String((init!.headers as Record<string, string>).authorization);
    if (options.failFor && auth.includes(options.failFor)) return new Response("{}", { status: 502 });
    const name = (JSON.parse(String(init?.body)) as { variables: { name: string } }).variables.name;
    const body = name !== "shared" ? repoAnswer([])
      : auth.includes(TOKEN_A)
      ? repoAnswer([{ number: 7, title: "Secret A issue" }, { number: 8, title: "Another A only title" }])
      : repoAnswer([{ number: 9, title: "B issue" }]);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  let now = NOW;
  const github = createGithubBoardReader({ token: (person) => PEOPLE[person]?.token, fetch: fetch as unknown as typeof globalThis.fetch, now: () => now });
  const of = (auth: RequestAuth) => PEOPLE[(auth as { session: { principalId: string } }).session.principalId]!;
  const deps: TeamBoardSourceDeps = {
    person: (auth) => (auth as { session: { principalId: string } }).session.principalId,
    viewerId: (auth) => (auth as { session: { principalId: string } }).session.principalId,
    teams: (auth) => of(auth).teams,
    bots: (auth) => of(auth).bots,
    entries: (bot, viewerId) => PEOPLE[viewerId!]!.entries.filter((entry) => entry.botId === bot.id),
    github,
    now: () => now,
  };
  return { routes: createTeamBoardSource(deps), fetch, advance: (ms: number) => { now += ms; } };
}

async function call(source: ReturnType<typeof createTeamBoardSource>, auth: RequestAuth, path = "") {
  const read = await source.read(auth, { params: {}, fresh: path.includes("fresh=1") });
  return { sent: [{ status: 200, body: read.value }], topics: read.topics };
}

describe("team-board source: isolation between people", () => {
  it("never gives person B a card, repository, bot name or cached GitHub answer of person A", async () => {
    const { routes } = world({ failFor: TOKEN_B });
    const a = await call(routes, session("person-a"));
    const boardA = a.sent[0]!.body as TeamBoard;
    expect(boardA.lanes.map((lane) => lane.name)).toEqual(["Alpha team"]);
    expect(JSON.stringify(boardA)).toContain("Secret A issue");

    // B works on the same repository; GitHub refuses B's token. A's cached
    // snapshot of acme/shared must not be served to B.
    const b = await call(routes, session("person-b"));
    const text = JSON.stringify(b.sent[0]!.body);
    for (const leak of ["Secret A issue", "Another A only title", "Alpha bot", "Alpha lead", "Alpha team", "team-a", "acme/a-only", "thread-a", "bot-a", TOKEN_A, TOKEN_B]) {
      expect(text).not.toContain(leak);
    }
    const boardB = b.sent[0]!.body as TeamBoard;
    expect(boardB.github.state).toBe("unavailable");
    expect(boardB.lanes.map((lane) => lane.name)).toEqual(["Beta team"]);
  });

  it("reads GitHub with each person's own token, never another's", async () => {
    const { routes, fetch } = world();
    const tokens = () => fetch.mock.calls.map(([, init]) => String((init!.headers as Record<string, string>).authorization));
    await call(routes, session("person-a"));
    const readsOfA = tokens();
    expect(new Set(readsOfA)).toEqual(new Set([`bearer ${TOKEN_A}`]));
    await call(routes, session("person-b"));
    // B's own read of acme/shared, not A's cached one
    expect(tokens().slice(readsOfA.length)).toEqual([`bearer ${TOKEN_B}`]);
    const b = await call(routes, session("person-b"));
    expect(JSON.stringify(b.sent[0]!.body)).not.toContain("Secret A issue");
  });
});

describe("team-board source", () => {
  it("names the reader's own bots as its live topics", async () => {
    const { routes } = world();
    expect((await call(routes, session("person-b"))).topics).toEqual(["bot-b"]);
  });

  it("builds lanes with the lead, the repositories and the cards in their columns", async () => {
    const { routes } = world();
    const board = (await call(routes, session("person-a"))).sent[0]!.body as TeamBoard;
    const lane = board.lanes[0]!;
    expect(lane.lead).toEqual({ botId: "lead-a", name: "Alpha lead" });
    expect(lane.repos).toEqual(["acme/a-only", "acme/shared"]);
    const byNumber = Object.fromEntries(lane.cards.filter((card) => card.repo === "acme/shared").map((card) => [card.number, card.column]));
    expect(byNumber).toEqual({ 7: "design", 8: "todo" });
    const design = lane.cards.find((card) => card.number === 7)!;
    expect(design.holder).toEqual({ botId: "bot-a", name: "Alpha bot", threadId: "thread-a", ref: "thread:bot-a:thread-a" });
    expect(design.status).toBe("taken");
    expect(design.sectionId).toBe("team-a");
    expect(board.summary.inProgress).toBe(1);
    expect(board.github).toEqual({ state: "ok", at: NOW });
  });

  it("reuses GitHub's answer for a minute, and fresh=1 reads again", async () => {
    const { routes, fetch, advance } = world();
    await call(routes, session("person-a"));
    await call(routes, session("person-a"));
    const reads = fetch.mock.calls.length;
    await call(routes, session("person-a"), "fresh=1");
    expect(fetch.mock.calls.length).toBeGreaterThan(reads);
    advance(TEAM_BOARD_GITHUB_TTL_MS + 1);
    const before = fetch.mock.calls.length;
    await call(routes, session("person-a"));
    expect(fetch.mock.calls.length).toBeGreaterThan(before);
  });

  it("keeps the last good snapshot, marked stale, when GitHub stops answering", async () => {
    let fail = false;
    const fetch = vi.fn(async () => (fail ? new Response("{}", { status: 502 }) : new Response(JSON.stringify(repoAnswer([{ number: 7, title: "Secret A issue" }])), { status: 200 })));
    let now = NOW;
    const reader = createGithubBoardReader({ token: () => TOKEN_A, fetch: fetch as unknown as typeof globalThis.fetch, now: () => now });
    await reader.read("person-a", ["acme/shared"]);
    fail = true;
    now += TEAM_BOARD_GITHUB_TTL_MS + 1;
    const read = await reader.read("person-a", ["acme/shared"]);
    expect(read.state).toBe("stale");
    expect(read.at).toBe(NOW);
    expect(read.snapshots.get("acme/shared")?.issues.map((issue) => issue.title)).toEqual(["Secret A issue"]);
  });

  it("says not connected, with no token and no gh sign-in, and never reads GitHub", async () => {
    const fetch = vi.fn();
    const reader = createGithubBoardReader({ token: () => undefined, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await reader.read("person-a", ["acme/shared"])).toEqual({ snapshots: new Map(), state: "not_connected", fix: "connect_or_token" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("team-board exits (#3413 review)", () => {
  it("names only the issue and pull request addresses of the board's repositories, never a title", () => {
    const card = (over: Record<string, unknown>) => ({ key: "k", repo: "acme/shared", number: 1, title: "https://x.example/a", issueUrl: "https://github.com/acme/shared/issues/1", column: "code", sectionId: "s", status: "taken", createdAt: NOW, ...over });
    const board = {
      lanes: [{ sectionId: "s", name: "T", repos: ["acme/shared"], cards: [
        card({ pull: { number: 2, url: "https://github.com/acme/shared/pull/2" }, holder: { botId: "b", name: "B", ref: "thread:b:t" }, blocked: { source: "turn", reason: "https://x.example/b" } }),
        card({ number: 3, issueUrl: "https://github.com/other/repo/issues/3" }),
        card({ number: 4, issueUrl: "https://x.example/c" }),
      ] }],
      at: NOW, github: { state: "ok" }, summary: { inProgress: 0, waitingYou: 0, blocked: 0, mergedThisWeek: 0 }, todoTotal: {},
    } as unknown as TeamBoard;
    expect(teamBoardExits(board)).toEqual({
      links: ["https://github.com/acme/shared/issues/1", "https://github.com/acme/shared/pull/2"],
      refs: ["thread:b:t"],
    });
  });

  it("gives the true count of open issues per repository", async () => {
    const { routes } = world();
    const board = (await call(routes, session("person-a"))).sent[0]!.body as TeamBoard;
    expect(board.todoTotal["acme/shared"]).toBe(2);
  });
});

describe("open issues read (#3413 review)", () => {
  it("reads at most 300, in pages of 100, and keeps GitHub's true count", async () => {
    let page = 0;
    const fetch = vi.fn(async () => {
      page += 1;
      const nodes = Array.from({ length: 100 }, (_, index) => ({ number: page * 1000 + index, title: "t", url: `https://github.com/acme/big/issues/${page * 1000 + index}` }));
      return new Response(JSON.stringify({ data: { repository: { issues: { totalCount: 450, pageInfo: { hasNextPage: true, endCursor: `c${page}` }, nodes }, pullRequests: { nodes: [] } } } }), { status: 200 });
    });
    const reader = createGithubBoardReader({ token: () => TOKEN_A, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW });
    const read = await reader.read("person-a", ["acme/big"]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(read.snapshots.get("acme/big")?.issues).toHaveLength(300);
    expect(read.snapshots.get("acme/big")?.openIssues).toBe(450);
  });
});
