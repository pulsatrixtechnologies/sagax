// 2026-10-17 (#695 follow-up): an MCP server an older build saved under a
// name Sagax now reserves is never mounted, and no longer silently: the start
// logs it, the MCP list shows it apart with a free name, and the rename route
// moves it to that name, saved off. Real server, isolated home.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { verificationServerEnvironment } from "../scripts/control-omb.ts";
import { InstallationCapabilityStore } from "./capabilities/installation-capability-store.ts";
import { resolveVaultKey } from "./mcp/mcp-oauth.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_CLI = join(ROOT, "server/testing/fake-claude-cli.ts");

const homes: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) await waitForExit(child, { signal: "SIGTERM" });
  for (const home of homes.splice(0)) await removeTempDir(home);
});

it("logs, lists apart and renames a saved server whose name is reserved", async () => {
  const home = mkdtempSync(join(tmpdir(), "omb-mcp-reserved-"));
  homes.push(home);
  mkdirSync(join(home, "tmp"), { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({
    instances: { claude: { driver: "claudeAgent", displayName: "Verification fixture", config: { cli: FAKE_CLI } } },
    mcpServers: {
      notes: { command: "notes-mcp", enabled: false },
      mcp: { command: "legacy-mcp", args: ["--serve"], enabled: true },
    },
  }));
  const port = await freePortBlock([0, 1]);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server/index.ts")], {
    cwd: ROOT,
    env: verificationServerEnvironment(process.env, home, port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout!.on("data", (chunk) => { output += chunk; });
  child.stderr!.on("data", (chunk) => { output += chunk; });
  await expect.poll(async () => {
    if (child.exitCode !== null) throw new Error(`server exited during boot:\n${output}`);
    try { return (await fetch(base + "/api/health")).ok; } catch { return false; }
  }, { timeout: 20_000, interval: 50 }).toBe(true);
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: { origin: base, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };

  await expect.poll(() => output, { timeout: 5_000 }).toContain('MCP server "mcp" is not mounted: its name is reserved by Sagax.');

  const listed = await api("GET", "/api/mcp/servers");
  expect(listed.status).toBe(200);
  expect(listed.body.servers.map((server: { name: string }) => server.name)).toEqual(["notes"]);
  expect(listed.body.reserved).toEqual([{ name: "mcp", suggestedName: "server" }]);

  // never back under another reserved name, never over a taken one
  expect((await api("POST", "/api/mcp/servers/mcp/rename", { to: "sagax-mcp" })).status).toBe(400);
  expect((await api("POST", "/api/mcp/servers/mcp/rename", { to: "notes" })).status).toBe(409);
  expect((await api("POST", "/api/mcp/servers/notes/rename", { to: "notes2" })).status).toBe(400);

  const renamed = await api("POST", "/api/mcp/servers/mcp/rename", { to: "server" });
  expect(renamed.status).toBe(200);
  expect(renamed.body.renamed).toEqual({ from: "mcp", to: "server" });
  expect(renamed.body.reserved).toBeUndefined();
  expect(renamed.body.servers).toEqual(expect.arrayContaining([expect.objectContaining({ name: "server", command: "legacy-mcp", enabled: false })]));

  // 9ede65b25 / f1db2ed59: installation MCP moves into the sealed store;
  // the verified migration clears only the legacy config field.
  const legacy = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  expect(legacy.mcpServers).toEqual({});
  // Read only this fixture's existing vault key, without operator env.
  expect(existsSync(join(home, "mcp-oauth.key"))).toBe(true);
  const installation = new InstallationCapabilityStore(home, () => resolveVaultKey(home, {}));
  expect(installation.present()).toBe(true);
  const disk = installation.read();
  expect(disk.migrated).toContain("config-mcp-servers");
  expect(Object.keys(disk.mcpServers)).toEqual(["notes", "server"]);
  expect(disk.mcpServers.notes).toEqual({ command: "notes-mcp", enabled: false });
  expect(disk.mcpServers.server).toMatchObject({ command: "legacy-mcp", args: ["--serve"], enabled: false });
}, 60_000);
