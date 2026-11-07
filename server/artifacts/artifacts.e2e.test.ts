// Artifacts through a real server on an isolated fixture: a turn's own
// capability saves one on the internal route (as save_artifact does), the
// person's routes list it, star it, refuse any other change and delete it
// (docs/superpowers/specs/2026-10-16-artifacts-design.md).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { SIGN_IN_CHECK_TOOL } from "../mcp/mcp-probe.ts";
import { startFakeHttpMcp } from "../testing/fake-http-mcp-server.ts";

it("a bot saves an artifact in its turn; the person sees it, stars it and deletes it", async () => {
  const gates = mkdtempSync(join(tmpdir(), "omb-artifacts-"));
  const gate = join(gates, "finish");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate });
  const api = async (method: string, path: string, body?: unknown, expected = 200, token?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    expect(response.status, JSON.stringify(result)).toBe(expected);
    return result;
  };
  try {
    const bot = (await api("POST", "/api/bots", { name: "Scout" }, 201)).bot;
    await runControlOmb(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Keep a CPU widget", "--url", fixture.info.url]);
    let token = "";
    await expect.poll(() => {
      try { token = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; }
      catch { return false; }
      return Boolean(token);
    }, { timeout: 15_000 }).toBe(true);

    const tool = (name: string, args: Record<string, unknown>, expected = 200) => api("POST", "/api/internal/artifacts", { tool: name, args }, expected, token);
    expect(await tool("save_artifact", { title: "CPU", html: "" }, 400)).toMatchObject({ error: expect.stringContaining("html") });
    const saved = (await tool("save_artifact", { title: "CPU", html: "<p id=v></p>", source: { kind: "command", command: "cat cpu.json" }, interval_seconds: 60 }, 201)).artifact;
    expect(saved).toMatchObject({ title: "CPU", interval_seconds: 60, favorite: false, popped: false, refresh: { state: "idle" } });
    expect((await tool("list_artifacts", {})).artifacts.map((artifact: any) => artifact.id)).toEqual([saved.id]);

    // The person's side: a summary in the list, the document when opened.
    const listed = (await api("GET", `/api/bots/${bot.id}/artifacts`)).artifacts;
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("html");
    expect(listed[0]).toMatchObject({ id: saved.id, botId: bot.id, threadId: bot.threadId });
    expect((await api("GET", `/api/bots/${bot.id}/artifacts/${saved.id}`)).artifact.html).toBe("<p id=v></p>");
    expect((await api("PATCH", `/api/bots/${bot.id}/artifacts/${saved.id}`, { interval_seconds: 30 }, 400)).error).toContain("Ask the bot");
    expect((await api("PATCH", `/api/bots/${bot.id}/artifacts/${saved.id}`, { favorite: true })).artifact.favorite).toBe(true);
    expect((await api("GET", "/api/artifacts")).artifacts.map((artifact: any) => [artifact.id, artifact.favorite])).toEqual([[saved.id, true]]);

    // The bot sees the star the person set; the person deletes it.
    expect((await tool("list_artifacts", {})).artifacts[0].favorite).toBe(true);
    await api("DELETE", `/api/bots/${bot.id}/artifacts/${saved.id}`);
    expect((await api("GET", `/api/bots/${bot.id}/artifacts`)).artifacts).toEqual([]);
    expect(await tool("delete_artifact", { artifact_id: saved.id }, 404)).toMatchObject({ error: expect.any(String) });
    writeFileSync(gate, "finish");
  } finally {
    await fixture.close();
    await removeTempDir(gates);
  }
}, 120_000);

