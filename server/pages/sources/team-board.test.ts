// The `team-board` page source (#3413, from #3409). Blocking guard first:
// one person never receives a card, repository, bot name or cached GitHub
// answer of another, even when both work on the same repository.
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../../auth/request-auth.ts";
import type { BotActivityItem } from "../../../shared/bot-activity.ts";
import type { TeamBoard } from "../../../shared/team-board.ts";
import { createGithubBoardReader, TEAM_BOARD_GITHUB_TTL_MS, TEAM_BOARD_RELEASE_LABEL_CHARS, TEAM_BOARD_RELEASES } from "../../team-board/github-board.ts";
import { buildTeamBoard, waitingCardOf, type BoardBot, type BoardEntry, type BoardTeam } from "../../team-board/board.ts";
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
    expect(await reader.read("person-a", ["acme/shared"])).toEqual({ snapshots: new Map(), state: "not_connected", fix: "connect_or_token", reason: "not_connected" });
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

// #3449: stable codes, a filter, the To do count per team, and the release
// of a merged card.
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const readOnce = async (fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>, token: string | null = TOKEN_A, extra: Partial<Parameters<typeof createGithubBoardReader>[0]> = {}) =>
  createGithubBoardReader({ token: () => token ?? undefined, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW, ...extra }).read("person-a", ["acme/shared"]);

describe("github.reason (#3449): a stable code beside github.fix", () => {
  it("says not_connected without a token or a gh sign-in", async () => {
    const read = await readOnce(vi.fn(), null);
    expect(read.reason).toBe("not_connected");
  });

  it("tells sso, token_scope, rate_limited (primary and secondary), no_access and outage apart", async () => {
    expect((await readOnce(async () => json({}, 403, { "x-github-sso": "required; url=https://github.com/orgs/acme/sso?x=1" }))).reason).toBe("sso");
    expect((await readOnce(async () => json({}, 403))).reason).toBe("token_scope");
    expect((await readOnce(async () => json({}, 403, { "x-ratelimit-remaining": "0" }))).reason).toBe("rate_limited");
    expect((await readOnce(async () => json({}, 403, { "retry-after": "60" }))).reason).toBe("rate_limited");
    expect((await readOnce(async () => json({}, 401))).reason).toBe("bad_token");
    expect((await readOnce(async () => json({}, 502))).reason).toBe("outage");
    expect((await readOnce(async () => { throw new Error("socket hang up"); })).reason).toBe("outage");
    // GraphQL answers 200 with typed errors
    expect((await readOnce(async () => json({ data: { repository: null }, errors: [{ type: "NOT_FOUND" }] }))).reason).toBe("no_access");
    expect((await readOnce(async () => json({ data: null, errors: [{ type: "RATE_LIMITED" }] }))).reason).toBe("rate_limited");
    expect((await readOnce(async () => json({ data: { repository: null }, errors: [{ type: "INSUFFICIENT_SCOPES" }] }))).reason).toBe("token_scope");
    expect((await readOnce(async () => json({ data: { repository: null }, errors: [{ type: "FORBIDDEN" }] }))).reason).toBe("token_scope");
  });

  it("never puts the token in the reason, the fix or anything it answers", async () => {
    const read = await readOnce(async () => json({ message: `bad ${TOKEN_A}` }, 401));
    expect(JSON.stringify({ ...read, snapshots: [...read.snapshots] })).not.toContain(TOKEN_A);
  });

  it("reaches the board's github block, beside the prose fix", async () => {
    const { routes } = world({ failFor: TOKEN_B });
    const board = (await call(routes, session("person-b"))).sent[0]!.body as TeamBoard;
    expect(board.github).toMatchObject({ state: "unavailable", reason: "outage" });
  });
});

