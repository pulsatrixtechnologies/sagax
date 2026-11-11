// #3623: toolsServed notes a mount's first request where it arrives. The
// harness mounts' streamable HTTP route answers `initialize` itself, so that
// route opens the mount's entry before its tool list reaches /<kind>/mcp.
import { afterEach, describe, expect, it } from "vitest";

import { createRunInternal } from "./run-internal.ts";
import { clearTurnCounters, closeTurnServing, openTurnServing } from "../turns/turn-trace.ts";

const BROWSER = { kind: "browser", threadId: "t1", botId: "b1" };
const DATA = { kind: "data", threadId: "t1", botId: "b1" };

function hostWith(capabilities: Record<string, object>, served: string[]) {
  return {
    PORT: 0,
    harnessMcpHttpKind: (path: string) => /^\/api\/internal\/(browser|computer|data)\/mcp-http$/.exec(path)?.[1] ?? null,
    serveHarnessMcpHttp: async (_req: unknown, _res: unknown, kind: string) => { served.push(kind); },
    authorizedInternalCapability: (header: string | undefined) => capabilities[header ?? ""],
    store: { bot: (id: string) => ({ id }), isConfidentialThread: () => false, groupByThread: () => undefined },
    botmailConfined: () => false,
    EXTERNAL_RUNTIME_GENERATION: -1,
    externalRuntimeMayCall: () => true,
    DATA_INTERNAL_MCP_PATH: "/api/internal/data/mcp",
  };
}

const fakeRes = () => ({ headersSent: false, writableEnded: false, statusCode: 0, setHeader() {}, writeHead(status: number) { this.statusCode = status; return this; }, end() { this.writableEnded = true; }, once() { return this; } });

async function call(host: ReturnType<typeof hostWith>, path: string, bearer: string, at: number) {
  const realNow = Date.now;
  Date.now = () => at;
  try {
    const url = new URL(`http://127.0.0.1${path}`);
    await createRunInternal(() => host)({ headers: { authorization: bearer }, method: "POST" }, fakeRes(), url, url.pathname, "POST", {});
  } finally {
    Date.now = realNow;
  }
}

afterEach(() => clearTurnCounters());

describe("toolsServed on the harness mounts' HTTP route (#3623)", () => {
  it("opens a mount's entry at its first request on the HTTP route, which answers initialize itself", async () => {
    const served: string[] = [];
    const host = hostWith({ "Bearer b": BROWSER }, served);
    openTurnServing("t1", 1_000);
    await call(host, "/api/internal/browser/mcp-http", "Bearer b", 1_120);
    // the forwarded tools/list reaches /browser/mcp later: the entry keeps its first request
    // (a claimed sender that differs ends that request right after the note)
    await call(host, "/api/internal/browser/mcp?self=other", "Bearer b", 1_400);
    expect(served).toEqual(["browser"]);
    expect(closeTurnServing("t1")).toEqual([["browser", 120]]);
  });

  it("notes nothing for a bearer of another mount or no bearer, and still serves the request", async () => {
    const served: string[] = [];
    const host = hostWith({ "Bearer d": DATA }, served);
    openTurnServing("t1", 1_000);
    await call(host, "/api/internal/browser/mcp-http", "Bearer d", 1_050);
    await call(host, "/api/internal/browser/mcp-http", "Bearer none", 1_060);
    expect(served).toEqual(["browser", "browser"]);
    expect(closeTurnServing("t1")).toEqual([]);
  });

  it("notes a stdio mount's first request on its own route", async () => {
    const host = hostWith({ "Bearer d": DATA }, []);
    openTurnServing("t1", 1_000);
    await call(host, "/api/internal/data/mcp?self=other", "Bearer d", 1_300);
    expect(closeTurnServing("t1")).toEqual([["data", 300]]);
  });
});
