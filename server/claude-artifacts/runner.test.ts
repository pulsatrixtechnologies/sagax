import { EventEmitter } from "node:events";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";
import {
  claudeArtifactArgs,
  claudeArtifactEnv,
  claudeArtifactPrompt,
  parseClaudeArtifactStream,
  runClaudeArtifact,
  type ClaudeArtifactSpawn,
} from "./runner.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) void removeTempDir(dir); });
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "claude-artifact-runner-"));
  dirs.push(dir);
  return dir;
}

const line = (frame: unknown) => `${JSON.stringify(frame)}\n`;
function transcript(tool: string, result: { text: string; structured?: unknown; isError?: boolean }): string {
  return [
    line({ type: "system", subtype: "init" }),
    line({ type: "assistant", message: { content: [{ type: "tool_use", id: "ts1", name: "ToolSearch", input: {} }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "ts1", content: "loaded" }] } }),
    line({ type: "assistant", message: { content: [{ type: "tool_use", id: "c1", name: tool, input: {} }] } }),
    line({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "c1", content: [{ type: "text", text: result.text }], ...(result.isError ? { is_error: true } : {}) }] },
      ...(result.structured !== undefined ? { tool_use_result: result.structured } : {}),
    }),
    line({ type: "result", result: "done" }),
  ].join("");
}

type Fake = ReturnType<typeof fakeChild>;
function fakeChild(stdout: string | null, code = 0) {
  const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; killed?: boolean; prompt?: string };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let prompt = "";
  child.stdin.on("data", (chunk) => { prompt += String(chunk); });
  child.stdin.on("finish", () => {
    child.prompt = prompt;
    if (stdout === null) return; // hangs
    child.stdout.end(stdout);
    setImmediate(() => child.emit("close", code));
  });
  return child;
}

describe("claudeArtifactArgs", () => {
  it("names the artifact tools, scopes Read to the staging folder and isolates the CLI", () => {
    const args = claudeArtifactArgs("/tmp/stage-1");
    expect(args.slice(0, 3)).toEqual(["-p", "--model", "haiku"]);
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args[args.indexOf("--tools") + 1]).toBe("Artifact,ArtifactData,ArtifactComments,ToolSearch,Read");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Artifact,ArtifactData,ArtifactComments,ToolSearch,Read(//tmp/stage-1/**)");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args).toContain("--strict-mcp-config");
    expect(args.filter((arg) => arg === "--tools")).toHaveLength(1);
    expect(args.filter((arg) => arg === "--system-prompt")).toHaveLength(1);
  });

  it("turns the artifact toolset on and claude.ai connectors off", () => {
    expect(claudeArtifactEnv({ KEEP: "1" })).toMatchObject({
      KEEP: "1", CLAUDE_CODE_ARTIFACT: "1", CLAUDE_CODE_ARTIFACT_TOOLSET: "1", ENABLE_TOOL_SEARCH: "true", ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    });
    expect(claudeArtifactPrompt("Artifact", { action: "list" })).toContain('{"action":"list"}');
  });
});

