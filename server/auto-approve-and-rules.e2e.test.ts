// Approve for me (level "auto") + Approbation automatique (owner mode "auto")
// + the person's custom rules, against a real isolated server and the native
// permission broker (no model, no real command). The contract, end to end:
//
//   - an ordinary action and a read run with no card (the mode's promise);
//   - a custom allow rule for a type (an email send) suppresses that card;
//   - a delete, a bulk change and an external message with NO covering rule
//     still raise a card (owner mode "auto" asks for the destructive kinds),
//     a native shell `rm -rf` included (before the fix it slipped through as
//     a plain "execute" and ran unasked);
//   - a send the rule does not cover (an SMS, when the rule is for email)
//     still raises its card.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";

import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";

it("auto level + auto mode auto-approves ordinary and read-only work and a rule-covered send, but still cards deletes, bulk changes, a shell rm and an uncovered send", async () => {
  const owner = randomBytes(32).toString("base64url");
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang", SAGAX_TEST_DESKTOP_OWNER_TOKEN: owner, SAGAX_MCP_OAUTH_KEY: randomBytes(32).toString("hex") });
  const { url, dataDir } = fixture.info;
  const sockets: Socket[] = [];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(url + path, {
      method,
      headers: { origin: url, "content-type": "application/json", "x-openmausbot-desktop-owner": owner },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    expect(response.status, `${method} ${path}: ${text}`).toBe(status);
    return parsed;
  };
  const dump = join(dataDir, "fake-claude-dump.json");
  const turn = async (botId: string, threadId: string, text: string): Promise<string> => {
    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${botId}/messages`, { threadId, text }, 202);
    let socket = "";
    await expect.poll(() => {
      if (!existsSync(dump)) return false;
      try { socket = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.ogb.args.at(-1); } catch { return false; }
      return Boolean(socket);
    }, { timeout: 20_000 }).toBe(true);
    return socket;
  };
  const ask = (socketPath: string, payload: Record<string, unknown>) => {
    const socket = connect(socketPath);
    sockets.push(socket);
    const id = randomUUID();
    let buffer = "";
    let answer: any;
    socket.on("connect", () => socket.write(JSON.stringify({ t: "ask", id, ...payload }) + "\n"));
    socket.on("data", (chunk) => { buffer += chunk; if (buffer.includes("\n") && !answer) answer = JSON.parse(buffer.split("\n")[0]!); });
    return { id, answer: () => answer };
  };
  const autoApproved = async (a: { answer: () => any }) =>
    expect.poll(() => a.answer()?.behavior, { timeout: 10_000 }).toBe("allow");
  const carded = async (threadId: string, a: { id: string; answer: () => any }) => {
    await expect.poll(async () =>
      (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages.some((m: any) => m.card?.requestId === a.id),
    { timeout: 10_000 }).toBe(true);
    expect(a.answer(), "a carded request is not answered for the person").toBeUndefined();
  };
  try {
    const bot = (await api("POST", "/api/bots", { name: "Zachary", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }, 201)).bot;
    // level = Approve for me (auto), owner mode = Approbation automatique (auto)
    await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "auto" });
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "auto" });
    await api("PUT", `/api/bots/${bot.id}/permission-mode`, { mode: "auto" });
    // a custom rule authorizing one type: email sends (external-send)
    await api("POST", "/api/custom-rules", { when: "l'envoi de courriels", behavior: "allow", botId: null, riskScope: ["external-send"] }, 201);

    const sock = await turn(bot.id, bot.threadId, "go");

    // auto-approved: an ordinary command, a read, and the rule-covered send
    await autoApproved(ask(sock, { tool: "Bash", input: { command: "printf hello" } }));
    await autoApproved(ask(sock, { tool: "Bash", input: { command: "ls -la /tmp" } }));
    await autoApproved(ask(sock, { tool: "mcp__gmail__send_email", mcpTool: "gmail__send_email", input: { to: "a@b.com", subject: "x", body: "y" } }));

    // still a card, no covering rule: a shell delete, an MCP delete, a bulk
    // change, and a send of a kind the rule does not cover (SMS)
    await carded(bot.threadId, ask(sock, { tool: "Bash", input: { command: "rm -rf /tmp/zzz" } }));
    await carded(bot.threadId, ask(sock, { tool: "mcp__cw_psa__delete_ticket", mcpTool: "cw_psa__delete_ticket", input: { id: 42 } }));
    await carded(bot.threadId, ask(sock, { tool: "mcp__cw_psa__bulk_close", mcpTool: "cw_psa__bulk_close", input: { ids: [1, 2, 3] } }));
    await carded(bot.threadId, ask(sock, { tool: "mcp__twilio__send_sms", mcpTool: "twilio__send_sms", input: { to: "+15551234567", body: "hi" } }));

    await api("POST", `/api/bots/${bot.id}/interrupt`, { threadId: bot.threadId });
  } finally {
    for (const s of sockets) s.destroy();
    await fixture.close();
  }
}, 90_000);
