// The real private marketplace protocol uses the installation link,
// including servers with no Claude CLI and no member sign-in.
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OrgFlowPlugins } from "./org-flow-plugins.ts";
import { flowPluginsSchema, type FlowPluginsDeclaration } from "./perspicax-link.ts";
import { ZipWriter } from "./zip.ts";

const TOKEN = "pxat1.fixture-server-link";

interface Plugin { name: string; version: string; tenant: boolean }

/** The fake Perspicax: its manifest and archives behind the member's token. */
class Marketplace {
  server!: Server;
  origin = "";
  plugins: Plugin[] = [];
  tamper = false;
  archiveOrigin = "";
  requests: Array<{ path: string; auth: boolean }> = [];

  private archives = new Map<string, Promise<Buffer>>();
  archive(p: Plugin): Promise<Buffer> {
    const key = `${p.name}@${p.version}`;
    if (!this.archives.has(key)) this.archives.set(key, (async () => {
      const chunks: Buffer[] = [];
      const zip = new ZipWriter((chunk) => { chunks.push(chunk); });
      for (const [path, text] of Object.entries({
        ".claude-plugin/plugin.json": JSON.stringify({ name: p.name, version: p.version }),
        "skills/entry/SKILL.md": `---\nname: entry\ndescription: ${p.name} ${p.version}\n---\nBody`,
        "hooks/hooks.json": JSON.stringify({ hooks: {} }),
        "bin/compute.py": "print('fixture')\n",
      })) await zip.add(`${p.name}/${path}`, text);
      await zip.finish();
      return Buffer.concat(chunks);
    })());
    return this.archives.get(key)!;
  }

  async start() {
    this.server = createServer(async (req, res) => {
      const auth = req.headers.authorization === `Bearer ${TOKEN}`;
      this.requests.push({ path: req.url ?? "", auth });
      if (!auth) { res.writeHead(401, { "www-authenticate": "Bearer" }).end(); return; }
      if (req.url === "/flow/marketplace/marketplace.json") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          name: "perspicax",
          plugins: await Promise.all(this.plugins.map(async (p) => ({ name: p.name, version: p.version, source: {
            source: "archive",
            url: `${this.archiveOrigin || this.origin}/flow/marketplace/plugins/${p.name}-${p.version}.zip`,
            sha256: this.tamper ? "0".repeat(64) : createHash("sha256").update(await this.archive(p)).digest("hex"),
          } }))),
        }));
        return;
      }
      const found = this.plugins.find((p) => req.url === `/flow/marketplace/plugins/${p.name}-${p.version}.zip`);
      if (found) { res.writeHead(200).end(await this.archive(found)); return; }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  declaration(over: Partial<FlowPluginsDeclaration> = {}): FlowPluginsDeclaration {
    return flowPluginsSchema.parse({
      enabled: true,
      guard: "enforce",
      name: "perspicax",
      url: `${this.origin}/flow/marketplace/marketplace.json`,
      resource: `${this.origin}/flow/marketplace`,
      pack: `sha256:${"a".repeat(64)}`,
      plugins: this.plugins,
      ...over,
    });
  }
}

/** Every file under a folder, for "the token is never on disk". */
function allFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...allFiles(path));
    else out.push(path);
  }
  return out;
}