describe("filter (#3449): one team, one column, validated by the source", () => {
  const TWO: World = {
    teams: [
      { sectionId: "team-1", name: "One", bots: [{ id: "bot-1", name: "Bot one" }] },
      { sectionId: "team-2", name: "Two", bots: [{ id: "bot-2", name: "Bot two" }] },
    ],
    bots: [{ id: "bot-1", name: "Bot one" }, { id: "bot-2", name: "Bot two" }],
    entries: [
      { botId: "bot-1", item: item("bot-1", "Bot one", "th-1", { repo: "acme/one", pullRequests: [], branches: [], commits: [], issues: [{ repo: "acme/one", number: 1, action: "viewed", at: NOW - 1_000 }] }) },
      { botId: "bot-2", item: item("bot-2", "Bot two", "th-2", { repo: "acme/two", pullRequests: [], branches: [], commits: [], issues: [{ repo: "acme/two", number: 2, action: "viewed", at: NOW - 1_000 }] }) },
    ],
    token: TOKEN_A,
  };
  function two() {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const name = (JSON.parse(String(init?.body)) as { variables: { name: string } }).variables.name;
      return json({ data: { repository: { issues: { totalCount: 2, pageInfo: { hasNextPage: false }, nodes: [{ number: name === "one" ? 1 : 2, title: `t ${name}`, url: `https://github.com/acme/${name}/issues/${name === "one" ? 1 : 2}` }, { number: 50, title: "free", url: `https://github.com/acme/${name}/issues/50` }] }, pullRequests: { nodes: [] } } } });
    });
    const github = createGithubBoardReader({ token: () => TOKEN_A, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW });
    const deps: TeamBoardSourceDeps = {
      person: (auth) => (auth as { session: { principalId: string } }).session.principalId,
      viewerId: () => "person-a",
      teams: () => TWO.teams,
      bots: () => TWO.bots,
      entries: (bot) => TWO.entries.filter((entry) => entry.botId === bot.id),
      github,
      now: () => NOW,
    };
    return { source: createTeamBoardSource(deps), fetch };
  }
  const repoNames = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { variables: { name: string } }).variables.name);

  it("keeps one team's lane and reads GitHub for its repositories only", async () => {
    const { source, fetch } = two();
    const board = (await source.read(session("person-a"), { params: { team: "team-2" }, fresh: false })).value as TeamBoard;
    expect(board.lanes.map((lane) => lane.sectionId)).toEqual(["team-2"]);
    expect(repoNames(fetch)).toEqual(["two"]);
    expect(Object.keys(board.todoTotal)).toEqual(["acme/two"]);
  });

  it("keeps one column", async () => {
    const { source } = two();
    const board = (await source.read(session("person-a"), { params: { column: "todo" }, fresh: false })).value as TeamBoard;
    expect(board.lanes.flatMap((lane) => lane.cards.map((card) => card.column))).toEqual(["todo", "todo"]);
  });

  it("refuses a team that is not the reader's, a column that does not exist and an unknown parameter, without reading", async () => {
    const { source, fetch } = two();
    for (const params of [{ team: "team-a" }, { column: "doing" }, { lane: "x" }, { team: 3 }]) {
      await expect(source.read(session("person-a"), { params, fresh: false })).rejects.toMatchObject({ code: "bad_request", status: 400 });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the cache per person: B filtered never gets A's snapshot", async () => {
    const { routes, fetch } = world({ failFor: TOKEN_B });
    await routes.read(session("person-a"), { params: {}, fresh: false });
    const b = await routes.read(session("person-b"), { params: { team: "team-b" }, fresh: false });
    expect(JSON.stringify(b.value)).not.toContain("Secret A issue");
    expect(fetch.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("To do count per team (#3449)", () => {
  it("says, per lane, how many open issues of its repositories were not loaded", async () => {
    let page = 0;
    const fetch = vi.fn(async () => {
      page += 1;
      const nodes = Array.from({ length: 100 }, (_, index) => ({ number: page * 1000 + index, title: "t", url: `https://github.com/acme/shared/issues/${page * 1000 + index}` }));
      return json({ data: { repository: { issues: { totalCount: 450, pageInfo: { hasNextPage: true, endCursor: `c${page}` }, nodes }, pullRequests: { nodes: [] } } } });
    });
    const github = createGithubBoardReader({ token: () => TOKEN_A, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW });
    const source = createTeamBoardSource({
      person: () => "person-a", viewerId: () => "person-a",
      teams: () => [{ sectionId: "team-b", name: "Beta team", bots: [{ id: "bot-b", name: "Beta bot" }] }],
      bots: () => [{ id: "bot-b", name: "Beta bot" }],
      entries: () => PEOPLE["person-b"]!.entries,
      github, now: () => NOW,
    });
    const board = (await source.read(session("person-a"), { params: {}, fresh: false })).value as TeamBoard;
    expect(board.lanes[0]!.todoNotLoaded).toBe(150);
    expect(board.todoTotal["acme/shared"]).toBe(450);
  });
});

describe("release of a card (#3449, lot P2 of #3409)", () => {
  const DAY = 86_400_000;
  const iso = (at: number) => new Date(at).toISOString();
  const MERGE_OID = "a".repeat(40);
  const OLD_MERGE_OID = "c".repeat(40);
  const TAG_84 = "d".repeat(40);
  const TAG_83 = "e".repeat(40);
  const graph = {
    data: { repository: {
      issues: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [
        { number: 30, title: "Planned", url: "https://github.com/acme/shared/issues/30", createdAt: iso(NOW - DAY), milestone: { title: "0.9.0", state: "OPEN" } },
      ] },
      pullRequests: { nodes: [
        { number: 20, url: "https://github.com/acme/shared/pull/20", title: "Fix", state: "MERGED", isDraft: false, mergedAt: iso(NOW - 2 * DAY), headRefName: "feat/11-fix", baseRefName: "main",
          mergeCommit: { oid: OLD_MERGE_OID, committedDate: iso(NOW - 2 * DAY) },
          closingIssuesReferences: { nodes: [{ number: 11, title: "Shipped one", url: "https://github.com/acme/shared/issues/11", state: "CLOSED", repository: { nameWithOwner: "acme/shared" } }] } },
        { number: 21, url: "https://github.com/acme/shared/pull/21", title: "New", state: "MERGED", isDraft: false, mergedAt: iso(NOW - 3_600_000), headRefName: "feat/12-new", baseRefName: "main",
          mergeCommit: { oid: MERGE_OID, committedDate: iso(NOW - 3_600_000) },
          closingIssuesReferences: { nodes: [{ number: 12, title: "Not cut", url: "https://github.com/acme/shared/issues/12", state: "CLOSED", repository: { nameWithOwner: "acme/shared" } }] } },
      ] },
      releases: { nodes: [
        { tagName: "pulsa-v0.8.84", name: "pulsa-v0.8.84", url: "https://github.com/acme/shared/releases/tag/pulsa-v0.8.84", publishedAt: iso(NOW - DAY), isDraft: false, tagCommit: { oid: "d".repeat(40), committedDate: iso(NOW - DAY) } },
        { tagName: "pulsa-v0.8.83", name: "", url: "https://github.com/acme/shared/releases/tag/pulsa-v0.8.83", publishedAt: iso(NOW - 1.5 * DAY), isDraft: false, tagCommit: { oid: "e".repeat(40), committedDate: iso(NOW - 1.5 * DAY) } },
        { tagName: "draft", name: "draft", url: "https://github.com/acme/shared/releases/tag/untagged", publishedAt: null, isDraft: true, tagCommit: null },
      ] },
      refs: { nodes: [] },
    } },
  };
  function released(compare: (base: string, head: string) => string | null, releases?: unknown[]) {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const address = String(url);
      const match = /\/repos\/acme\/shared\/compare\/([\w.-]+)\.\.\.([\w.-]+)/.exec(address);
      if (match) {
        const status = compare(match[1]!, match[2]!);
        return status ? json({ status, ahead_by: 0, behind_by: 1, commits: [], files: [] }) : json({}, 500);
      }
      return json(releases ? { data: { repository: { ...graph.data.repository, releases: { nodes: releases } } } } : graph);
    });
    const github = createGithubBoardReader({ token: () => TOKEN_A, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW });
    const source = createTeamBoardSource({
      person: () => "person-a", viewerId: () => "person-a",
      teams: () => [{ sectionId: "team-a", name: "Alpha team", bots: [{ id: "bot-a", name: "Alpha bot" }] }],
      bots: () => [{ id: "bot-a", name: "Alpha bot" }],
      entries: () => [{ botId: "bot-a", item: item("bot-a", "Alpha bot", "thread-a", {
        repo: "acme/shared", pullRequests: [], commits: [],
        branches: [{ name: "feat/11-fix", repo: "acme/shared", pushed: true, at: NOW - 2 * DAY }, { name: "feat/12-new", repo: "acme/shared", pushed: true, at: NOW - 3_600_000 }],
        issues: [{ repo: "acme/shared", number: 30, action: "viewed", at: NOW - 1_000 }],
      }) }],
      github, now: () => NOW,
    });
    return { source, fetch };
  }
  const cardOf = (board: TeamBoard, number: number) => board.lanes.flatMap((lane) => lane.cards).find((card) => card.number === number)!;

  it("gives a merged card the oldest release whose tag contains its merge, its merge date and the released status", async () => {
    // the tag of 0.8.83 contains the merge (the merge is behind the tag)
    const { source, fetch } = released((base) => (base === TAG_83 ? "behind" : "ahead"));
    const read = await source.read(session("person-a"), { params: {}, fresh: false });
    const board = read.value as TeamBoard;
    const shipped = cardOf(board, 11);
    expect(shipped.status).toBe("released");
    expect(shipped.mergedAt).toBe(NOW - 2 * DAY);
    expect(shipped.release).toEqual({ kind: "shipped", label: "0.8.83", tag: "pulsa-v0.8.83", url: "https://github.com/acme/shared/releases/tag/pulsa-v0.8.83", at: NOW - 1.5 * DAY, confirmed: true });
    expect(shipped.waiting).toBeUndefined();
    expect(fetch.mock.calls.some(([url]) => String(url).includes(`/compare/${TAG_83}...${OLD_MERGE_OID}`))).toBe(true);
    // the release address opens without a question: a release of a board repository
    expect(read.links).toContain("https://github.com/acme/shared/releases/tag/pulsa-v0.8.83");
    expect(board.releases.map((release) => release.label)).toEqual(["0.8.84", "0.8.83"]);
  });

  it("takes the next release when the first by date does not contain the merge", async () => {
    const { source } = released((base) => (base === TAG_84 ? "behind" : "diverged"));
    const board = (await source.read(session("person-a"), { params: {}, fresh: false })).value as TeamBoard;
    expect(cardOf(board, 11).release).toMatchObject({ kind: "shipped", label: "0.8.84" });
  });

  it("says not cut yet for a merge newer than every release, without asking GitHub more", async () => {
    const { source, fetch } = released(() => "behind");
    const board = (await source.read(session("person-a"), { params: {}, fresh: false }, ) ).value as TeamBoard;
    const card = cardOf(board, 12);
    expect(card.status).toBe("waiting_release");
    expect(card.release).toEqual({ kind: "unreleased", label: "Not cut yet" });
    expect(card.waiting).toMatchObject({ on: "release", code: "not_released" });
    expect(fetch.mock.calls.some(([url]) => String(url).includes(MERGE_OID))).toBe(false);
  });

  it("says not cut yet in Quebec French for a French reader", async () => {
    const { source } = released(() => "behind");
    const board = (await source.read(session("person-a"), { params: {}, fresh: false, lang: "fr" })).value as TeamBoard;
    expect(cardOf(board, 12).release?.label).toBe("Pas encore coupé");
  });

  it("gives an open card its milestone as planned", async () => {
    const { source } = released(() => "behind");
    const board = (await source.read(session("person-a"), { params: {}, fresh: false })).value as TeamBoard;
    expect(cardOf(board, 30).release).toEqual({ kind: "planned", label: "0.9.0" });
  });

  it("caches each containment answer per person: a second read asks GitHub's compare nothing more", async () => {
    const { source, fetch } = released((base) => (base === TAG_83 ? "behind" : "ahead"));
    await source.read(session("person-a"), { params: {}, fresh: false });
    const compares = () => fetch.mock.calls.filter(([url]) => String(url).includes("/compare/")).length;
    const first = compares();
    await source.read(session("person-a"), { params: {}, fresh: true });
    expect(compares()).toBe(first);
  });

  it("keeps the date rule when GitHub's compare does not answer, marked not confirmed", async () => {
    const { source } = released(() => null);
    const board = (await source.read(session("person-a"), { params: {}, fresh: false })).value as TeamBoard;
    expect(cardOf(board, 11).release).toMatchObject({ kind: "shipped", label: "0.8.83", confirmed: false });
  });

  // review of #3450: a full list whose oldest release is newer than the
  // merge cannot name its release (the real one may be older, unread)
  const many = (count: number, newestAt: number, step: number, tagOf = (index: number) => `v1.${count - index}`) =>
    Array.from({ length: count }, (_, index) => ({ tagName: tagOf(index), name: tagOf(index), publishedAt: iso(newestAt - index * step), isDraft: false, isPrerelease: false,
      tagCommit: { oid: index.toString(16).padStart(40, "f"), committedDate: iso(newestAt - index * step) } }));

  it("never names a release when the list read is full and the merge is older than its oldest release", async () => {
    // TEAM_BOARD_RELEASES releases, all newer than the merge of #20 (2 days ago), every one contains it
    const { source } = released(() => "behind", many(TEAM_BOARD_RELEASES, NOW - DAY, 60_000));
    const board = (await source.read(session("person-a"), { params: {}, fresh: false })).value as TeamBoard;
    const card = cardOf(board, 11);
    expect(card.release).toBeUndefined();
    expect(card.status).toBe("waiting_release");
    expect(card.waiting).toMatchObject({ on: "release", code: "release_unknown" });
  });

  it("reads enough releases to cover Merged's 7 days", () => {
    expect(TEAM_BOARD_RELEASES).toBeGreaterThanOrEqual(100);
  });

  it("confirms the candidate and that the release just before does not contain the merge", async () => {
    // a full list that reaches before the merge: v1.(n) newest ... one release per 2 hours
    const releases = many(TEAM_BOARD_RELEASES, NOW - DAY, 2 * 3_600_000);
    const oldestFirst = [...releases].reverse();
    const first = oldestFirst.findIndex((release) => Date.parse(release.tagCommit.committedDate) >= NOW - 2 * DAY);
    const candidate = oldestFirst[first]!;
    const before = oldestFirst[first - 1]!;
    const seen: string[] = [];
    const { source } = released((base) => { seen.push(base); return base === before.tagCommit.oid ? "ahead" : "behind"; }, releases);
    const board = (await source.read(session("person-a"), { params: {}, fresh: false })).value as TeamBoard;
    expect(cardOf(board, 11).release).toMatchObject({ kind: "shipped", tag: candidate.tagName, confirmed: true });
    expect(seen).toEqual(expect.arrayContaining([candidate.tagCommit.oid, before.tagCommit.oid]));
  });

  it("walks back when the release before also contains the merge (a history that is not linear)", async () => {
    const releases = many(TEAM_BOARD_RELEASES, NOW - DAY, 2 * 3_600_000);
    const oldestFirst = [...releases].reverse();
    const first = oldestFirst.findIndex((release) => Date.parse(release.tagCommit.committedDate) >= NOW - 2 * DAY);
    const twoBefore = oldestFirst[first - 2]!;
    const { source } = released((base) => (base === twoBefore.tagCommit.oid ? "ahead" : "behind"), releases);
    const board = (await source.read(session("person-a"), { params: {}, fresh: false })).value as TeamBoard;
    expect(cardOf(board, 11).release).toMatchObject({ tag: oldestFirst[first - 1]!.tagName, confirmed: true });
  });

  it("never counts a prerelease or a draft as shipped, and bounds a label taken from a name", async () => {
    const long = "x".repeat(300);
    const { source } = released(() => "behind", [
      { tagName: "nightly", name: long, publishedAt: iso(NOW - 1.8 * DAY), isDraft: false, isPrerelease: false, tagCommit: { oid: "1".repeat(40), committedDate: iso(NOW - 1.8 * DAY) } },
      { tagName: "v2.0.0-rc.1", name: "rc", publishedAt: iso(NOW - 1.9 * DAY), isDraft: false, isPrerelease: true, tagCommit: { oid: "2".repeat(40), committedDate: iso(NOW - 1.9 * DAY) } },
      { tagName: "v1.9.9", name: "draft", publishedAt: iso(NOW - 1.95 * DAY), isDraft: true, isPrerelease: false, tagCommit: { oid: "3".repeat(40), committedDate: iso(NOW - 1.95 * DAY) } },
    ]);
    const board = (await source.read(session("person-a"), { params: {}, fresh: false })).value as TeamBoard;
    const release = cardOf(board, 11).release!;
    expect(release.tag).toBe("nightly");
    expect(release.label.length).toBeLessThanOrEqual(TEAM_BOARD_RELEASE_LABEL_CHARS);
    expect(board.releases.map((entry) => entry.tag)).toEqual(["nightly"]);
  });
});

describe("waiting codes (#3449)", () => {
  const waitingWorld = (waitingOn?: BoardEntry["waitingOn"]) => createTeamBoardSource({
    person: () => "person-a", viewerId: () => "person-a",
    teams: () => [{ sectionId: "team-a", name: "Alpha team", bots: [{ id: "bot-a", name: "Alpha bot" }] }],
    bots: () => [{ id: "bot-a", name: "Alpha bot" }],
    entries: () => [{ botId: "bot-a", ...(waitingOn ? { waitingOn } : {}), item: item("bot-a", "Alpha bot", "thread-a", {
      repo: "acme/shared", pullRequests: [], branches: [], commits: [], issues: [{ repo: "acme/shared", number: 7, action: "viewed", at: NOW - 1_000 }],
    }, { status: "waiting", currentStep: "git push origin main" }) }],
    github: createGithubBoardReader({ token: () => undefined }),
    now: () => NOW,
  });
  const waitingOf = async (source: ReturnType<typeof createTeamBoardSource>) => ((await source.read(session("person-a"), { params: {}, fresh: false })).value as TeamBoard).lanes[0]!.cards[0]!.waiting;

  it("names an approval with its tool, a question, and falls back when the card cannot be read", async () => {
    expect(await waitingOf(waitingWorld({ kind: "approval", what: "Push to main", tool: "Bash" }))).toMatchObject({ on: "you", reason: "git push origin main", code: "approval", params: { what: "Push to main", tool: "Bash" } });
    expect(await waitingOf(waitingWorld({ kind: "question", what: "Which repo?" }))).toMatchObject({ code: "question", params: { what: "Which repo?" } });
    expect(await waitingOf(waitingWorld())).toMatchObject({ code: "waiting_you", params: { what: "git push origin main" } });
  });

  it("reads the open card of a conversation, never an answered one", () => {
    const card = (over: Record<string, unknown>) => ({ id: "m", role: "bot", kind: "options", card: { title: "Approval needed", subtitle: "Push to main", options: ["Allow", "Deny"], requestId: "r1", ...over } });
    expect(waitingCardOf([card({ tool: "Bash" })] as never)).toEqual({ kind: "approval", what: "Push to main", tool: "Bash" });
    expect(waitingCardOf([card({ answered: true, tool: "Bash" })] as never)).toBeUndefined();
    expect(waitingCardOf([card({ title: "Your bot has a question", subtitle: "Which repo?" })] as never)).toEqual({ kind: "question", what: "Which repo?" });
  });
});

describe("the lead of a lane (#3464)", () => {
  const lead = (managedSections: string[]) => buildTeamBoard({
    teams: [{ sectionId: "sec-9f2", name: "Alpha team", bots: [{ id: "bot-a", name: "Alpha bot" }] }],
    bots: [{ id: "bot-a", name: "Alpha bot" }, { id: "lead-a", name: "Alpha lead", managedSections }],
    entries: [{ botId: "bot-a", item: item("bot-a", "Alpha bot", "thread-x", { repo: "acme/shared", pullRequests: [], branches: [], commits: [], issues: [{ repo: "acme/shared", number: 7, action: "commented", at: NOW - 1_000 }] }) }],
    github: new Map(),
    now: NOW,
  })[0]!.lead;
  it("is found when managedSections holds the section name", () => {
    expect(lead(["alpha team "])).toEqual({ botId: "lead-a", name: "Alpha lead" });
  });
  it("is found when managedSections holds the section id", () => {
    expect(lead(["sec-9f2"])).toEqual({ botId: "lead-a", name: "Alpha lead" });
  });
  it("is not found for another section", () => {
    expect(lead(["sec-other", "Beta team"])).toBeUndefined();
  });
});
