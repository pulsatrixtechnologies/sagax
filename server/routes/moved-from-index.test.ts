// Routes that left server/index.ts (#1099): thread file pin, bot history owner
// rule, per-person engine models. The wiring is covered by the e2e files; this
// covers each module's own answers.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { createBotHistoryRoutes } from "./bot-history.ts";
import { createMeEngineModelsRoutes } from "./me-engine-models.ts";
import { PASS, type RouteContext } from "./table.ts";
import { createThreadFilePinRoutes } from "./thread-file-pins.ts";

const auth = { kind: "loopback", trust: "owner" } as unknown as RequestAuth;
function ctx(path: string, method: string, body: unknown = null) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: {} as IncomingMessage,
    res: { setHeader: () => undefined } as unknown as ServerResponse,
    url: new URL(`http://x${path}`), path, method, auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}
const FILE = "a".repeat(24);

describe("thread file pin route", () => {
  const deps = { hasConversation: (id: string) => id === "t1", hasFile: (_t: string, f: string) => f === FILE, setPin: vi.fn(() => true) };
  const route = createThreadFilePinRoutes(deps);
  it("passes what is not its own", async () => {
    expect(await route(ctx(`/api/threads/t1/files/${FILE}/pin`, "GET").context)).toBe(PASS);
    expect(await route(ctx("/api/threads/t1/files", "POST").context)).toBe(PASS);
  });
  it("pins a listed file and refuses the rest", async () => {
    const ok = ctx(`/api/threads/t1/files/${FILE}/pin`, "POST", { pinned: true });
    await route(ok.context);
    expect(ok.sent).toEqual([{ status: 200, body: { ok: true, pinned: true } }]);
    const noConversation = ctx(`/api/threads/t9/files/${FILE}/pin`, "POST", { pinned: true });
    await route(noConversation.context);
    expect(noConversation.sent[0]!.status).toBe(404);
    const badBody = ctx(`/api/threads/t1/files/${FILE}/pin`, "POST", { pinned: "yes" });
    await route(badBody.context);
    expect(badBody.sent[0]!.status).toBe(400);
    const otherFile = ctx(`/api/threads/t1/files/${"b".repeat(24)}/pin`, "POST", { pinned: true });
    await route(otherFile.context);
    expect(otherFile.sent[0]!.status).toBe(404);
  });
});

describe("bot history route", () => {
  const bot = { id: "b1", name: "A", title: "", description: "" };
  const make = (mayManage: boolean) => createBotHistoryRoutes({
    bot: (id) => (id === "b1" ? bot : undefined), mayManage: () => mayManage,
    setSoul: () => bot, wireBot: (b) => b, broadcast: () => undefined,
  });
  it("refuses someone who does not own the bot, reads and undoes alike", async () => {
    for (const [path, method] of [["/api/bots/b1/history", "GET"], ["/api/bots/b1/history/rollback", "POST"]] as const) {
      const call = ctx(path, method, {});
      await make(false)(call.context);
      expect(call.sent[0]).toMatchObject({ status: 403, body: { code: "bot_history_owner_only" } });
    }
  });
  it("leaves other methods and unknown bots to the rest of the server", async () => {
    expect(await make(false)(ctx("/api/bots/b1/history", "DELETE").context)).toBe(PASS);
    expect(await make(true)(ctx("/api/bots/b1/history", "POST").context)).toBe(PASS);
    const unknown = ctx("/api/bots/zz/history", "GET");
    await make(true)(unknown.context);
    expect(unknown.sent[0]!.status).toBe(404);
  });
});

describe("engine models route", () => {
  it("answers for a person and refuses anyone else", async () => {
    const accountModels = vi.fn(async () => ["m1"]);
    const person = createMeEngineModelsRoutes({ principalOf: () => "pr_1", accountModels });
    const ok = ctx("/api/me/engines/e1/models", "GET");
    await person(ok.context);
    expect(ok.sent).toEqual([{ status: 200, body: { models: ["m1"] } }]);
    expect(accountModels).toHaveBeenCalledWith("pr_1", "e1");
    const none = ctx("/api/me/engines/e1/models", "GET");
    await createMeEngineModelsRoutes({ principalOf: () => "", accountModels })(none.context);
    expect(none.sent[0]!.status).toBe(403);
    expect(await person(ctx("/api/me/engines", "GET").context)).toBe(PASS);
  });
});
