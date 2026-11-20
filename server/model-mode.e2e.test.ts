import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";

// Composer modes (#4900) through the real server and the scripted Claude
// fixture: the choice is stored with the bot (and refused when it is not a
// mode), the preview says what every mode runs for this person, and a
// person's turn runs on the mode's model with its effort and records why.
async function fixture(test: (f: any) => Promise<void>) {
  const session = await launchVerificationServer({ ...process.env }, undefined, undefined, undefined, undefined, { scripted: true });
  const cli = (...args: string[]) => runControlOmb(args, { env: { SAGAX_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") => request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  try {
    const bot = (await cli("new-bot", "--name", "Wren", "--section", "Leadership")).bot;
    writeFileSync(join(session.info.dataDir, "room-plan.json"), JSON.stringify({ [bot.id]: { reply: "Hello." } }));
    const bots = async () => (await api("/api/bots?messages=0")).bots as any[];
    await test({ session, cli, api, bot, bots });
  } finally { await session.close(); }
}

const withMode = (selection: any, mode: string) => ({ ...selection, auto: true, mode });

it("stores a mode, names what each mode runs, and runs the turn on it", () => fixture(async f => {
  await f.api(`/api/bots/${f.bot.id}`, { modelSelection: withMode(f.bot.modelSelection, "fast") }, "PATCH");
  expect((await f.bots()).find((b: any) => b.id === f.bot.id).modelSelection).toMatchObject({ auto: true, mode: "fast" });

  const preview = await f.api(`/api/bots/${f.bot.id}/auto-model`, undefined, "GET");
  expect(Object.keys(preview.modes)).toEqual(["auto", "fast", "expert", "heavy"]);
  expect(preview.modes.fast).toMatchObject({ pick: { model: "claude-haiku-5-5" } });
  expect(preview.modes.expert.pick.model).toBe("claude-fable-5-2");
  // #5089: one account here: Heavy seats its two strongest models
  expect(preview.modes.heavy.team.map((seat: { model: string }) => seat.model)).toEqual(["claude-fable-5-2", "claude-fable-5-1"]);
  expect(preview.pick).toMatchObject({ mode: "fast", reason: "mode", tier: "fast", model: "claude-haiku-5-5" });

  await f.cli("send", "--bot", f.bot.id, "--task", f.bot.activeTaskId, "--text", "Say hello.");
  expect((await f.cli("wait", "--bot", f.bot.id, "--task", f.bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
  const task = (await f.bots()).find((b: any) => b.id === f.bot.id).tasks.find((t: any) => t.threadId === f.bot.activeTaskId);
  expect(task.autoModel).toMatchObject({ role: "orchestration", mode: "fast", reason: "mode", model: "claude-haiku-5-5" });
  // the bot keeps its mode and its base model
  expect((await f.bots()).find((b: any) => b.id === f.bot.id).modelSelection).toMatchObject({ ...f.bot.modelSelection, auto: true, mode: "fast" });
}), 60_000);

it("refuses a mode that does not exist, drops one with no Auto, and a pinned model clears it", () => fixture(async f => {
  await expect(f.api(`/api/bots/${f.bot.id}`, { modelSelection: withMode(f.bot.modelSelection, "turbo") }, "PATCH")).rejects.toThrow(/mode must be/);
  await f.api(`/api/bots/${f.bot.id}`, { modelSelection: { ...f.bot.modelSelection, mode: "heavy" } }, "PATCH");
  expect((await f.bots()).find((b: any) => b.id === f.bot.id).modelSelection.mode).toBeUndefined();
  await f.api(`/api/bots/${f.bot.id}`, { modelSelection: withMode(f.bot.modelSelection, "expert") }, "PATCH");
  await f.api(`/api/bots/${f.bot.id}`, { modelSelection: { instanceId: f.bot.modelSelection.instanceId, model: "claude-haiku-4-5" } }, "PATCH");
  const saved = (await f.bots()).find((b: any) => b.id === f.bot.id).modelSelection;
  expect(saved.auto).toBeUndefined();
  expect(saved.mode).toBeUndefined();
}), 45_000);