it("a fake engine's bot saves an artifact with a source; Sagax refreshes it with no turn, and blocks a source that needs approval", async () => {
  const gates = mkdtempSync(join(tmpdir(), "omb-artifacts-refresh-"));
  const gate = join(gates, "finish");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate });
  const stats = await startFakeHttpMcp({ tools: [{ name: "cpu", inputSchema: { type: "object" } }] });
  const api = async (method: string, path: string, body?: unknown, expected = 200, token?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    expect(response.status, JSON.stringify(result)).toBe(expected);
    return result;
  };
  try {
    // A remote MCP server the workspace uses, whose tools ask each time.
    await api("POST", "/api/mcp/servers", { name: "stats", type: "http", url: stats.url }, 201);
    await api("PATCH", "/api/mcp/servers/stats", { enabled: true });
    const bot = (await api("POST", "/api/bots", { name: "Gauge" }, 201)).bot;
    // The file the bot keeps up to date in its own workspace.
    const workspace = join(fixture.info.dataDir, "workspaces", bot.id);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "stats.json"), JSON.stringify({ open: 3 }));

    await runControlOmb(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Keep my open tickets on screen, every 30 seconds", "--url", fixture.info.url]);
    let token = "";
    await expect.poll(() => {
      try { token = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; }
      catch { return false; }
      return Boolean(token);
    }, { timeout: 15_000 }).toBe(true);
    const tool = (name: string, args: Record<string, unknown>, expected = 200) => api("POST", "/api/internal/artifacts", { tool: name, args }, expected, token);
    const html = "<b id=n></b><script>window.sagax.onData(function(d){n.textContent=d.open})</script>";
    const gauge = (await tool("save_artifact", { title: "Open tickets", html, source: { kind: "tool", tool: "mcp__agents__workspace_read", args: { path: "stats.json" } }, interval_seconds: 30 }, 201)).artifact;
    const asking = (await tool("save_artifact", { title: "CPU", html, source: { kind: "tool", tool: "mcp__stats__cpu", args: {} }, interval_seconds: 30 }, 201)).artifact;
    // The turn ends: from here on no model runs.
    writeFileSync(gate, "finish");
    const one = async (id: string) => (await api("GET", `/api/bots/${bot.id}/artifacts/${id}`)).artifact;

    // Nobody looks at them and neither is a favorite: nothing runs.
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    expect((await one(gauge.id)).refresh).toMatchObject({ state: "idle" });
    expect((await one(gauge.id)).data).toBeUndefined();

    // Opened (a watch lease): the refresher reads the file on its own.
    expect(await api("POST", "/api/artifacts/watch", { ids: [gauge.id, asking.id, "art_madeup0001"] })).toEqual({ ok: true, watching: 2 });
    await expect.poll(async () => (await one(gauge.id)).data?.value, { timeout: 15_000, interval: 500 }).toEqual({ open: 3 });
    expect((await one(gauge.id)).refresh).toMatchObject({ state: "ok", failures: 0 });
    // A tool that asks each time is never called alone: blocked, no failure.
    await expect.poll(async () => (await one(asking.id)).refresh.state, { timeout: 15_000, interval: 500 }).toBe("blocked");
    expect((await one(asking.id)).refresh).toMatchObject({ failures: 0, error: expect.stringContaining("approval") });
    // Adding the server probes it once for a sign-in (SIGN_IN_CHECK_TOOL, a
    // name no server defines); the tool itself is never called.
    expect(stats.calls.filter((call) => (call as { name?: string }).name !== SIGN_IN_CHECK_TOOL)).toEqual([]);

    // Refresh now picks up the new value at once, still with no turn.
    writeFileSync(join(workspace, "stats.json"), JSON.stringify({ open: 7 }));
    const refreshed = (await api("POST", `/api/bots/${bot.id}/artifacts/${gauge.id}/refresh`)).artifact;
    expect(refreshed.data.value).toEqual({ open: 7 });
    // A bad file counts a failure; the list shows the state without the data.
    rmSync(join(workspace, "stats.json"));
    expect((await api("POST", `/api/bots/${bot.id}/artifacts/${gauge.id}/refresh`)).artifact.refresh).toMatchObject({ state: "error", failures: 1 });
    const listed = (await api("GET", `/api/bots/${bot.id}/artifacts`)).artifacts.find((artifact: any) => artifact.id === gauge.id);
    expect(listed).not.toHaveProperty("data");
    expect(listed.dataAt).toEqual(expect.any(Number));
    // No turn ran for any of it: the bot's conversation has the one prompt.
    const messages = (await api("GET", `/api/threads/${bot.threadId}/messages`)).messages;
    expect(messages.filter((message: any) => message.role === "user")).toHaveLength(1);
  } finally {
    await fixture.close();
    await stats.close();
    await removeTempDir(gates);
  }
}, 120_000);
