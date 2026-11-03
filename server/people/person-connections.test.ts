import { createCipheriv } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parsePersonalMcpInput, personalAuthHeaders, personalMcpInputFromAgent, PersonConnections, PersonConnectionsError, principalDir } from "./person-connections.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const key = { kind: "key" as const, key: Buffer.alloc(32, 7) };

function store() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-person-"));
  dirs.push(dir);
  return { dir, connections: new PersonConnections(dir, () => key) };
}

function legacyFile(dir: string, principalId: string, document: unknown): string {
  const iv = Buffer.alloc(12, 5);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(Buffer.from("sagax person-connections v1"));
  const data = Buffer.concat([cipher.update(JSON.stringify(document), "utf8"), cipher.final()]);
  const folder = principalDir(dir, principalId);
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "connections.enc");
  writeFileSync(file, JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }));
  return file;
}

describe("parsePersonalMcpInput", () => {
  it("takes a remote server with a token, OAuth or the GitHub connection", () => {
    expect(parsePersonalMcpInput({ name: "github", url: "https://api.githubcopilot.com/mcp/", auth: "github" }, 1).server)
      .toEqual({ kind: "remote", type: "http", url: "https://api.githubcopilot.com/mcp/", auth: "github", enabled: true, addedAt: 1 });
    expect(parsePersonalMcpInput({ name: "docs", url: "https://docs.example.com/mcp", token: "abc" }, 1).server).toMatchObject({ auth: "token", token: "abc" });
    expect(parsePersonalMcpInput({ name: "notion", url: "https://mcp.notion.com/mcp", auth: "oauth" }, 1).server).toMatchObject({ auth: "oauth" });
  });
  it("takes a command that runs in the person's server environment", () => {
    expect(parsePersonalMcpInput({ name: "gh-local", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "x" } }, 1).server)
      .toEqual({ kind: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "x" }, runsIn: "environment", enabled: true, addedAt: 1 });
  });
  it("refuses http, credentials in the URL, reserved names and Sagax variables", () => {
    for (const bad of [
      { name: "a", url: "http://example.com/mcp" },
      { name: "a", url: "https://u:p@example.com/mcp" },
      { name: "agents", url: "https://example.com/mcp" },
      { name: "a", url: "https://example.com/mcp", auth: "token" },
      { name: "a", command: "npx", env: { SAGAX_SANDBOX_TOKEN: "x" } },
      { name: "A", url: "https://example.com/mcp" },
    ]) expect(() => parsePersonalMcpInput(bad), JSON.stringify(bad)).toThrow(PersonConnectionsError);
  });
});

describe("personalAuthHeaders", () => {
  it("sends a token as Bearer, the GitHub connection's token, or nothing", () => {
    const base = { kind: "remote" as const, type: "http" as const, url: "https://x.example/mcp", enabled: true, addedAt: 1 };
    expect(personalAuthHeaders({ ...base, auth: "token", token: "t1" }, undefined)).toEqual({ Authorization: "Bearer t1" });
    expect(personalAuthHeaders({ ...base, auth: "token", token: "Basic abc" }, undefined)).toEqual({ Authorization: "Basic abc" });
    expect(personalAuthHeaders({ ...base, auth: "token", token: "k", headerName: "X-API-Key" }, undefined)).toEqual({ "X-API-Key": "k" });
    expect(personalAuthHeaders({ ...base, auth: "github" }, { token: "gho_1", login: "owner", via: "device", connectedAt: 1 })).toEqual({ Authorization: "Bearer gho_1" });
    expect(personalAuthHeaders({ ...base, auth: "github" }, undefined)).toBeNull();
    expect(personalAuthHeaders({ ...base, auth: "none" }, undefined)).toEqual({});
  });
});

