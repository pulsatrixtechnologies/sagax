import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import type { MeetingService } from "../meetings/meeting-requests.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { InternalRouteContext } from "./internal-route.ts";
import { createMeetingInternalRoutes } from "./meeting-internal.ts";
import { createMeetingRoutes } from "./meetings.ts";
import { PASS, type RouteContext } from "./table.ts";

function fakeService(over: Partial<MeetingService> = {}) {
  const calls: string[] = [];
  const service = {
    submit: (args: { url: string }) => { calls.push(`submit ${args.url}`); return { requestId: "r1", messageId: "m1", supported: true, provider: "google-meet" }; },
    leave: () => { calls.push("leave"); return { ok: true as const }; },
    isMeetingCard: (_threadId: string, requestId: string) => requestId === "r1",
    ...over,
  } as unknown as MeetingService;
  return { service, calls };
}

describe("POST /api/internal/meetings/join", () => {
  const call = async (opts: { owns?: boolean; direct?: boolean; body?: Record<string, unknown>; enabled?: boolean }) => {
    const { service, calls } = fakeService();
    const route = createMeetingInternalRoutes({ meetings: () => service, ownsThread: () => opts.owns ?? true, isDirect: () => opts.direct ?? true, enabled: () => opts.enabled ?? true });
    const sent: Array<{ status: number; body: any }> = [];
    await route({
      res: {} as ServerResponse,
      path: "/api/internal/meetings/join",
      method: "POST",
      json: ((_res: ServerResponse, status: number, body: unknown) => { sent.push({ status, body }); }) as InternalRouteContext["json"],
      capability: { botId: "bot-1", threadId: "t1", generation: "g" },
      readBody: async () => opts.body ?? { url: "https://meet.google.com/abc-defg-hij", reason: "sync" },
    });
    return { sent, calls };
  };

  it("stages the card for the capability's own bot and conversation", async () => {
    const { sent, calls } = await call({});
    expect(sent[0]).toMatchObject({ status: 200, body: { requestId: "r1", supported: true } });
    expect(calls).toEqual(["submit https://meet.google.com/abc-defg-hij"]);
  });

  it("refuses a stray call while the notetaker is off, before anything else", async () => {
    const { sent, calls } = await call({ enabled: false, owns: false });
    expect(sent).toEqual([{ status: 403, body: { code: "meetings_disabled", error: "The meeting notetaker is off. Turn it on in Settings > Experimental." } }]);
    expect(calls).toEqual([]);
  });

  it("refuses another conversation, a room, and a malformed body", async () => {
    expect((await call({ owns: false })).sent[0]?.status).toBe(403);
    expect((await call({ direct: false })).sent[0]?.status).toBe(409);
    expect((await call({ body: { url: "x", extra: 1 } })).sent[0]?.status).toBe(400);
  });
});

describe("POST /api/meetings/leave", () => {
  const call = async (opts: { refusal?: string | null; body?: unknown; contentType?: string; path?: string; enabled?: boolean }) => {
    const { service, calls } = fakeService();
    const route = createMeetingRoutes({ meetings: () => service, refusal: () => opts.refusal ?? null, enabled: () => opts.enabled ?? true });
    const sent: Array<{ status: number; body: any }> = [];
    const out = await route({
      req: { headers: { "content-type": opts.contentType ?? "application/json" } } as unknown as IncomingMessage,
      res: {} as ServerResponse,
      url: new URL("http://x/"),
      path: opts.path ?? "/api/meetings/leave",
      method: "POST",
      auth: { kind: "loopback" } as unknown as RequestAuth,
      json: ((_res: ServerResponse, status: number, body: unknown) => { sent.push({ status, body }); }) as RouteContext["json"],
      readBody: async () => opts.body ?? { threadId: "t1", requestId: "r1" },
    } as RouteContext);
    return { out, sent, calls };
  };

  it("makes the bot leave for whoever may answer the card", async () => {
    const { sent, calls } = await call({});
    expect(sent[0]).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toEqual(["leave"]);
  });

  it("refuses others, unknown meetings and non-JSON posts", async () => {
    expect((await call({ refusal: "Only the bot owner can answer this approval." })).sent[0]?.status).toBe(403);
    expect((await call({ body: { threadId: "t1", requestId: "nope" } })).sent[0]?.status).toBe(404);
    expect((await call({ contentType: "text/plain" })).sent[0]?.status).toBe(415);
  });

  it("refuses every meeting route while the notetaker is off", async () => {
    for (const path of ["/api/meetings/leave", "/api/meetings/anything"]) {
      const { sent, calls } = await call({ enabled: false, path });
      expect(sent).toEqual([{ status: 403, body: expect.objectContaining({ code: "meetings_disabled" }) }]);
      expect(calls).toEqual([]);
    }
  });

  it("passes other paths", async () => {
    expect((await call({ path: "/api/other" })).out).toBe(PASS);
  });
});
