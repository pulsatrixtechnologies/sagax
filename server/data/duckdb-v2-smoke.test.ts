// Focused smoke for @duckdb/node-api 2.0 (#5272): open via the staged
// SAGAX_DUCKDB_DIR tree, create a small store, write, read, reopen.
// engine.test.ts covers the surface; this file pins the major bump itself.
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { CLOSE_DRAIN_MS, createDataEngine } from "./engine.ts";
import type { DataEngine } from "./types.ts";

const root = mkdtempSync(join(tmpdir(), "omb-duckdb-v2-smoke-"));
const outOfTree = join(root, "duckdb-resources");
const nodeApi = realpathSync(join(process.cwd(), "node_modules", "@duckdb", "node-api"));
const bindings = realpathSync(join(nodeApi, "..", "node-bindings"));
const platform = realpathSync(join(bindings, "..", `node-bindings-${process.platform}-${process.arch}`));
for (const [name, source] of [
  ["node-api", nodeApi],
  ["node-bindings", bindings],
  [`node-bindings-${process.platform}-${process.arch}`, platform],
] as const) {
  cpSync(source, join(outOfTree, "node_modules", "@duckdb", name), { recursive: true, dereference: true });
}

const engines: DataEngine[] = [];
const bot = { connection: "bot" as const };

function engine(): DataEngine {
  const created = createDataEngine({
    botFolder: (botId) => join(root, "bots", botId),
    dataDir: join(root, "data"),
    env: { ...process.env, SAGAX_DUCKDB_DIR: outOfTree, SAGAX_RESOURCES_PATH: undefined },
  });
  engines.push(created);
  return created;
}

afterAll(async () => {
  if (process.platform === "win32") return;
  const closing = Promise.all(engines.map((e) => e.closeAll()));
  const gaveUp = new Promise<"gave-up">((resolve) => setTimeout(() => resolve("gave-up"), CLOSE_DRAIN_MS * 2).unref());
  if ((await Promise.race([closing.then(() => "closed" as const), gaveUp])) === "gave-up") {
    throw new Error("closeAll did not finish");
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}, CLOSE_DRAIN_MS * 4);

describe("duckdb 2.0 staged binding smoke", () => {
  it("loads 2.x from SAGAX_DUCKDB_DIR, creates a store, writes, reads, and reopens", async () => {
    const pkg = JSON.parse(readFileSync(join(nodeApi, "package.json"), "utf8")) as { version: string };
    expect(pkg.version.startsWith("2.")).toBe(true);

    const requireFromTree = createRequire(join(outOfTree, "node_modules", "openmausbot-duckdb-anchor.js"));
    const binding = requireFromTree("@duckdb/node-api") as { version: () => string };
    expect(binding.version()).toMatch(/^v?2\./);

    const e = engine();
    expect(e.unavailable()).toBeNull();

    const db = await e.forBot("smoke-v2");
    await db.run("CREATE TABLE items AS SELECT 1 AS id, 'alpha' AS name", bot);
    const written = await db.run("SELECT id, name FROM items", bot);
    expect(written.rows).toEqual([[1, "alpha"]]);
    expect(existsSync(join(root, "bots", "smoke-v2", "data.duckdb"))).toBe(true);

    const versionRow = await db.run("SELECT version()", bot);
    expect(String(versionRow.rows[0]?.[0] ?? "")).toMatch(/^v?2\./);

    await db.close();
    const again = await e.forBot("smoke-v2");
    const reread = await again.run("SELECT name FROM items WHERE id = 1", bot);
    expect(reread.rows).toEqual([["alpha"]]);
  });
});
