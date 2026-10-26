// sagax_help through the real mounted agents MCP of a disposable fixture:
// the tool is in the catalog, a call reaches /api/internal/self-knowledge
// with the turn's capability, and the answer names the solo server.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

it("answers sagax_help from the generated base in a real turn", async () => {
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "hang" });
  const proxies: ChildProcess[] = [];
  const cli = async (...args: string[]) => await runControlOmb(args, { env: { SAGAX_URL: fixture.info.url } }) as any;
  try {
    expect((await cli("doctor")).ok).toBe(true);
    const bot = (await cli("new-bot", "--name", "Helper")).bot;
    const dumpFile = join(fixture.info.dataDir, "fake-claude-dump.json");
    rmSync(dumpFile, { force: true });
    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Hold this verification turn open.");
    await expect.poll(() => existsSync(dumpFile), { timeout: 15_000 }).toBe(true);
    const mounted = JSON.parse(readFileSync(dumpFile, "utf8")).mcpConfig.mcpServers.agents;
    const proxy = spawn(mounted.command, mounted.args, { cwd: process.cwd(),
      env: { ...mounted.env, PATH: process.env.PATH, HOME: fixture.info.dataDir }, stdio: ["pipe", "pipe", "pipe"] });
    proxies.push(proxy);
    proxy.stderr!.resume();
    let sequence = 0;
    const pending = new Map<number, (value: any) => void>();
    createInterface({ input: proxy.stdout! }).on("line", (line) => {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
    const rpc = (method: string, params?: unknown): Promise<any> => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture MCP ${method} timed out`)); }, 10_000);
      pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
      proxy.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    await rpc("initialize", { protocolVersion: "2024-11-05" });
    const listed = (await rpc("tools/list")).result.tools as Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>;
    expect(listed.find((tool) => tool.name === "sagax_help")?.annotations?.readOnlyHint).toBe(true);
    const answer = (await rpc("tools/call", { name: "sagax_help", arguments: { question: "Où sont mes routines ?" } })).result;
    expect(answer.isError).toBeFalsy();
    const text = answer.content[0].text as string;
    expect(text).toContain("a person's own Sagax (solo, no organization)");
    expect(text).toContain("Automations");
    expect(text.length).toBeLessThan(4000);
    // Without the turn's capability the route answers nothing.
    const refused = await fetch(`${fixture.info.url}/api/internal/self-knowledge`, { method: "POST",
      headers: { origin: fixture.info.url, "content-type": "application/json" }, body: JSON.stringify({ question: "x" }), signal: AbortSignal.timeout(10_000) });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(await refused.text()).not.toContain("knowledge");
  } finally {
    try { await Promise.all(proxies.map((proxy) => waitForExit(proxy, { signal: "SIGTERM" }))); } finally { await fixture.close(); }
  }
}, 90_000);
