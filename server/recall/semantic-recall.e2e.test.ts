// Recall by meaning end to end, against an isolated fixture server and the
// fake engine (FAKE_CLAUDE_PROMPTS records what the engine is sent). A fact
// is written with other words than the question, so FTS5 alone does not
// find it; with the local semantic index on (the default) the passage rides
// into the turn. Content encryption is on, as on a real server.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import type { WireBot } from "../../shared/wire.ts";

it("brings a fact said with other words into the turn, and stops when switched off", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-semantic-recall-"));
  const prompts = join(scratch, "prompts.jsonl");
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_PROMPTS: prompts, SAGAX_CONTENT_ENCRYPTION: "on" });
  const control = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
  const api = async <T = any>(path: string, method = "GET", body?: unknown, status = 200): Promise<T> => {
    const response = await fetch(fixture.info.url + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status, `${method} ${path}`).toBe(status);
    return response.json() as Promise<T>;
  };
  const turn = async (botId: string, threadId: string, text: string) => {
    await control("send", "--bot", botId, "--task", threadId, "--text", text);
    expect(await control("wait", "--bot", botId, "--task", threadId, "--timeout", "30")).toMatchObject({ status: "settled" });
  };
  const sentCount = () => { try { return readFileSync(prompts, "utf8").trim().split("\n").filter(Boolean).length; } catch { return 0; } };
  const sentSince = (count: number) => readFileSync(prompts, "utf8").trim().split("\n").slice(count).join("\n");
  try {
    const { bot } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Memo" }, 201);
    await api(`/api/bots/${bot.id}`, "PATCH", { memoryUpkeep: false });
    expect((await api("/api/config")).memory).toMatchObject({ semanticRecall: true, embeddingsUrl: "", embeddingsModel: "" });

    // a memory line FTS5 cannot match: every word of the question is misspelt
    await api(`/api/bots/${bot.id}/memory/file`, "PUT", { path: "memory/health.md", text: "- The dentist appointment is on Thursday at 3pm\n- Prefers green tea\n" });
    // a fact said in the main chat, asked about later in another chat
    await turn(bot.id, bot.threadId, "Note for later: the Lebanese restaurant reservation is for eight people.");
    const created = await api<any>(`/api/bots/${bot.id}/tasks`, "POST", { title: "New chat" }, 201);
    const second: string = created.task?.threadId ?? created.threadId;

    // switched off: FTS5 alone finds neither
    await api("/api/config", "PUT", { memory: { semanticRecall: false } });
    let before = sentCount();
    await turn(bot.id, second, "When is my dentst apointment?");
    expect(sentSince(before)).not.toContain("dentist appointment is on Thursday");
    before = sentCount();
    await turn(bot.id, second, "Lebanon restaurent reservaton?");
    expect(sentSince(before)).not.toContain("reservation is for eight people");

    // on (the default): the passages ride into the turn the engine sees
    await api("/api/config", "PUT", { memory: { semanticRecall: true } });
    before = sentCount();
    await turn(bot.id, second, "When is my dentst apointment?");
    expect(sentSince(before)).toContain("Recalled for this message");
    expect(sentSince(before)).toContain("dentist appointment is on Thursday at 3pm");
    expect(sentSince(before)).not.toContain("Prefers green tea");
    before = sentCount();
    await turn(bot.id, second, "Lebanon restaurent reservaton?");
    expect(sentSince(before)).toContain("reservation is for eight people");
    // named like an FTS5 passage: the chat it came from and who said it
    expect(sentSince(before)).toMatch(/chat \\"Note for later[^"]*\\" \(\d{4}-\d{2}-\d{2}\): User: Note for later/);

    // the bot's Memory settings see the index; its vectors are sealed on disk
    const status = await api(`/api/bots/${bot.id}/memory/semantic`);
    expect(status).toMatchObject({ enabled: true, encoder: "built-in" });
    expect(status.memoryPassages).toBeGreaterThanOrEqual(2);
    expect(status.conversationPassages).toBeGreaterThanOrEqual(1);
    const file = join(fixture.info.dataDir, "semantic-index.db");
    expect(existsSync(file)).toBe(true);
    for (const suffix of ["", "-wal"]) {
      if (existsSync(file + suffix)) expect(readFileSync(file + suffix).toString("latin1")).not.toMatch(/Lebanese|dentist/);
    }

    // an endpoint that does not answer: recall keeps the built-in vectors
    await api("/api/config", "PUT", { memory: { embeddingsUrl: "http://127.0.0.1:9/v1", embeddingsModel: "nomic-embed-text" } });
    before = sentCount();
    await turn(bot.id, second, "When is my dentst apointment?");
    expect(sentSince(before)).toContain("dentist appointment is on Thursday at 3pm");
    expect(await api(`/api/bots/${bot.id}/memory/semantic`)).toMatchObject({ encoder: "endpoint", model: "nomic-embed-text", endpointOk: false });
  } finally {
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 180_000);
