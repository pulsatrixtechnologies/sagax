import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PRODUCTION_ENGINE_IDS } from "../../shared/production-engines.ts";
import { ENGINE_PROBE_CONCURRENCY, EngineSelfCheck, mapLimited, readEngineManifest, runEngineSelfCheck, type EngineManifest } from "./engines-self-check.ts";
import { BUILT_IN_DRIVERS } from "../drivers/builtIn.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function manifestFile(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "engines-manifest-"));
  dirs.push(dir);
  const path = join(dir, "manifest.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

const MANIFEST: EngineManifest = {
  lockVersion: 1,
  engineSet: "all",
  arch: "arm64",
  installed: [
    { id: "claude", name: "Claude Code", drivers: ["claudeAgent"], kind: "npm", version: "2.1.288", bin: "claude" },
    { id: "grok", name: "Grok Build", drivers: ["grokAgent"], kind: "native", version: "1.0.46", bin: "grok" },
    { id: "hermes", name: "Hermes Agent", drivers: ["hermesAgent"], kind: "python", version: "0.21.5", bin: "hermes" },
  ],
  notPreinstalled: [
    { id: "antigravity", name: "Antigravity", drivers: ["antigravityAgent"], reason: "too big" },
    { id: "minimax-cli", name: "mmx", drivers: [], reason: "not needed" },
  ],
};

describe("readEngineManifest", () => {
  it("is null without a path, a file or valid JSON", () => {
    expect(readEngineManifest(undefined)).toBeNull();
    expect(readEngineManifest("")).toBeNull();
    expect(readEngineManifest(join(tmpdir(), "no-such-engines-manifest.json"))).toBeNull();
    expect(readEngineManifest(manifestFile("{nope"))).toBeNull();
    expect(readEngineManifest(manifestFile([]))).toBeNull();
  });

  it("keeps the well-formed entries and drops the rest", () => {
    const manifest = readEngineManifest(manifestFile({
      ...MANIFEST,
      installed: [...MANIFEST.installed, { id: "nobin", drivers: ["x"] }, "junk"],
      notPreinstalled: [...MANIFEST.notPreinstalled, { id: "noreason" }],
    }));
    expect(manifest?.installed.map((engine) => engine.id)).toEqual(["claude", "grok", "hermes"]);
    expect(manifest?.notPreinstalled.map((entry) => entry.id)).toEqual(["antigravity", "minimax-cli"]);
    expect(manifest?.engineSet).toBe("all");
  });
});

describe("runEngineSelfCheck", () => {
  it("probes each installed engine once, logs its version and answers per instance", async () => {
    const probed: string[] = [];
    const lines: string[] = [];
    const check = await runEngineSelfCheck(MANIFEST, {
      find: (bin) => (bin === "hermes" ? [] : [`/usr/local/bin/${bin}`]),
      probe: async (path) => {
        probed.push(path);
        if (path.endsWith("/grok")) throw new Error("exec format error\nmore");
        return "2.1.288 (Claude Code)";
      },
      log: (line) => lines.push(line),
    });
    expect(probed.sort()).toEqual(["/usr/local/bin/claude", "/usr/local/bin/grok"]);
    expect(check.forInstance("claudeAgent", "claude")).toMatchObject({ ok: true, version: "2.1.288 (Claude Code)", pinned: "2.1.288" });
    expect(check.forInstance("grokAgent", "grok")).toMatchObject({ ok: false, error: "exec format error" });
    expect(check.forInstance("hermesAgent", "hermes")).toMatchObject({ ok: false, error: "`hermes` is not on this server's PATH" });
    // an instance with its own command is probed as before
    expect(check.forInstance("claudeAgent", "/opt/other/claude")).toBeNull();
    expect(check.forInstance("codex", "codex")).toBeNull();
    expect(check.notAvailableReason("antigravityAgent")).toBe("too big");
    expect(check.notAvailableReason("claudeAgent")).toBeUndefined();
    expect(lines.join("\n")).toContain("[engines] claude: 2.1.288 (Claude Code) (pinned 2.1.288, /usr/local/bin/claude)");
    expect(lines.join("\n")).toContain("[engines] grok: FAILED, exec format error (pinned 1.0.46)");
    expect(lines.join("\n")).toContain("[engines] antigravity: not preinstalled, too big");
    expect(lines.join("\n")).not.toContain("minimax-cli");
    const missing = lines.find((line) => line.includes("engine_missing"));
    expect(missing).toContain("engineSet=all");
    expect(missing).toContain("codex");
    expect(missing).toContain("grok");
    expect(lines.at(-1)).toBe("[engines] self-check: 1/3 preinstalled engine(s) start (image set all)");
  });

  it("never runs more than one --version probe at once when the manifest has no recorded version", async () => {
    expect(ENGINE_PROBE_CONCURRENCY).toBe(1);
    const eleven: EngineManifest = {
      ...MANIFEST,
      installed: Array.from({ length: 11 }, (_, i) => ({ id: `e${i}`, name: `E${i}`, drivers: [`d${i}`], kind: "npm", version: "1", bin: `e${i}` })),
      notPreinstalled: [],
    };
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const check = await runEngineSelfCheck(eleven, {
      find: (bin) => [`/usr/local/bin/${bin}`],
      probe: async (path) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, path.endsWith("e0") ? 15 : 2));
        running -= 1;
        order.push(path);
        return `v ${path}`;
      },
      log: () => {},
    });
    expect(peak).toBe(1);
    expect(order).toHaveLength(11);
    // results keep the manifest's order however the probes finish
    expect(check.checks.map((c) => c.id)).toEqual(eleven.installed.map((e) => e.id));
    expect(check.checks.every((c) => c.ok)).toBe(true);
  });

  it("does not spawn a CLI whose image build already recorded --version", async () => {
    const probed: string[] = [];
    const lines: string[] = [];
    const recorded: EngineManifest = {
      ...MANIFEST,
      installed: MANIFEST.installed.map((engine) => ({ ...engine, reported: `${engine.id} 1.2.3` })),
    };
    const check = await runEngineSelfCheck(recorded, {
      find: (bin) => (bin === "hermes" ? [] : [`/usr/local/bin/${bin}`]),
      probe: async (path) => {
        probed.push(path);
        return "must not run";
      },
      log: (line) => lines.push(line),
    });
    expect(probed).toEqual([]);
    expect(check.forInstance("claudeAgent", "claude")).toMatchObject({ ok: true, version: "claude 1.2.3", path: "/usr/local/bin/claude" });
    expect(check.forInstance("grokAgent", "grok")).toMatchObject({ ok: true, version: "grok 1.2.3" });
    expect(check.forInstance("hermesAgent", "hermes")).toMatchObject({ ok: false, error: "`hermes` is not on this server's PATH" });
    expect(lines.join("\n")).toContain("[engines] claude: claude 1.2.3 (pinned 2.1.288, /usr/local/bin/claude)");
    expect(lines.join("\n")).toContain("[engines] hermes: FAILED, `hermes` is not on this server's PATH");
    expect(lines.at(-1)).toBe("[engines] self-check: 2/3 preinstalled engine(s) start (image set all)");
  });

  it("probes only the engines with no recorded version, still one at a time", async () => {
    let running = 0;
    let peak = 0;
    const probed: string[] = [];
    const mixed: EngineManifest = {
      ...MANIFEST,
      installed: [
        { ...MANIFEST.installed[0]!, reported: "claude from image" },
        { ...MANIFEST.installed[1]! },
        { ...MANIFEST.installed[2]! },
      ],
    };
    await runEngineSelfCheck(mixed, {
      find: (bin) => [`/usr/local/bin/${bin}`],
      probe: async (path) => {
        running += 1;
        peak = Math.max(peak, running);
        probed.push(path);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return "live";
      },
      log: () => {},
    });
    expect(peak).toBe(1);
    expect(probed.sort()).toEqual(["/usr/local/bin/grok", "/usr/local/bin/hermes"]);
  });

  it("mapLimited keeps order, survives an empty list and a limit above the list", async () => {
    expect(await mapLimited([], 2, async (x: number) => x)).toEqual([]);
    expect(await mapLimited([3, 1, 2], 10, async (x) => x * 2)).toEqual([6, 2, 4]);
    expect(await mapLimited([3, 1, 2], 0, async (x) => x)).toEqual([3, 1, 2]);
  });

  it("logs engine_missing when the image set is empty", async () => {
    const lines: string[] = [];
    await runEngineSelfCheck({ ...MANIFEST, engineSet: "none", installed: [] }, {
      find: () => [],
      probe: async () => { throw new Error("must not probe"); },
      log: (line) => lines.push(line),
    });
    const missing = lines.find((line) => line.includes("engine_missing"));
    expect(missing).toContain("engineSet=none");
    expect(missing).toContain("claude");
    expect(missing).toContain("cursor");
    expect(lines.at(-1)).toBe("[engines] self-check: 0/0 preinstalled engine(s) start (image set none)");
  });

  it("stays quiet when every production engine started", async () => {
    const lines: string[] = [];
    const manifest: EngineManifest = {
      ...MANIFEST,
      installed: PRODUCTION_ENGINE_IDS.map((id) => ({ id, name: id, drivers: [], kind: "npm", version: "1", bin: id })),
    };
    await runEngineSelfCheck(manifest, {
      find: (bin) => [`/usr/local/bin/${bin}`],
      probe: async () => "1",
      log: (line) => lines.push(line),
    });
    expect(lines.join("\n")).not.toContain("engine_missing");
    expect(lines.at(-1)).toBe(`[engines] self-check: ${PRODUCTION_ENGINE_IDS.length}/${PRODUCTION_ENGINE_IDS.length} preinstalled engine(s) start (image set all)`);
  });

  it("does nothing without a manifest", async () => {
    const lines: string[] = [];
    const check = await runEngineSelfCheck(null, { log: (line) => lines.push(line), probe: async () => { throw new Error("must not probe"); } });
    expect(lines).toEqual([]);
    expect(check.forInstance("claudeAgent", "claude")).toBeNull();
    expect(check.notAvailableReason("antigravityAgent")).toBeUndefined();
    expect(new EngineSelfCheck(null).forInstance("codex", "codex")).toBeNull();
  });
});

