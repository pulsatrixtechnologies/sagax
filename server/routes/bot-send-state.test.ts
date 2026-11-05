import { describe, expect, it, vi } from "vitest";

import { createBotSendStateRoutes } from "./bot-send-state.ts";
import { PASS } from "./table.ts";

function call(handler: ReturnType<typeof createBotSendStateRoutes<{ id: string }>>, method: string, path: string, body?: unknown) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const ctx = {
    req: {} as never, res: { setHeader: vi.fn() } as never, url: new URL(`http://x${path}`), path: path.split("?")[0]!, method,
    auth: { kind: "loopback", scopes: ["admin"] } as never,
    json: (_res: unknown, status: number, out: unknown) => { sent.push({ status, body: out }); },
    readBody: async () => body,
  };
  return Promise.resolve(handler(ctx as never)).then((result) => ({ result, sent }));
}

describe("send-state routes (#2013)", () => {
  const block = { reason: "engine_refused", message: "x", advisory: true, action: { kind: "fix", fix: "codex_native_mcp" } } as const;

  it("answers the send state, and repairs a known Fix before answering it again", async () => {
    const fix = vi.fn((_bot: { id: string }, _name: string) => ({ ok: true }));
    let current: unknown = block;
    const handler = createBotSendStateRoutes<{ id: string }>({
      requestedTaskBot: (id) => ({ id }),
      sendStateFor: () => current as never,
      fixSendState: (bot, name) => { current = null; return fix(bot, name); },
    });
    expect((await call(handler, "GET", "/api/bots/b1/send-state?threadId=t")).sent).toEqual([{ status: 200, body: { block } }]);
    const fixed = await call(handler, "POST", "/api/bots/b1/send-state/fix?threadId=t", { fix: "codex_native_mcp" });
    expect(fix).toHaveBeenCalledWith({ id: "b1" }, "codex_native_mcp");
    expect(fixed.sent).toEqual([{ status: 200, body: { ok: true, block: null } }]);
  });

  it("refuses an unknown Fix and passes other paths on", async () => {
    const handler = createBotSendStateRoutes<{ id: string }>({
      requestedTaskBot: (id) => ({ id }), sendStateFor: () => null, fixSendState: () => ({ ok: false }),
    });
    expect((await call(handler, "POST", "/api/bots/b1/send-state/fix", { fix: "other" })).sent[0]?.status).toBe(400);
    expect((await call(handler, "GET", "/api/bots/b1/other")).result).toBe(PASS);
  });
});
