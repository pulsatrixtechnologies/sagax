import { describe, expect, it } from "vitest";

import { CLIENT_ALLOW } from "../auth/client-allow.ts";
import { QUIET_MODE_PERSON_PATH, quietModeBotPath } from "../../shared/quiet-mode.ts";
import { QuietMode } from "../quiet-mode/quiet-mode.ts";
import { createQuietModeRoutes } from "./quiet-mode.ts";
import { PASS } from "./table.ts";

type Answer = { status: number; body: Record<string, unknown> };

function setup() {
  const bots = [{ id: "nova", owner: "ada" }, { id: "atlas", owner: "grace" }];
  const lines: string[] = [];
  const quiet = new QuietMode({
    bot: (id) => bots.find((bot) => bot.id === id),
    bots: () => bots,
    owner: (bot) => bot.owner,
    language: () => "en",
    line: (_bot, text) => { lines.push(text); },
  });
  // the caller is ada: she owns nova, not atlas
  const route = createQuietModeRoutes({
    quiet,
    person: () => "ada",
    ownBot: (_auth, botId) => bots.find((bot) => bot.id === botId && bot.owner === "ada"),
  });
  const call = (method: string, path: string, body?: unknown): Promise<Answer | "PASS"> => {
    let answer: Answer | null = null;
    return route({
      req: {} as never, res: {} as never, url: new URL(`http://x${path}`), path, method,
      auth: { kind: "client", scopes: [] } as never,
      json: ((_res: unknown, status: number, out: Record<string, unknown>) => { answer = { status, body: out }; }) as never,
      readBody: (async () => body) as never,
    }).then((out) => (out === PASS ? "PASS" : answer!));
  };
  return { call, lines, quiet };
}

describe("GET and PUT the quiet mode routes (#3480)", () => {
  it("reads and sets one bot's quiet mode, and writes the line when it goes off", async () => {
    const { call, lines, quiet } = setup();
    expect(await call("GET", "/api/bots/nova/other")).toBe("PASS");
    expect(await call("GET", quietModeBotPath("nova"))).toEqual({ status: 200, body: { botId: "nova", bot: false, all: false, quiet: false, kept: { runs: 0, problems: 0 } } });
    const on = await call("PUT", quietModeBotPath("nova"), { on: true, via: "words" }) as Answer;
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ quiet: true, said: "Done: I am staying quiet and will reach you only when I need your answer." });
    quiet.keep("nova", "r1", false);
    const off = await call("PUT", quietModeBotPath("nova"), { on: false }) as Answer;
    expect(off.body).toMatchObject({ quiet: false, summary: "Quiet mode is off: 1 run kept quiet, none with problems. See them in Automations, under each routine's Runs." });
    expect(lines).toHaveLength(1);
  });

  it("is the person's own: another person's bot is not found, and a bad body is refused", async () => {
    const { call } = setup();
    expect(await call("PUT", quietModeBotPath("atlas"), { on: true })).toMatchObject({ status: 404 });
    expect(await call("PUT", quietModeBotPath("nova"), { quiet: "yes" })).toMatchObject({ status: 400 });
    expect(await call("DELETE", quietModeBotPath("nova"))).toMatchObject({ status: 405 });
  });

  it("sets all the person's bots at once", async () => {
    const { call, quiet } = setup();
    const on = await call("PUT", QUIET_MODE_PERSON_PATH, { on: true }) as Answer;
    expect(on.body).toMatchObject({ all: true, bots: [{ botId: "nova", quiet: true }] });
    expect(quiet.quiet("nova")).toBe(true);
    expect(quiet.quiet("atlas")).toBe(false);
    expect(await call("GET", QUIET_MODE_PERSON_PATH)).toMatchObject({ status: 200, body: { all: true } });
  });

  it("is the person's own route (client scope)", () => {
    for (const path of [QUIET_MODE_PERSON_PATH, quietModeBotPath("nova")]) {
      expect(CLIENT_ALLOW.find((entry) => entry.path.test(path))?.methods).toEqual(["GET", "PUT"]);
    }
  });
});
