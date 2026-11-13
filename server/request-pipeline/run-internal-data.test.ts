// #3539: every turn that mounts the Data tools sends tools/list through
// /api/internal/data/mcp. That answer needs no database, so it must not load
// DuckDB's native library (over 100 MB, synchronously on the loop): the
// first tools/call does.
import { cpSync, mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";

import { createDataEngine } from "../data/engine.ts";
import { DATA_INTERNAL_MCP_PATH, dataRpc } from "../data/rpc.ts";
import { DataSheetStore } from "../data/sheet.ts";
import { DataFailure, type DataEngine } from "../data/types.ts";
import { PASS } from "../routes/table.ts";
import { createRunInternal } from "./run-internal.ts";

const root = mkdtempSync(join(tmpdir(), "omb-internal-data-"));
const duckdb = join(root, "duckdb");
const nodeApi = realpathSync(join(process.cwd(), "node_modules", "@duckdb", "node-api"));
const bindings = realpathSync(join(nodeApi, "..", "node-bindings"));
const platform = realpathSync(join(bindings, "..", `node-bindings-${process.platform}-${process.arch}`));
for (const [name, source] of [["node-api", nodeApi], ["node-bindings", bindings], [`node-bindings-${process.platform}-${process.arch}`, platform]]) {
  cpSync(source, join(duckdb, "node_modules", "@duckdb", name), { recursive: true, dereference: true });
}
const loaded = () => Object.keys(createRequire(import.meta.url).cache).filter((file) => file.startsWith(realpathSync(duckdb)));

const engines: DataEngine[] = [];
afterAll(async () => {
  await Promise.all(engines.map((engine) => engine.closeAll()));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function hostWith(dataEngine: DataEngine) {
  const sheets = new Map<string, DataSheetStore>();
  return {
    PORT: 0,
    harnessMcpHttpKind: () => null,
    authorizedInternalCapability: (header: string | undefined) => header === "Bearer d" ? { kind: "data", threadId: "t1", botId: "b1", depth: 0, generation: 1 } : undefined,
    store: { bot: (id: string) => ({ id, name: "Bot", color: "#000" }), bots: [], isConfidentialThread: () => false, groupByThread: () => undefined, appendMessage: () => undefined },
    botmailConfined: () => false,
    EXTERNAL_RUNTIME_GENERATION: -1,
    externalRuntimeMayCall: () => true,
    DATA_INTERNAL_MCP_PATH,
    CONFIDENTIAL_GATED_MCP_PATHS: new Set<string>(),
    internalCapabilityIsActive: () => true,
    internalAgentApiTool: () => null,
    cloudAgentInternalAction: () => null,
    readAndDraft: { refusesRoute: () => false },
    waitsBoot: { routes: async () => PASS },
    savedSteps: { journalRoutes: () => async () => PASS },
    requestSignIn: () => undefined,
    dataEngine,
    dataScopeForTurn: () => "b1",
    dataSheets: { for: (key: string) => sheets.get(key) ?? sheets.set(key, new DataSheetStore({ botId: key, dir: join(root, "sheets", key) })).get(key)! },
    dataRpc,
    DataFailure,
    compileChart: () => { throw new DataFailure({ code: "spec_invalid", message: "not in this test" }); },
    validateVegaLite: async () => ({}),
    chartRenderer: { svg: async () => "<svg/>", png: async () => Buffer.alloc(0) },
    dataExportRoots: () => [root],
    dataConfinedRoots: () => null,
    dataDownloadDir: () => root,
  };
}

async function post(host: ReturnType<typeof hostWith>, body: unknown) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { headers: { authorization: "Bearer d" }, method: "POST" });
  const reply: { status: number; body: string } = { status: 0, body: "" };
  const res = {
    headersSent: false, writableEnded: false,
    setHeader() {}, once() { return this; }, on() { return this; },
    writeHead(status: number) { reply.status = status; this.headersSent = true; return this; },
    end(data?: string) { reply.body = data ?? ""; this.writableEnded = true; },
  };
  const url = new URL(`http://127.0.0.1${DATA_INTERNAL_MCP_PATH}`);
  await createRunInternal(() => host)(req, res, url, url.pathname, "POST", {});
  return { status: reply.status, body: JSON.parse(reply.body) as { result?: Record<string, unknown>; error?: string } };
}

describe("the Data MCP route (#3539)", () => {
  it("answers tools/list without loading DuckDB, and the first tools/call loads it", async () => {
    const engine = createDataEngine({
      botFolder: (botId) => join(root, "bots", botId),
      dataDir: join(root, "data"),
      env: { ...process.env, SAGAX_DUCKDB_DIR: duckdb, SAGAX_RESOURCES_PATH: undefined },
    });
    engines.push(engine);
    const host = hostWith(engine);

    const listed = await post(host, { method: "tools/list", params: {} });
    expect(listed.status).toBe(200);
    expect(listed.body.result).toHaveProperty("tools.0.name", "data_load");
    expect(loaded()).toEqual([]);

    const called = await post(host, { method: "tools/call", params: { name: "data_sql", arguments: { sql: "SELECT 1 AS one", limit: 1 } } });
    expect(called.status).toBe(200);
    expect(called.body.result?.isError).toBeFalsy();
    expect(loaded().some((file) => file.endsWith("duckdb.node"))).toBe(true);
  });

  it("answers 503 with the reason when the binding is found but does not open", async () => {
    const opened: string[] = [];
    const engine = {
      unavailable: () => null,
      forBot: async (botId: string) => { opened.push(botId); throw new DataFailure({ code: "engine_unavailable", message: "DuckDB did not load: broken" }); },
    } as unknown as DataEngine;
    const host = hostWith(engine);
    expect((await post(host, { method: "tools/list", params: {} })).status).toBe(200);
    expect(opened).toEqual([]);
    const called = await post(host, { method: "tools/call", params: { name: "data_sql", arguments: { sql: "SELECT 1", limit: 1 } } });
    expect(called).toEqual({ status: 503, body: { error: "DuckDB did not load: broken" } });
    expect(opened).toEqual(["b1"]);
  });
});
