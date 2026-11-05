// Browse Bots through the route table, on a real HTTP server, with an
// in-memory organisation behind it: who sees which bot, who may publish
// or feature one, and what an import copies and records.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { botLevel, type Level } from "../auth/authz.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import type { BotCatalogDetail, BotCatalogListing, BotCatalogResponse } from "../../shared/bot-catalog.ts";
import { catalogSource, createBotCatalogRoutes, memberImportReset, type CatalogAuditRow, type CatalogBot } from "./bot-catalog.ts";
import { dispatchRoutes } from "./table.ts";

const ANA = "pr_00000000-0000-4000-8000-00000000000a";
const BEN = "pr_00000000-0000-4000-8000-00000000000b";
const ADMIN = "pr_00000000-0000-4000-8000-0000000000ad";
const READER = "pr_00000000-0000-4000-8000-0000000000ee";

interface FakeBot extends CatalogBot {
  grants: Array<{ target: string; level: Level }>;
  /** Stand-in for the record's run settings, copied like the console clone. */
  settings?: Record<string, unknown>;
}

const look = { color: "blue" as const, avatarUrl: null };
function bot(id: string, owner: string, extra: Partial<FakeBot> = {}): FakeBot {
  return { id, name: id, title: "", description: `${id} bot`, look, ownerPrincipalId: owner, archived: false, primary: false, grants: [], ...extra };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve(options: { organization?: boolean; bots?: FakeBot[] } = {}) {
  const organization = options.organization ?? true;
  const bots: FakeBot[] = options.bots ?? [];
  const audits: CatalogAuditRow[] = [];
  const clones: Array<{ from: string; owner: string; name?: string; asMember: boolean }> = [];
  const viewerOf = (auth: RequestAuth) => auth.kind === "session" ? auth.session.principalId ?? "" : "";
  const routes = [createBotCatalogRoutes({
    organization: () => organization,
    bots: () => bots,
    viewer: (auth) => {
      const principalId = viewerOf(auth);
      if (!principalId) return null;
      return { principalId, admin: principalId === ADMIN, canCreate: true, botsReadOnly: principalId === READER };
    },
    level: (auth, botId) => {
      const found = bots.find((candidate) => candidate.id === botId)!;
      const principalId = viewerOf(auth);
      return botLevel({ viewer: { principalId, orgAdmin: principalId === ADMIN, teams: [], disabled: false }, ownerPrincipalId: found.ownerPrincipalId,
        grants: found.grants.map((grant) => ({ ...grant, by: found.ownerPrincipalId, at: 0 })), sections: [] });
    },
    personName: (principalId) => ({ [ANA]: "Ana", [BEN]: "Ben", [ADMIN]: "Ada" } as Record<string, string>)[principalId] ?? "",
    detail: (botId, { memories }) => ({
      soul: `You are ${botId}.`,
      memories: memories ? [`${botId} knows a fact`] : null,
      skills: [{ name: "triage", description: "Sort the inbox" }],
      routines: [{ name: "Morning digest", schedule: { type: "daily", time: "08:00", weekdays: [0, 1, 2, 3, 4, 5, 6] }, enabled: true }],
      integrations: [{ name: "github", kind: "mcp" }],
    }),
    setListing: (botId, listing: BotCatalogListing | null) => {
      const found = bots.find((candidate) => candidate.id === botId)!;
      if (listing) found.catalog = listing;
      else delete found.catalog;
    },
    clone: async (botId, input) => {
      clones.push({ from: botId, owner: input.ownerPrincipalId, ...(input.name ? { name: input.name } : {}), asMember: input.asMember });
      const source = bots.find((candidate) => candidate.id === botId)!;
      // a remote (url) MCP server is named remote-* in these fixtures
      const keep = input.ownSource ? { mcpServers: source.settings?.mcpServers as string[] | undefined, remote: (name: string) => name.startsWith("remote-") } : undefined;
      const copy = bot(`copy-${clones.length}`, input.ownerPrincipalId, { settings: { ...source.settings, ...(input.asMember ? memberImportReset(keep) : {}) } });
      bots.push(copy);
      return copy.id;
    },
    audit: (_auth, row) => audits.push(row),
    now: () => 1_000,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const principalId = req.headers["x-viewer"];
    const auth = (typeof principalId === "string"
      ? { kind: "session", scopes: principalId === ADMIN ? ["admin", "client"] : ["client"], session: { id: "s", principalId, label: principalId } }
      : { kind: "loopback", trust: "service", scopes: ["admin", "client"] }) as unknown as RequestAuth;
    try {
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline routes" });
    } catch (error) {
      json(res, (error as { status?: number }).status ?? 500, { error: String(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (viewer: string | null, path: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", ...(viewer ? { "x-viewer": viewer } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    return { status: response.status, body: await response.json() as any };
  };
  return { call, bots, audits, clones };
}

const organisation = () => [
  bot("ana-private", ANA),
  bot("ana-archived", ANA, { archived: true }),
  bot("ben-private", BEN),
  bot("ben-shared", BEN, { grants: [{ target: `user:${ANA}`, level: "use" }] }),
  bot("ben-published", BEN, { catalog: { published: true, category: "sales", publishedBy: BEN } }),
  bot("ben-published-archived", BEN, { archived: true, catalog: { published: true } }),
];

describe("catalogSource", () => {
  it("is mine, shared, published, or nothing", () => {
    expect(catalogSource({ archived: true }, "owner", true)).toBe("mine");
    expect(catalogSource({ archived: false }, "use", true)).toBe("shared");
    expect(catalogSource({ archived: true }, "use", true)).toBeNull();
    expect(catalogSource({ archived: false, catalog: { published: true } }, null, true)).toBe("organization");
    expect(catalogSource({ archived: false, catalog: { published: false } }, null, true)).toBeNull();
    expect(catalogSource({ archived: false }, null, true)).toBeNull();
    // a solo server: own bots only
    expect(catalogSource({ archived: false, catalog: { published: true } }, null, false)).toBeNull();
    expect(catalogSource({ archived: false }, "use", false)).toBeNull();
  });
});

describe("/api/bot-catalog", () => {
  it("lists a member's own bots (archived flagged), shared and published ones, never another person's private bot", async () => {
    const { call } = await serve({ bots: organisation() });
    const { status, body } = await call(ANA, "/api/bot-catalog");
    expect(status).toBe(200);
    const listed = body as BotCatalogResponse;
    expect(listed.organization).toBe(true);
    expect(listed.viewer).toEqual({ principalId: ANA, admin: false, canCreate: true });
    expect(listed.entries.map((entry) => [entry.id, entry.source, entry.archived])).toEqual([
      ["ana-private", "mine", false],
      ["ana-archived", "mine", true],
      ["ben-shared", "shared", false],
      ["ben-published", "organization", false],
    ]);
    const published = listed.entries.find((entry) => entry.id === "ben-published")!;
    expect(published.owner).toEqual({ principalId: BEN, name: "Ben" });
    expect(published.catalog).toEqual({ published: true, category: "sales", publishedBy: BEN });
  });

  it("gives an admin no other person's private bot either", async () => {
    const { call } = await serve({ bots: organisation() });
    const ids = ((await call(ADMIN, "/api/bot-catalog")).body as BotCatalogResponse).entries.map((entry) => entry.id);
    expect(ids).toEqual(["ben-published"]);
    expect((await call(ADMIN, "/api/bot-catalog/ben-private")).status).toBe(404);
  });

  it("lists only the owner's bots on a solo server, and hides the published flag there", async () => {
    const { call } = await serve({ organization: false, bots: [bot("mine", ANA, { catalog: { published: true } }), bot("other", BEN)] });
    const listed = (await call(ANA, "/api/bot-catalog")).body as BotCatalogResponse;
    expect(listed.organization).toBe(false);
    expect(listed.entries.map((entry) => entry.id)).toEqual(["mine"]);
    expect(listed.entries[0]!.catalog).toBeUndefined();
    expect((await call(ANA, "/api/bot-catalog/mine/listing", { method: "PUT", body: { published: true } })).status).toBe(409);
  });

  it("refuses a request with no person behind it", async () => {
    const { call } = await serve({ bots: organisation() });
    expect((await call(null, "/api/bot-catalog")).status).toBe(403);
  });

  it("shows the detail read only, with memories only to the owner and the people it is shared with", async () => {
    const { call } = await serve({ bots: organisation() });
    const shared = (await call(ANA, "/api/bot-catalog/ben-shared")).body as BotCatalogDetail;
    expect(shared.entry.source).toBe("shared");
    expect(shared.soul).toBe("You are ben-shared.");
    expect(shared.memories).toEqual(["ben-shared knows a fact"]);
    expect(shared.skills).toEqual([{ name: "triage", description: "Sort the inbox" }]);
    expect(shared.routines).toEqual([{ name: "Morning digest", schedule: { type: "daily", time: "08:00", weekdays: [0, 1, 2, 3, 4, 5, 6] }, enabled: true }]);
    const published = (await call(ANA, "/api/bot-catalog/ben-published")).body as BotCatalogDetail;
    expect(published.memories).toBeNull();
    expect((await call(ANA, "/api/bot-catalog/ben-private")).status).toBe(404);
    expect((await call(ANA, "/api/bot-catalog/ben-published-archived")).status).toBe(404);
    expect((await call(ANA, "/api/bot-catalog/nope")).status).toBe(404);
  });

  it("is member scope, every rule checked in the handler", () => {
    expect(requiredScope("GET", "/api/bot-catalog")).toBe("client");
    expect(requiredScope("GET", "/api/bot-catalog/b1")).toBe("client");
    expect(requiredScope("PUT", "/api/bot-catalog/b1/listing")).toBe("client");
    expect(requiredScope("POST", "/api/bot-catalog/b1/import")).toBe("client");
    expect(requiredScope("DELETE", "/api/bot-catalog/b1")).toBe("admin");
    expect(requiredScope("POST", "/api/bot-catalog/b1/listing")).toBe("admin");
  });
});

describe("publishing to the organisation catalogue", () => {
  it("lets the owner publish and withdraw, audited, and keeps the bot out of others' lists once withdrawn", async () => {
    const { call, audits } = await serve({ bots: organisation() });
    const published = await call(ANA, "/api/bot-catalog/ana-private/listing", { method: "PUT", body: { published: true, category: "  Engineering " } });
    expect(published).toEqual({ status: 200, body: { catalog: { published: true, category: "engineering", publishedAt: 1_000, publishedBy: ANA } } });
    expect(((await call(BEN, "/api/bot-catalog")).body as BotCatalogResponse).entries.find((entry) => entry.id === "ana-private")?.source).toBe("organization");
    expect((await call(ANA, "/api/bot-catalog/ana-private/listing", { method: "PUT", body: { published: false } })).body).toEqual({ catalog: null });
    expect(((await call(BEN, "/api/bot-catalog")).body as BotCatalogResponse).entries.some((entry) => entry.id === "ana-private")).toBe(false);
    expect(audits.map((row) => [row.action, row.target.id])).toEqual([["bot.catalog_publish", "ana-private"], ["bot.catalog_unpublish", "ana-private"]]);
  });

  it("refuses someone who neither owns the bot nor administers the organisation, even when it is shared with them", async () => {
    const { call, audits } = await serve({ bots: organisation() });
    expect((await call(ANA, "/api/bot-catalog/ben-shared/listing", { method: "PUT", body: { published: true } })).body.error).toBe("catalog_owner_only");
    expect((await call(ANA, "/api/bot-catalog/ben-published/listing", { method: "PUT", body: { published: false } })).body.error).toBe("catalog_owner_only");
    expect(audits).toEqual([]);
  });

  it("lets only an admin feature a bot, and an admin unpublish anyone's published bot", async () => {
    const { call, audits, bots } = await serve({ bots: organisation() });
    expect((await call(BEN, "/api/bot-catalog/ben-published/listing", { method: "PUT", body: { published: true, featured: true } })).body.error).toBe("catalog_feature_admin");
    const featured = await call(ADMIN, "/api/bot-catalog/ben-published/listing", { method: "PUT", body: { published: true, featured: true } });
    expect(featured.body.catalog).toMatchObject({ published: true, category: "sales", featured: true, publishedBy: BEN });
    // the owner may change the category and keep the admin's feature
    expect((await call(BEN, "/api/bot-catalog/ben-published/listing", { method: "PUT", body: { published: true, featured: true, category: "Field sales" } })).body.catalog)
      .toMatchObject({ category: "Field sales", featured: true });
    expect((await call(ADMIN, "/api/bot-catalog/ben-published/listing", { method: "PUT", body: { published: false } })).status).toBe(200);
    expect(bots.find((candidate) => candidate.id === "ben-published")!.catalog).toBeUndefined();
    expect(audits.map((row) => [row.action, row.changed])).toEqual([
      ["bot.catalog_update", ["featured"]],
      ["bot.catalog_update", ["category"]],
      ["bot.catalog_unpublish", ["catalog"]],
    ]);
  });

  it("refuses an archived bot and a malformed body", async () => {
    const { call } = await serve({ bots: organisation() });
    expect((await call(ANA, "/api/bot-catalog/ana-archived/listing", { method: "PUT", body: { published: true } })).status).toBe(409);
    expect((await call(ANA, "/api/bot-catalog/ana-private/listing", { method: "PUT", body: { published: "yes" } })).status).toBe(400);
    expect((await call(ANA, "/api/bot-catalog/ana-private/listing", { method: "PUT", body: { published: true, owner: BEN } })).status).toBe(400);
    expect((await call(ANA, "/api/bot-catalog/ana-private/listing", { method: "POST", body: { published: true } })).status).toBe(405);
  });
});

describe("importing a bot from the catalogue", () => {
  it("copies a published or shared bot for the viewer and records it", async () => {
    const { call, clones, audits } = await serve({ bots: organisation() });
    expect(await call(ANA, "/api/bot-catalog/ben-published/import", { method: "POST", body: {} })).toEqual({ status: 201, body: { botId: "copy-1" } });
    expect(await call(ANA, "/api/bot-catalog/ben-shared/import", { method: "POST", body: { name: "My helper" } })).toEqual({ status: 201, body: { botId: "copy-2" } });
    expect(clones).toEqual([{ from: "ben-published", owner: ANA, asMember: true }, { from: "ben-shared", owner: ANA, name: "My helper", asMember: true }]);
    expect(audits.map((row) => [row.action, row.target.id, row.after])).toEqual([
      ["bot.catalog_import", "copy-1", { from: "ben-published", source: "organization", ownerPrincipalId: ANA, memberDefaults: true }],
      ["bot.catalog_import", "copy-2", { from: "ben-shared", source: "shared", ownerPrincipalId: ANA, memberDefaults: true }],
    ]);
    // the copy is the viewer's own
    expect(((await call(ANA, "/api/bot-catalog")).body as BotCatalogResponse).entries.filter((entry) => entry.id.startsWith("copy-")).map((entry) => entry.source)).toEqual(["mine", "mine"]);
  });

  const hostSettings = {
    modelSelection: { instanceId: "claude", model: "opus" }, soul: "You sell.", skills: ["pricing"], perspicax: { profiles: ["cw-psa"] },
    computer: "local", browser: true, browserProfile: "work", mcpServers: ["filesystem", "remote-github"], alwaysAllow: ["Bash"], cwd: "/srv/sales",
    cloudBackend: "vps", autoStartVps: true,
  };

  it("keeps a member's computer, browser and Always allow on their copy; drops what stays an admin's on the shared server", async () => {
    const { call, bots } = await serve({ bots: [bot("ben-published", BEN, { catalog: { published: true }, settings: hostSettings })] });
    const { body } = await call(ANA, "/api/bot-catalog/ben-published/import", { method: "POST", body: {} });
    expect(bots.find((candidate) => candidate.id === body.botId)!.settings).toEqual({
      modelSelection: { instanceId: "claude", model: "opus" }, soul: "You sell.", skills: ["pricing"], perspicax: { profiles: ["cw-psa"] },
      computer: "local", browser: true, alwaysAllow: ["Bash"],
      // another person's bot: no MCP server comes along, remote or not
      browserProfile: undefined, mcpServers: [], cwd: undefined, cloudBackend: "vps", autoStartVps: true,
    });
  });

  it("keeps the remote MCP servers of a member's copy of their own bot, never a stdio one", async () => {
    const { call, bots } = await serve({ bots: [bot("ana-own", ANA, { settings: hostSettings })] });
    const { body } = await call(ANA, "/api/bot-catalog/ana-own/import", { method: "POST", body: {} });
    expect(body.botId).toBeTruthy();
    expect(bots.find((candidate) => candidate.id === body.botId)!.settings).toMatchObject({
      mcpServers: ["remote-github"], computer: "local", browser: true, alwaysAllow: ["Bash"],
      browserProfile: undefined, cwd: undefined, cloudBackend: "vps", autoStartVps: true,
    });
  });

  it("keeps every setting on an organization admin's copy", async () => {
    const { call, bots, clones } = await serve({ bots: [bot("ben-published", BEN, { catalog: { published: true }, settings: hostSettings })] });
    const { body } = await call(ADMIN, "/api/bot-catalog/ben-published/import", { method: "POST", body: {} });
    expect(clones).toEqual([{ from: "ben-published", owner: ADMIN, asMember: false }]);
    expect(bots.find((candidate) => candidate.id === body.botId)!.settings).toEqual(hostSettings);
  });

  it("refuses a private bot of someone else, an archived published one, and a person limited to shared bots", async () => {
    const { call, clones } = await serve({ bots: [...organisation(), bot("ben-for-reader", BEN, { grants: [{ target: `user:${READER}`, level: "use" }] })] });
    expect((await call(ANA, "/api/bot-catalog/ben-private/import", { method: "POST", body: {} })).status).toBe(404);
    expect((await call(ANA, "/api/bot-catalog/ben-published-archived/import", { method: "POST", body: {} })).status).toBe(404);
    expect((await call(READER, "/api/bot-catalog/ben-for-reader/import", { method: "POST", body: {} })).body.error).toBe("org_bots_read_only");
    expect((await call(ANA, "/api/bot-catalog/ben-published/import", { method: "POST", body: { name: "" } })).status).toBe(400);
    expect((await call(ANA, "/api/bot-catalog/ben-published/import", { method: "POST", body: { owner: BEN } })).status).toBe(400);
    expect(clones).toEqual([]);
  });

  it("leaves other paths to the next handler", async () => {
    const { call } = await serve({ bots: organisation() });
    expect((await call(ANA, "/api/bot-catalog/ana-private/other")).body).toEqual({ from: "inline routes" });
  });
});
