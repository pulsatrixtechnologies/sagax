// The `bot` page source (#5461). One person never receives another person's
// bot name or routines, even on a page that person shared.
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../../auth/request-auth.ts";
import type { PageBotView } from "../../../shared/page-bot.ts";
import { PageSourceError } from "../page-sources.ts";
import { createBotSource, type BotSourceDeps } from "./bot.ts";

const SECRET = "sk-live-do-not-leak";

const session = (principalId: string | null) => ({ kind: "session", via: "cookie", scopes: ["client"], session: { principalId } }) as unknown as RequestAuth;

interface BotFacts {
  name: string;
  approvalMode: string;
  activity: string;
  routines: Array<{ id: string; name: string; enabled: boolean }>;
  runs: Array<{ routineId: string; status: string; at: number; happened?: boolean }>;
}

const ADA: BotFacts = {
  name: "Ada",
  approvalMode: "auto",
  activity: "working",
  routines: [{ id: "ra", name: "Ada routine", enabled: true }],
  runs: [{ routineId: "ra", status: "completed", at: 20, happened: true }, { routineId: "ra", status: "queued", at: 9_000 }],
};

const NIMBUS: BotFacts = {
  name: "Nimbus",
  approvalMode: "ask",
  activity: "idle",
  routines: [{ id: "rb", name: "Nimbus routine", enabled: false }],
  runs: [],
};

function world(over: Partial<BotSourceDeps> = {}) {
  const bots: Record<string, BotFacts> = { "bot-a": ADA, "bot-b": NIMBUS };
  const seen = new Set<string>();
  const person = (auth: RequestAuth) => {
    const id = (auth as { session?: { principalId?: string | null } }).session?.principalId;
    return id || undefined;
  };
  const owns = (auth: RequestAuth, botId: string) => (person(auth) === "person-a" ? botId === "bot-a" : person(auth) === "person-b" ? botId === "bot-b" : false);
  const deps: BotSourceDeps = {
    person,
    visible: (auth, botId) => owns(auth, botId),
    bot: (botId) => {
      seen.add(`bot:${botId}`);
      const found = bots[botId];
      return found ? { name: found.name } : null;
    },
    approvalMode: (botId) => bots[botId]?.approvalMode ?? "ask",
    activity: (_auth, botId) => bots[botId]?.activity ?? "idle",
    routines: (botId) => {
      seen.add(`routines:${botId}`);
      return bots[botId]?.routines ?? [];
    },
    runs: (botId) => bots[botId]?.runs ?? [],
    ...over,
  };
  return { source: createBotSource(deps), seen };
}

const read = (source: ReturnType<typeof createBotSource>, who: string | null, botId = "bot-a", params: Record<string, unknown> = {}) =>
  source.read(session(who), { params, fresh: false, page: { id: "page-1", botId } });

describe("bot page source", () => {
  it("returns the page's bot for a reader who may see it", async () => {
    const { source } = world();
    expect(source.name).toBe("bot");
    expect(source.label).toBe("This page's bot");
    const answer = await read(source, "person-a");
    expect(answer.topics).toEqual(["bot-a"]);
    expect(answer.value).toEqual({
      name: "Ada",
      approvalMode: "auto",
      activity: "working",
      routines: [{ id: "ra", name: "Ada routine", enabled: true, lastRun: { status: "completed", at: 20 } }],
    } satisfies PageBotView);
    const text = JSON.stringify(answer.value);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("person-a");
    expect(text).not.toContain("cwd");
  });

  it("ignores params it does not use", async () => {
    const { source } = world();
    const answer = await read(source, "person-a", "bot-a", { token: SECRET, cwd: "/secret", team: "nope" });
    expect(JSON.stringify(answer.value)).not.toContain(SECRET);
    expect(JSON.stringify(answer.value)).not.toContain("cwd");
  });

  it("never gives person B person A's bot name or routines", async () => {
    const { source, seen } = world();
    await expect(read(source, "person-b", "bot-a")).rejects.toMatchObject({ code: "unavailable", status: 404 });
    expect([...seen]).not.toContain("bot:bot-a");
    expect([...seen]).not.toContain("routines:bot-a");
    const own = await read(source, "person-b", "bot-b");
    const text = JSON.stringify(own.value);
    expect(text).toContain("Nimbus");
    expect(text).not.toContain("Ada");
    expect(text).not.toContain(SECRET);
    expect((own.value as PageBotView).routines.map((routine) => routine.name)).toEqual(["Nimbus routine"]);
  });

  it("refuses a reader who is not signed in before looking up the bot", async () => {
    const visible = vi.fn(() => true);
    const { source } = world({ visible });
    await expect(read(source, null)).rejects.toBeInstanceOf(PageSourceError);
    await expect(read(source, null)).rejects.toMatchObject({ code: "sign_in", status: 401 });
    expect(visible).not.toHaveBeenCalled();
  });

  it("refuses a missing bot and a page with no bot, without listing routines", async () => {
    const routines = vi.fn(() => [{ id: "ra", name: "Ada routine", enabled: true }]);
    const { source } = world({
      visible: () => true,
      bot: () => null,
      routines,
    });
    await expect(read(source, "person-a", "missing")).rejects.toMatchObject({ code: "unavailable", status: 404 });
    await expect(source.read(session("person-a"), { params: {}, fresh: false })).rejects.toMatchObject({ code: "unavailable" });
    expect(routines).not.toHaveBeenCalled();
  });
});
