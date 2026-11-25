import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SAVE_RUN_AS_SKILL_LINE } from "../shared/learn-request.ts";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("dispatches setup and canonical standing instructions through the real isolated app", async () => {
  // 062d7c42e continues tool-only endings; inspect this requested turn, not a follow-up.
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_TOOL_CALLS: "[]", SAGAX_TURN_CLOCK: "on" });
  const env = { SAGAX_URL: fixture.info.url };
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    expect(response.ok, JSON.stringify(result)).toBe(true);
    return result;
  };
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Setup fixture"], { env }) as any;
    const turn = async (text: string) => {
      await runControlOmb(["send", "--bot", bot.id, "--text", text], { env });
      await runControlOmb(["wait", "--bot", bot.id, "--timeout", "30"], { env });
      return JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
    };
    await api("PUT", "/api/settings/bot", { timeZone: "America/Toronto" });
    const setup = await turn("/setup Help me track garden watering");
    expect(JSON.stringify(setup.prompt)).toContain("[Current time:");
    expect(setup.systemPrompt).toContain("The user explicitly asked you to set yourself up");
    expect(setup.systemPrompt).toContain("propose_profile");
    expect(JSON.stringify(setup.prompt)).toContain("Set yourself up for this job: Help me track garden watering");

    const bare = await turn("/setup");
    expect(JSON.stringify(bare.prompt)).toContain("Set yourself up. Ask me what you need to know");
    expect(JSON.stringify(bare.prompt)).toContain("[Current time:");

    await api("PATCH", "/api/config", { features: { skillAuthoring: false } });
    const disabled = await turn("/learn record the harvest");
    expect(JSON.stringify(disabled.prompt)).toContain("/learn record the harvest");
    expect(JSON.stringify(disabled.prompt)).not.toContain("[/learn]");

    await api("PATCH", "/api/config", { features: { skillAuthoring: true } });
    for (const request of ["/learn record the harvest", `${SAVE_RUN_AS_SKILL_LINE}\nrecord the harvest`]) {
      const learned = await turn(request);
      expect(JSON.stringify(learned.prompt)).toContain("[Current time:");
      expect(JSON.stringify(learned.prompt)).toContain("[/learn]");
      expect(JSON.stringify(learned.prompt)).toContain("record the harvest");
      expect(learned.systemPrompt).not.toContain("The user explicitly asked you to set yourself up");
    }

    await api("PATCH", `/api/bots/${bot.id}`, { description: "Garden helper", soul: "Only water the fixture garden after approval." });
    writeFileSync(join(fixture.info.dataDir, "bots", bot.id, "SOUL.md"), "UNAPPROVED MIRROR INSTRUCTIONS");
    const configured = await turn("What is your job?");
    expect(configured.systemPrompt).toContain("Only water the fixture garden after approval.");
    expect(configured.systemPrompt).not.toContain("UNAPPROVED MIRROR INSTRUCTIONS");
    expect(configured.systemPrompt).not.toContain("The user explicitly asked you to set yourself up");
    const drift = await api("GET", `/api/bots/${bot.id}/soul`);
    expect(drift.drift).toBe(true);
    expect(drift.fileText).toBe("UNAPPROVED MIRROR INSTRUCTIONS");
    expect((await api("GET", `/api/bots/${bot.id}/history`)).rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "soul" }),
    ]));
    const messages = await runControlOmb(["messages", "--bot", bot.id, "--limit", "40"], { env });
    expect(JSON.stringify(messages)).toContain("hello from fake claude");
    expect(JSON.stringify(messages)).toContain('"/setup"');
    expect(JSON.stringify(messages)).toContain('"/learn record the harvest"');
  } finally {
    await fixture.close();
  }
}, 90_000);