describe("PersonConnections", () => {
  it("keeps each person's servers and GitHub apart, encrypted, and lists no secret", () => {
    const { dir, connections } = store();
    connections.add("pr_a", "docs", parsePersonalMcpInput({ name: "docs", url: "https://docs.example.com/mcp", token: "secret-token-a" }).server);
    connections.setGithub("pr_a", { token: "gho_secret_a", login: "alice", via: "device", connectedAt: 1 });
    expect(connections.list("pr_b")).toEqual([]);
    expect(connections.github("pr_b")).toBeUndefined();
    const listed = connections.list("pr_a");
    expect(listed).toEqual([expect.objectContaining({ name: "docs", tokenConfigured: true, domain: "docs.example.com" })]);
    expect(JSON.stringify(listed)).not.toContain("secret-token-a");
    const onDisk = readFileSync(join(principalDir(dir, "pr_a"), "capabilities.enc"), "utf8");
    expect(onDisk).not.toContain("secret-token-a");
    expect(onDisk).not.toContain("gho_secret_a");
    // a second process with the same key reads it back
    const again = new PersonConnections(dir, () => key);
    expect(again.github("pr_a")?.login).toBe("alice");
    expect(again.servers("pr_a").docs).toMatchObject({ token: "secret-token-a" });
  });

  it("refuses a duplicate name, toggles and removes", () => {
    const { connections } = store();
    const server = parsePersonalMcpInput({ name: "docs", url: "https://docs.example.com/mcp" }).server;
    connections.add("pr_a", "docs", server);
    expect(() => connections.add("pr_a", "docs", server)).toThrow(PersonConnectionsError);
    connections.setEnabled("pr_a", "docs", false);
    expect(connections.list("pr_a")[0]).toMatchObject({ enabled: false });
    expect(connections.remove("pr_a", "docs")).toBe(true);
    expect(connections.remove("pr_a", "docs")).toBe(false);
  });

  it("never overwrites a file it cannot decrypt", () => {
    const { dir, connections } = store();
    connections.setGithub("pr_a", { token: "gho_1", login: "alice", via: "token", connectedAt: 1 });
    const wrong = new PersonConnections(dir, () => ({ kind: "key", key: Buffer.alloc(32, 9) }));
    expect(() => wrong.github("pr_a")).toThrow(PersonConnectionsError);
    expect(() => wrong.setGithub("pr_a", undefined)).toThrow(PersonConnectionsError);
    expect(new PersonConnections(dir, () => key).github("pr_a")?.login).toBe("alice");
  });

  it("migrates legacy connections once, preserving the original and removals across restarts", () => {
    const { dir, connections } = store();
    const old = legacyFile(dir, "pr_a", { version: 1, mcpServers: { docs: parsePersonalMcpInput({ name: "docs", url: "https://docs.example.com/mcp", token: "legacy-fixture" }).server }, github: { token: "github-fixture", login: "alice", via: "token", connectedAt: 1 } });
    const original = readFileSync(old, "utf8");
    expect(connections.list("pr_a")).toHaveLength(1);
    const migrated = join(principalDir(dir, "pr_a"), "capabilities.enc");
    expect(existsSync(migrated)).toBe(true);
    expect(statSync(migrated).mode & 0o777).toBe(0o600);
    expect(readFileSync(old, "utf8")).toBe(original);
    expect(readFileSync(migrated, "utf8")).not.toContain("legacy-fixture");
    expect(connections.read("pr_a")).toMatchObject({ version: 2, plugins: { version: 2, plugins: {} }, pluginValues: {}, assignedSkills: [] });
    connections.remove("pr_a", "docs");
    connections.setGithub("pr_a", undefined);
    const again = new PersonConnections(dir, () => key);
    expect(again.list("pr_a")).toEqual([]);
    expect(again.github("pr_a")).toBeUndefined();
    expect(readFileSync(old, "utf8")).toBe(original);
  });

  it("does not fall back to the legacy file when the new store is corrupt", () => {
    const { dir, connections } = store();
    const old = legacyFile(dir, "pr_a", { version: 1, mcpServers: {}, github: { token: "github-fixture", login: "alice", via: "token", connectedAt: 1 } });
    const current = join(principalDir(dir, "pr_a"), "capabilities.enc");
    writeFileSync(current, "broken-current-fixture");
    expect(() => connections.github("pr_a")).toThrow(PersonConnectionsError);
    expect(() => connections.setAssignedSkills("pr_a", ["docs"])).toThrow(PersonConnectionsError);
    expect(readFileSync(current, "utf8")).toBe("broken-current-fixture");
    expect(existsSync(old)).toBe(true);
  });

  it("keeps plugin state, configuration and skill references in the same encrypted personal store", () => {
    const { dir, connections } = store();
    const plugins = { version: 2 as const, plugins: { "docs@market": { name: "docs", marketplace: "market", enabled: true, installedAt: 1, updatedAt: 1, removed: [], declaredMcpServers: ["docs"] } } };
    connections.setPluginState("pr_a", plugins);
    connections.setPluginValues("pr_a", { "docs@market": { region: "fixture-region" } });
    connections.setAssignedSkills("pr_a", ["release-notes", "docs", "docs"]);
    connections.setGithub("pr_a", { token: "github-fixture", login: "alice", via: "token", connectedAt: 1 });
    const again = new PersonConnections(dir, () => key);
    expect(again.pluginState("pr_a")).toEqual(plugins);
    expect(again.pluginValues("pr_a")).toEqual({ "docs@market": { region: "fixture-region" } });
    expect(again.assignedSkills("pr_a")).toEqual(["docs", "release-notes"]);
    expect(again.read("pr_b")).toMatchObject({ plugins: { plugins: {} }, pluginValues: {}, assignedSkills: [] });
    const onDisk = readFileSync(join(principalDir(dir, "pr_a"), "capabilities.enc"), "utf8");
    expect(onDisk).not.toContain("fixture-region");
    expect(onDisk).not.toContain("github-fixture");
    expect(onDisk).not.toContain("docs@market");
    const detached = again.pluginState("pr_a");
    detached.plugins["docs@market"]!.enabled = false;
    expect(again.pluginState("pr_a").plugins["docs@market"]!.enabled).toBe(true);
  });

  it("refuses a person id that would leave the people folder", () => {
    expect(() => principalDir("/data", "../x")).toThrow(PersonConnectionsError);
    expect(() => principalDir("/data", "..")).toThrow(PersonConnectionsError);
  });
});

