// #3385: the GitHub plugin's server failed at connect with "Remote MCP
// request failed (HTTP 400)". The plugin ships
// `Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}` and mountPluginMcp
// handed it to the engine as read, so the literal placeholder reached the
// remote server. A local stand-in refuses a malformed Authorization header
// with 400, as the remote one does.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedPluginMcp } from "./scopedPluginMcp.ts";
import { createMountPluginMcp } from "./mountPluginMcp.ts";
import { RemoteMcpClient } from "../mcp/mcp-http.ts";

const TOKEN = "gho_standintokenvalue123";
let server: Server;
let url = "";
const seen: Array<string | undefined> = [];

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    request.on("data", (chunk) => { text += chunk; });
    request.on("end", () => resolve(text));
  });
}

beforeAll(async () => {
  server = createServer((request, response) => {
    void body(request).then((text) => {
      const auth = request.headers.authorization;
      seen.push(auth);
      if (!auth || !/^Bearer [A-Za-z0-9_]+$/.test(auth)) {
        response.writeHead(400, { "content-type": "text/plain" }).end("bad request: invalid Authorization header");
        return;
      }
      if (auth !== `Bearer ${TOKEN}`) { response.writeHead(401).end(); return; }
      const frame = JSON.parse(text) as { id?: number; method: string };
      if (frame.id === undefined) { response.writeHead(202).end(); return; }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        jsonrpc: "2.0", id: frame.id,
        result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stand-in" } },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp/`;
});
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

function host(kind: "solo" | "perspicax", token: string | undefined) {
  const plugin = { key: "github@official", plugin: "github", dir: "/plugins/github" };
  const h: Record<string, any> = {
    IDENTITY: { kind },
    installationPlugins: { mcpServers: () => [] },
    personalPlugins: {
      mcpServers: () => [{ ...plugin, name: "github", spec: { type: "http", url, headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" } } }],
      listPlugins: () => [{ key: plugin.key }],
      installedFolder: () => ({ dir: plugin.dir }),
    },
    botPlugins: { mcpServers: () => [], listPlugins: () => [] },
    scopedPluginFolders: () => [{ scope: "person", name: "github", dir: plugin.dir }],
    orgCapabilityMounts: () => [],
    samePerson: () => true,
    effectiveBotOwner: () => "me",
    localPrincipalId: () => "me",
    store: { bot: () => ({ id: "b1", builtinPlugins: { rea: false } }) },
    managedPolicy: { filterMcp: (servers: Record<string, unknown>) => servers },
    userSandbox: {},
    personalHostRefusalCached: async () => false,
    githubAccountToken: (person: string) => (person === "me" ? token : undefined),
  };
  h.scopedPluginMcp = createScopedPluginMcp(() => h);
  return h;
}

async function mount(kind: "solo" | "perspicax", token: string | undefined) {
  const integrations: { custom?: Record<string, any> } = {};
  const result = await createMountPluginMcp(() => host(kind, token))(integrations, { botId: "b1", threadId: "t1", generation: "g1", customMcp: true, principal: "me" });
  return { custom: integrations.custom ?? {}, withheld: (result?.githubWithheld ?? []) as string[] };
}

async function connect(spec: { type: "http"; url: string; headers: Record<string, string> }) {
  const client = new RemoteMcpClient(spec, { fetch: globalThis.fetch });
  try { return await client.initialize("Sagax tool proxy", AbortSignal.timeout(5_000)); }
  finally { await client.close(); }
}

describe("a plugin's GitHub server goes as the turn's person (#3385)", () => {
  it.each(["perspicax", "solo"] as const)("%s: the handshake carries the person's GitHub connection, never the placeholder", async (kind) => {
    const { custom, withheld } = await mount(kind, TOKEN);
    expect(withheld).toEqual([]);
    expect(custom.github.headers.Authorization).not.toContain("${");
    seen.length = 0;
    await expect(connect(custom.github)).resolves.toMatchObject({ serverInfo: { name: "stand-in" } });
    expect(seen.every((auth) => auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("the stand-in refuses the literal placeholder with HTTP 400, as the remote server did", async () => {
    await expect(connect({ type: "http", url, headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" } }))
      .rejects.toMatchObject({ status: 400 });
  });

  it("organization server: a person without a GitHub connection gets no GitHub server, and the turn says so", async () => {
    const { custom, withheld } = await mount("perspicax", undefined);
    expect(custom.github).toBeUndefined();
    expect(withheld).toEqual(["github"]);
  });
});
