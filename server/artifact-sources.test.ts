import { describe, expect, it, vi } from "vitest";

import { commandValue, createArtifactSourceRunner, perspicaxReadTool, SOURCE_BLOCKED, toolResultValue, type ArtifactSourceDeps } from "./artifact-sources.ts";
import type { Artifact, ArtifactSource } from "../shared/artifacts.ts";

const artifact = (source: ArtifactSource): Artifact => ({
  id: "art_test0001", botId: "bot-a", threadId: "t1", title: "T", html: "<p>", source, intervalSeconds: 60,
  favorite: true, popped: false, createdAt: 1, updatedAt: 1, rev: 1, refresh: { state: "idle", failures: 0 },
});

function deps(over: Partial<ArtifactSourceDeps> = {}) {
  const calls: string[] = [];
  const base: ArtifactSourceDeps = {
    bot: () => ({ id: "bot-a", computer: "vm", perspicaxProfiles: ["p1"] }),
    threadFor: (a) => a.threadId ?? "main",
    fullAccess: () => false,
    alwaysAllowed: () => false,
    mcpServer: async (_bot, _thread, server) => server === "stats" ? { type: "http", url: "http://127.0.0.1:1/mcp", headers: {} } : undefined,
    toolDisabled: () => false,
    workspaceRead: (_bot, path) => { if (path === "missing.json") throw new Error("no such file: missing.json"); calls.push(`read ${path}`); return "{\"open\":4}"; },
    callRemote: async (_spec, tool, args) => { calls.push(`remote ${tool} ${JSON.stringify(args)}`); return { isError: false, value: { cpu: 12 } }; },
    perspicax: { call: async ({ tool, args }) => { calls.push(`perspicax ${tool} ${JSON.stringify(args)}`); return { isError: false, value: [{ id: 1 }] }; } },
    vm: {
      state: async () => "running",
      exec: async (_bot, command) => { calls.push(`exec ${command}`); return { exitCode: 0, stdout: "{\"up\":true}\n", stderr: "" }; },
    },
    ...over,
  };
  return { run: createArtifactSourceRunner(base), calls };
}

const signal = new AbortController().signal;

