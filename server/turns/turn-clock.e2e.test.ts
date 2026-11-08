// The per-turn clock note, end to end: once a time zone is set, the text the
// engine gets starts with the local time in that zone; with none set the
// engine gets the user's text unchanged. Real harness, fake Claude CLI that
// dumps what it was given, throwaway home.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchVerificationServer, type VerificationServer } from "../../scripts/control-omb.ts";
import { removeTempDir } from "../testing/cleanup.ts";

describe.skipIf(process.platform === "win32")("turn clock e2e", () => {
  let session: VerificationServer;
  let fixture: string;
  let botId: string;
  let threadId: string;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${session.info.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: session.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  // The text the engine received for this turn.
  const engineText = async (text: string): Promise<string> => {
    const dump = join(fixture, "provider.json");
    rmSync(dump, { force: true });
    expect((await api("POST", `/api/bots/${botId}/messages`, { text, threadId })).status).toBe(202);
    let got = "";
    await expect.poll(() => {
      if (!existsSync(dump)) return false;
      const prompt = JSON.parse(readFileSync(dump, "utf8")).prompt;
      got = typeof prompt?.message?.content === "string" ? prompt.message.content : "";
      return got.endsWith(text);
    }, { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => (await api("GET", "/api/bots")).body.bots.find((bot: any) => bot.id === botId)?.busy, { timeout: 15_000 }).toBe(false);
    return got;
  };

  beforeAll(async () => {
    fixture = mkdtempSync(join(tmpdir(), "omb-turn-clock-"));
    session = await launchVerificationServer(process.env);
    const wrapper = join(fixture, "dump-claude.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      `process.env.FAKE_CLAUDE_DUMP = ${JSON.stringify(join(fixture, "provider.json"))};`,
      `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
    ].join("\n"), { mode: 0o700 });
    expect((await api("PATCH", "/api/instances/claude", { cli: wrapper })).status).toBe(200);
    const created = await api("POST", "/api/bots", { name: "Clock", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
    expect(created.status).toBe(201);
    botId = created.body.bot.id;
    threadId = created.body.bot.threadId;
  }, 30_000);

  afterAll(async () => {
    if (session) await session.close();
    if (fixture) await removeTempDir(fixture);
  });

  it("adds the local time only when a zone is set", async () => {
    expect(await engineText("NO_ZONE_YET")).not.toContain("[Current time:");
    expect((await api("PUT", "/api/settings/bot", { timeZone: "America/Toronto" })).status).toBe(200);
    const zoned = await engineText("WITH_ZONE");
    expect(zoned).toMatch(/\[Current time: \w+day, \w+ \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M, America\/Toronto \(UTC-0[45]:00\)\. This clock is exact: [^\]]*Give dates and times in America\/Toronto[^\]]*\]\n\nWITH_ZONE$/);
  }, 60_000);
});
