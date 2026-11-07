import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { REA_PLUGIN } from "../../shared/builtin-plugins.ts";

// REA is never started for real here: any spawn is a failure.
const spawn = vi.hoisted(() => vi.fn(() => { throw new Error("spawn must not run in tests"); }));
vi.mock("node:child_process", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:child_process")>()), spawn, execFile: spawn, exec: spawn }));
const missing = vi.hoisted(() => ({ value: false }));
vi.mock("./builtin-plugin-mounts.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./builtin-plugin-mounts.ts")>();
  return { ...real, builtinRuntimeMissing: () => missing.value };
});

const { builtinPluginMcp, commandOnPath, createRuntimeCheck } = await import("./builtin-plugin-mounts.ts");
const { createScopedPluginMcp } = await import("../index-leaves/scopedPluginMcp.ts");
const { createMountPluginMcp } = await import("../index-leaves/mountPluginMcp.ts");

function host(bot: Record<string, unknown>, kind: "solo" | "perspicax" = "solo") {
  const h: Record<string, any> = {
    IDENTITY: { kind },
    installationPlugins: { mcpServers: () => [] },
    personalPlugins: { mcpServers: () => [], listPlugins: () => [] },
    botPlugins: { mcpServers: () => [], listPlugins: () => [] },
    scopedPluginFolders: () => [],
    orgCapabilityMounts: () => [],
    samePerson: () => true,
    effectiveBotOwner: () => "me",
    localPrincipalId: () => "me",
    store: { bot: () => bot },
    managedPolicy: { filterMcp: (servers: Record<string, unknown>) => servers },
    userSandbox: kind === "perspicax" ? {} : undefined,
    personalStdioIntegration: (_bot: string, _thread: string, _gen: string, person: string, name: string, ref: unknown) => ({ command: "sandbox-relay", args: [person, name], env: {}, ref }),
  };
  h.scopedPluginMcp = createScopedPluginMcp(() => h);
  return h;
}

async function mounts(bot: Record<string, unknown>, kind: "solo" | "perspicax" = "solo") {
  const integrations: { custom?: Record<string, any> } = {};
  await createMountPluginMcp(() => host(bot, kind))(integrations, { botId: "b1", threadId: "t1", generation: "g1", customMcp: true, principal: "me" });
  return integrations.custom ?? {};
}

beforeEach(() => { missing.value = false; spawn.mockClear(); });

describe("REA built-in mounts", () => {
  it("mounts REA for a new bot with the pinned non-interactive command", async () => {
    const custom = await mounts({ id: "b1", builtinPlugins: {} });
    expect(custom.rea).toEqual({ command: "npx", args: ["-y", `rea-agents@${REA_PLUGIN.version}`, "mcp"], env: REA_PLUGIN.spec.env });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("mounts REA for a bot saved before built-ins existed (no field, no migration)", async () => {
    const custom = await mounts({ id: "b1", name: "Old bot", mcpServers: ["docs"] });
    expect(Object.keys(custom)).toEqual(["rea"]);
  });

  it("removes REA from the mounts when the bot switches it off", async () => {
    expect(await mounts({ id: "b1", builtinPlugins: { rea: false } })).toEqual({});
    expect(builtinPluginMcp({ builtinPlugins: { rea: false } })).toEqual([]);
  });

  it("keeps REA off the desktop turn when npx is missing", async () => {
    missing.value = true;
    expect(await mounts({ id: "b1" })).toEqual({});
  });

  it("runs REA in the person's sandbox on an organization, whatever the server's PATH", async () => {
    missing.value = true;
    const custom = await mounts({ id: "b1" }, "perspicax");
    expect(custom.rea).toMatchObject({ command: "sandbox-relay", ref: { scope: "bot", key: "builtin:rea", name: "rea" } });
  });

  it("hands each caller a fresh copy of the spec", () => {
    const [first] = builtinPluginMcp({});
    (first.spec as { args: string[] }).args.push("setup");
    expect((builtinPluginMcp({})[0].spec as { args: string[] }).args).toEqual(REA_PLUGIN.spec.args);
  });
});

describe("runtime check", () => {
  const dir = mkdtempSync(join(tmpdir(), "rea-path-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds an executable on PATH without running it", () => {
    writeFileSync(join(dir, "npx"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    expect(commandOnPath("npx", { PATH: dir }, "darwin")).toBe(join(dir, "npx"));
    expect(commandOnPath("npx", { PATH: "" }, "darwin")).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("caches the lookup for its TTL", () => {
    const lookup = vi.fn(() => null);
    const check = createRuntimeCheck(lookup, 60_000);
    expect(check(REA_PLUGIN)).toBe(true);
    expect(check(REA_PLUGIN)).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    const found = createRuntimeCheck(() => "/usr/bin/npx");
    expect(found(REA_PLUGIN)).toBe(false);
  });
});
