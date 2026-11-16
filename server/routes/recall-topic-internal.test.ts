// #4407: recall_topic brings other topics' titles (a listing) or words (a
// page) into the calling conversation's engine session; the route notes
// which, so a topic made confidential later forgets that session too.
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { InternalRouteContext } from "./internal-route.ts";
import { createRecallTopicInternalRoutes } from "./recall-topic-internal.ts";

const capability = { botId: "bot-1", threadId: "topic-live", generation: "g1", depth: 0 };

function route(noteCarried = vi.fn()) {
  return {
    noteCarried,
    handler: createRecallTopicInternalRoutes({
      ownsThread: () => true,
      topics: () => [
        { id: "topic-a", title: "Harbour", createdAt: 1, lastAt: 2 },
        { id: "topic-b", title: "Roof", createdAt: 3, lastAt: 4 },
      ],
      page: () => ({ text: "the harbour contract", more: false }),
      noteCarried,
    }),
  };
}

async function call(handler: ReturnType<typeof route>["handler"], body: Record<string, unknown>) {
  const sent: Array<{ status: number; body: unknown }> = [];
  await handler({
    res: {} as ServerResponse,
    path: "/api/internal/recall-topic",
    method: "POST",
    url: new URL("http://x/api/internal/recall-topic"),
    json: ((_res: ServerResponse, status: number, out: unknown) => { sent.push({ status, body: out }); }) as InternalRouteContext["json"],
    capability,
    readBody: async () => body,
  } as InternalRouteContext);
  return sent;
}

describe("recall_topic notes what it carried (#4407)", () => {
  it("a listing carries every listed topic, a page the one it read", async () => {
    const { handler, noteCarried } = route();
    expect((await call(handler, {}))[0]!.status).toBe(200);
    expect(noteCarried).toHaveBeenLastCalledWith(capability, ["topic-a", "topic-b"]);
    expect((await call(handler, { topicId: "topic-b" }))[0]).toMatchObject({ status: 200, body: { title: "Roof" } });
    expect(noteCarried).toHaveBeenLastCalledWith(capability, ["topic-b"]);
    // a missing topic reads nothing
    expect((await call(handler, { topicId: "topic-z" }))[0]!.status).toBe(404);
    expect(noteCarried).toHaveBeenCalledTimes(2);
  });
});
