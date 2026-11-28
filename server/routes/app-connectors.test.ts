// Connector calls from a chat app (R6). The hub is a fake: nothing here
// reaches a real connector, and person-b never calls with person-a's account.
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { ConnectorHub } from "../connectors/hub.ts";
import type { ConnectorAccount } from "../connectors/types.ts";
import { pageActVerdict } from "../pages/page-act-verdict.ts";
import { PageDataApprovals } from "../pages/page-data-approvals.ts";
import { CustomRuleStore } from "../rules/custom-rules-store.ts";
import { createAppConnectorRoutes, type AppConnectorMessage, type AppConnectorRouteDeps } from "./app-connectors.ts";
import type { RouteContext } from "./table.ts";

const NOW = 1_800_000_000_000;
const HTML = '<script type="application/sagax-capabilities+json">{"connectors":{"GitHub":["search_issues","create_issue"]}}</script><p>board</p>';
const SEARCH_ONLY = '<script type="application/sagax-capabilities+json">{"connectors":{"GitHub":["search_issues"]}}</script><p>board</p>';

const as = (principalId: string | null, act = false) => ({ kind: "session", via: "cookie", scopes: ["client"], session: { principalId, ...(act ? { ephemeral: true, label: "Bot act" } : {}) } }) as unknown as RequestAuth;

const accountOf = (who: string) => ({
  provider: "chatgpt-apps", instanceId: "i", slot: 0, key: `k-${who}`, label: `${who} account`, auth: "signed-in", at: 1,
  connectors: [{ name: "GitHub", state: "connected", tools: [{ id: "search_issues" }, { id: "create_issue" }] }],
}) as unknown as ConnectorAccount;

