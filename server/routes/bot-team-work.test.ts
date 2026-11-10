import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { TeamWork } from "../../shared/team-work.ts";
import { createBotTeamWorkRoutes, teamWorkSince } from "./bot-team-work.ts";
import { PASS, type RouteContext } from "./table.ts";

const NOW = 100 * 24 * 60 * 60_000;

function rig(visible = true) {
  const reads: Array<{ botId: string; viewerId: string | undefined; since: number }> = [];
  const route = createBotTeamWorkRoutes({
    bot: (id) => (visible && id === "orc" ? { id } : null),
    viewerId: () => "ana",
    read: (botId, viewerId, since): TeamWork => {
      reads.push({ botId, viewerId, since });
      return { botId, at: NOW, team: [], live: [], doneToday: [] };
    },
    now: () => NOW,
  });
  const call = async (path: string, method = "GET") => {
    const headers: Record<string, string> = {};
    let sent: { status: number; body: any } | undefined;
    const url = new URL(`http://local${path}`);
    const out = await route({
      res: { setHeader: (name: string, value: string) => { headers[name] = value; } } as unknown as ServerResponse,
      url, path: url.pathname, method, auth: { kind: "session" } as unknown as RequestAuth,
      json: ((_res: ServerResponse, status: number, body: unknown) => { sent = { status, body }; }) as RouteContext["json"],
    } as unknown as RouteContext);
    return { out, sent, headers };
  };
  return { call, reads };
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
