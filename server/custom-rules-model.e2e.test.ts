// The model reviewer of custom rules (examen automatique, lot A1, JC
// 2026-10-21), through a real isolated server and the fake Claude engine:
// a card the matcher leaves to the person is judged by the one-shot
// reviewer against the person's rules written in free text. An allow it
// names answers the card (the engine gets the allow, the card says who and
// why, the journal names the rule and the reason); a deny refuses it; an
// unsure answer leaves the card to the person.
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";

import { expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

function client(fixture: VerificationServer) {
  const { url } = fixture.info;
  return async (method: string, path: string, body?: unknown, status = 200): Promise<any> => {
    const response = await fetch(url + path, {
      method,
      headers: { origin: url, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    expect(response.status, `${method} ${path}: ${text}`).toBe(status);
    try { return JSON.parse(text); } catch { return {}; }
  };
}

function decisions(dataDir: string): any[] {
  const dir = join(dataDir, "decisions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)));
}

it("judges a card against the person's free rules: allow answers it with the reason, deny refuses it, unsure leaves it", async () => {
  const routes = join(process.env.TMPDIR ?? "/tmp", `a1-routes-${randomUUID()}.json`);
  const marker = "You review one action a bot asked to take";
  const reply = (body: object) => writeFileSync(routes, JSON.stringify({ [marker]: JSON.stringify(body) }));
  reply({ decision: "none" });
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_TEXT_ROUTES: routes });
  const { dataDir } = fixture.info;
  const api = client(fixture);
  const sockets: Socket[] = [];
  try {
    const bot = (await api("POST", "/api/bots", { name: "Katarina", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }, 201)).bot;
    const threadId = bot.threadId as string;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { approvalMode: "ask" });
    const allowRule = (await api("POST", "/api/custom-rules", { when: "tout ce qui touche au projet Sagax", behavior: "allow", botId: bot.id, riskScope: [] }, 201)).rule;
    const denyRule = (await api("POST", "/api/custom-rules", { when: "toucher aux factures du client Acme", behavior: "deny", botId: bot.id, riskScope: [] }, 201)).rule;
    const dump = join(dataDir, "fake-claude-dump.json");
    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId, text: "Hold this turn while its approvals are exercised." }, 202);
    await expect.poll(() => existsSync(dump), { timeout: 15_000 }).toBe(true);
    const socketPath = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.ogb.args.at(-1) as string;
    const card = async (id: string) =>
      (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages.find((message: any) => message.card?.requestId === id)?.card;
    const ask = async (input: object) => {
      const socket = connect(socketPath);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
      const id = randomUUID();
      let buffer = "";
      let answer: any;
      socket.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.includes("\n") && !answer) answer = JSON.parse(buffer.split("\n")[0]!);
      });
      socket.write(JSON.stringify({ t: "ask", id, tool: "mcp__acme__update_ticket", input }) + "\n");
      return { id, answer: () => answer };
    };

    // allow: the reviewer names the person's allow rule
    reply({ decision: "allow", rule: "R2", reason: "Le billet fait partie du projet Sagax." });
    const allowed = await ask({ ticket: 12, project: "Sagax", status: "En cours" });
    await expect.poll(() => allowed.answer()?.behavior, { timeout: 20_000 }).toBe("allow");
    await expect.poll(async () => (await card(allowed.id))?.answeredBy?.via, { timeout: 10_000 }).toBe("auto-review");
    expect((await card(allowed.id)).customRule).toMatchObject({ id: allowRule.id, outcome: "approved", reviewer: "model", reason: "Le billet fait partie du projet Sagax." });
    await expect.poll(() => decisions(dataDir).find((row) => row.requestId === allowed.id && row.source === "auto-review"), { timeout: 5_000 })
      .toMatchObject({ decision: "auto-approved", rule: allowRule.id, reason: "Le billet fait partie du projet Sagax." });

    // deny: the reviewer names the deny rule
    reply({ decision: "deny", rule: "R1", reason: "Facture du client Acme." });
    const denied = await ask({ invoice: 7, client: "Acme" });
    await expect.poll(() => denied.answer()?.behavior, { timeout: 20_000 }).toBe("deny");
    await expect.poll(() => decisions(dataDir).find((row) => row.requestId === denied.id && row.source === "auto-review"), { timeout: 5_000 })
      .toMatchObject({ decision: "auto-denied", rule: denyRule.id });

    // unsure: the card stays the person's
    reply({ decision: "none" });
    const unsure = await ask({ ticket: 99, project: "Autre" });
    await expect.poll(async () => Boolean(await card(unsure.id)), { timeout: 15_000 }).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(unsure.answer()).toBeUndefined();
    expect((await card(unsure.id)).answered).toBeUndefined();
    await api("POST", `/api/threads/${threadId}/respond`, { requestId: unsure.id, behavior: "deny" });
  } finally {
    for (const socket of sockets) socket.destroy();
    await fixture.close();
    rmSync(routes, { force: true });
  }
}, 120_000);
