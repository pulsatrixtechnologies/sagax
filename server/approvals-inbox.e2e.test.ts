// The Approvals screen against a real isolated server and the native
// permission broker (no model, no real command): the list holds the open
// permission and question cards with plain fields and the card as the
// conversation shows it; one card answered the usual way leaves it; a bulk
// Allow answers the plain permissions once (the broker gets "allow", no
// rule is saved) and leaves the question with its reason; a bulk body that
// tries to remember anything is refused whole; a paired member device
// sees nothing to answer; the History names each answer and who gave it.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";

it("lists, answers one, answers in bulk once only, and keeps the history", async () => {
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "hang" });
  const { url, dataDir } = fixture.info;
  const sockets: Socket[] = [];
  const api = async (method: string, path: string, body?: unknown, status = 200, token?: string) => {
    const response = await fetch(url + path, {
      method,
      headers: { origin: url, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const ask = async (socketPath: string, payload: Record<string, unknown>) => {
    const socket = connect(socketPath);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const id = randomUUID();
    let buffer = "";
    const reply = new Promise<any>((resolve, reject) => {
      socket.once("error", reject);
      socket.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.includes("\n")) resolve(JSON.parse(buffer.split("\n")[0]!));
      });
    });
    void reply.catch(() => {});
    socket.write(JSON.stringify({ t: "ask", id, ...payload }) + "\n");
    return { id, reply };
  };
  try {
    const bot = (await api("POST", "/api/bots", { name: "Inbox fixture", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }, 201)).bot;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "ask" });
    const dump = join(dataDir, "fake-claude-dump.json");
    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "Hold this task while its approvals are answered from the Approvals screen." }, 202);
    await expect.poll(() => existsSync(dump), { timeout: 15_000 }).toBe(true);
    const socketPath = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.ogb.args.at(-1) as string;

    const first = await ask(socketPath, { tool: "Bash", input: { command: "printf one" } });
    const second = await ask(socketPath, { tool: "Bash", input: { command: "printf two" } });
    const third = await ask(socketPath, { tool: "Bash", input: { command: "printf three" } });
    const question = await ask(socketPath, { kind: "question", tool: "AskUserQuestion", input: { questions: [{ question: "Which file?", options: [{ label: "README" }, { label: "Guide" }] }] } });
    await expect.poll(async () => (await api("GET", "/api/approvals")).pending.length, { timeout: 10_000 }).toBe(4);

    const listed = (await api("GET", "/api/approvals")).pending as any[];
    const byId = new Map(listed.map((entry) => [entry.requestId, entry]));
    expect(byId.get(first.id)).toMatchObject({ botName: "Inbox fixture", kind: "permission", scope: "mine", decidable: true, bulk: true, destination: "computer", threadId: bot.threadId });
    expect(byId.get(first.id).message.card.requestId).toBe(first.id);
    expect(byId.get(question.id)).toMatchObject({ kind: "question", bulk: "question", decidable: true });
    expect((await api("GET", "/api/approvals")).history).toEqual([]);

    // A device paired with chat access only answers nothing here.
    const pairing = await api("POST", "/api/auth/pairing", { label: "Member fixture", scopes: ["client"] });
    const paired = await api("POST", "/api/auth/pair", { code: pairing.code });
    const memberView = await fetch(url + "/api/approvals", { headers: { origin: url, authorization: `Bearer ${paired.token}` } });
    if (memberView.status === 200) {
      expect(((await memberView.json()) as any).pending.filter((entry: any) => entry.decidable && entry.kind === "permission")).toEqual([]);
    } else {
      expect([401, 403]).toContain(memberView.status);
    }

    // One card answered the usual way leaves the list.
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: first.id, behavior: "deny" });
    expect(await first.reply).toMatchObject({ behavior: "deny" });
    await expect.poll(async () => (await api("GET", "/api/approvals")).pending.length).toBe(3);

    // Never "always" in bulk.
    const refused = await api("POST", "/api/approvals/bulk", { decision: "allow", always: true, items: [{ threadId: bot.threadId, requestId: second.id }] }, 400);
    expect(refused.code).toBe("bulk_once_only");

    const bulk = await api("POST", "/api/approvals/bulk", {
      decision: "allow",
      items: [second.id, third.id, question.id, first.id].map((requestId) => ({ threadId: bot.threadId, requestId })),
    });
    expect(bulk.answered).toBe(2);
    const codes = Object.fromEntries(bulk.results.map((row: any) => [row.key.split(":")[1], row.ok ? "ok" : row.code]));
    expect(codes).toEqual({ [second.id]: "ok", [third.id]: "ok", [question.id]: "question", [first.id]: "gone" });
    expect(await second.reply).toMatchObject({ behavior: "allow" });
    expect(await third.reply).toMatchObject({ behavior: "allow" });
    expect((await api("GET", `/api/bots/${bot.id}/command-allowlist`)).rules).toEqual([]);
    const left = (await api("GET", "/api/approvals")).pending as any[];
    expect(left.map((entry) => entry.requestId)).toEqual([question.id]);

    const history = (await api("GET", "/api/approvals?history=1")).history as any[];
    const answered = new Map(history.map((row) => [row.requestId, row]));
    expect(answered.get(first.id)).toMatchObject({ decision: "user-denied", botName: "Inbox fixture" });
    expect(answered.get(second.id)).toMatchObject({ decision: "user-approved" });
    expect(answered.get(third.id)).toMatchObject({ decision: "user-approved" });
    expect(typeof answered.get(second.id).who).toBe("string");

    await api("POST", `/api/bots/${bot.id}/interrupt`, { threadId: bot.threadId });
  } finally {
    for (const socket of sockets) socket.destroy();
    await fixture.close();
  }
}, 90_000);