describe("Pulsatrix Flow for every member, from Perspicax's private marketplace", () => {
  let market: Marketplace;
  let data: string;
  let declaration: FlowPluginsDeclaration | undefined;
  let token: string | undefined;
  let tokenAsks: string[];
  let flow: OrgFlowPlugins;

  const calls = () => market.requests;

  beforeEach(async () => {
    market = new Marketplace();
    await market.start();
    market.plugins = [{ name: "pulsatrix-flow", version: "0.17.0", tenant: false }, { name: "pulsatrix-flow-acme", version: "0.1.21", tenant: true }];
    data = mkdtempSync(join(tmpdir(), "sagax-org-flow-"));
    declaration = market.declaration();
    token = TOKEN;
    tokenAsks = [];
    flow = new OrgFlowPlugins({
      dataDir: join(data, "sagax"),
      issuer: market.origin,
      declaration: () => declaration,
      token: async () => { tokenAsks.push("server-link"); return token; },
      isMember: (id) => id === "member",
      log: () => {},
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => market.server.close(resolve));
    rmSync(data, { recursive: true, force: true });
  });

  it("installs the product and the tenant once, with the server link token never on disk, and loads them for members only", async () => {
    const status = await flow.sync("sign-in");
    expect(status).toMatchObject({
      mode: "on",
      plugins: [
        { id: "pulsatrix-flow@perspicax", tenant: false, state: "installed", version: "0.17.0" },
        { id: "pulsatrix-flow-acme@perspicax", tenant: true, state: "installed", version: "0.1.21" },
      ],
    });
    expect(status.error).toBeUndefined();
    expect(tokenAsks).toEqual(["server-link"]);
    expect(market.requests.map((request) => request.path)).toEqual([
      "/flow/marketplace/marketplace.json",
      "/flow/marketplace/plugins/pulsatrix-flow-0.17.0.zip",
      "/flow/marketplace/plugins/pulsatrix-flow-acme-0.1.21.zip",
    ]);
    // every request carried the token; nothing reached it without
    expect(market.requests.every((r) => r.auth)).toBe(true);
    // the token is in no file Sagax or Claude Code wrote
    for (const file of allFiles(join(data, "sagax"))) expect(readFileSync(file, "utf8")).not.toContain(TOKEN);
    expect(existsSync(join(flow.root, "claude"))).toBe(false);
    expect(existsSync(join(flow.root, "headers-helper.cjs"))).toBe(false);

    // the sanitized copies load for a member, after the bot's own, never twice
    const dirs = flow.dirsFor("member", []);
    expect(dirs.map((d) => d.split("/").pop())).toEqual(["pulsatrix-flow", "pulsatrix-flow-acme"]);
    expect(existsSync(join(dirs[0]!, "skills", "entry", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dirs[0]!, "hooks"))).toBe(false);
    expect(existsSync(join(dirs[0]!, "bin", "compute.py"))).toBe(true);
    expect(flow.dirsFor("member", ["/bots/b1/pulsatrix-flow"]).map((d) => d.split("/").pop())).toEqual(["pulsatrix-flow-acme"]);
    expect(flow.dirsFor("someone-else", [])).toEqual([]);
    expect(flow.dirsFor(undefined, [])).toEqual([]);
  });

  it("is silent when up to date, and updates only what a new pack changed", async () => {
    await flow.sync("sign-in");
    const before = calls().length;
    const requests = market.requests.length;
    const again = await flow.sync("schedule");
    expect(again.mode).toBe("on");
    expect(again.plugins.every((p) => p.state === "installed")).toBe(true);
    expect(calls().length).toBe(before);
    expect(market.requests.length).toBe(requests);
    expect(tokenAsks).toEqual(["server-link"]);

    market.plugins = [{ name: "pulsatrix-flow", version: "0.17.1", tenant: false }, market.plugins[1]!];
    declaration = market.declaration({ pack: `sha256:${"b".repeat(64)}` });
    const updated = await flow.sync("directory");
    expect(updated.plugins.map((p) => [p.id, p.state, p.version])).toEqual([
      ["pulsatrix-flow@perspicax", "installed", "0.17.1"],
      ["pulsatrix-flow-acme@perspicax", "installed", "0.1.21"],
    ]);
    expect(market.requests.slice(before).map((request) => request.path)).toEqual([
      "/flow/marketplace/marketplace.json",
      "/flow/marketplace/plugins/pulsatrix-flow-0.17.1.zip",
    ]);
    expect(JSON.parse(readFileSync(join(flow.dirsFor("member", [])[0]!, ".claude-plugin", "plugin.json"), "utf8")).version).toBe("0.17.1");
  });

  it("says why in words when it cannot install, and keeps the copy it has", async () => {
    token = undefined;
    const nobody = await flow.sync("start");
    expect(nobody.mode).toBe("on");
    expect(nobody.error).toMatch(/server link is unavailable/);
    expect(nobody.plugins.every((p) => p.state === "pending")).toBe(true);
    expect(calls()).toEqual([]);

    token = TOKEN;
    await flow.sync("sign-in");
    market.plugins = [{ name: "pulsatrix-flow", version: "0.18.0", tenant: false }, market.plugins[1]!];
    declaration = market.declaration({ pack: `sha256:${"c".repeat(64)}` });
    token = "pxat1.revoked-link";
    const refused = await flow.sync("directory");
    expect(refused.error).toMatch(/could not be read: .*401/);
    expect(JSON.stringify(refused)).not.toContain("pxat1.revoked-link");
    // the copy already installed still loads
    expect(flow.dirsFor("member", []).length).toBe(2);

    token = TOKEN;
    market.tamper = true;
    const tampered = await flow.sync("schedule");
    expect(tampered.plugins[0]).toMatchObject({ id: "pulsatrix-flow@perspicax", state: "failed" });
    expect(tampered.plugins[0]!.error).toMatch(/integrity check failed/);

    market.tamper = false;
    const noCli = new OrgFlowPlugins({ dataDir: join(data, "other"), issuer: market.origin, declaration: () => declaration, token: async () => TOKEN, isMember: () => true, log: () => {} });
    expect((await noCli.sync("start")).plugins.every((plugin) => plugin.state === "installed")).toBe(true);

  });

  it("never sends a token to a marketplace that is not Perspicax's", async () => {
    declaration = market.declaration({ url: "https://elsewhere.example.test/flow/marketplace/marketplace.json" });
    const status = await flow.sync("directory");
    expect(status.error).toMatch(/not served by Perspicax/);
    declaration = market.declaration({ resource: `${market.origin}/mcp` });
    expect((await flow.sync("directory")).error).toMatch(/token audience/);
    expect(tokenAsks).toEqual([]);
    expect(calls()).toEqual([]);
  });

  it("refuses an off-origin archive before sending the link token", async () => {
    market.archiveOrigin = "https://other.example.test";
    const status = await flow.sync("start");
    expect(status.plugins.every((plugin) => plugin.state === "failed")).toBe(true);
    expect(status.error).toContain("not served by this Flow marketplace");
    expect(market.requests.map((request) => request.path)).toEqual(["/flow/marketplace/marketplace.json"]);
    expect(flow.dirsFor("member", [])).toEqual([]);
  });

  it("takes everything out when the admin turns it off, and waits on an older Perspicax", async () => {
    await flow.sync("sign-in");
    expect(existsSync(flow.root)).toBe(true);
    declaration = market.declaration({ enabled: false, plugins: [], pack: undefined });
    const off = await flow.sync("directory");
    expect(off).toMatchObject({ mode: "off", plugins: [] });
    expect(existsSync(flow.root)).toBe(false);
    expect(flow.dirsFor("member", [])).toEqual([]);
    declaration = undefined;
    expect((await flow.sync("directory")).mode).toBe("unknown");
  });

  it("installs and loads nothing unless Perspicax enforces the Flow guard on every write", async () => {
    // the copy here has no hooks: the guard is Perspicax's (server guard)
    await flow.sync("sign-in");
    expect(flow.dirsFor("member", []).length).toBe(2);
    const before = calls().length;

    // a Perspicax that does not say it enforces (older, off or shadow)
    for (const guard of [undefined, "shadow", "off"]) {
      declaration = market.declaration({ guard });
      expect(flow.dirsFor("member", [])).toEqual([]);
    }
    declaration = market.declaration({ guard: "shadow" });
    const shadow = await flow.sync("directory");
    expect(shadow).toMatchObject({ mode: "off", plugins: [] });
    expect(existsSync(flow.root)).toBe(false);

    // held back because a profile that can write is not linked to Flow
    declaration = market.declaration({ enabled: false, plugins: [], pack: undefined, reason: "flow_guard_uncovered" });
    const held = await flow.sync("directory");
    expect(held).toMatchObject({ mode: "off", plugins: [], reason: "flow_guard_uncovered" });
    expect(flow.dirsFor("member", [])).toEqual([]);
    // no command ran and no token was asked for any of it
    expect(calls().length).toBe(before);
    expect(tokenAsks).toEqual(["server-link"]);
  });
});
