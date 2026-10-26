// The organization's approval policy (server/custom-rules-org.ts): admin
// rules every member meets and cannot change, and "Toujours permettre" off
// for everyone (Grok Bot parity lot 1A, 2026-10-21).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { autoVerdict } from "./auto-approve.ts";
import { setOrgApprovalPolicySource, standingGrantsAllowed } from "./custom-rules-org.ts";
import { customRuleNotice, reviewCustomRules } from "./custom-rules-review.ts";
import { CustomRuleStore, registeredCustomRuleStore } from "./custom-rules-store.ts";
import { json, readBody } from "./harness/http.ts";
import { opsRoutes, type OpsDeps } from "./org-admin-ops.ts";
import { matchOwnerRule, ruleCoversExactScope, type OwnerRule } from "./owner-approval.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createCustomRuleRoutes } from "./routes/custom-rules.ts";
import { dispatchRoutes } from "./routes/table.ts";
import { alwaysAllowStepUp, approvalStepUp } from "./step-up-gate.ts";
import { fakeConsole } from "./testing/console-context.ts";
import { ruleTextDiff } from "../shared/custom-rules.ts";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  setOrgApprovalPolicySource(null);
});

function storeFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-org-rules-"));
  dirs.push(dir);
  return join(dir, "custom-approval-rules.json");
}

const READ_DOCS = { tool: "Read", paths: ["/Users/jc/Documents/a.txt"] };

describe("organization rules in the store", () => {
  it("restrict only, apply to every person and bot, survive a restart", () => {
    const file = storeFile();
    const store = new CustomRuleStore(file);
    expect(() => store.addOrgRule({ when: "la lecture de fichiers", behavior: "allow" as never })).toThrow(/asks first or refuses/);
    const rule = store.addOrgRule({ when: "la lecture de fichiers dans ~/Documents", behavior: "deny" });
    expect(rule).toMatchObject({ org: true, botId: null, behavior: "deny", enabled: true });
    store.add({ ownerId: "bob", botId: "bot-b", when: "la lecture de fichiers dans ~/Documents", behavior: "allow" });
    // bob's own allow loses to the organization's deny
    const { decision } = reviewCustomRules(store.rulesOf("bob", "bot-b"), READ_DOCS, "bot-b", "/Users/jc");
    expect(decision).toMatchObject({ kind: "deny", rule: { id: rule.id } });
    expect(customRuleNotice(decision)).toMatchObject({ outcome: "denied", org: true });
    // anyone's rules carry it; nobody owns it
    expect(store.rulesOf("alice").map((each) => each.id)).toEqual([rule.id]);
    expect(store.ownRulesOf("alice")).toEqual([]);
    expect(store.get("alice", rule.id)).toBeUndefined();
    // reload
    const again = new CustomRuleStore(file);
    expect(again.orgRules()).toHaveLength(1);
    expect(again.isOrgRule(rule.id)).toBe(true);
    // off, then removed
    again.updateOrgRule(rule.id, { enabled: false });
    expect(again.rulesOf("bob", "bot-b").some((each) => each.org)).toBe(false);
    expect(again.removeOrgRule(rule.id)?.id).toBe(rule.id);
    expect(again.orgRules()).toEqual([]);
  });

  it("an org ask beats a person's ask of the same words for the notice", () => {
    const store = new CustomRuleStore(storeFile());
    store.add({ ownerId: "bob", botId: null, when: "la lecture de fichiers", behavior: "ask" });
    store.addOrgRule({ when: "la lecture de fichiers", behavior: "ask" });
    const { decision } = reviewCustomRules(store.rulesOf("bob", "bot-b"), READ_DOCS, "bot-b", "/Users/jc");
    expect(customRuleNotice(decision)).toMatchObject({ outcome: "held", org: true });
  });

  it("Always allow off pauses the person's allow rules and is the live policy", () => {
    const store = new CustomRuleStore(storeFile());
    expect(registeredCustomRuleStore()).toBe(store);
    store.add({ ownerId: "bob", botId: "bot-b", when: "la lecture de fichiers dans ~/Documents", behavior: "allow" });
    expect(standingGrantsAllowed()).toBe(true);
    store.setOrgAlwaysAllow(false);
    expect(standingGrantsAllowed()).toBe(false);
    expect(store.rulesOf("bob", "bot-b")).toEqual([]);
    expect(store.ownRulesOf("bob")).toHaveLength(1);
    store.setOrgAlwaysAllow(true);
    expect(store.rulesOf("bob", "bot-b")).toHaveLength(1);
  });

  it("a file that cannot be read refuses standing grants", () => {
    const file = storeFile();
    writeFileSync(file, "{ not json");
    const store = new CustomRuleStore(file);
    expect(store.orgPolicy()).toEqual({ alwaysAllow: false });
    expect(standingGrantsAllowed()).toBe(false);
    expect(() => store.setOrgAlwaysAllow(true)).toThrow(/could not be read/);
  });
});