function world(options: { rule?: "deny" | "ask"; mayRead?: string[]; html?: string; room?: boolean; fromBot?: string } = {}) {
  const hubCall = vi.fn(async (input: { principalId: string; account: ConnectorAccount; tool: string }) => ({ text: `${input.tool} for ${input.principalId} on ${input.account.label}` }));
  const hub = { callable: () => true, ruleTool: (_p: unknown, entry: { name: string }, tool: string) => `${entry.name}__${tool}`, outbound: (id: string) => id.endsWith("create_issue"), call: hubCall } as unknown as ConnectorHub;
  const dir = mkdtempSync(join(tmpdir(), "app-connectors-"));
  dirs.push(dir);
  const rules = new CustomRuleStore(join(dir, "rules.json"), () => NOW);
  if (options.rule) rules.addOrgRule({ when: "utiliser l'outil GitHub__create_issue", behavior: options.rule });
  if (options.rule) rules.addOrgRule({ when: "utiliser l'outil GitHub__search_issues", behavior: options.rule });
  const approvals = new PageDataApprovals(null, () => NOW, () => rules.orgPolicy().alwaysAllow);
  const readers = new Set(options.mayRead ?? ["person-a", "person-b"]);
  const message: AppConnectorMessage = { id: "m1", kind: "app", app: { v: 1, html: options.html ?? HTML }, ...(options.fromBot ? { from: { botId: options.fromBot } } : {}) };
  const deps: AppConnectorRouteDeps = {
    bot: (id) => (id === "bot-a" ? { id: "bot-a", threadId: "thread-a", tasks: [{ threadId: "task-a" }] } : null),
    room: () => options.room === true,
    messages: (threadId) => (threadId === "thread-a" || threadId === "task-a" ? [message] : []),
    mayRead: (_auth, _botId, _threadId) => {
      const id = ( _auth as { session: { principalId: string | null } }).session.principalId;
      return Boolean(id && readers.has(id));
    },
    reader: (auth) => {
      const id = (auth as { session: { principalId: string | null } }).session.principalId;
      return id ? { principalId: id, computerOwner: false } : null;
    },
    botAct: (auth) => (auth as { session: { ephemeral?: boolean } }).session.ephemeral === true,
    approvals,
    connectors: {
      principal: (viewer) => viewer.principalId ?? "",
      accounts: (principalId) => (principalId === "person-a" || principalId === "person-b" ? [accountOf(principalId)] : []),
      hub: () => hub,
      verdict: (viewer, input) => pageActVerdict({
        rules: rules.rulesOf(viewer.principalId ?? "", `bot-of-${viewer.principalId}`),
        call: { tool: input.tool, mcpTool: input.mcpTool, summary: input.summary, input: input.input, hints: { readOnly: input.readOnly } },
        botId: `bot-of-${viewer.principalId}`,
        level: "ask",
        keyed: false,
        home: "/tmp/grok-live-pages-connectors",
      }),
      journal: vi.fn(),
    },
  };
  return { routes: createAppConnectorRoutes(deps), hubCall, approvals };
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function call(routes: ReturnType<typeof createAppConnectorRoutes>, auth: RequestAuth, path: string, body: unknown) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const url = new URL(`http://x${path}`);
  const context = {
    req: { headers: {} } as unknown as IncomingMessage,
    res: { setHeader() {} } as unknown as ServerResponse,
    url,
    path: url.pathname,
    method: "POST",
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  await routes(context);
  return { status: sent[0]?.status, body: sent[0]?.body as Record<string, unknown> };
}

const A = as("person-a");
const B = as("person-b");
const read = { threadId: "thread-a", connector: "GitHub", tool: "search_issues", arguments: { q: "bug" } };
const change = { threadId: "thread-a", connector: "GitHub", tool: "create_issue", arguments: { title: "x" } };

describe("chat app connector calls", () => {
  it("refuses a tool the stored page does not declare, and never calls the hub", async () => {
    const { routes, hubCall } = world({ html: SEARCH_ONLY });
    const denied = await call(routes, B, "/api/bots/bot-a/apps/m1/connector", { ...change, connectors: { GitHub: ["create_issue"] } });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("not_declared");
    expect(hubCall).not.toHaveBeenCalled();
  });

  it("runs a read on the viewer's own account", async () => {
    const { routes, hubCall } = world();
    const done = await call(routes, B, "/api/bots/bot-a/apps/m1/connector", read);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ connector: "GitHub", account: "person-b account", tool: "search_issues" });
    expect(hubCall.mock.calls[0]![0]).toMatchObject({ principalId: "person-b" });
    expect(JSON.stringify(hubCall.mock.calls)).not.toContain("person-a");
  });

  it("refuses a change that did not come from a click", async () => {
    const { routes, hubCall } = world();
    const denied = await call(routes, B, "/api/bots/bot-a/apps/m1/connector", change);
    expect(denied.status).toBe(400);
    expect(denied.body.code).toBe("bad_request");
    expect(hubCall).not.toHaveBeenCalled();
  });

  it("asks first, then runs the change once the viewer allows it", async () => {
    const { routes, hubCall } = world();
    const asked = await call(routes, B, "/api/bots/bot-a/apps/m1/connector", { ...change, click: true });
    expect(asked.status).toBe(409);
    expect(asked.body).toMatchObject({ code: "ask_first", source: "connector:GitHub__create_issue" });
    expect(hubCall).not.toHaveBeenCalled();
    const id = String(asked.body.approvalId);
    expect((await call(routes, A, `/api/bots/bot-a/apps/m1/approvals/${id}`, { threadId: "thread-a", answer: "once" })).status).toBe(404);
    expect((await call(routes, as("person-b", true), `/api/bots/bot-a/apps/m1/approvals/${id}`, { threadId: "thread-a", answer: "once" })).body.code).toBe("person_only");
    expect((await call(routes, B, `/api/bots/bot-a/apps/m1/approvals/${id}`, { threadId: "thread-a", answer: "once" })).status).toBe(200);
    expect((await call(routes, B, "/api/bots/bot-a/apps/m1/connector", { ...change, click: true })).status).toBe(200);
    expect(hubCall).toHaveBeenCalledTimes(1);
    expect(hubCall.mock.calls[0]![0]).toMatchObject({ principalId: "person-b" });
  });

  it("applies an organization refusal before any call", async () => {
    const { routes, hubCall } = world({ rule: "deny" });
    const denied = await call(routes, B, "/api/bots/bot-a/apps/m1/connector", read);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: "denied", reason: "org_rule" });
    expect(hubCall).not.toHaveBeenCalled();
  });

  it("hides the app from a viewer who cannot read the thread, and does not use the owner's account", async () => {
    const { routes, hubCall } = world({ mayRead: ["person-a"] });
    const hidden = await call(routes, B, "/api/bots/bot-a/apps/m1/connector", read);
    expect(hidden.status).toBe(404);
    expect(hidden.body.code).toBe("not_found");
    expect(hubCall).not.toHaveBeenCalled();
    expect(JSON.stringify(hidden.body)).not.toContain("person-a");
  });

  it("refuses a room, a missing app, and a page posted by another bot", async () => {
    expect((await call(world({ room: true }).routes, A, "/api/bots/bot-a/apps/m1/connector", read)).body.code).toBe("not_allowed");
    expect((await call(world().routes, A, "/api/bots/bot-a/apps/missing/connector", read)).body.code).toBe("not_found");
    expect((await call(world({ fromBot: "bot-other" }).routes, A, "/api/bots/bot-a/apps/m1/connector", read)).body.code).toBe("not_found");
    expect((await call(world().routes, as(null), "/api/bots/bot-a/apps/m1/connector", read)).body.code).toBe("sign_in");
  });
});
