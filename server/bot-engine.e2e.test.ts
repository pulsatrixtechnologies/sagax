import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";
import { readHandoffs } from "./testing/handoff-rows.ts";

async function fixture(test: (f: any) => Promise<void>) {
  const session = await launchVerificationServer({ ...process.env }, undefined, undefined, undefined, undefined, { scripted: true });
  const cli = (...args: string[]) => runControlOmb(args, { env: { SAGAX_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") => request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  try { await test({ session, cli, api }); } finally { await session.close(); }
}

it("a bot created without a named engine receives the default engine; an empty one is refused at the API", () => fixture(async ({ api }) => {
  const created = (await api("/api/bots", { name: "Fig" })).bot;
  expect(created.modelSelection.instanceId).not.toBe("");
  expect(created.modelSelection.model).not.toBe("");
  await expect(api("/api/bots", { name: "Empty", modelSelection: { instanceId: "", model: "" } })).rejects.toThrow(/400/);
}));

it("a delegation to a teammate whose engine is not usable falls back at once", () => fixture(async ({ session, cli, api }) => {
  const chief = (await cli("new-bot", "--name", "Clive", "--section", "Leadership")).bot;
  const fig = (await cli("new-bot", "--name", "Fig", "--section", "Engineering")).bot;
  await api(`/api/bots/${chief.id}`, { chiefOfStaff: true, managedSections: ["Engineering"], acknowledgePeerScope: true }, "PATCH");
  // the engine this teammate named is gone (removed, or never installed)
  await api(`/api/bots/${fig.id}`, { modelSelection: { instanceId: "ghost-engine", model: "m" } }, "PATCH");
  writeFileSync(join(session.info.dataDir, "room-plan.json"), JSON.stringify({
    [chief.id]: { steps: [{ arguments: { bot_ids: [fig.id], message: "Review the export" } }], reply: "Je le fais moi-même", resumeReply: "Fait moi-même" },
  }));
  await cli("send", "--bot", chief.id, "--task", chief.activeTaskId, "--text", "Fais réviser l'export par Fig.");
  await cli("wait", "--bot", chief.id, "--task", chief.activeTaskId, "--timeout", "30");
  // nothing was queued for the teammate: no handoff to wait on
  expect(readHandoffs(session.info.dataDir).filter((node: any) => node.botId === fig.id)).toEqual([]);
  const messages = (await api(`/api/threads/${chief.activeTaskId}/messages`)).messages;
  expect(JSON.stringify(messages)).not.toContain('provider instance \\"\\"');
}));
