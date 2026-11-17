import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { TeamWork, TeamWorkClear } from "../../shared/team-work.ts";
import { createBotTeamWorkRoutes, teamWorkClearBody, teamWorkSince } from "./bot-team-work.ts";
import { PASS, type RouteContext } from "./table.ts";

const NOW = 100 * 24 * 60 * 60_000;

function rig(visible = true) {
  const reads: Array<{ botId: string; viewerId: string | undefined; since: number }> = [];
  const clears: Array<{ botId: string; viewerId: string | undefined; since: number; clear: TeamWorkClear }> = [];
  const route = createBotTeamWorkRoutes({
    clear: (botId, viewerId, since, clear) => { clears.push({ botId, viewerId, since, clear }); return 1; },
    bot: (id) => (visible && id === "orc" ? { id } : null),
    viewerId: () => "ana",
    read: (botId, viewerId, since): TeamWork => {
      reads.push({ botId, viewerId, since });
      return { botId, at: NOW, team: [], live: [], doneToday: [] };
    },
    now: () => NOW,
  });
  const call = async (path: string, method = "GET", body?: unknown) => {
    const headers: Record<string, string> = {};
    let sent: { status: number; body: any } | undefined;
    const url = new URL(`http://local${path}`);
    const out = await route({
      res: { setHeader: (name: string, value: string) => { headers[name] = value; } } as unknown as ServerResponse,
      url, path: url.pathname, method, auth: { kind: "session" } as unknown as RequestAuth,
      json: ((_res: ServerResponse, status: number, answer: unknown) => { sent = { status, body: answer }; }) as RouteContext["json"],
      readBody: (async () => body) as unknown as RouteContext["readBody"],
    } as unknown as RouteContext);
    return { out, sent, headers };
  };
  return { call, reads, clears };
}

describe("GET /api/bots/:id/team-work (#3461)", () => {
  it("answers the read model, private and never cached", async () => {
    const { call, reads } = rig();
    const midnight = NOW - 3_600_000;
    const { sent, headers } = await call(`/api/bots/orc/team-work?since=${midnight}`);
    expect(sent).toEqual({ status: 200, body: { botId: "orc", at: NOW, team: [], live: [], doneToday: [] } });
    expect(headers["cache-control"]).toBe("private, no-store");
    expect(reads).toEqual([{ botId: "orc", viewerId: "ana", since: midnight }]);
  });

  it("is a 404 for a bot the reader cannot see", async () => {
    const { call, reads } = rig(false);
    const { sent } = await call("/api/bots/orc/team-work");
    expect(sent?.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it("is GET only, and passes other paths on", async () => {
    const { call } = rig();
    expect((await call("/api/bots/orc/team-work", "POST")).sent?.status).toBe(405);
    expect((await call("/api/bots/orc/activity")).out).toBe(PASS);
  });

  it("reads the reader's midnight, else the last day", () => {
    expect(teamWorkSince(String(NOW - 1_000), NOW)).toBe(NOW - 1_000);
    expect(teamWorkSince(null, NOW)).toBe(NOW - 86_400_000);
    expect(teamWorkSince("soon", NOW)).toBe(NOW - 86_400_000);
    expect(teamWorkSince(String(NOW + 1), NOW)).toBe(NOW - 86_400_000);
  });
});

// #4421: the person clears rows of their own list: no administrator, no
// approval, only what their read lists; the answer is the list read again.
describe("POST /api/bots/:id/team-work/clear (#4421)", () => {
  it("clears the rows named, or the finished ones, for this reader, and answers the list", async () => {
    const { call, reads, clears } = rig();
    const midnight = NOW - 3_600_000;
    const one = await call(`/api/bots/orc/team-work/clear?since=${midnight}`, "POST", { keys: ["work:release"] });
    expect(one.sent).toEqual({ status: 200, body: { botId: "orc", at: NOW, team: [], live: [], doneToday: [] } });
    expect(one.headers["cache-control"]).toBe("private, no-store");
    await call("/api/bots/orc/team-work/clear", "POST", { finished: true });
    expect(clears).toEqual([
      { botId: "orc", viewerId: "ana", since: midnight, clear: { keys: ["work:release"] } },
      { botId: "orc", viewerId: "ana", since: NOW - 86_400_000, clear: { finished: true } },
    ]);
    expect(reads.map((read) => read.viewerId)).toEqual(["ana", "ana"]);
  });

  it("is a 404 for a bot the reader cannot see, a 400 for a body that names nothing, POST only", async () => {
    expect((await rig(false).call("/api/bots/orc/team-work/clear", "POST", { finished: true })).sent?.status).toBe(404);
    const { call, clears } = rig();
    expect((await call("/api/bots/orc/team-work/clear", "POST", {})).sent?.status).toBe(400);
    expect((await call("/api/bots/orc/team-work/clear", "GET")).sent?.status).toBe(405);
    expect(clears).toEqual([]);
  });

  it("reads keys and finished from the body, nothing else", () => {
    expect(teamWorkClearBody({ keys: ["work:a", 3, "", "step:h1"], finished: "yes" })).toEqual({ keys: ["work:a", "step:h1"] });
    expect(teamWorkClearBody({ finished: true })).toEqual({ finished: true });
    expect(teamWorkClearBody(null)).toBeNull();
    expect(teamWorkClearBody({ keys: [] })).toBeNull();
  });
});
