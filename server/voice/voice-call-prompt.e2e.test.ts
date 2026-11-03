// A voice call turn, end to end through the real server and the fake Claude
// CLI: the hidden phone-call instruction reaches the engine only on the
// turns said on a call (with the interrupted marker when the person cut the
// bot), the first written turn after the call is told the call ended, and
// the thread stores only the person's words (docs/voice-mode-xai.md).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../../scripts/control-omb.ts";
import { VOICE_CALL_INTERRUPTED_NOTE } from "./voice-call-prompt.ts";

const CALL = "You are on a live phone call with";
const ENDED = "The phone call with";

it("gives call turns the hidden phone-call instruction and stores only the words", async () => {
  const fixture = await launchVerificationServer();
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5_000),
    });
    const result = await response.json() as any;
    expect(response.status, JSON.stringify(result)).toBe(status);
    return result;
  };
  const receivedPath = join(dataDir, "received.jsonl");
  // Everything the engine was given so far: each launch's appended system
  // prompt, then every prompt written to it, in order.
  const received = () => {
    const dumps = readdirSync(dataDir).filter((name) => name.startsWith("dump-")).sort()
      .map((name) => JSON.parse(readFileSync(join(dataDir, name), "utf8")).systemPrompt ?? "");
    const prompts = existsSync(receivedPath) ? readFileSync(receivedPath, "utf8") : "";
    return { dumps: dumps.join("\n"), prompts, count: prompts.trim() ? prompts.trim().split("\n").length : 0 };
  };
  try {
    const wrapper = join(dataDir, "call-claude.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      'import { join } from "node:path";',
      `const home = ${JSON.stringify(dataDir)};`,
      'process.env.FAKE_CLAUDE_PROMPTS = join(home, "received.jsonl");',
      'process.env.FAKE_CLAUDE_DUMP = join(home, "dump-" + String(Date.now()).padStart(15, "0") + "-" + process.pid + ".json");',
      'process.stdin.on("end", () => process.exit(0));',
      `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../testing/fake-claude-cli.ts", import.meta.url))).href)});`,
    ].join("\n"), { mode: 0o700 });
    await api("PATCH", "/api/instances/claude", { cli: wrapper });
    const bot = (await api("POST", "/api/bots", { name: "Phone friend" }, 201)).bot;
    const thread = bot.threadId;
    const messages = async () => (await api("GET", `/api/threads/${thread}/messages?limit=100`)).messages as any[];
    let turns = 0;
    // one turn: what the engine received for it alone
    const turn = async (body: Record<string, unknown>) => {
      const before = received();
      await api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, ...body }, 202);
      turns += 1;
      await expect.poll(() => received().count, { timeout: 15_000 }).toBe(before.count + 1);
      await expect.poll(async () => (await messages()).filter((m) => m.role === "bot" && m.turnTerminal).length, { timeout: 15_000 }).toBe(turns);
      const after = received();
      return after.dumps.slice(before.dumps.length) + "\n" + after.prompts.slice(before.prompts.length);
    };

    const written = await turn({ text: "Hello in writing" });
    expect(written).not.toContain(CALL);
    expect(written).not.toContain(ENDED);

    const said = "can you check the uh the weather for tomorrow";
    const call = await turn({ text: said, voiceCall: { callId: "call-0123456789", language: "fr" } });
    expect(call).toContain(CALL);
    expect(call).toContain("(their call is set to French)");
    expect(call).toContain("never mention a transcript, dictation or voice mode");
    expect(call).not.toContain(VOICE_CALL_INTERRUPTED_NOTE);

    const cut = await turn({ text: "no wait stop that", voiceCall: { callId: "call-0123456789", interrupted: true } });
    expect(cut).toContain(VOICE_CALL_INTERRUPTED_NOTE);

    const after = await turn({ text: "Back to typing" });
    expect(after).not.toContain(CALL);
    expect(after).toContain(ENDED);

    const later = await turn({ text: "Still typing" });
    expect(later).not.toContain(CALL);
    expect(later).not.toContain(ENDED);

    // the thread keeps the person's words, marked, never the instruction
    const users = (await messages()).filter((m) => m.role === "user");
    expect(users.map((m) => m.text)).toEqual(["Hello in writing", said, "no wait stop that", "Back to typing", "Still typing"]);
    expect(users[1].voiceCall).toEqual({ callId: "call-0123456789", language: "fr" });
    expect(users[2].voiceCall).toEqual({ callId: "call-0123456789", interrupted: true });
    expect(users[0].voiceCall).toBeUndefined();
    for (const message of await messages()) expect(String(message.text ?? "")).not.toContain(CALL);

    // a malformed mark is refused before anything is recorded
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, text: "x", voiceCall: { callId: "no" } }, 400);
  } finally {
    await fixture.close();
  }
}, 90_000);
