import { describe, expect, it } from "vitest";

import { createBotsCoreCardsRoutes } from "./bots-core-cards.ts";
import { PASS } from "./table.ts";
import type { BotsCoreRouteDeps } from "./bots-core-deps.ts";
import type { Message } from "../store.ts";

function harness() {
  const messages: Message[] = [
    { id: "m1", at: 1, role: "bot", kind: "text", text: "", terminalEmbed: { sessionId: "s1", provider: "sandbox", resourceId: "mine", label: "Cloud", status: "ended" } } as unknown as Message,
    { id: "m2", at: 2, role: "bot", kind: "text", text: "plain" } as unknown as Message,
  ];
  const deps = {
    store: {
      messagesFor: () => messages,
      patchMessage: (_thread: string, id: string, patch: Partial<Message>) => {
        const row = messages.find((m) => m.id === id)!;
        Object.assign(row, patch);
        return row;
      },
    },
    requestedTaskBot: (id: string, threadId: string) => ({ id, threadId }),
  } as unknown as BotsCoreRouteDeps;
  const route = createBotsCoreCardsRoutes(deps);
  async function patch(messageId: string, body: unknown) {
    let answer: { status: number; body: Record<string, unknown> } | undefined;
    const result = await route({
      req: {} as never, res: {} as never, url: new URL("http://x"), auth: {} as never,
      path: `/api/bots/b1/terminal-embeds/${messageId}`, method: "PATCH",
      readBody: (async () => body) as never,
      json: ((_res: unknown, status: number, payload: Record<string, unknown>) => { answer = { status, body: payload }; }) as never,
    });
    expect(result).not.toBe(PASS);
    return answer!;
  }
  return { messages, patch };
}

describe("PATCH /api/bots/:id/terminal-embeds/:messageId", () => {
  it("saves the fold on the message, so it survives a reload", async () => {
    const { messages, patch } = harness();
    expect((await patch("m1", { threadId: "t1", collapsed: false })).status).toBe(200);
    expect(messages[0]!.terminalEmbed).toMatchObject({ sessionId: "s1", status: "ended", collapsed: false });
    expect((await patch("m1", { threadId: "t1", collapsed: true })).status).toBe(200);
    expect(messages[0]!.terminalEmbed?.collapsed).toBe(true);
  });

  it("changes nothing else and only on a terminal card", async () => {
    const { messages, patch } = harness();
    expect((await patch("m1", { threadId: "t1", collapsed: true, status: "live" })).status).toBe(400);
    expect((await patch("m1", { threadId: "t1", collapsed: "yes" })).status).toBe(400);
    expect((await patch("m2", { threadId: "t1", collapsed: true })).status).toBe(404);
    expect(messages[0]!.terminalEmbed?.status).toBe("ended");
  });
});