describe("Always allow off in the deciders", () => {
  it("autoVerdict: no saved command, gate rule or allow rule answers", () => {
    new CustomRuleStore(storeFile()).setOrgAlwaysAllow(false);
    expect(autoVerdict("ask", "Bash", { commandAllowed: true }).approve).toBeNull();
    expect(autoVerdict("ask", "mcp__cw__get", { sagaxGate: true, ruleAllowed: true }).approve).toBeNull();
    expect(autoVerdict("ask", "Read", { customRule: { behavior: "allow", id: "crule_1" } }).approve).toBeNull();
    // asks and denies still hold; Full still answers (a level, not a grant)
    expect(autoVerdict("full", "Read", { customRule: { behavior: "ask", id: "orule_1" } }).source).toBe("custom-rule-ask");
    expect(autoVerdict("full", "Read").source).toBe("full-access");
  });

  it("autoVerdict: unchanged while it is on", () => {
    new CustomRuleStore(storeFile());
    expect(autoVerdict("ask", "Bash", { commandAllowed: true }).source).toBe("command-allowlist");
    expect(autoVerdict("ask", "Read", { customRule: { behavior: "allow", id: "crule_1" } }).source).toBe("custom-rule");
  });

  it("matchOwnerRule: allow rules stop answering, deny rules still deny", () => {
    const rule = (behavior: OwnerRule["behavior"]): OwnerRule => ({ id: `r_${behavior}`, ownerId: "bob", botId: null, tool: "cw__get_ticket", scope: {}, behavior, description: "", createdAt: 0, updatedAt: 0 });
    const call = { ownerId: "bob", botId: "bot-b", tool: "mcp__cw__get_ticket", input: "{}" };
    const store = new CustomRuleStore(storeFile());
    expect(matchOwnerRule([rule("allow")], call)?.behavior).toBe("allow");
    store.setOrgAlwaysAllow(false);
    expect(matchOwnerRule([rule("allow")], call)).toBeUndefined();
    expect(matchOwnerRule([rule("allow"), rule("deny")], call)?.behavior).toBe("deny");
    // the exact-scope rules of acts, holds, proposals and kept sends too
    expect(ruleCoversExactScope(rule("allow"), "cw__get_ticket", {})).toBe(false);
    store.setOrgAlwaysAllow(true);
    expect(ruleCoversExactScope(rule("allow"), "cw__get_ticket", {})).toBe(true);
  });

  it("an organization Refuse rule refuses even an approved email draft", () => {
    expect(autoVerdict("ask", "send_email", { emailDraftApproved: true, customRule: { behavior: "deny", id: "orule_1" } }).source).toBe("custom-rule-deny");
    expect(autoVerdict("ask", "send_email", { emailDraftApproved: true, customRule: { behavior: "deny", id: "crule_1" } }).source).toBe("email-draft-approval");
  });

  it("the step-up gate refuses every answer that saves a grant", () => {
    new CustomRuleStore(storeFile()).setOrgAlwaysAllow(false);
    const base = { keys: {} as never, person: "bob", threadId: "t", requestId: "r", card: undefined, behavior: "allow", risks: [], stepUp: undefined };
    for (const answer of [{ always: true }, { rememberCommand: true }, { rule: "allow" as const }]) {
      expect(approvalStepUp({ ...base, answer })).toMatchObject({ status: 403, body: { code: "org_always_allow_off" } });
    }
    expect(alwaysAllowStepUp({ keys: {} as never, person: "bob", botId: "b", threadId: "t", requestId: "r", card: undefined, key: "mcp:x", risks: [], stepUp: undefined }))
      .toMatchObject({ status: 403, body: { code: "org_always_allow_off" } });
    // a deny never widens
    expect(approvalStepUp({ ...base, behavior: "deny", answer: { rule: "deny" } })).toBeNull();
  });
});

