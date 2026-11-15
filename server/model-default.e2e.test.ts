import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";

it("a bot model PATCH silently moves every existing thread and keeps permissions", async () => {
  const server = await launchVerificationServer();
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${server.info.url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as any;
    expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    return result;
  };
  try {
    const bot = (await api("POST", "/api/bots", { name: "Silent model fixture" })).bot;
    const first = { instanceId: bot.modelSelection.instanceId, model: "claude-sonnet-5-5" };
    const next = { instanceId: first.instanceId, model: "claude-haiku-4-5" };
    const { task } = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Older pinned conversation" });
    await api("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { modelSelection: first, approvalMode: "edits" });
    const before = (await api("GET", `/api/threads/${task.threadId}/messages`)).messages;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: next });
    const saved = (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
    expect(saved.modelSelection).toEqual(next);
    expect(saved.tasks.every((entry: any) => entry.followsBotModel === true && entry.modelSelection.model === next.model)).toBe(true);
    // One approval level per bot (#4200): the level chosen in the
    // conversation is the bot's, and the model move keeps it.
    expect(bot.approvalMode).not.toBe("edits");
    expect(saved.approvalMode).toBe("edits");
    expect(saved.tasks.find((entry: any) => entry.threadId === task.threadId).approvalMode).toBeUndefined();
    expect((await api("GET", `/api/threads/${task.threadId}/messages`)).messages).toEqual(before);
    // Saving the same default again also clears a pin from an older client.
    await api("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { modelSelection: first });
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: next });
    const again = (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
    expect(again.tasks.every((entry: any) => entry.followsBotModel === true)).toBe(true);
  } finally { await server.close(); }
}, 60_000);
