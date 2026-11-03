// POST /api/youtube/transcript: who may call it, and the codes the apps map
// to their own words (no_captions 404, unavailable 422, blocked 502).
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { RouteContext } from "./table.ts";

const fetchYoutubeTranscript = vi.fn();
vi.mock("../youtube-transcript.ts", () => ({ fetchYoutubeTranscript: (id: string) => fetchYoutubeTranscript(id) }));

const { createMediaWidgetRoutes } = await import("./media-widgets.ts");

type Answer = { status: number; body: Record<string, unknown> };

async function call(auth: RequestAuth, body: unknown = { videoId: "jNQXAC9IVRw" }): Promise<Answer> {
  let answer: Answer | undefined;
  const ctx = {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    url: new URL("http://x/api/youtube/transcript"),
    path: "/api/youtube/transcript",
    method: "POST",
    auth,
    json: ((_res: ServerResponse, status: number, payload: Record<string, unknown>) => {
      answer = { status, body: payload };
    }) as unknown as RouteContext["json"],
    readBody: (async () => body) as unknown as RouteContext["readBody"],
  } satisfies RouteContext;
  await createMediaWidgetRoutes()(ctx);
  return answer!;
}

const owner = { kind: "loopback", scopes: [] } as unknown as RequestAuth;
const service = { kind: "loopback", scopes: [], trust: "service" } as unknown as RequestAuth;
const session = { kind: "session", scopes: [], via: "bearer", session: {} } as unknown as RequestAuth;

describe("POST /api/youtube/transcript", () => {
  beforeEach(() => {
    fetchYoutubeTranscript.mockReset();
    fetchYoutubeTranscript.mockResolvedValue({ cues: [{ startMs: 1200, text: "All right" }], language: "en", automatic: false });
  });

  it("answers the desktop app and a phone through the companion (loopback owner), not only a session", async () => {
    for (const auth of [owner, session]) {
      expect(await call(auth)).toEqual({
        status: 200,
        body: { videoId: "jNQXAC9IVRw", cues: [{ startMs: 1200, text: "All right" }], language: "en", automatic: false },
      });
    }
  });

  it("refuses a bot's shell on a shared server", async () => {
    expect((await call(service)).status).toBe(401);
    expect(fetchYoutubeTranscript).not.toHaveBeenCalled();
  });

  it("refuses a malformed id before fetching", async () => {
    expect(await call(owner, { videoId: "../etc" })).toMatchObject({ status: 400, body: { error: "invalid_video" } });
    expect(fetchYoutubeTranscript).not.toHaveBeenCalled();
  });

  it.each([
    ["no_captions", 404],
    ["unavailable", 422],
    ["blocked", 502],
    [undefined, 502],
  ])("maps %s to %i with a code and a message", async (code, status) => {
    fetchYoutubeTranscript.mockRejectedValue(Object.assign(new Error(String(code)), { code }));
    const answer = await call(owner);
    expect(answer.status).toBe(status);
    expect(answer.body.error).toBe(code ?? "blocked");
    expect(typeof answer.body.message).toBe("string");
  });
});
