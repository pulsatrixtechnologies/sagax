// Real server; only the provider's planning is scripted. A Chief of Staff's
// level flows down to the threads it opens with teammates, so the person
// stops switching each one off "Ask for approval" by hand.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("starts a thread a Chief opens with a teammate at the Chief's level, and a Chief on Ask raises nobody", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = fixture.info;
  const planPath = join(dataDir, "room-plan.json");
  const plans: Record<string, { turns: any[] }> = {};
  const providerTurns = (): any[] => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages as any[];
  const persistedTask = (botId: string, threadId: string) => JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"))
    .find((bot: any) => bot.id === botId).tasks.find((task: any) => task.threadId === threadId);
  /** The Chief brings `teammate` in from `threadId` (coordinate_bots opens a
   * thread with them); resolves with the teammate's provider turn. */
  const bringIn = async (chief: any, threadId: string, teammate: any, requestKey: string) => {
    plans[teammate.id] = { turns: [{ reply: `${teammate.name} checked the fixture report.` }] };
    (plans[chief.id] ??= { turns: [] }).turns.push(
      { steps: [{ tool: "coordinate_bots", arguments: { bot_ids: [teammate.id], request_key: requestKey, message: "Check the fixture report and say what you found." } }],
        reply: `Asked ${teammate.name} to check the report.` },
      { reply: `${teammate.name} checked the report.` },
    );
    writeFileSync(planPath, JSON.stringify(plans));
    await cli("send", "--bot", chief.id, "--task", threadId, "--text", `Have ${teammate.name} check the fixture report.`);
    await expect.poll(() => providerTurns().find(turn => turn.botId === teammate.id), { timeout: 25_000 }).toBeTruthy();
    expect((await cli("wait", "--bot", chief.id, "--task", threadId, "--timeout", "25")).status).toBe("settled");
    return providerTurns().find(turn => turn.botId === teammate.id)!;
  };
  try {
    const chief = (await cli("new-bot", "--name", "Clive", "--section", "Operations")).bot;
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true });
    const ada = (await cli("new-bot", "--name", "Ada", "--section", "Operations")).bot;
    const bea = (await cli("new-bot", "--name", "Bea", "--section", "Operations")).bot;
    // New bots start on Approve for me. This case is about delegation, so
    // each bot's own level is Ask before the Chief conversation is raised.
    for (const id of [chief.id, ada.id, bea.id]) await api("PATCH", `/api/bots/${id}`, { approvalMode: "ask" });

    // The person put the Chief on Approve for me from this conversation.
    await api("PATCH", `/api/bots/${chief.id}/tasks/${chief.activeTaskId}`, { approvalMode: "auto", acknowledgeLocalAuto: true });
    const adaTurn = await bringIn(chief, chief.activeTaskId, ada, "check-auto");
    // Ada's own level is Ask, yet the thread Clive opened with her runs Approve for me,
    // the thread says where that came from, and Ada's default does not move.
    expect(adaTurn.permissionMode).toBe("auto");
    expect(persistedTask(ada.id, adaTurn.threadId)).toMatchObject({ approvalMode: "auto", autoApprove: false });
    expect((await messages(adaTurn.threadId)).some(message => message.kind === "activity"
      && message.tool?.name === "Approve for me — delegated by Clive, a Primary Bot on Approve for me")).toBe(true);
    expect((await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === ada.id).approvalMode ?? "ask").toBe("ask");

    // A Chief on Ask raises nobody. #4200 (one approval level per bot,
    // #4226): the level picked in a conversation is the Chief's own, so the
    // person puts the Chief back on Ask before this part.
    await api("PATCH", `/api/bots/${chief.id}`, { approvalMode: "ask" });
    const askThread = (await api("POST", `/api/bots/${chief.id}/tasks`, { title: "Plain Ask work" }, 201)).task;
    const beaTurn = await bringIn(chief, askThread.threadId, bea, "check-ask");
    expect(beaTurn.permissionMode).toBe("default");
    expect(persistedTask(bea.id, beaTurn.threadId)?.approvalMode ?? "ask").toBe("ask");
    expect((await messages(beaTurn.threadId)).some(message => message.kind === "activity" && /delegated by/.test(message.tool?.name ?? ""))).toBe(false);
  } finally {
    await fixture.close();
  }
}, 120_000);
