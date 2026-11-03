// GET /api/bots/:id/capabilities: the one resolved list of a bot
// (server/capabilities/capabilities.ts), read only, with an optional engine preview.
import { describe, expect, it } from "vitest";

import { createBotCapabilitiesRoutes, type BotCapabilitiesAnswer } from "./bot-capabilities.ts";
import { PASS } from "./table.ts";

function harness(answer: (botId: string, engine: string | undefined) => BotCapabilitiesAnswer) {
  const asked: Array<[string, string | undefined]> = [];
  const route = createBotCapabilitiesRoutes({
    resolve: (_auth, botId, engine) => {
      asked.push([botId, engine]);
      return answer(botId, engine);
    },
  });
  const call = async (target: string, method = "GET") => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const url = new URL(`http://localhost${target}`);
    const out = await route({
      req: { headers: {} } as never,
      res: {} as never,
      url,
      path: url.pathname,
      method,
      auth: {} as never,
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => undefined) as never,
    });
    return { out, sent: sent[0] };
  };
  return { call, asked };
}

const list = { botId: "b1", engine: { kind: "codex", label: "Codex" }, items: [] };

describe("GET /api/bots/:id/capabilities", () => {
  it("answers the resolved list of the bot", async () => {
    const h = harness(() => ({ ok: true, capabilities: list }));
    expect((await h.call("/api/bots/b1/capabilities")).sent).toEqual({ status: 200, body: list });
    expect(h.asked).toEqual([["b1", undefined]]);
  });

  it("passes an engine preview and refuses a malformed one", async () => {
    const h = harness(() => ({ ok: true, capabilities: list }));
    await h.call("/api/bots/b1/capabilities?engine=claude-main");
    expect(h.asked).toEqual([["b1", "claude-main"]]);
    expect((await h.call("/api/bots/b1/capabilities?engine=%3Cx%3E")).sent).toMatchObject({ status: 400, body: { code: "unknown_engine" } });
  });

  it("says no such bot as the resolver says it, and reads only", async () => {
    const h = harness(() => ({ ok: false, status: 404, error: "no such bot", code: "not_found" }));
    expect((await h.call("/api/bots/nope/capabilities")).sent).toEqual({ status: 404, body: { error: "no such bot", code: "not_found" } });
    expect((await h.call("/api/bots/b1/capabilities", "POST")).sent).toMatchObject({ status: 405 });
  });

  it("leaves every other path to the next route", async () => {
    const h = harness(() => ({ ok: true, capabilities: list }));
    expect((await h.call("/api/bots/b1/plugins")).out).toBe(PASS);
  });
});