describe("parseClaudeArtifactStream", () => {
  it("returns the structured result of the named tool's call", () => {
    const parsed = parseClaudeArtifactStream(transcript("Artifact", { text: "ok", structured: { artifacts: [], total: 0 } }), "Artifact");
    expect(parsed).toEqual({ ok: true, result: { artifacts: [], total: 0 }, text: "ok" });
  });

  it("falls back to the text when there is no structured result", () => {
    expect(parseClaudeArtifactStream(transcript("ArtifactComments", { text: "No comment threads" }), "ArtifactComments"))
      .toEqual({ ok: true, result: "No comment threads", text: "No comment threads" });
  });

  it("turns a consent refusal into blocked other_account with the engine account", () => {
    const parsed = parseClaudeArtifactStream(transcript("Artifact", { text: "Couldn't check who made this artifact. Let Claude read it?", isError: true }), "Artifact", "person@example.com");
    expect(parsed).toEqual({ ok: false, blocked: "other_account", account: "person@example.com" });
  });

  it("treats a dontAsk denial of an artifact tool as another account's artifact", () => {
    const text = "Permission to use ArtifactData has been denied because Claude Code is running in don't ask mode. IMPORTANT: ...";
    expect(parseClaudeArtifactStream(transcript("ArtifactData", { text, isError: true }), "ArtifactData", "person@example.com"))
      .toEqual({ ok: false, blocked: "other_account", account: "person@example.com" });
  });

  it("reads before an update publish and keeps the publish call's result", () => {
    const url = "https://claude.ai/artifact/abc";
    const prompt = claudeArtifactPrompt("Artifact", { action: "publish", url, file_path: "/s/page.html" });
    expect(prompt.indexOf(`{"action":"read","url":"${url}"}`)).toBeLessThan(prompt.indexOf('"action":"publish"'));
    expect(claudeArtifactPrompt("Artifact", { action: "publish", file_path: "/s/page.html" })).not.toContain('"action":"read"');
    const frames = [
      line({ type: "assistant", message: { content: [{ type: "tool_use", id: "r1", name: "Artifact", input: { action: "read", url } }] } }),
      line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "r1", content: "page html" }] } }),
      line({ type: "assistant", message: { content: [{ type: "tool_use", id: "p1", name: "Artifact", input: { action: "publish", url } }] } }),
      line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "p1", content: "published" }] }, tool_use_result: { url, updated: true } }),
    ].join("");
    expect(parseClaudeArtifactStream(frames, "Artifact", undefined, "publish")).toEqual({ ok: true, result: { url, updated: true }, text: "published" });
  });

  it("reports a tool error and a missing call", () => {
    expect(parseClaudeArtifactStream(transcript("Artifact", { text: "not found", isError: true }), "Artifact")).toEqual({ ok: false, error: "not found" });
    expect(parseClaudeArtifactStream(line({ type: "result", result: "I cannot do that" }), "Artifact")).toEqual({ ok: false, error: "Artifact was not called: I cannot do that" });
  });
});

describe("runClaudeArtifact", () => {
  it("stages the page, sends the prompt on stdin and removes the staging folder", async () => {
    let seen: { args: string[]; cwd: string; env: NodeJS.ProcessEnv; staged?: string } | undefined;
    let child: Fake | undefined;
    const spawn: ClaudeArtifactSpawn = (_cli, args, opts) => {
      child = fakeChild(transcript("Artifact", { text: "published", structured: { url: "https://claude.ai/artifact/abcdefgh12" } }));
      seen = { args, cwd: opts.cwd, env: opts.env };
      child.stdin.on("finish", () => { seen!.staged = readFileSync(join(opts.cwd, "page.html"), "utf8"); });
      return child as never;
    };
    const result = await runClaudeArtifact({
      account: { cli: "claude", env: { CLAUDE_CONFIG_DIR: root() } },
      tool: "Artifact", input: { action: "publish" }, html: "<p>hi</p>", spawn, stagingRoot: root(),
    });
    expect(result).toMatchObject({ ok: true, result: { url: "https://claude.ai/artifact/abcdefgh12" } });
    expect(seen?.staged).toBe("<p>hi</p>");
    expect(child?.prompt).toContain(`"file_path":"${join(seen!.cwd, "page.html")}"`);
    expect(seen?.env.CLAUDE_CODE_ARTIFACT).toBe("1");
    expect(existsSync(seen!.cwd)).toBe(false);
  });

  it("kills a child that runs past the timeout", async () => {
    let killed = 0;
    const result = await runClaudeArtifact({
      account: { cli: "claude", env: { CLAUDE_CONFIG_DIR: root() } },
      tool: "ArtifactComments", input: { action: "read", url: "https://claude.ai/artifact/abcdefgh12" },
      spawn: () => fakeChild(null) as never,
      kill: () => { killed += 1; },
      timeoutMs: 20,
      stagingRoot: root(),
    });
    expect(killed).toBe(1);
    expect(result).toEqual({ ok: false, error: "ArtifactComments timed out" });
  });

  it("never throws when the spawn fails", async () => {
    const result = await runClaudeArtifact({
      account: { cli: "claude", env: { CLAUDE_CONFIG_DIR: root() } },
      tool: "Artifact", input: { action: "list" },
      spawn: () => { throw new Error("ENOENT"); },
      stagingRoot: root(),
    });
    expect(result).toEqual({ ok: false, error: "ENOENT" });
  });
});
