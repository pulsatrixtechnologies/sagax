// A turn its engine refuses with a real HTTP 403 (Claude Code's api-error
// frame for an account whose plan does not allow it here: "OAuth
// authentication is currently not allowed for this organization") is sent
// again once, at once, to the backup the person chose, end to end through
// the real server, the fake Claude CLI and the fake Codex app-server
// (resendOnSignedOutBackup, server/engines/signed-out-carry-on.ts, wired in
// server/runtime-events/turn-completed.ts). The backup answers that very
// message, the conversation keeps the model the person chose, and a second
// refusal never loops.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../../scripts/control-omb.ts";

const BACKUP = { instanceId: "codex", model: "gpt-fake-default" };
const REFUSAL = 'API Error: 403 {"type":"error","error":{"type":"permission_error","message":"OAuth authentication is currently not allowed for this organization."},"request_id":"req_fixture_403"}';

async function fixture() {
  const server = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, ["codex"]);
  const { url, dataDir } = server.info;
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const prompts = join(dataDir, "claude-prompts.jsonl");
  const wrapper = join(dataDir, "refusing-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    // every turn the account's plan refuses, as Claude Code 2.1 relays an HTTP 403
    'process.env.FAKE_CLAUDE_MODE = "api-error";',
    `process.env.FAKE_CLAUDE_API_ERROR = ${JSON.stringify(REFUSAL)};`,
    'process.env.FAKE_CLAUDE_API_ERROR_STATUS = "403";',
    `process.env.FAKE_CLAUDE_PROMPTS = ${JSON.stringify(prompts)};`,
    'process.stdin.on("end", () => process.exit(0));',
    `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../testing/fake-claude-cli.ts", import.meta.url))).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli: wrapper });
  // The fake Codex lists its models once the server is up; a backup is only accepted once its model is offered.
  await expect.poll(async () => {
    const { instances } = await api("GET", "/api/instances");
    return instances.find((instance: any) => instance.instanceId === "codex")?.models?.options?.some((option: any) => option.id === BACKUP.model);
  }, { timeout: 20_000 }).toBe(true);
  const bot = (await api("POST", "/api/bots", { name: "Quasar" }, 201)).bot;
  const thread = bot.threadId as string;
  const messages = async () => (await api("GET", `/api/threads/${thread}/messages?limit=200`)).messages as any[];
  const claudePrompts = () => (existsSync(prompts) ? readFileSync(prompts, "utf8").trim().split("\n").filter(Boolean) : []);
  return { server, api, bot, thread, messages, claudePrompts };
}

it("sends a turn its engine refused with HTTP 403 again once, at once, to the backup the person chose", async () => {
  const t = await fixture();
  try {
    expect(t.bot.modelSelection.instanceId).toBe("claude");
    const own = { ...t.bot.modelSelection };
    // The person chose Codex as this bot's backup (Automatic recovery, on the bot itself: no admin).
    await t.api("PATCH", `/api/bots/${t.bot.id}/runtime-settings`, { automaticRecovery: { enabled: true, backup: BACKUP } });
    await t.api("POST", `/api/bots/${t.bot.id}/messages`, { threadId: t.thread, text: "what is on my calendar today" }, 202);

    // The backup answers that very message, with nothing sent again by the person.
    await expect.poll(async () => (await t.messages()).some((m) => m.role === "bot" && m.kind === "text" && String(m.text ?? "").includes("fake codex")),
      { timeout: 30_000 }).toBe(true);
    const all = await t.messages();
    const asked = all.filter((m) => m.role === "user" && m.text === "what is on my calendar today");
    expect(asked).toHaveLength(1);
    // Claude really met the message, once, and refused it.
    expect(t.claudePrompts().filter((line) => line.includes("what is on my calendar today"))).toHaveLength(1);
    // The refused turn went to the backup, and the conversation says so in one quiet line.
    expect(all.filter((m) => m.kind === "activity" && m.tool?.limitFailover?.kind === "signedOut").map((m) => m.tool.limitFailover))
      .toEqual([{ kind: "signedOut", from: "Verification fixture", to: "Verification Codex" }]);
    const answer = all.findIndex((m) => m.role === "bot" && m.kind === "text" && m.turnTerminal && String(m.text ?? "").includes("fake codex"));
    expect(answer).toBeGreaterThan(all.indexOf(asked[0]));

    // The conversation keeps the model the person chose: only the refused turn ran on the backup.
    const task = (await t.api("GET", "/api/bots")).bots.find((entry: any) => entry.id === t.bot.id);
    expect(task.modelSelection).toMatchObject({ instanceId: own.instanceId, model: own.model });

    // A second message while Claude is held starts on the backup directly, and Claude never sees it.
    await t.api("POST", `/api/bots/${t.bot.id}/messages`, { threadId: t.thread, text: "and tomorrow" }, 202);
    await expect.poll(async () => (await t.messages()).filter((m) => m.role === "bot" && m.kind === "text" && m.turnTerminal && String(m.text ?? "").includes("fake codex")).length,
      { timeout: 30_000 }).toBe(2);
    expect(t.claudePrompts().filter((line) => line.includes("and tomorrow"))).toHaveLength(0);
  } finally {
    await t.server.close();
  }
}, 120_000);