async function serveRules(person: string | null) {
  const store = new CustomRuleStore(storeFile());
  const routes = [createCustomRuleRoutes({
    store,
    manager: () => person,
    ownedBots: () => [{ id: "bot-b", name: "Beta" }],
    audit: () => {},
    home: "/Users/jc",
  })];
  const auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/custom-rules`;
  const call = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
  return { store, call };
}

describe("a member's rule routes", () => {
  it("list the organization's rules first, locked, with the policy", async () => {
    const { store, call } = await serveRules("bob");
    const org = store.addOrgRule({ when: "l'envoi de messages", behavior: "ask" });
    await call("", "POST", { when: "la lecture de fichiers dans ~/Documents", behavior: "allow", botId: "bot-b" });
    const listed = await call("?botId=bot-b");
    expect(listed.body.orgPolicy).toEqual({ alwaysAllow: true });
    expect(listed.body.rules.map((rule: { id: string; org?: boolean }) => [rule.id === org.id, rule.org ?? false])).toEqual([[true, true], [false, false]]);
    expect(await call(`/${org.id}`, "PATCH", { enabled: false })).toMatchObject({ status: 403, body: { code: "org_rule_locked" } });
    expect(await call(`/${org.id}`, "DELETE")).toMatchObject({ status: 403, body: { code: "org_rule_locked" } });
    expect(store.orgRules()[0]!.enabled).toBe(true);
    expect((await call("/policy")).body).toEqual({ alwaysAllow: true, orgRules: 1 });
  });

  it("save no allow rule while Always allow is off; asks and refusals still save", async () => {
    const { store, call } = await serveRules("bob");
    const ask = await call("", "POST", { when: "la lecture de fichiers dans ~/Documents", behavior: "ask", botId: "bot-b" });
    store.setOrgAlwaysAllow(false);
    expect(await call("", "POST", { when: "la lecture de fichiers dans ~/Images", behavior: "allow", botId: "bot-b" })).toMatchObject({ status: 403, body: { code: "org_always_allow_off" } });
    expect(await call(`/${ask.body.rule.id}`, "PATCH", { behavior: "allow" })).toMatchObject({ status: 403, body: { code: "org_always_allow_off" } });
    expect((await call("", "POST", { when: "la suppression de fichiers", behavior: "deny", botId: null })).status).toBe(201);
    expect((await call("/policy")).body).toMatchObject({ alwaysAllow: false });
  });

  it("are never a bot's", async () => {
    const { call } = await serveRules(null);
    expect((await call("/policy")).status).toBe(403);
  });
});

describe("the console's org-approvals routes", () => {
  function console() {
    const store = new CustomRuleStore(storeFile());
    const deps = { orgApprovals: store } as unknown as OpsDeps;
    return { store, console: fakeConsole(opsRoutes(deps)) };
  }

  it("add, change and remove an organization rule, audited", async () => {
    const { store, console: admin } = console();
    expect((await admin.call("POST", "org-approvals/rules", { body: { when: "la lecture de fichiers", behavior: "allow" } })).status).toBe(400);
    const added = await admin.call("POST", "org-approvals/rules", { body: { when: "la suppression de fichiers", behavior: "deny" } });
    expect(added).toMatchObject({ status: 201, body: { rule: { behavior: "deny", enabled: true, recognized: true } } });
    const id = added.body.rule.id as string;
    expect((await admin.call("POST", `org-approvals/rules/${id}`, { body: { behavior: "ask", enabled: false } })).body.rule).toMatchObject({ behavior: "ask", enabled: false });
    expect((await admin.call("POST", `org-approvals/rules/${id}`, { body: { behavior: "allow" } })).status).toBe(400);
    expect((await admin.call("GET", "org-approvals")).body).toMatchObject({ alwaysAllow: true, rules: [{ id, behavior: "ask" }] });
    expect((await admin.call("POST", `org-approvals/rules/${id}/remove`)).status).toBe(200);
    expect((await admin.call("POST", `org-approvals/rules/${id}/remove`)).status).toBe(404);
    expect(store.orgRules()).toEqual([]);
    expect(admin.records.map((row) => row.action)).toEqual(["org.approvals.rule.add", "org.approvals.rule.update", "org.approvals.rule.remove"]);
  });

  it("turns Always allow off and on", async () => {
    const { console: admin } = console();
    expect((await admin.call("POST", "org-approvals", { body: { alwaysAllow: "no" } })).status).toBe(400);
    expect((await admin.call("POST", "org-approvals", { body: { alwaysAllow: false } })).body).toMatchObject({ alwaysAllow: false });
    expect(standingGrantsAllowed()).toBe(false);
    expect(admin.records.at(-1)).toMatchObject({ category: "approval", action: "org.approvals.alwaysAllow", before: { alwaysAllow: true }, after: { alwaysAllow: false } });
    await admin.call("POST", "org-approvals", { body: { alwaysAllow: true } });
    expect(standingGrantsAllowed()).toBe(true);
  });
});

describe("ruleTextDiff", () => {
  it("marks words removed and added", () => {
    expect(ruleTextDiff("la lecture de fichiers dans ~/Documents", "la lecture de fichiers dans ~/Images")).toEqual([
      { text: "la lecture de fichiers dans ", kind: "same" },
      { text: "~/Documents", kind: "removed" },
      { text: "~/Images", kind: "added" },
    ]);
    expect(ruleTextDiff("a b", "a b")).toEqual([{ text: "a b", kind: "same" }]);
    expect(ruleTextDiff("", "x")).toEqual([{ text: "x", kind: "added" }]);
  });
});
