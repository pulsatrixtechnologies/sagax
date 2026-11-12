import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { isProgramEntry } from "./program-entry.ts";

const dir = fileURLToPath(new URL(".", import.meta.url));

// #3901, #3910: a spawned proxy is bundled into the server's index.js, whose
// import.meta.url is the server's entry too; only the proxy's own file runs it.
describe("program entry", () => {
  it("runs a proxy only from its own file, never inside the server's bundle", () => {
    for (const name of ["harness-mcp-proxy", "user-sandbox-proxy"]) {
      for (const extension of [".js", ".ts", ".mjs"]) {
        const entry = `${dir}${name}${extension}`;
        expect(isProgramEntry(name, entry, new URL(`${name}${extension}`, import.meta.url).href)).toBe(true);
      }
      const server = `${dir}index.js`;
      expect(isProgramEntry(name, server, new URL("index.js", import.meta.url).href)).toBe(false);
      expect(isProgramEntry(name, undefined, import.meta.url)).toBe(false);
    }
    // the file name alone is not enough: the module must be the one node started on
    expect(isProgramEntry("user-sandbox-proxy", `${dir}user-sandbox-proxy.js`, new URL("index.js", import.meta.url).href)).toBe(false);
    expect(isProgramEntry("user-sandbox-proxy", `${dir}other-user-sandbox-proxy.js`, new URL("other-user-sandbox-proxy.js", import.meta.url).href)).toBe(false);
  });

  it("leaves the server's stdin alone when the sandbox proxy is bundled into it", async () => {
    // the real path: node names its entry by it, and a temporary folder can sit behind a link
    const work = await realpath(await mkdtemp(join(tmpdir(), "program-entry-")));
    try {
      const source = join(work, "entry.ts");
      await writeFile(source, `import { PERSONAL_STDIO_TOOL_SERVER } from ${JSON.stringify(join(dir, "user-sandbox-proxy.ts"))};\nvoid PERSONAL_STDIO_TOOL_SERVER;\nsetTimeout(() => {}, 300);\n`);
      const outfile = join(work, "index.mjs");
      await build({ entryPoints: [source], outfile, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
      const child = spawn(process.execPath, [outfile], { env: { PATH: process.env.PATH ?? "" }, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
      child.stdin.end();
      await new Promise<void>((resolve) => child.once("close", () => resolve()));
      expect(stdout).toBe("");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
