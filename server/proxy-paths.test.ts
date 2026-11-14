import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { SERVER_ROOT, SPAWNED_PROXIES } from "./proxy-paths.ts";

describe("local computer proxy runtime path", () => {
  it("resolves an existing TypeScript entry in development", () => {
    expect(SPAWNED_PROXIES.localComputer).toBe(join(SERVER_ROOT, "local-computer-proxy.ts"));
    expect(existsSync(SPAWNED_PROXIES.localComputer)).toBe(true);
  });

  it("is included in the server bundle entry points", () => {
    const script = readFileSync(join(SERVER_ROOT, "../scripts/bundle-server.mjs"), "utf8");
    const entryPoints = script.match(/const ENTRY_POINTS = \[([\s\S]*?)\];/)?.[1];
    expect(entryPoints).toMatch(/["']local-computer-proxy\.ts["']/);
  });

  it("resolves the bundled JavaScript sibling without a source tree", async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "omb-proxy-paths-")));
    try {
      await build({
        entryPoints: ["proxy-paths.ts", "local-computer-proxy.ts"].map((entry) => join(SERVER_ROOT, entry)),
        bundle: true,
        platform: "node",
        target: "node20",
        format: "esm",
        outdir: directory,
        logLevel: "silent",
      });
      const manifest = pathToFileURL(join(directory, "proxy-paths.js")).href;
      const output = execFileSync(process.execPath, ["--input-type=module", "-e", [
        `import { SERVER_ROOT, SPAWNED_PROXIES } from ${JSON.stringify(manifest)};`,
        "console.log(JSON.stringify({ root: SERVER_ROOT, localComputer: SPAWNED_PROXIES.localComputer }));",
      ].join("\n")], { encoding: "utf8", timeout: 10_000 });
      const packaged = JSON.parse(output);

      expect(packaged.root).toBe(directory);
      expect(packaged.localComputer).toBe(join(directory, "local-computer-proxy.js"));
      expect(existsSync(packaged.localComputer)).toBe(true);
      expect(existsSync(join(directory, "local-computer-proxy.ts"))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

// #3901: every process the server starts from a file of its own (a relay the
// MCP gate runs as a thread or, when the thread is late, as a process) ships
// in each form of the server: its source in the tree, its bundle in
// dist-server, which the packaged apps and the container image copy whole.
describe("every spawned entry ships", () => {
  it("has its source and is an entry point of the server bundle", () => {
    const script = readFileSync(join(SERVER_ROOT, "../scripts/bundle-server.mjs"), "utf8");
    const entryPoints = script.match(/const ENTRY_POINTS = \[([\s\S]*?)\];/)?.[1] ?? "";
    const listed = new Set([...entryPoints.matchAll(/["']([^"']+\.ts)["']/g)].map((match) => match[1]));
    // the pi extension is loaded by another program as TypeScript: copied, not bundled
    const copied = script.replace(entryPoints, "");
    const missing = Object.entries(SPAWNED_PROXIES).flatMap(([name, path]) => {
      const file = relative(SERVER_ROOT, path).split(sep).join("/");
      const shipped = listed.has(file) || copied.includes(`"${basename(file)}"`);
      return existsSync(path) && shipped ? [] : [`${name}: ${file}`];
    });
    expect(missing).toEqual([]);
  });
});

describe("harness MCP proxy runtime path", () => {
  it("ships the one proxy the built-in browser and the cloud computer share", () => {
    expect(SPAWNED_PROXIES.harnessMcp).toBe(join(SERVER_ROOT, "harness-mcp-proxy.ts"));
    expect(existsSync(SPAWNED_PROXIES.harnessMcp)).toBe(true);
    const script = readFileSync(join(SERVER_ROOT, "../scripts/bundle-server.mjs"), "utf8");
    const entryPoints = script.match(/const ENTRY_POINTS = \[([\s\S]*?)\];/)?.[1];
    expect(entryPoints).toMatch(/["']harness-mcp-proxy\.ts["']/);
    expect(entryPoints).not.toMatch(/["']browser-proxy\.ts["']/);
  });
});