describe("personalMcpHostRefusal", () => {
  it("refuses private, loopback and metadata addresses, by literal or by name", async () => {
    const { personalMcpHostRefusal } = await import("./person-connections.ts");
    expect(await personalMcpHostRefusal("https://169.254.169.254/mcp")).toBeTruthy();
    expect(await personalMcpHostRefusal("https://127.0.0.1/mcp")).toBeTruthy();
    expect(await personalMcpHostRefusal("https://[::1]/mcp")).toBeTruthy();
    expect(await personalMcpHostRefusal("https://internal.example/mcp", { lookup: async () => [{ address: "10.0.0.5", family: 4 }] })).toBeTruthy();
    expect(await personalMcpHostRefusal("https://api.githubcopilot.com/mcp/", { lookup: async () => [{ address: "140.82.112.21", family: 4 }] })).toBeNull();
    expect(await personalMcpHostRefusal("http://127.0.0.1:9/mcp", { allowPrivate: true })).toBeNull();
  });
});

// 2026-10-28: add_mcp_server on an organization server adds to the person's
// own servers; what the bot sends becomes that list's own input
describe("personalMcpInputFromAgent", () => {
  it("maps a remote url, one header or OAuth, and a command in the person's environment", () => {
    expect(personalMcpInputFromAgent({ name: "notes", url: "https://mcp.example.com/mcp" })).toEqual({ name: "notes", url: "https://mcp.example.com/mcp", type: "http", auth: "none" });
    expect(personalMcpInputFromAgent({ name: "notes", url: "https://mcp.example.com/sse", type: "sse", headers: { "X-Api-Key": "k1" } }))
      .toEqual({ name: "notes", url: "https://mcp.example.com/sse", type: "sse", auth: "token", headerName: "X-Api-Key", token: "k1" });
    expect(personalMcpInputFromAgent({ name: "notes", url: "https://mcp.example.com/mcp", oauth: {} })).toMatchObject({ auth: "oauth" });
    expect(personalMcpInputFromAgent({ name: "files", command: "npx", args: ["-y", "server"], env: { A: "1" } }))
      .toEqual({ name: "files", command: "npx", args: ["-y", "server"], env: { A: "1" }, runsIn: "environment" });
    const parsed = parsePersonalMcpInput(personalMcpInputFromAgent({ name: "notes", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer t" } }));
    expect(parsed.server).toMatchObject({ kind: "remote", auth: "token", headerName: "Authorization", token: "Bearer t" });
  });

  it("says why it cannot be one of the person's servers", () => {
    expect(personalMcpInputFromAgent({ name: "n", url: "https://a.example.com", headers: { A: "1", B: "2" } })).toMatch(/one header/);
    expect(personalMcpInputFromAgent({ name: "n", url: "https://a.example.com", oauth: { clientId: "c" } })).toMatch(/pre-registered/);
    expect(personalMcpInputFromAgent({ name: "n", url: "https://a.example.com", command: "x" })).toMatch(/not both/);
    expect(personalMcpInputFromAgent({ name: "n", command: "x", args: [1] })).toMatch(/args/);
    expect(personalMcpInputFromAgent(null)).toMatch(/url or a command/);
  });
});
