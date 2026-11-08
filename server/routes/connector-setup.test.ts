import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAC_FULL_DISK_ACCESS_URL, type ConnectorSetupView } from "../../shared/connector-setup.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { connectorSetupOwner, createConnectorSetupInternalRoutes, createConnectorSetupProofs, createConnectorSetupRoutes, type ConnectorSetupContext, type ConnectorSetupProofs } from "./connector-setup.ts";
import { PASS } from "./table.ts";

interface Row { id: string; kind: string; at: number; text?: string; connectorSetup?: ConnectorSetupView; tool?: { name: string; ok?: boolean; input?: string } }

let server: Server;
let base = "";
let rows: Row[] = [];
let speaker: string | undefined = "pr_a";
let caller: string | undefined = "pr_a";
let context: ConnectorSetupContext | null;
let claudeInventory: Array<{ name: string; status: string }> | null = null;
let claudeReads = 0;
let clock = 1_000;
let proofs: ConnectorSetupProofs;
let grokReach: Record<string, { connectors: string[]; at: number; elsewhere?: { engine: string; connectors: string[] }; account?: "personal" | "team" }> = {};
let signInCards: string[] = [];
let signInEngine: string | null = null;
let macAccess = false;

beforeEach(async () => {
  rows = [];
  speaker = "pr_a";
  caller = "pr_a";
  context = { engine: "grok", account: "own" };
  claudeInventory = null;
  claudeReads = 0;
  clock = 1_000;
  proofs = createConnectorSetupProofs();
  grokReach = {};
  signInCards = [];
  signInEngine = null;
  macAccess = false;
  let seq = 0;
  const shared = {
    cards: (threadId: string) => threadId === "t1"
      ? rows.filter((row) => row.connectorSetup).map((row) => ({ messageId: row.id, view: row.connectorSetup! }))
      : [],
    proofs: () => proofs,
    botOf: (threadId: string) => threadId === "t1" ? "b1" : undefined,
    patch: (_threadId: string, messageId: string, view: ConnectorSetupView) => {
      const row = rows.find((candidate) => candidate.id === messageId);
      if (row) row.connectorSetup = view;
    },
    now: () => clock,
    grokReach: (principalId: string) => grokReach[principalId],
  };
  const internal = createConnectorSetupInternalRoutes({
    ...shared,
    ownsThread: (botId) => botId === "b1",
    principal: () => speaker,
    context: () => context,
    post: ({ view, text }) => { rows.push({ id: `m${++seq}`, kind: "text", at: clock, text, connectorSetup: view }); },
    signIn: (_botId, _threadId, principalId) => { if (!signInEngine) return null; signInCards.push(principalId); return { engine: signInEngine }; },
    newId: () => `cs_${String(++seq).padStart(18, "0")}`,
  });
  const routes = createConnectorSetupRoutes({
    ...shared,
    principalId: () => caller,
    claudeConnectors: async () => { claudeReads += 1; return claudeInventory; },
    macAccess: () => macAccess,
  });
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname.startsWith("/api/internal/")) {
      const botId = String(req.headers["x-bot"] ?? "b1");
      void internal({ res, path: url.pathname, method: req.method ?? "GET", json, capability: { botId, threadId: "t1", generation: "g" }, readBody: () => readBody(req) as Promise<Record<string, unknown>> })
        .then((out) => { if (out === PASS && !res.headersSent) json(res, 404, { error: "pass" }); });
      return;
    }
    void routes({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "local" } as unknown as RequestAuth, json, readBody })
      .then((out) => { if (out === PASS && !res.headersSent) json(res, 404, { error: "pass" }); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const open = async (body: unknown, bot = "b1") => {
  const res = await fetch(`${base}/api/internal/connector-setup/open`, { method: "POST", headers: { "content-type": "application/json", "x-bot": bot }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const check = async (id: string, threadId = "t1") => {
  const res = await fetch(`${base}/api/connector-setup/${id}/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId }) });
  return { status: res.status, body: await res.json() as { view?: ConnectorSetupView; error?: string } };
};

describe("open_connector_setup (bot route)", () => {
  it("a Grok-engine bot on the person's own account: one card, grok.com, in the person's language", async () => {
    const out = await open({ connector: "Microsoft Teams", language: "fr" });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, route: "grok", label: "Microsoft Teams", status: "waiting" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe("Connectez Microsoft Teams sur [grok.com](https://grok.com/connectors).");
    expect(rows[0]!.connectorSetup).toMatchObject({ provider: "grok", url: "https://grok.com/connectors", status: "waiting", owner: connectorSetupOwner("pr_a") });
    // the card carries no person id
    expect(JSON.stringify(rows[0])).not.toContain("pr_a");
  });

  it("names the Grok account the connector goes on, team or personal (2026-10-30)", async () => {
    grokReach = { pr_a: { connectors: [], at: 500, account: "team" } };
    const out = await open({ connector: "Outlook", language: "fr" });
    expect(out.body).toMatchObject({ card: "posted", route: "grok" });
    expect(String(out.body.note)).toContain("team Grok account");
    expect(rows[0]!.connectorSetup).toMatchObject({ provider: "grok", account: "team", url: "https://grok.com/connectors" });
    expect(rows[0]!.text).toBe("Connectez Outlook sur [grok.com](https://grok.com/connectors), avec votre compte Grok d'équipe.");
  });

  it("asked twice in one conversation: the same card, not a second one", async () => {
    await open({ connector: "Teams" });
    const again = await open({ connector: "microsoft teams" });
    expect(again.body).toMatchObject({ ok: true, card: "existing" });
    expect(rows).toHaveLength(1);
  });

  it("a Claude bot: claude.ai connectors", async () => {
    context = { engine: "claude", account: "own" };
    const out = await open({ connector: "Outlook", language: "en" });
    expect(out.body).toMatchObject({ route: "claude" });
    expect(rows[0]!.connectorSetup?.url).toBe("https://claude.ai/customize/connectors");
  });

  it("refuses another person's engine account, with no card", async () => {
    context = { engine: "grok", account: "foreign" };
    const out = await open({ connector: "Teams" });
    expect(out.status).toBe(409);
    expect(String(out.body.error)).toMatch(/not the person's own/);
    expect(rows).toHaveLength(0);
  });

  it("refuses with no person in the turn, another bot's conversation, or no name", async () => {
    speaker = undefined;
    expect((await open({ connector: "Teams" })).status).toBe(403);
    speaker = "pr_a";
    expect((await open({ connector: "Teams" }, "b2")).status).toBe(403);
    expect((await open({ connector: "" })).status).toBe(400);
    expect((await open({ connector: "Teams", via: "somewhere" })).status).toBe(400);
  });
});

describe("proofs recorded as calls settle", () => {
  it("keeps only successful calls of a person's turn, bounded per conversation, with the person as a digest", () => {
    const ledger = createConnectorSetupProofs({ perThread: 3 });
    ledger.record({ threadId: "t1", botId: "b1", principalId: undefined, name: "mcp__x__y", ok: true, at: 1 });
    ledger.record({ threadId: "t1", botId: "b1", principalId: "pr_a", name: "mcp__x__y", ok: false, at: 1 });
    expect(ledger.list("t1")).toEqual([]);
    for (let at = 1; at <= 5; at += 1) ledger.record({ threadId: "t1", botId: "b1", principalId: "PR_A ", name: "mcp__x__y", ok: true, at });
    expect(ledger.list("t1").map((proof) => proof.at)).toEqual([3, 4, 5]);
    expect(ledger.list("t1")[0]!.owner).toBe(connectorSetupOwner("pr_a"));
    expect(JSON.stringify(ledger.list("t1"))).not.toContain("pr_a");
  });
});

describe("the card's check (person route)", () => {
  it("Grok: pending until a call to that connector succeeds, then connected", async () => {
    await open({ connector: "Teams" });
    const id = rows[0]!.connectorSetup!.id;
    clock = 2_000;
    const first = await check(id);
    expect(first.status).toBe(200);
    expect(first.body.view).toMatchObject({ status: "pending", checkedAt: 2_000 });
    // another person's successful call in the same conversation proves nothing for this card
    proofs.record({ threadId: "t1", botId: "b1", principalId: "pr_b", name: "mcp__microsoft_teams__list_chats", ok: true, at: 2_500 });
    // nor a sign-in step of the card's person
    proofs.record({ threadId: "t1", botId: "b1", principalId: "pr_a", name: "mcp__microsoft_teams__authenticate", ok: true, at: 2_600 });
    clock = 2_700;
    expect((await check(id)).body.view?.status).toBe("pending");
    proofs.record({ threadId: "t1", botId: "b1", principalId: "pr_a", name: "use_tool", input: JSON.stringify({ tool_name: "microsoft_teams__list_chats" }), ok: true, at: 3_000 });
    clock = 4_000;
    expect((await check(id)).body.view?.status).toBe("connected");
    expect(rows[0]!.connectorSetup?.status).toBe("connected");
  });

  it("Grok: connected once a later turn of the person's own catalog carries it through grok's gateway (2026-10-28)", async () => {
    await open({ connector: "Teams" });
    const id = rows[0]!.connectorSetup!.id;
    // read before the card: no evidence; another person's reach: none either
    grokReach = { pr_a: { connectors: ["microsoft-teams"], at: 500 }, pr_b: { connectors: ["microsoft-teams"], at: 5_000 } };
    clock = 2_000;
    expect((await check(id)).body.view?.status).toBe("pending");
    grokReach.pr_a = { connectors: ["outlook"], at: 3_000 };
    expect((await check(id)).body.view?.status).toBe("pending");
    // a gateway call is proof as well
    proofs.record({ threadId: "t1", botId: "b1", principalId: "pr_a", name: "use_tool", input: JSON.stringify({ tool_name: "cursor__user-Outlook-list_5fmail_5fmessages___12" }), ok: true, at: 3_100 });
    expect((await check(id)).body.view?.status).toBe("pending");
    grokReach.pr_a = { connectors: ["outlook", "microsoft-teams"], at: 3_500 };
    expect((await check(id)).body.view?.status).toBe("connected");
  });

  it("Grok: no card when the person's Grok catalog already carries the connector", async () => {
    grokReach = { pr_a: { connectors: ["microsoft-teams"], at: 500 } };
    const out = await open({ connector: "Microsoft Teams" });
    expect(out.body).toMatchObject({ ok: true, route: "grok", status: "connected", card: "none" });
    expect(String(out.body.note)).toMatch(/already connected/);
    expect(rows).toHaveLength(0);
    // Outlook is not there: its card is posted
    expect((await open({ connector: "Outlook" })).body).toMatchObject({ card: "posted" });
  });

  it("Claude: reads the inventory again and says connected only when it shows it", async () => {
    context = { engine: "claude", account: "own" };
    await open({ connector: "Teams" });
    const id = rows[0]!.connectorSetup!.id;
    // a call is never proof for a Claude card, even the person's own
    proofs.record({ threadId: "t1", botId: "b1", principalId: "pr_a", name: "mcp__claude_ai_Microsoft_365__teams_list_chats", ok: true, at: 5_000 });
    claudeInventory = [{ name: "Microsoft 365", status: "needs_auth" }];
    expect((await check(id)).body.view?.status).toBe("pending");
    claudeInventory = [{ name: "Microsoft 365", status: "connected" }];
    expect((await check(id)).body.view?.status).toBe("connected");
    expect(claudeReads).toBe(2);
    // an unknown inventory is never "connected"
    rows[0]!.connectorSetup!.status = "waiting";
    claudeInventory = null;
    expect((await check(id)).body.view?.status).toBe("pending");
  });

  it("only the person the card is for checks it; anyone else gets the same 404 as an unknown card", async () => {
    await open({ connector: "Teams" });
    const id = rows[0]!.connectorSetup!.id;
    caller = "pr_b";
    expect((await check(id)).status).toBe(404);
    caller = undefined;
    expect((await check(id)).status).toBe(401);
    caller = "pr_a";
    expect((await check("cs_999999999999999999")).status).toBe(404);
    expect((await check(id, "t2")).status).toBe(404);
  });

  it("#2690: a Messages card is connected once this Mac gives Full Disk Access again", async () => {
    rows.push({ id: "m-mac", kind: "text", at: clock, text: "Messages", connectorSetup: {
      id: "cs_00000000000000000a", connector: "messages", label: "Messages", provider: "mac",
      url: MAC_FULL_DISK_ACCESS_URL, status: "waiting", owner: connectorSetupOwner("pr_a"), createdAt: clock,
    } });
    expect((await check("cs_00000000000000000a")).body).toMatchObject({ view: { status: "pending" } });
    macAccess = true;
    expect((await check("cs_00000000000000000a")).body).toMatchObject({ view: { status: "connected" } });
    expect(claudeReads).toBe(0);
  });

  it("the owner digest is opaque and stable", () => {
    const owner = connectorSetupOwner("pr_person");
    expect(owner).toMatch(/^[a-f0-9]{16}$/);
    expect(owner).not.toContain("person");
    expect(connectorSetupOwner(" PR_Person ")).toBe(owner);
  });
});

describe("2026-10-29: no account of their own, and the other Grok account", () => {
  it("posts the Connect Claude card when Claude takes a sign-in here, instead of refusing", async () => {
    context = { engine: "claude", account: "none" };
    signInEngine = "Claude";
    const out = await open({ connector: "Microsoft Teams" });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, route: "claude", card: "sign-in" });
    expect(String((out.body as { note: string }).note)).toContain("Connect Claude");
    expect(signInCards).toEqual(["pr_a"]);
    expect(rows).toHaveLength(0);
  });

  it("still refuses in words when no engine takes a sign-in", async () => {
    context = { engine: "other", account: "none" };
    const out = await open({ connector: "Microsoft Teams" });
    expect(out.status).toBe(409);
    expect(signInCards).toEqual([]);
  });

  it("a connector on the person's other Grok account: no card, the bot hands that part there", async () => {
    grokReach = { pr_a: { connectors: [], at: 500, elsewhere: { engine: "Grok (personal account)", connectors: ["microsoft-teams"] } } };
    const out = await open({ connector: "Teams" });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, route: "grok", status: "connected", card: "none" });
    expect(String((out.body as { note: string }).note)).toContain('run_with_engine with engine "Grok (personal account)"');
    expect(rows).toHaveLength(0);
  });
});