describe("engines.lock.json", () => {
  const lock = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "engines.lock.json"), "utf8")) as {
    engines: Array<{ id: string; drivers: string[]; bin: string; kind: string; version: string; integrity?: string; redistributable: boolean; license: string; artifacts?: Record<string, { sha256: string; url: string }>; source?: { sha256: string } }>;
    notPreinstalled: Array<{ drivers: string[]; reason: string }>;
    noInstall: Array<{ drivers: string[] }>;
  };
  const drivers = new Map(BUILT_IN_DRIVERS.map((driver) => [driver.driverKind, driver]));

  it("names every built-in driver once, as installed, not preinstalled or needing no install", () => {
    const listed = [...lock.engines, ...lock.notPreinstalled, ...lock.noInstall].flatMap((entry) => entry.drivers);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...drivers.keys()].sort());
  });

  it("pins each engine to the command its driver runs by default", () => {
    for (const engine of lock.engines) {
      expect(engine.version, engine.id).toMatch(/^\d[\w.-]*$/);
      expect(typeof engine.redistributable, engine.id).toBe("boolean");
      expect(engine.license, engine.id).toBeTruthy();
      for (const kind of engine.drivers) {
        const config = drivers.get(kind)!.defaultConfig() as { cli?: string };
        expect(config.cli, `${engine.id} ${kind}`).toBe(engine.bin);
      }
      if (engine.kind === "npm") expect(engine.integrity, engine.id).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
      if (engine.kind === "native") {
        expect(Object.keys(engine.artifacts ?? {}).sort(), engine.id).toEqual(["amd64", "arm64"]);
        for (const artifact of Object.values(engine.artifacts!)) {
          expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(artifact.url).toMatch(/^https:\/\//);
        }
      }
      if (engine.kind === "python") expect(engine.source?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const entry of lock.notPreinstalled) expect(entry.reason.length).toBeGreaterThan(20);
  });
});