describe("artifact sources: what runs with nobody there", () => {
  it("reads a file of the bot's own workspace, bare or behind the agents server", async () => {
    const { run, calls } = deps();
    expect(await run(artifact({ kind: "tool", tool: "workspace_read", args: { path: "stats.json" } }), signal)).toEqual({ ok: true, value: { open: 4 } });
    expect(await run(artifact({ kind: "tool", tool: "mcp__agents__workspace_read", args: { path: "stats.json" } }), signal)).toMatchObject({ ok: true });
    expect(await run(artifact({ kind: "tool", tool: "workspace_read", args: {} }), signal)).toMatchObject({ ok: false, error: expect.stringContaining("args.path") });
    expect(await run(artifact({ kind: "tool", tool: "workspace_read", args: { path: "missing.json" } }), signal)).toEqual({ ok: false, error: "no such file: missing.json" });
    expect(await run(artifact({ kind: "tool", tool: "mcp__other__workspace_read", args: { path: "stats.json" } }), signal)).toMatchObject({ blocked: true });
    expect(calls).toEqual(["read stats.json", "read stats.json"]);
  });


  it("runs a Perspicax read tool, bare or behind its bridge, in the owner's name", async () => {
    const { run, calls } = deps();
    expect(await run(artifact({ kind: "tool", tool: "cw_psa_query", args: { resource: "tickets" } }), signal)).toEqual({ ok: true, value: [{ id: 1 }] });
    expect(await run(artifact({ kind: "tool", tool: "mcp__perspicax-cw__cw_psa_query", args: {} }), signal)).toMatchObject({ ok: true });
    expect(calls).toEqual(['perspicax cw_psa_query {"resource":"tickets"}', "perspicax cw_psa_query {}"]);
  });

  it("never runs a Perspicax write alone", async () => {
    const { run, calls } = deps();
    expect(await run(artifact({ kind: "tool", tool: "cw_psa_write", args: {} }), signal)).toEqual({ ok: false, blocked: true, error: SOURCE_BLOCKED.unknown });
    expect(await run(artifact({ kind: "tool", tool: "mcp__perspicax-cw__cw_psa_action", args: {} }), signal)).toMatchObject({ ok: false, blocked: true });
    expect(calls).toEqual([]);
  });

  it("runs a remote MCP tool only once the person allowed it for good, and never one turned off", async () => {
    const source: ArtifactSource = { kind: "tool", tool: "mcp__stats__cpu", args: { host: "a" } };
    expect(await deps().run(artifact(source), signal)).toEqual({ ok: false, blocked: true, error: SOURCE_BLOCKED.tool });
    const keys: string[] = [];
    const allowed = deps({ alwaysAllowed: (_bot, thread, key) => { keys.push(`${thread} ${key}`); return true; } });
    expect(await allowed.run(artifact(source), signal)).toEqual({ ok: true, value: { cpu: 12 } });
    expect(keys).toEqual(["t1 mcp:stats__cpu"]);
    expect(allowed.calls).toEqual(['remote cpu {"host":"a"}']);
    const off = deps({ alwaysAllowed: () => true, toolDisabled: (server, tool) => server === "stats" && tool === "cpu" });
    expect(await off.run(artifact(source), signal)).toEqual({ ok: false, blocked: true, error: SOURCE_BLOCKED.disabled });
    expect(await deps({ alwaysAllowed: () => true }).run(artifact({ kind: "tool", tool: "mcp__unknown__cpu", args: {} }), signal)).toMatchObject({ blocked: true, error: SOURCE_BLOCKED.unknown });
  });

  it("hands back a tool's error as a failure, with its words", async () => {
    const { run } = deps({ alwaysAllowed: () => true, callRemote: async () => ({ isError: true, value: "rate limited" }) });
    expect(await run(artifact({ kind: "tool", tool: "stats__cpu", args: {} }), signal)).toEqual({ ok: false, error: "rate limited" });
  });

  it("runs a command only on the bot's own Local VM in Full access (or Auto, below), and waits for a stopped one", async () => {
    const source: ArtifactSource = { kind: "command", command: "cat /home/cua/workspace/stats.json" };
    expect(await deps().run(artifact(source), signal)).toEqual({ ok: false, blocked: true, error: SOURCE_BLOCKED.command });
    expect(await deps({ fullAccess: () => true, bot: () => ({ id: "bot-a", computer: "local" }) }).run(artifact(source), signal)).toMatchObject({ blocked: true });
    const full = deps({ fullAccess: () => true });
    expect(await full.run(artifact(source), signal)).toEqual({ ok: true, value: { up: true } });
    expect(full.calls).toEqual(["exec cat /home/cua/workspace/stats.json"]);
    const stopped = deps({ fullAccess: () => true, vm: { state: async () => "stopped", exec: vi.fn() } });
    expect(await stopped.run(artifact(source), signal)).toMatchObject({ ok: false, waiting: true });
    const failing = deps({ fullAccess: () => true, vm: { state: async () => "running", exec: async () => ({ exitCode: 2, stdout: "", stderr: "no such file\nmore" }) } });
    expect(await failing.run(artifact(source), signal)).toEqual({ ok: false, error: "The command exited with 2: no such file" });
  });

  it("runs the owner's command on their own bot's Local VM in Approve for me too (2026-10-26)", async () => {
    const source: ArtifactSource = { kind: "command", command: "cat stats.json" };
    const alice = "pr_alice";
    const own = deps({ approvalLevel: () => "auto", bot: () => ({ id: "bot-a", computer: "vm", ownerPrincipalId: alice }) });
    expect(await own.run({ ...artifact(source), ownerPrincipalId: alice }, signal)).toEqual({ ok: true, value: { up: true } });
    // an artifact with no owner of its own is the bot owner's
    expect(await own.run(artifact(source), signal)).toEqual({ ok: true, value: { up: true } });
    expect(own.calls).toEqual(["exec cat stats.json", "exec cat stats.json"]);
  });

  it("still blocks a command at Approve for me for another person's bot, an unknown owner, Ask, or off the Local VM", async () => {
    const source: ArtifactSource = { kind: "command", command: "cat stats.json" };
    const blocked = { ok: false, blocked: true, error: SOURCE_BLOCKED.command };
    const bob = deps({ approvalLevel: () => "auto", bot: () => ({ id: "bot-b", computer: "vm", ownerPrincipalId: "pr_bob" }) });
    expect(await bob.run({ ...artifact(source), ownerPrincipalId: "pr_alice" }, signal)).toEqual(blocked);
    expect(await deps({ approvalLevel: () => "auto" }).run({ ...artifact(source), ownerPrincipalId: "pr_alice" }, signal)).toEqual(blocked);
    expect(await deps({ approvalLevel: () => "ask", bot: () => ({ id: "bot-a", computer: "vm", ownerPrincipalId: "pr_alice" }) }).run(artifact(source), signal)).toEqual(blocked);
    expect(await deps({ approvalLevel: () => "auto", bot: () => ({ id: "bot-a", computer: "cloud", ownerPrincipalId: "pr_alice" }) }).run(artifact(source), signal)).toEqual(blocked);
    expect(bob.calls).toEqual([]);
  });

  it("blocks a source whose bot is gone", async () => {
    expect(await deps({ bot: () => null }).run(artifact({ kind: "command", command: "x" }), signal)).toEqual({ ok: false, blocked: true, error: SOURCE_BLOCKED.gone });
  });
});

describe("reading what a source answered", () => {
  it("reads JSON when it is JSON, else text", () => {
    expect(commandValue(" [1,2] ")).toEqual([1, 2]);
    expect(commandValue("load 0.4")).toBe("load 0.4");
    expect(commandValue("")).toBeNull();
  });

  it("prefers structured content, then the first text block", () => {
    expect(toolResultValue({ structuredContent: { a: 1 }, content: [{ type: "text", text: "x" }] })).toEqual({ isError: false, value: { a: 1 } });
    expect(toolResultValue({ content: [{ type: "image" }, { type: "text", text: "{\"b\":2}" }] })).toEqual({ isError: false, value: { b: 2 } });
    expect(toolResultValue({ isError: true, content: [{ type: "text", text: "nope" }] })).toEqual({ isError: true, value: "nope" });
  });

  it("knows the Perspicax reads by their exact name", () => {
    expect(perspicaxReadTool("memory_recall")).toBe("memory_recall");
    expect(perspicaxReadTool("mcp__px__api_search")).toBe("api_search");
    expect(perspicaxReadTool("mcp__px__cw_psa_write")).toBeNull();
    expect(perspicaxReadTool("my_cw_psa_query")).toBeNull();
  });
});
