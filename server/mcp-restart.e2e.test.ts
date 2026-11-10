// A bot reloads a command server it changed, on a real server with a warm engine process: the saved key stays, and the
// next turn gets a new process. Turning the server off and on in Settings does the same. Nothing here reaches the user's
// data or the person's live ports.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

const FAKE_MCP = fileURLToPath(new URL("./testing/fake-mcp-server.ts", import.meta.url));

it.skipIf(process.platform === "win32")("restart keeps the key and replaces the warm process, and so does turning the server off and on", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "sagax-mcp-restart-"));
  const gate = join(scratch, "finish");
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate });
  const api = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const dump = () => JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
  /** The key the server itself starts with, behind the tool gate when the turn mounts it through one. */
  const mailKey = (started: any): string | undefined => {
    const mounted = started.mcpConfig.mcpServers.mail;
    return (mounted.env.SAGAX_GATE_UPSTREAM ? JSON.parse(mounted.env.SAGAX_GATE_UPSTREAM) : mounted).env.MAIL_KEY;
  };
  let sends = 0;
  let bot: { id: string; threadId: string };
  /** A turn that stays running until `done`, so its bot's tools answer; the dump is what its engine was started with. */
  const turn = async () => {
    sends += 1;
    const text = `Use your tools, take ${sends}`;
    rmSync(gate, { force: true });
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text, sendId: `restart-e2e-send-${String(sends).padStart(4, "0")}` });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    await expect.poll(() => { try { return JSON.stringify(dump().prompt).includes(text); } catch { return false; } }, { timeout: 30_000 }).toBe(true);
    const started = dump();
    const internal = (body: unknown) => api("POST", "/api/internal/mcp-servers", body, started.mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN);
    const done = async () => {
      writeFileSync(gate, "");
      await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).body.bots.find((one: any) => one.id === bot.id).busy, { timeout: 20_000 }).toBe(false);
    };
    return { started, internal, done };
  };
  try {
    bot = (await api("POST", "/api/bots", { name: "Iris" })).body.bot;
    const added = await api("POST", "/api/mcp/servers", {
      name: "mail", command: process.execPath, args: ["--experimental-strip-types", "--no-warnings", FAKE_MCP], env: { MAIL_KEY: "kept-key-value" },
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect((await api("PATCH", "/api/mcp/servers/mail", { enabled: true })).status, "Settings saves a new server off").toBe(200);
    /** What Settings lists for the server: its saved key names, never their values. */
    const saved = async () => ((await api("GET", "/api/mcp/servers")).body.servers as any[]).find((one) => one.name === "mail");
    const savedBefore = await saved();
    expect(savedBefore).toBeDefined();

    const launched = await turn();
    await launched.done();
    expect(mailKey(launched.started)).toBe("kept-key-value");
    const warm = await turn();
    expect(warm.started.pid, "with nothing changed the warm process takes the next turn").toBe(launched.started.pid);
    const restarted = await warm.internal({ action: "restart", name: "mail" });
    expect(restarted.status, JSON.stringify(restarted.body)).toBe(200);
    expect(restarted.body.text).toContain("Restarted MCP server mail. Its saved keys stay.");
    expect(restarted.body.text).toContain("Test: it started and listed its tools: read_notes. That does not show what they return: call one to check.");
    expect(restarted.body.text).toContain("your next turn starts the new code.");
    expect(await saved(), "a restart writes nothing: the saved key stays as it is").toEqual(savedBefore);
    await warm.done();

    const fresh = await turn();
    expect(fresh.started.pid, "a restart starts a new process").not.toBe(warm.started.pid);
    expect(mailKey(fresh.started)).toBe("kept-key-value");
    await fresh.done();
    const steady = await turn();
    expect(steady.started.pid, "once restarted, the warm process takes turns again").toBe(fresh.started.pid);
    expect((await api("PATCH", "/api/mcp/servers/mail", { enabled: false })).status).toBe(200);
    expect((await api("PATCH", "/api/mcp/servers/mail", { enabled: true })).status).toBe(200);
    await steady.done();

    const cycled = await turn();
    await cycled.done();
    expect(cycled.started.pid, "off and on between two turns starts a new process too").not.toBe(steady.started.pid);
    expect(mailKey(cycled.started)).toBe("kept-key-value");
    expect(await saved()).toEqual(savedBefore);
  } finally {
    writeFileSync(gate, "");
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, hostTimeout(120_000));
