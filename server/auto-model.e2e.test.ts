import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";

// Auto model (docs/plans/2026-10-08-auto-model.md) through real turns on the
// scripted Claude fixture: a person's turn runs on the orchestration model,
// delegated work on the model its class calls for, and a pinned teammate
// keeps its own model.
async function fixture(test: (f: any) => Promise<void>) {
  const session = await launchVerificationServer({ ...process.env }, undefined, undefined, undefined, undefined, { scripted: true });
  const cli = (...args: string[]) => runControlOmb(args, { env: { SAGAX_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") => request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  try {
    const chief = (await cli("new-bot", "--name", "Clive", "--section", "Leadership")).bot;
    const lead = (await cli("new-bot", "--name", "Engineering lead", "--section", "Engineering")).bot;
    const specialist = (await cli("new-bot", "--name", "Reviewer", "--section", "Engineering")).bot;
    await api(`/api/bots/${chief.id}`, { chiefOfStaff: true, managedSections: ["Engineering"], acknowledgePeerScope: true }, "PATCH");
    const planPath = join(session.info.dataDir, "room-plan.json");
    const plan: Record<string, any> = {
      [chief.id]: { steps: [{ arguments: { bot_ids: [lead.id], message: "Refactor the CSV export module and fix the failing unit tests" } }], reply: "Assigned to Engineering", resumeReply: "The CSV export is refactored and tested" },
      [lead.id]: { steps: [{ arguments: { bot_ids: [specialist.id], message: "Review the refactored CSV export code" } }], reply: "Sent for review", resumeReply: "Refactored and reviewed" },
      [specialist.id]: { reply: "Code review done" },
    };
    writeFileSync(planPath, JSON.stringify(plan));
    const bots = async () => (await api("/api/bots?messages=0")).bots as any[];
    const messages = async (threadId: string) => (await api(`/api/threads/${threadId}/messages`)).messages as any[];
    await test({ session, cli, api, chief, lead, specialist, bots, messages });
  } finally { await session.close(); }
}

const auto = (selection: any) => ({ ...selection, auto: true });

it("runs an Auto bot's own turn on the orchestration model and says why", () => fixture(async f => {
  const saved = await f.api(`/api/bots/${f.chief.id}`, { modelSelection: auto(f.chief.modelSelection) }, "PATCH");
  expect(saved.modelSelection?.auto ?? (await f.bots()).find((b: any) => b.id === f.chief.id).modelSelection.auto).toBe(true);
  const preview = await f.api(`/api/bots/${f.chief.id}/auto-model`, undefined, "GET");
  expect(preview.auto).toBe(true);
  expect(preview.pick).toMatchObject({ role: "orchestration", model: "claude-fable-5-2", reason: "strongest-own", tier: "top" });
  expect(preview.explanation).toContain("Auto: Claude Fable 5.2 for this bot, because it is the strongest general model");

  await f.cli("send", "--bot", f.chief.id, "--task", f.chief.activeTaskId, "--text", "Please have Engineering refactor the CSV export.");
  expect((await f.cli("wait", "--bot", f.chief.id, "--task", f.chief.activeTaskId, "--timeout", "30")).status).toBe("settled");
  const chief = (await f.bots()).find((b: any) => b.id === f.chief.id);
  const task = chief.tasks.find((t: any) => t.threadId === f.chief.activeTaskId);
  expect(task.autoModel).toMatchObject({ role: "orchestration", model: "claude-fable-5-2" });
  // The bot itself keeps Auto and its base model.
  expect(chief.modelSelection).toMatchObject({ ...f.chief.modelSelection, auto: true });
  expect((await f.api(`/api/bots/${f.lead.id}/auto-model`, undefined, "GET")).auto).toBe(false);
}), 60_000);

it("gives delegated work on an Auto teammate the model for its class, and leaves a pinned one alone", () => fixture(async f => {
  await f.api(`/api/bots/${f.lead.id}`, { modelSelection: auto(f.lead.modelSelection) }, "PATCH");
  await f.cli("send", "--bot", f.chief.id, "--task", f.chief.activeTaskId, "--text", "Please have Engineering refactor the CSV export.");
  expect((await f.cli("wait", "--bot", f.chief.id, "--task", f.chief.activeTaskId, "--timeout", "45")).status).toBe("settled");

  const workerTask = async () => (await f.bots()).find((b: any) => b.id === f.lead.id)?.tasks.find((t: any) => t.autoModel?.role === "worker");
  await expect.poll(workerTask, { timeout: 20_000 }).toBeTruthy();
  const task = await workerTask();
  expect(task.autoModel).toMatchObject({ role: "worker", taskClass: "coding", tier: "coding", model: "claude-sonnet-5-5", reason: "strongest-own" });
  const rows = await f.messages(task.threadId);
  const row = rows.find((m: any) => m.kind === "activity" && m.autoModel?.role === "worker");
  expect(row?.tool?.name).toBe("notice: Auto: worker Verification fixture · Claude Sonnet 5.5 (coding), the coding tier this server can run.");

  // The pinned reviewer ran on its own model: no Auto record anywhere.
  const reviewer = (await f.bots()).find((b: any) => b.id === f.specialist.id);
  expect(reviewer.modelSelection).toEqual(f.specialist.modelSelection);
  expect(reviewer.tasks.some((t: any) => t.autoModel)).toBe(false);
  // The chief stayed pinned too: its own turns carry no pick.
  expect((await f.bots()).find((b: any) => b.id === f.chief.id).tasks.some((t: any) => t.autoModel)).toBe(false);
}), 90_000);

it("rejects a malformed Auto flag and lets a person pin a model again", () => fixture(async f => {
  await expect(f.api(`/api/bots/${f.lead.id}`, { modelSelection: { ...f.lead.modelSelection, auto: "yes" } }, "PATCH")).rejects.toThrow(/auto must be a boolean/);
  await f.api(`/api/bots/${f.lead.id}`, { modelSelection: auto(f.lead.modelSelection) }, "PATCH");
  await f.api(`/api/bots/${f.lead.id}`, { modelSelection: { instanceId: f.lead.modelSelection.instanceId, model: "claude-haiku-4-5" } }, "PATCH");
  const lead = (await f.bots()).find((b: any) => b.id === f.lead.id);
  expect(lead.modelSelection.auto).toBeUndefined();
  expect(lead.modelSelection.model).toBe("claude-haiku-4-5");
}), 45_000);
