import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  cardRuleCandidate,
  destructiveKindOf,
  FOLDER_KEY,
  folderRuleCandidate,
  pathInFolder,
  matchOwnerRule,
  normalizeRuleTool,
  ownerDecision,
  ownerVerdictOver,
  ruleCandidateFor,
  ruleCoversExactScope,
  WHOLE_CALL_KEY,
  wholeCallDigest,
  APP_KEY,
  APP_RULE_TOOL,
  ruleInputFor,
  ruleScopeFor,
  scopeKeepable,
  type OwnerRule,
  type RuleCall,
} from "./owner-approval.ts";
import { OwnerApprovalStore } from "./owner-approval-store.ts";
import { autoVerdict } from "./auto-approve.ts";

const ALICE = "pr_alice";
const BOB = "pr_bob";
const CW_WRITE = "mcp__perspicax_quasar__cw_psa_write";
const ticketUpdate = JSON.stringify({ resource: "service/tickets/4512", operation: "update", body: { status: "In progress" } });
const scheduleCreate = JSON.stringify({ resource: "schedule/entries", operation: "create", body: {} });
const ticketDelete = JSON.stringify({ resource: "service/tickets/4512", operation: "delete" });
const bulkClose = JSON.stringify({ resource: "service/tickets", operation: "update", ids: [1, 2, 3], body: { status: "Closed" } });
const smsSend = JSON.stringify({ resource: "Accounts/AC1/Messages", operation: "create", body: { To: "+15550001111" } });

const call = (input: string, extra: Partial<RuleCall> = {}): RuleCall => ({ ownerId: ALICE, botId: "bot-a", tool: CW_WRITE, input, ...extra });

function rule(over: Partial<OwnerRule> = {}): OwnerRule {
  const candidate = ruleCandidateFor({ tool: CW_WRITE, input: ticketUpdate });
  return {
    id: "r1", ownerId: ALICE, botId: "bot-a", tool: candidate.tool, scope: candidate.scope, behavior: "allow",
    description: candidate.description, createdAt: 1, updatedAt: 1, ...over,
  };
}

describe("rule granularity: the tool and its target, not the whole tool", () => {
  it("reads the target from the arguments, without record ids", () => {
    expect(ruleScopeFor(ticketUpdate)).toEqual({ resource: "service/tickets", operation: "update" });
    expect(ruleScopeFor(JSON.stringify({ url: "https://github.com/acme/repo/pull/3" }))).toEqual({ host: "github.com" });
    expect(ruleScopeFor("not json")).toEqual({});
  });
  it("reads a gateway api_write call as api, resource and verb, like the MCP permission key (#508)", () => {
    const update = JSON.stringify({ api: "CW", resource: "ticket", verb: "update", body: {} });
    const create = JSON.stringify({ api: "cw", resource: "ticket", verb: "create", body: {} });
    expect(ruleScopeFor(update)).toEqual({ api: "cw", resource: "ticket", verb: "update" });
    expect(ruleScopeFor(JSON.stringify({ api: "cw", resource: "ticket", action: "close" }))).toEqual({ api: "cw", resource: "ticket", action: "close" });
    const tool = "mcp__perspicax_quasar__api_write";
    const candidate = ruleCandidateFor({ tool, input: update });
    const saved: OwnerRule = { id: "g1", ownerId: ALICE, botId: "bot-a", tool: candidate.tool, scope: candidate.scope, behavior: "allow", description: candidate.description, createdAt: 1, updatedAt: 1 };
    expect(matchOwnerRule([saved], { ownerId: ALICE, botId: "bot-a", tool, input: update })?.id).toBe("g1");
    expect(matchOwnerRule([saved], { ownerId: ALICE, botId: "bot-a", tool, input: create })).toBeUndefined();
  });
  it("treats mcp__srv__tool and srv__tool as one tool", () => {
    expect(normalizeRuleTool(CW_WRITE)).toBe(normalizeRuleTool("perspicax_quasar__cw_psa_write"));
    expect(normalizeRuleTool("WebSearch")).toBe("WebSearch");
  });
  it("describes the rule in plain words with its target", () => {
    const candidate = ruleCandidateFor({ tool: CW_WRITE, input: ticketUpdate });
    expect(candidate.description).toMatch(/ticket/i);
    expect(candidate.description).toContain("service/tickets");
    expect(candidate.description).not.toContain("mcp__");
  });
  it("an Always allow for ticket updates does not cover schedule entries", () => {
    expect(matchOwnerRule([rule()], call(ticketUpdate))?.id).toBe("r1");
    expect(matchOwnerRule([rule()], call(scheduleCreate))).toBeUndefined();
  });
  it("an empty scope (any target, widened by the owner) covers every target", () => {
    expect(matchOwnerRule([rule({ scope: {} })], call(scheduleCreate))?.id).toBe("r1");
  });
});

describe("rules are kept per person and never shared", () => {
  it("a rule of Alice never answers for a bot of Bob, even for the same tool", () => {
    expect(matchOwnerRule([rule()], call(ticketUpdate, { ownerId: BOB, botId: "bot-b" }))).toBeUndefined();
    expect(matchOwnerRule([rule({ botId: null })], call(ticketUpdate, { ownerId: BOB, botId: "bot-b" }))).toBeUndefined();
  });
  it("a rule for one bot does not cover another bot of the same person; all my bots does", () => {
    expect(matchOwnerRule([rule()], call(ticketUpdate, { botId: "bot-other" }))).toBeUndefined();
    expect(matchOwnerRule([rule({ botId: null })], call(ticketUpdate, { botId: "bot-other" }))?.id).toBe("r1");
  });
});

describe("destructive gateway calls with hyphenated server names (#1931)", () => {
  it.each(["user", "team", "org", "workspace"])("reads the tool after the whole %s server name", (scope) => {
    const tool = `cursor__${scope}-pulsatrix-connectwise-psa-delete_5frecord___23`;
    expect(destructiveKindOf({ tool, input: "{}" })).toBe("delete");
    expect(ruleCandidateFor({ tool, input: "{}" }).destructive).toBe("delete");
    expect(ownerDecision({ mode: "auto", rules: [], call: call("{}", { tool }) }))
      .toMatchObject({ kind: "card", reason: "destructive" });
  });

  it("never treats a verb in the server name as the tool's action", () => {
    for (const prefix of ["", "mcp__"]) {
      const tool = `${prefix}cursor__user-acme-delete-list_5frecords___23`;
      expect(destructiveKindOf({ tool, input: "{}" })).toBeUndefined();
      expect(ownerDecision({ mode: "auto", rules: [], call: call("{}", { tool }) }))
        .toMatchObject({ kind: "allow", source: "owner-auto" });
    }
  });
});

describe("Always allow / Allow once / Deny", () => {
  it("Always allow approves the next matching call without a card", () => {
    expect(ownerDecision({ mode: "approval", rules: [rule()], call: call(ticketUpdate) })).toMatchObject({ kind: "allow", source: "owner-rule" });
  });
  it("Allow once saves nothing: the next call is a card again", () => {
    expect(ownerDecision({ mode: "approval", rules: [], call: call(ticketUpdate) })).toEqual({ kind: "card", reason: "no-rule" });
  });
  it("Always deny refuses without a card, and deny wins over allow", () => {
    const deny = rule({ id: "r2", behavior: "deny", scope: {} });
    expect(ownerDecision({ mode: "approval", rules: [rule(), deny], call: call(ticketUpdate) })).toMatchObject({ kind: "deny", source: "owner-rule-deny", rule: { id: "r2" } });
  });
  it("Ask every time keeps a card in approval and auto modes", () => {
    const ask = rule({ behavior: "ask" });
    expect(ownerDecision({ mode: "approval", rules: [ask], call: call(ticketUpdate) })).toMatchObject({ kind: "card", reason: "ask-rule" });
    expect(ownerDecision({ mode: "auto", rules: [ask], call: call(ticketUpdate) })).toMatchObject({ kind: "card", reason: "ask-rule" });
  });
});

describe("the owner's mode and rules never answer what Sagax would not (re-review of #690, 2026-10-17)", () => {
  it("a call in a class protected by a security key keeps its card in auto and bypass, an Always allow included", () => {
    for (const mode of ["auto", "bypass", "approval"] as const) {
      expect(ownerDecision({ mode, rules: [rule()], call: call(ticketUpdate), stepUpRequired: true })).toMatchObject({ kind: "card", reason: "step-up" });
      expect(ownerDecision({ mode, rules: [], call: call(ticketUpdate), stepUpRequired: true })).toMatchObject({ kind: "card", reason: "step-up" });
    }
    // a deny rule still denies
    const deny = rule({ id: "r2", behavior: "deny", scope: {} });
    expect(ownerDecision({ mode: "bypass", rules: [deny], call: call(ticketUpdate), stepUpRequired: true })).toMatchObject({ kind: "deny" });
  });

  it("a turn that is not the owner's own (another bot, a webhook, an email) gets no automatic answer, nor an Always allow", () => {
    for (const mode of ["auto", "bypass"] as const) {
      expect(ownerDecision({ mode, rules: [], call: call(ticketUpdate), autonomyRefused: true })).toMatchObject({ kind: "card", reason: "origin" });
      expect(ownerDecision({ mode, rules: [rule()], call: call(ticketUpdate), autonomyRefused: true })).toMatchObject({ kind: "card", reason: "origin" });
    }
    expect(ownerDecision({ mode: "auto", rules: [], call: call(ticketUpdate) })).toMatchObject({ kind: "allow", source: "owner-auto" });
  });
});

describe("Always allow on a read card (2026-10-15: Rocket reading Twilio accounts)", () => {
  const TWILIO_QUERY = "mcp__perspicax_quasar__twilio_api_query";
  const accounts = (extra: Record<string, unknown> = {}) => JSON.stringify({ resource: "Accounts", fields: ["sid", "friendlyName"], limit: 5, ...extra });
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("saves the card's rule for this person and scope, and the same request no longer asks", () => {
    dir = mkdtempSync(join(tmpdir(), "owner-approvals-"));
    const file = join(dir, "owner-approvals.json");
    const first: RuleCall = { ownerId: ALICE, botId: "rocket", tool: TWILIO_QUERY, input: accounts() };
    // before: a card, with Always allow to offer
    expect(ownerDecision({ mode: "approval", rules: [], call: first })).toEqual({ kind: "card", reason: "no-rule" });
    const candidate = ruleCandidateFor(first);
    expect(candidate).toMatchObject({ tool: "perspicax_quasar__twilio_api_query", scope: { resource: "accounts" } });
    expect(candidate.destructive).toBeUndefined();
    // Always allow: the server saves the candidate for the bot's owner
    new OwnerApprovalStore(file).add({ ownerId: ALICE, botId: "rocket", tool: candidate.tool, scope: candidate.scope, behavior: "allow", description: candidate.description });
    // kept on disk: a restart still knows it
    const rules = new OwnerApprovalStore(file).rulesOf(ALICE, "rocket");
    expect(rules).toEqual([expect.objectContaining({ ownerId: ALICE, botId: "rocket", behavior: "allow", scope: { resource: "accounts" } })]);
    // the same request, and the same kind with other fields, pass without a card
    expect(ownerDecision({ mode: "approval", rules, call: first })).toMatchObject({ kind: "allow", source: "owner-rule" });
    expect(ownerDecision({ mode: "approval", rules, call: { ...first, input: accounts({ limit: 50 }) } })).toMatchObject({ kind: "allow", source: "owner-rule" });
    // another target, another bot of hers or another person still ask
    expect(ownerDecision({ mode: "approval", rules, call: { ...first, input: JSON.stringify({ resource: "Calls" }) } })).toEqual({ kind: "card", reason: "no-rule" });
    expect(new OwnerApprovalStore(file).rulesOf(ALICE, "other-bot")).toEqual([]);
    expect(ownerDecision({ mode: "approval", rules: new OwnerApprovalStore(file).rulesOf(BOB, "rocket"), call: { ...first, ownerId: BOB } })).toEqual({ kind: "card", reason: "no-rule" });
  });
});

describe("destructive actions need their own explicit Always rule", () => {
  it("detects a delete, a bulk change and an external message", () => {
    expect(destructiveKindOf({ tool: CW_WRITE, input: ticketDelete })).toBe("delete");
    expect(destructiveKindOf({ tool: CW_WRITE, input: bulkClose })).toBe("bulk");
    expect(destructiveKindOf({ tool: "mcp__perspicax_quasar__twilio_api_write", input: smsSend })).toBe("external-message");
    expect(destructiveKindOf({ tool: "mcp__gmail__send_email", input: "{}" })).toBe("external-message");
    expect(destructiveKindOf({ tool: CW_WRITE, input: ticketUpdate })).toBeUndefined();
  });
  it("an allow rule with any target does not cover a delete at Approval or Auto (Bypass asks nothing, 2026-11-06)", () => {
    const wide = rule({ scope: {} });
    expect(ownerDecision({ mode: "bypass", rules: [wide], call: call(ticketDelete) })).toMatchObject({ kind: "allow" });
    for (const mode of ["approval", "auto"] as const) {
      expect(ownerDecision({ mode, rules: [wide], call: call(ticketDelete) })).toMatchObject({ kind: "card", reason: "destructive", destructive: "delete" });
    }
  });
  it("an allow rule made for that kind does", () => {
    const candidate = ruleCandidateFor({ tool: CW_WRITE, input: ticketDelete });
    expect(candidate.destructive).toBe("delete");
    const deletes = rule({ scope: candidate.scope, destructive: "delete" });
    expect(ownerDecision({ mode: "approval", rules: [deletes], call: call(ticketDelete) })).toMatchObject({ kind: "allow", source: "owner-rule" });
    // a delete rule does not cover a bulk close
    expect(ownerDecision({ mode: "approval", rules: [rule({ scope: {}, destructive: "delete" })], call: call(bulkClose) })).toMatchObject({ kind: "card", reason: "destructive" });
  });
  it("a deny rule covers a destructive call too", () => {
    expect(ownerDecision({ mode: "bypass", rules: [rule({ scope: {}, behavior: "deny" })], call: call(ticketDelete) })).toMatchObject({ kind: "deny" });
  });
});

describe("a destructive shell command is a delete, in every mode (2026-10-22)", () => {
  // describeApproval reads a shell tool only as "execute", so before this a
  // native `rm -rf` slipped through the owner auto/bypass destructive guard
  // (owner-approval.ts) and ran with no card. The custom-rules risk engine
  // already extracts the delete from the same line; the owner route now does
  // too. Covers the built-in Bash, an engine's own shell tool and a folded
  // native command line alike.
  const BASH = "Bash";
  const SHELL = "mcp__sagax-desktop__run_command";
  const shell = (command: string) => JSON.stringify({ command });
  const shellCall = (tool: string, command: string, over: Partial<RuleCall> = {}): RuleCall => ({ ownerId: ALICE, botId: "bot-a", tool, input: shell(command), ...over });

  it("reads rm as a delete whichever tool wraps the line, and leaves a plain command alone", () => {
    expect(destructiveKindOf({ tool: BASH, input: shell("rm -rf /tmp/zzz") })).toBe("delete");
    expect(destructiveKindOf({ tool: SHELL, input: shell("rm -rf /tmp/zzz") })).toBe("delete");
    expect(destructiveKindOf({ tool: BASH, input: shell("rm -rf /tmp/zzz && echo done") })).toBe("delete");
    // a plain command and a read are not deletes
    expect(destructiveKindOf({ tool: BASH, input: shell("printf hello") })).toBeUndefined();
    expect(destructiveKindOf({ tool: BASH, input: shell("ls -la /tmp") })).toBeUndefined();
    expect(destructiveKindOf({ tool: BASH, input: shell("npm run build") })).toBeUndefined();
  });

  it("auto holds a card for it unless an allow rule was made for a delete; bypass runs it; a plain command still auto-approves", () => {
    expect(ownerDecision({ mode: "bypass", rules: [], call: shellCall(BASH, "rm -rf /tmp/zzz") })).toEqual({ kind: "allow", source: "owner-bypass" });
    for (const mode of ["auto"] as const) {
      expect(ownerDecision({ mode, rules: [], call: shellCall(BASH, "rm -rf /tmp/zzz") }))
        .toMatchObject({ kind: "card", reason: "destructive", destructive: "delete" });
      // a wide allow rule (any target) never covers it (same guard as an MCP delete)
      expect(ownerDecision({ mode, rules: [rule({ scope: {} })], call: shellCall(BASH, "rm -rf /tmp/zzz") }))
        .toMatchObject({ kind: "card", reason: "destructive", destructive: "delete" });
    }
    expect(ownerDecision({ mode: "auto", rules: [], call: shellCall(BASH, "printf hello") }))
      .toEqual({ kind: "allow", source: "owner-auto" });
  });

  it("in the person's own isolated environment, auto and bypass run a delete or a bulk change (2026-10-26)", () => {
    const SANDBOX = "mcp__sagax-environment__run_command";
    const bulk = JSON.stringify({ command: "true", ids: ["a", "b"] });
    for (const mode of ["auto", "bypass"] as const) {
      const source = mode === "auto" ? "owner-auto" : "owner-bypass";
      expect(ownerDecision({ mode, rules: [], call: shellCall(SANDBOX, "rm -rf build"), ownEnvironment: true })).toEqual({ kind: "allow", source });
      expect(ownerDecision({ mode, rules: [], call: { ...shellCall(SANDBOX, "true"), input: bulk }, ownEnvironment: true })).toEqual({ kind: "allow", source });
      // a hold, a security key and a deny rule still come first
      expect(ownerDecision({ mode, rules: [], call: shellCall(SANDBOX, "rm -rf build"), ownEnvironment: true, personMustAnswer: true })).toEqual({ kind: "card", reason: "hold" });
      expect(ownerDecision({ mode, rules: [], call: shellCall(SANDBOX, "rm -rf build"), ownEnvironment: true, stepUpRequired: true })).toMatchObject({ kind: "card", reason: "step-up" });
    }
  });

  it("outside it (another person's, the real computer, a connector), at Approval, or for a message to a third party, the delete card stays (Bypass: only another person's)", () => {
    // 2026-11-06: Bypass asks nothing a rule did not keep; another
    // person's environment still holds its card
    expect(ownerDecision({ mode: "bypass", rules: [], call: shellCall(BASH, "rm -rf /tmp/zzz") })).toEqual({ kind: "allow", source: "owner-bypass" });
    expect(ownerDecision({ mode: "bypass", rules: [], call: { ...call(smsSend), tool: "mcp__perspicax_quasar__twilio_api_write" }, ownEnvironment: true })).toEqual({ kind: "allow", source: "owner-bypass" });
    expect(ownerDecision({ mode: "bypass", rules: [], call: shellCall(BASH, "rm -rf build"), ownEnvironment: true, crossPerson: true })).toEqual({ kind: "card", reason: "cross-person" });
    for (const mode of ["auto"] as const) {
      // not the person's own environment
      expect(ownerDecision({ mode, rules: [], call: shellCall(BASH, "rm -rf /tmp/zzz") })).toMatchObject({ kind: "card", reason: "destructive", destructive: "delete" });
      expect(ownerDecision({ mode, rules: [], call: call(ticketDelete) })).toMatchObject({ kind: "card", reason: "destructive" });
      // someone else's environment
      expect(ownerDecision({ mode, rules: [], call: shellCall(BASH, "rm -rf build"), ownEnvironment: true, crossPerson: true })).toEqual({ kind: "card", reason: "cross-person" });
      // a message that leaves the organization, even sent from the sandbox
      expect(ownerDecision({ mode, rules: [], call: { ...call(smsSend), tool: "mcp__perspicax_quasar__twilio_api_write" }, ownEnvironment: true }))
        .toMatchObject({ kind: "card", reason: "destructive", destructive: "external-message" });
    }
    expect(ownerDecision({ mode: "approval", rules: [], call: shellCall(BASH, "rm -rf build"), ownEnvironment: true })).toMatchObject({ kind: "card", reason: "destructive" });
  });

  it("a deny rule still denies it and a hold still holds, as for any destructive call", () => {
    const denyShell: OwnerRule = { id: "d1", ownerId: ALICE, botId: "bot-a", tool: "Bash", scope: {}, behavior: "deny", description: "no shell", createdAt: 1, updatedAt: 1 };
    expect(ownerDecision({ mode: "bypass", rules: [denyShell], call: shellCall(BASH, "rm -rf /tmp/zzz") }))
      .toMatchObject({ kind: "deny" });
    expect(ownerDecision({ mode: "auto", rules: [], call: shellCall(BASH, "rm -rf /tmp/zzz"), personMustAnswer: true }))
      .toEqual({ kind: "card", reason: "hold" });
  });
});

describe("modes", () => {
  it("auto approves what no rule covers and is not destructive", () => {
    expect(ownerDecision({ mode: "auto", rules: [], call: call(ticketUpdate) })).toEqual({ kind: "allow", source: "owner-auto" });
    expect(ownerDecision({ mode: "auto", rules: [], call: call(smsSend, { tool: "mcp__perspicax_quasar__twilio_api_write" }) })).toMatchObject({ kind: "card", reason: "destructive" });
  });
  it("bypass asks nothing a rule does not cover, is journaled as bypass, and an ask rule still shows its card (2026-10-26)", () => {
    expect(ownerDecision({ mode: "bypass", rules: [], call: call(ticketUpdate) })).toEqual({ kind: "allow", source: "owner-bypass" });
    expect(ownerDecision({ mode: "bypass", rules: [rule({ behavior: "ask" })], call: call(ticketUpdate) })).toMatchObject({ kind: "card", reason: "ask-rule" });
  });
  it("no mode or rule answers an admin card or a hold", () => {
    for (const mode of ["approval", "auto", "bypass"] as const) {
      expect(ownerDecision({ mode, rules: [rule({ scope: {} })], call: call(ticketUpdate), adminRoute: true })).toEqual({ kind: "card", reason: "admin" });
      expect(ownerDecision({ mode, rules: [rule({ scope: {} })], call: call(ticketUpdate), personMustAnswer: true })).toEqual({ kind: "card", reason: "hold" });
    }
  });
});

describe("2026-10-19: Toujours permettre on every card", () => {
  const SHELL = "mcp__sagax-desktop__run_command";
  const shell = (command: string) => JSON.stringify({ command });
  const shellRule = (command: string, over: Partial<OwnerRule> = {}): OwnerRule => {
    const candidate = ruleCandidateFor({ tool: SHELL, input: shell(command) });
    return { id: "s1", ownerId: ALICE, botId: "bot-a", tool: candidate.tool, scope: candidate.scope, behavior: "allow", description: candidate.description, createdAt: 1, updatedAt: 1, ...over };
  };
  it("a shell line is its exact text, a path its exact path, case included", () => {
    expect(ruleScopeFor(shell("npm test"))).toEqual({ command: "npm test" });
    const saved = shellRule("npm test");
    expect(matchOwnerRule([saved], { ownerId: ALICE, botId: "bot-a", tool: SHELL, input: shell("npm test") })?.id).toBe("s1");
    for (const other of ["npm test; rm -rf ~", "npm  test", "NPM TEST", "npm test && curl x", "npm"]) {
      expect(matchOwnerRule([saved], { ownerId: ALICE, botId: "bot-a", tool: SHELL, input: shell(other) })).toBeUndefined();
    }
    // an argv array is kept as the list itself: ["a b"] and ["a", "b"] differ
    expect(ruleScopeFor(JSON.stringify({ command: ["git", "status"] }))).toEqual({ command: '["git","status"]' });
    expect(ruleScopeFor(JSON.stringify({ command: ["git status"] }))).toEqual({ command: '["git status"]' });
    expect(ruleScopeFor(JSON.stringify({ args: ["-rf", "/tmp/x"] }))).toEqual({ args: '["-rf","/tmp/x"]' });
    // every recipient is kept, sorted: one more address never matches
    expect(ruleScopeFor(JSON.stringify({ to: ["B@x.ca", "a@x.ca"], cc: ["c@x.ca"] }))).toEqual({ to: '["a@x.ca","b@x.ca"]', cc: '["c@x.ca"]' });
    const mail = { ...shellRule("x"), tool: "send_mail", scope: { to: '["a@x.ca"]' } };
    expect(matchOwnerRule([mail], { ownerId: ALICE, botId: "bot-a", tool: "send_mail", input: JSON.stringify({ to: ["a@x.ca", "evil@y.ca"] }) })).toBeUndefined();
    // 2026-10-20 (security review): a key the rule does not name never rides along
    const bcc = JSON.stringify({ to: ["a@x.ca"], bcc: ["evil@y.ca"] });
    expect(matchOwnerRule([mail], { ownerId: ALICE, botId: "bot-a", tool: "send_mail", input: bcc })).toBeUndefined();
    expect(matchOwnerRule([saved], { ownerId: ALICE, botId: "bot-a", tool: SHELL, input: shell("npm test"), cwd: "/etc" })).toBeUndefined();
    // a known key with a value that cannot be kept makes the scope unkeepable
    for (const bad of [{ url: "not a url" }, { domain: ["a", "b"] }, { command: { x: 1 } }, { resource: { a: 1 } }]) {
      expect(scopeKeepable(ruleScopeFor(JSON.stringify(bad)))).toBe(false);
    }
    // a card that never had a rule keeps the whole request
    const sql = (q: string) => JSON.stringify({ server: "db", sql: q });
    const whole = ruleCandidateFor({ tool: "mcp__db__run", input: sql("select 1") }, undefined, { wholeCall: true });
    expect(whole.scope[WHOLE_CALL_KEY]).toMatch(/^[0-9a-f]{32}$/);
    expect(whole.description).not.toMatch(/[0-9a-f]{32}/);
    const wholeRule = { ...shellRule("x"), tool: whole.tool, scope: whole.scope };
    expect(matchOwnerRule([wholeRule], { ownerId: ALICE, botId: "bot-a", tool: "mcp__db__run", input: sql("select 1") })?.id).toBe("s1");
    expect(matchOwnerRule([wholeRule], { ownerId: ALICE, botId: "bot-a", tool: "mcp__db__run", input: sql("drop table t") })).toBeUndefined();
    // 2026-11-06: arguments the scope does not read keep this tool on
    // this server for this bot, so the next call matches the saved rule
    const sendCandidate = ruleCandidateFor({ tool: "mcp__mail__send", input: JSON.stringify({ message: { toRecipients: ["a@x.ca"] } }) });
    expect(sendCandidate.scope).toEqual({});
    expect(sendCandidate.destructive).toBe("external-message");
    expect(ruleCandidateFor({ tool: "mcp__mail__list", input: "{}" }).scope).toEqual({});
    // a target too long to keep never becomes "any value"
    expect(ruleScopeFor(JSON.stringify({ domain: "a".repeat(200) })).domain).toBeDefined();
    expect(ruleScopeFor(JSON.stringify({ file_path: "/Users/a/Notes.md" }))).toEqual({ file_path: "/Users/a/Notes.md" });
    const notes = { ...shellRule("x"), tool: "Write", scope: { file_path: "/Users/a/Notes.md" } };
    expect(matchOwnerRule([notes], { ownerId: ALICE, botId: "bot-a", tool: "Write", input: JSON.stringify({ file_path: "/users/a/notes.md" }) })).toBeUndefined();
  });
  it("a native shell line is bound to its folder; a folder Sagax made for the bot by its kind", () => {
    const bash = (cwd: string) => ({ ownerId: ALICE, botId: "bot-a", tool: "Bash", input: JSON.stringify({ command: "./deploy.sh" }), cwd });
    const made = "/data/task-workspaces/0b9f6a52-8a4e-4a8b-9d55-5f0f4b8b1c11/1f2e3d4c-5b6a-4789-8abc-def012345678";
    const other = "/data/task-workspaces/0b9f6a52-8a4e-4a8b-9d55-5f0f4b8b1c11/9a8b7c6d-5e4f-4321-8abc-def012345678";
    const candidate = ruleCandidateFor(bash(made));
    expect(candidate.scope).toEqual({ command: "./deploy.sh", cwd: "sagax:conversation" });
    expect(candidate.description).not.toMatch(/sagax:|0b9f6a52/);
    const saved: OwnerRule = { id: "c1", ownerId: ALICE, botId: "bot-a", tool: candidate.tool, scope: candidate.scope, behavior: "allow", description: candidate.description, createdAt: 1, updatedAt: 1 };
    expect(matchOwnerRule([saved], bash(other))?.id).toBe("c1");
    expect(matchOwnerRule([saved], bash("/srv/elsewhere"))).toBeUndefined();
    const elsewhere = ruleCandidateFor(bash("/srv/app"));
    expect(elsewhere.scope).toEqual({ command: "./deploy.sh", cwd: "/srv/app" });
    expect(matchOwnerRule([{ ...saved, scope: elsewhere.scope }], bash("/srv/app2"))).toBeUndefined();
  });
  it("a value too long to keep makes no rule, never a wider one", () => {
    const long = ruleScopeFor(shell("x".repeat(5_000)));
    expect(scopeKeepable(long)).toBe(false);
    expect(matchOwnerRule([shellRule("npm test", { scope: {} })], { ownerId: ALICE, botId: "bot-a", tool: SHELL, input: shell("x".repeat(5_000)) })?.id).toBe("s1");
    expect(matchOwnerRule([shellRule("npm test", { scope: { command: "x" } })], { ownerId: ALICE, botId: "bot-a", tool: SHELL, input: shell("x".repeat(5_000)) })).toBeUndefined();
  });
  it("a held card and a turn that is not the person's own: only a rule saved from that kind of card", () => {
    const shellCall = { ownerId: ALICE, botId: "bot-a", tool: SHELL, input: shell("npm test") };
    for (const mode of ["approval", "auto", "bypass"] as const) {
      expect(ownerDecision({ mode, rules: [shellRule("npm test")], call: shellCall, personMustAnswer: true })).toEqual({ kind: "card", reason: "hold" });
      expect(ownerDecision({ mode, rules: [shellRule("npm test", { from: "hold" })], call: shellCall, personMustAnswer: true })).toMatchObject({ kind: "allow", source: "owner-rule" });
      expect(ownerDecision({ mode, rules: [shellRule("npm test")], call: shellCall, autonomyRefused: true })).toEqual({ kind: "card", reason: "origin" });
      expect(ownerDecision({ mode, rules: [shellRule("npm test", { from: "origin" })], call: shellCall, autonomyRefused: true })).toMatchObject({ kind: "allow", source: "owner-rule" });
      // a hold rule never answers an origin card, nor the reverse
      expect(ownerDecision({ mode, rules: [shellRule("npm test", { from: "hold" })], call: shellCall, autonomyRefused: true }).kind).toBe("card");
      expect(ownerDecision({ mode, rules: [shellRule("npm test", { from: "origin" })], call: shellCall, personMustAnswer: true }).kind).toBe("card");
      // a security key the person chose still asks, whatever the rule
      expect(ownerDecision({ mode, rules: [shellRule("npm test", { from: "hold" })], call: shellCall, personMustAnswer: true, stepUpRequired: true })).toMatchObject({ kind: "card", reason: "step-up" });
      expect(ownerDecision({ mode, rules: [shellRule("npm test", { from: "origin" })], call: shellCall, autonomyRefused: true, stepUpRequired: true })).toMatchObject({ kind: "card", reason: "step-up" });
      // someone else's environment (#2091): the card offers Always allow like
      // any other; only an origin rule its answerer saved answers it
      expect(ownerDecision({ mode, rules: [shellRule("npm test")], call: shellCall, crossPerson: true })).toEqual({ kind: "card", reason: "cross-person" });
      expect(ownerDecision({ mode, rules: [shellRule("npm test", { from: "hold" })], call: shellCall, crossPerson: true })).toEqual({ kind: "card", reason: "cross-person" });
      expect(ownerDecision({ mode, rules: [shellRule("npm test", { from: "origin" })], call: shellCall, crossPerson: true })).toMatchObject({ kind: "allow", source: "owner-rule" });
    }
    // a deny rule still denies a held card
    expect(ownerDecision({ mode: "approval", rules: [shellRule("npm test", { behavior: "deny" })], call: shellCall, personMustAnswer: true })).toMatchObject({ kind: "deny" });
  });
  it("a rule of one person never answers another's call", () => {
    const shellCall = { ownerId: BOB, botId: "bot-a", tool: SHELL, input: shell("npm test") };
    expect(ownerDecision({ mode: "approval", rules: [shellRule("npm test", { from: "origin" })], call: shellCall, autonomyRefused: true }).kind).toBe("card");
  });
  it("an act or widget rule covers the very same scope, key for key", () => {
    const act = { ...rule(), tool: "sagax_settings", scope: { setting: "bot.theme", target: "b1" } };
    expect(ruleCoversExactScope(act, "sagax_settings", { setting: "bot.theme", target: "b1" })).toBe(true);
    expect(ruleCoversExactScope(act, "sagax_settings", { setting: "bot.theme", target: "b2" })).toBe(false);
    // a change bound to its value is never covered by a rule without one
    expect(ruleCoversExactScope(act, "sagax_settings", { setting: "bot.theme", target: "b1", value: "abc" })).toBe(false);
    expect(ruleCoversExactScope({ ...act, behavior: "deny" }, "sagax_settings", { setting: "bot.theme", target: "b1" })).toBe(false);
    expect(ruleCoversExactScope(act, "sagax_act", { setting: "bot.theme", target: "b1" })).toBe(false);
  });
});

describe("the store", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  const open = () => {
    dir = mkdtempSync(join(tmpdir(), "owner-approvals-"));
    return new OwnerApprovalStore(join(dir, "owner-approvals.json"), () => 1_000);
  };

  it("keeps rules per person: another person neither sees, changes nor removes them", () => {
    const store = open();
    const saved = store.add({ ownerId: ALICE, botId: "bot-a", tool: "perspicax_quasar__cw_psa_write", scope: { resource: "service/tickets" }, behavior: "allow", description: "Update tickets" });
    expect(store.rulesOf(ALICE)).toHaveLength(1);
    expect(store.rulesOf(BOB)).toHaveLength(0);
    expect(store.update(BOB, saved.id, { behavior: "deny" })).toBeNull();
    expect(store.remove(BOB, saved.id)).toBe(false);
    expect(store.rulesOf(ALICE)[0]!.behavior).toBe("allow");
    expect(store.update(ALICE, saved.id, { behavior: "deny", anyTarget: true, botId: null })).toMatchObject({ behavior: "deny", scope: {}, botId: null });
    expect(store.remove(ALICE, saved.id)).toBe(true);
    expect(store.rulesOf(ALICE)).toHaveLength(0);
  });

  it("the same rule saved twice replaces its behavior", () => {
    const store = open();
    const input = { ownerId: ALICE, botId: "bot-a", tool: "x__y", scope: { resource: "a" }, behavior: "allow" as const, description: "d" };
    store.add(input);
    store.add({ ...input, behavior: "deny" });
    expect(store.rulesOf(ALICE)).toEqual([expect.objectContaining({ behavior: "deny" })]);
  });

  it("filters to the rules that can apply to one bot", () => {
    const store = open();
    store.add({ ownerId: ALICE, botId: "bot-a", tool: "x__y", scope: {}, behavior: "allow", description: "a" });
    store.add({ ownerId: ALICE, botId: null, tool: "x__z", scope: {}, behavior: "allow", description: "all" });
    store.add({ ownerId: ALICE, botId: "bot-b", tool: "x__w", scope: {}, behavior: "allow", description: "b" });
    expect(store.rulesOf(ALICE, "bot-a").map((row) => row.description).sort()).toEqual(["a", "all"]);
  });

  it("reads the legacy modes once, then drops them (2026-10-26, one approval level), and persists 0600", () => {
    dir = mkdtempSync(join(tmpdir(), "owner-approvals-"));
    const file = join(dir, "owner-approvals.json");
    writeFileSync(file, JSON.stringify({ version: 1, rules: [], modes: { "bot-a": { mode: "bypass", ownerId: ALICE, at: 1 } } }));
    const store = new OwnerApprovalStore(file);
    expect(store.legacyModes()).toEqual({ "bot-a": { mode: "bypass", ownerId: ALICE } });
    store.dropLegacyModes();
    // Windows has no POSIX file modes: statSync reports 0o666 whatever chmod asked.
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(new OwnerApprovalStore(file).legacyModes()).toEqual({});
    // a file written without modes still opens
    writeFileSync(file, JSON.stringify({ version: 1, rules: [] }));
    expect(new OwnerApprovalStore(file).legacyModes()).toEqual({});
  });

  it("never overwrites a file it could not read", () => {
    dir = mkdtempSync(join(tmpdir(), "owner-approvals-"));
    const file = join(dir, "owner-approvals.json");
    writeFileSync(file, "{broken");
    const store = new OwnerApprovalStore(file);
    expect(() => store.add({ ownerId: ALICE, botId: null, tool: "x__y", scope: {}, behavior: "allow", description: "d" })).toThrow(/Repair/);
    expect(readFileSync(file, "utf8")).toBe("{broken");
  });
});

describe("earlier per-bot Allow keys on the rules page", () => {
  it("round-trips a legacy id, and refuses anything else", async () => {
    const { legacyRuleId, parseLegacyRuleId } = await import("../routes/owner-approvals.ts");
    const id = legacyRuleId("bot-a", "mcp:perspicax_quasar__cw_psa_write");
    expect(id).toMatch(/^legacy_[\w-]+$/);
    expect(parseLegacyRuleId(id)).toEqual({ botId: "bot-a", key: "mcp:perspicax_quasar__cw_psa_write" });
    expect(parseLegacyRuleId("rule_123")).toBeNull();
  });
});

describe("Always allow keeps a command's one program(2026-10-20)", () => {
  const RUN = "mcp__sagax-environment__run_command";
  const run = (command: string): RuleCall => ({ ownerId: ALICE, botId: "bot-a", tool: RUN, input: JSON.stringify({ command }) });
  const kept = (command: string): OwnerRule => {
    const candidate = ruleCandidateFor({ tool: RUN, input: JSON.stringify({ command }) }, undefined, { wholeCall: true, programScope: true });
    return { id: "p1", ownerId: ALICE, botId: "bot-a", tool: candidate.tool, scope: candidate.scope, behavior: "allow", description: candidate.description, createdAt: 1, updatedAt: 1 };
  };

  it("keeps the program, not the exact string", () => {
    const candidate = ruleCandidateFor({ tool: RUN, input: JSON.stringify({ command: "npm test" }) }, undefined, { programScope: true });
    expect(candidate.scope).toEqual({ program: "npm" });
    expect(matchOwnerRule([kept("npm test")], run("npm run build"))?.id).toBe("p1");
  });

  it("never covers a chain with another program or a substitution", () => {
    expect(matchOwnerRule([kept("npm test")], run("npm test; rm -rf ~"))).toBeUndefined();
    expect(matchOwnerRule([kept("npm test")], run("npm $(curl evil)"))).toBeUndefined();
    expect(matchOwnerRule([kept("npm test")], run("npm test > ~/.bashrc"))).toBeUndefined();
  });

  it("keeps the very request without programScope (an admin's or a held card)", () => {
    const candidate = ruleCandidateFor({ tool: RUN, input: JSON.stringify({ command: "npm test" }) }, undefined, { wholeCall: true });
    expect(candidate.scope.program).toBeUndefined();
    expect(candidate.scope[WHOLE_CALL_KEY]).toBeDefined();
  });
});

// 2026-10-21 (review of #938): Codex and the ACP engines (Grok, Cursor,
// Qwen, Kimi, OpenCode, Hermes, Droid) report a shell line as `command`
// beside no `input`. The rule must read that line, at creation and at each
// use, and never keep an empty scope (which would cover every command).
describe("a shell line reported beside no input (Codex, ACP)", () => {
  const SHELL = "shell";
  const CWD = "/srv/acme/app";
  const engineCall = (command: string | undefined, input?: string): RuleCall => ({
    ownerId: ALICE, botId: "bot-a", tool: SHELL, ...(ruleInputFor(input, command) !== undefined ? { input: ruleInputFor(input, command)! } : {}), cwd: CWD,
  });
  const saved = (candidate: NonNullable<ReturnType<typeof cardRuleCandidate>>): OwnerRule => ({
    id: "s1", ownerId: ALICE, botId: "bot-a", tool: candidate.tool, scope: candidate.scope, behavior: "allow", description: candidate.description,
    ...(candidate.from ? { from: candidate.from } : {}), createdAt: 1, updatedAt: 1,
  });

  it("reads the line as the call's command, keeping the other arguments", () => {
    expect(JSON.parse(ruleInputFor(undefined, "npm test")!)).toEqual({ command: "npm test" });
    expect(JSON.parse(ruleInputFor(JSON.stringify({ reason: "tests" }), "npm test")!)).toEqual({ reason: "tests", command: "npm test" });
    // a call that names its command already keeps it as is
    expect(ruleInputFor(JSON.stringify({ command: "ls" }), "npm test")).toBe(JSON.stringify({ command: "ls" }));
    expect(ruleInputFor(undefined, undefined)).toBeUndefined();
    expect(ruleInputFor(undefined, "   ")).toBeUndefined();
  });

  it("Codex: an admin's Always allow keeps the program in its folder, never every command", () => {
    const candidate = cardRuleCandidate({ tool: SHELL, command: "npm test", cwd: CWD }, { from: "admin" });
    expect(candidate).toMatchObject({ scope: { program: "npm", cwd: CWD }, from: "admin" });
    const rule = saved(candidate!);
    expect(matchOwnerRule([rule], engineCall("npm run build"))?.id).toBe("s1");
    expect(matchOwnerRule([rule], engineCall("uname -a"))).toBeUndefined();
    expect(matchOwnerRule([rule], engineCall("npm test; rm -rf ~"))).toBeUndefined();
    // a call with no line at all is never covered
    expect(matchOwnerRule([rule], engineCall(undefined))).toBeUndefined();
  });

  it("ACP: the same with other arguments beside the line", () => {
    const candidate = cardRuleCandidate({ tool: SHELL, input: JSON.stringify({ title: "Run tests" }), command: "git status", cwd: CWD }, { from: "admin" });
    expect(candidate).toMatchObject({ scope: { program: "git", cwd: CWD }, from: "admin" });
    const rule = saved(candidate!);
    expect(matchOwnerRule([rule], engineCall("git log -1", JSON.stringify({ title: "Last commit" })))?.id).toBe("s1");
    expect(matchOwnerRule([rule], engineCall("hostname", JSON.stringify({ title: "Host" })))).toBeUndefined();
  });

  it("an ordinary owner card of such an engine keeps the program too", () => {
    expect(cardRuleCandidate({ tool: SHELL, command: "npm test", cwd: CWD }, {})?.scope).toEqual({ program: "npm", cwd: CWD });
  });

  it("#2091: a call with no readable arguments keeps the whole tool, with its situation", () => {
    expect(cardRuleCandidate({ tool: SHELL, cwd: CWD }, { from: "admin" })).toMatchObject({ tool: SHELL, scope: {}, from: "admin" });
    expect(cardRuleCandidate({ tool: SHELL }, { from: "hold", held: true })).toMatchObject({ scope: {}, from: "hold" });
    expect(cardRuleCandidate({ tool: SHELL, input: "{}" }, {})).toMatchObject({ scope: {} });
    expect(cardRuleCandidate({ tool: SHELL, input: "  " }, { from: "origin" })).toMatchObject({ scope: {}, from: "origin" });
    expect(cardRuleCandidate({ tool: SHELL }, {})!.description.length).toBeGreaterThan(0);
  });

  it("#2091: a scope too long to keep exactly keeps the whole request", () => {
    const input = JSON.stringify({ command: "x".repeat(5000) });
    const candidate = cardRuleCandidate({ tool: SHELL, input }, {});
    expect(Object.keys(candidate.scope)).toEqual([WHOLE_CALL_KEY]);
    expect(candidate.scope[WHOLE_CALL_KEY]).toBe(wholeCallDigest(input));
  });


  // review of #938, finding 3: a held admin card (safety hold,
  // dangerouslyDisableSandbox, Codex additionalPermissions or network,
  // requiresExplicitApproval) keeps the whole request, never the program
  it("a held admin card keeps the whole request: npm install kept, npm run deploy asks", () => {
    const candidate = cardRuleCandidate({ tool: "Bash", input: JSON.stringify({ command: "npm install", dangerouslyDisableSandbox: true }), command: "npm install", cwd: CWD }, { from: "admin", held: true });
    expect(candidate?.scope.program).toBeUndefined();
    expect(candidate?.scope).toMatchObject({ command: "npm install", cwd: CWD });
    expect(candidate?.scope[WHOLE_CALL_KEY]).toBeDefined();
    const rule = { ...saved(candidate!), tool: candidate!.tool };
    const bash = (command: string, extra: Record<string, unknown> = {}): RuleCall => ({ ownerId: ALICE, botId: "bot-a", tool: "Bash", input: JSON.stringify({ command, ...extra }), cwd: CWD });
    expect(matchOwnerRule([rule], bash("npm run deploy"))).toBeUndefined();
    expect(matchOwnerRule([rule], bash("npm install"))).toBeUndefined();
    expect(matchOwnerRule([rule], bash("npm install", { dangerouslyDisableSandbox: true }))?.id).toBe("s1");
  });
});

describe("app rules on the person's own computer (parité R10, ligne 80)", () => {
  const CLICK = "mcp__computer__click";
  const TYPE = "mcp__sagax-desktop__computer_use";
  const clickSafari = JSON.stringify({ pid: 812, element_index: 5 });
  const typeSafari = JSON.stringify({ tool_name: "type_text", arguments: { pid: 812, text: "bonjour" } });
  const SAFARI = { label: "Safari", bundleId: "com.apple.Safari", team: "apple" };
  const appRule = (candidate: NonNullable<ReturnType<typeof cardRuleCandidate>>): OwnerRule => ({
    id: "r_app", ownerId: ALICE, botId: "bot_1", tool: candidate.tool, scope: candidate.scope, behavior: "allow",
    description: candidate.description, ...(candidate.from ? { from: candidate.from } : {}), createdAt: 1, updatedAt: 1,
  });

  it("keeps the signed app the server read, never the whole call", () => {
    const candidate = cardRuleCandidate({ tool: CLICK, input: clickSafari, app: SAFARI }, {});
    expect(candidate).toMatchObject({ tool: APP_RULE_TOOL, scope: { [APP_KEY]: "Safari", bundle: "com.apple.Safari", team: "apple" } });
    expect(candidate?.from).toBeUndefined();
    expect(candidate?.description).toContain("Safari");
  });

  it("covers every coverable screen action of that app, never another app or another signature", () => {
    const rule = appRule(cardRuleCandidate({ tool: CLICK, input: clickSafari, app: SAFARI }, {})!);
    const call = (over: Partial<RuleCall>) => ({ ownerId: ALICE, botId: "bot_1", tool: CLICK, input: clickSafari, app: SAFARI, ...over });
    expect(matchOwnerRule([rule], call({}))?.id).toBe("r_app");
    expect(matchOwnerRule([rule], call({ tool: TYPE, input: typeSafari }))?.id).toBe("r_app");
    expect(matchOwnerRule([rule], call({ app: { label: "Notes", bundleId: "com.apple.Notes", team: "apple" } }))).toBeUndefined();
    // a copied "Safari" signed by someone else is another app
    expect(matchOwnerRule([rule], call({ app: { label: "Safari", bundleId: "com.apple.Safari", team: "ABCDE12345" } }))).toBeUndefined();
    expect(matchOwnerRule([rule], call({ app: { label: "Safari", bundleId: "com.evil.Safari", team: "apple" } }))).toBeUndefined();
    // the server read no app (another turn, another computer): no match
    expect(matchOwnerRule([rule], call({ app: undefined }))).toBeUndefined();
    // a call an app rule never covers (foreground, a file written)
    expect(matchOwnerRule([rule], call({ input: JSON.stringify({ pid: 812, delivery_mode: "foreground" }) }))).toBeUndefined();
    expect(matchOwnerRule([rule], call({ input: JSON.stringify({ pid: 812, debug_image_out: "/tmp/a.png" }) }))).toBeUndefined();
    // another bot, another person, a tool that is not a screen action
    expect(matchOwnerRule([rule], call({ botId: "bot_2" }))).toBeUndefined();
    expect(matchOwnerRule([rule], call({ ownerId: BOB }))).toBeUndefined();
    expect(matchOwnerRule([rule], call({ tool: "mcp__sagax-desktop__run_command", input: JSON.stringify({ command: "ls" }) }))).toBeUndefined();
  });

  it("an app rule missing its signature never covers anything (no empty scope, no older label-only rule)", () => {
    const base = appRule(cardRuleCandidate({ tool: CLICK, input: clickSafari, app: SAFARI }, {})!);
    const call = { ownerId: ALICE, botId: "bot_1", tool: CLICK, input: clickSafari, app: SAFARI };
    expect(matchOwnerRule([{ ...base, scope: {} }], call)).toBeUndefined();
    expect(matchOwnerRule([{ ...base, scope: { [APP_KEY]: "Safari" } }], call)).toBeUndefined();
  });

  it("answers an ordinary card, never a held card, a key or a turn that is not the person's own", () => {
    const rule = appRule(cardRuleCandidate({ tool: CLICK, input: clickSafari, app: SAFARI }, {})!);
    const call = { ownerId: ALICE, botId: "bot_1", tool: CLICK, input: clickSafari, app: SAFARI };
    expect(ownerDecision({ mode: "approval", rules: [rule], call })).toMatchObject({ kind: "allow", source: "owner-rule" });
    expect(ownerDecision({ mode: "approval", rules: [rule], call, autonomyRefused: true }).kind).toBe("card");
    expect(ownerDecision({ mode: "approval", rules: [rule], call, stepUpRequired: true }).kind).toBe("card");
    expect(ownerDecision({ mode: "approval", rules: [rule], call, personMustAnswer: true }).kind).toBe("card");
  });

  it("a held, an admin's or an origin card keeps its own rule", () => {
    for (const situation of [{ held: true }, { from: "admin" as const }, { from: "origin" as const }]) {
      expect(cardRuleCandidate({ tool: CLICK, input: clickSafari, app: SAFARI }, situation)?.tool).not.toBe(APP_RULE_TOOL);
    }
  });
});

describe("Bypass on the owner's own computer, and what always wins over it (#1065)", () => {
  const DESKTOP_READ = "mcp__sagax-desktop__read_file";
  const DESKTOP_RUN = "mcp__sagax-desktop__run_command";
  const readme = JSON.stringify({ path: "C:/repo/README.md" });
  const listing = JSON.stringify({ command: "Get-ChildItem -Recurse docs", cwd: "C:/repo", timeout_seconds: 30 });
  const desktop = (tool: string, input: string): RuleCall => ({ ownerId: ALICE, botId: "bot-a", tool, input });

  it("Bypass answers a read or a command on the owner's real computer from their own turn, with no card", () => {
    for (const [tool, input] of [[DESKTOP_READ, readme], [DESKTOP_RUN, listing]] as const) {
      expect(ownerDecision({ mode: "bypass", rules: [], call: desktop(tool, input), autonomyRefused: true, ownComputerOwnTurn: true }))
        .toMatchObject({ kind: "allow", source: "owner-bypass" });
    }
  });

  it("Auto answers it too from the owner's own turn (2026-10-26), journaled as auto", () => {
    for (const [tool, input] of [[DESKTOP_READ, readme], [DESKTOP_RUN, listing]] as const) {
      expect(ownerDecision({ mode: "auto", rules: [], call: desktop(tool, input), autonomyRefused: true, ownComputerOwnTurn: true }))
        .toEqual({ kind: "allow", source: "owner-auto" });
    }
  });

  it("Approval keeps the card there, and another origin (a webhook, another person's bot) keeps it under Auto and Bypass", () => {
    expect(ownerDecision({ mode: "approval", rules: [], call: desktop(DESKTOP_READ, readme), autonomyRefused: true, ownComputerOwnTurn: true }))
      .toMatchObject({ kind: "card", reason: "origin" });
    for (const mode of ["auto", "bypass"] as const) {
      expect(ownerDecision({ mode, rules: [], call: desktop(DESKTOP_READ, readme), autonomyRefused: true }))
        .toMatchObject({ kind: "card", reason: "origin" });
      expect(ownerDecision({ mode, rules: [], call: desktop(DESKTOP_READ, readme), autonomyRefused: true, ownComputerOwnTurn: true, crossPerson: true }))
        .toEqual({ kind: "card", reason: "cross-person" });
    }
  });

  it("a hold, a security key and the owner's deny rule still stop Bypass on the owner's computer", () => {
    const rm = JSON.stringify({ command: "rm -rf docs", cwd: "C:/repo" });
    const own = { mode: "bypass" as const, autonomyRefused: true, ownComputerOwnTurn: true };
    // 2026-11-06: a delete is the person's own authorized work in Bypass
    expect(ownerDecision({ ...own, rules: [], call: desktop(DESKTOP_RUN, rm) })).toEqual({ kind: "allow", source: "owner-bypass" });
    expect(ownerDecision({ ...own, rules: [], call: desktop(DESKTOP_READ, readme), personMustAnswer: true })).toMatchObject({ kind: "card", reason: "hold" });
    expect(ownerDecision({ ...own, rules: [], call: desktop(DESKTOP_READ, readme), stepUpRequired: true })).toMatchObject({ kind: "card", reason: "step-up" });
    const deny: OwnerRule = { id: "d1", ownerId: ALICE, botId: null, tool: "sagax-desktop__read_file", scope: {}, behavior: "deny", description: "never", createdAt: 1, updatedAt: 1 };
    expect(ownerDecision({ ...own, rules: [deny], call: desktop(DESKTOP_READ, readme) })).toMatchObject({ kind: "deny" });
  });

  it("an organization rule Refuser or Demander d'abord wins over Bypass, Auto and an Always allow", () => {
    const allowed = ownerDecision({ mode: "bypass", rules: [], call: desktop(DESKTOP_READ, readme), autonomyRefused: true, ownComputerOwnTurn: true });
    expect(allowed.kind).toBe("allow");
    for (const mode of ["full", "auto", "ask"] as const) {
      const orgAsk = autoVerdict(mode, DESKTOP_READ, { sagaxGate: true, customRule: { behavior: "ask", id: "orule_ask" } });
      expect(orgAsk.source).toBe("custom-rule-ask");
      expect(ownerVerdictOver(orgAsk, allowed, DESKTOP_READ)).toMatchObject({ approve: null, source: "custom-rule-ask" });
      const orgDeny = autoVerdict(mode, DESKTOP_READ, { sagaxGate: true, emailDraftApproved: true, customRule: { behavior: "deny", id: "orule_deny" } });
      expect(orgDeny.source).toBe("custom-rule-deny");
      expect(ownerVerdictOver(orgDeny, allowed, DESKTOP_READ)).toMatchObject({ approve: null, source: "custom-rule-deny" });
    }
    const ruleAllow = ownerDecision({ mode: "auto", rules: [{ id: "a1", ownerId: ALICE, botId: null, tool: "sagax-desktop__read_file", scope: {}, behavior: "allow", description: "ok", createdAt: 1, updatedAt: 1 }], call: desktop(DESKTOP_READ, readme) });
    expect(ruleAllow.kind).toBe("allow");
    expect(ownerVerdictOver(autoVerdict("auto", DESKTOP_READ, { customRule: { behavior: "ask", id: "orule_ask" } }), ruleAllow, DESKTOP_READ)?.approve).toBeNull();
    // with no rule in the way, the owner's Bypass answers
    expect(ownerVerdictOver(autoVerdict("full", DESKTOP_READ, { sagaxGate: true }), allowed, DESKTOP_READ))
      .toMatchObject({ approve: `approved ${DESKTOP_READ} (bypass)`, source: "owner-bypass" });
  });
});

describe("an outward engine connector call at Approve for me (2026-10-30)", () => {
  it("the owner's automatic level never answers what the outbound guard holds; a saved rule still does", () => {
    // a gateway tool name that does not read as a send, flagged outward by the driver
    const tool = "cursor__user-Tasks-do_5fthing___3";
    const base = autoVerdict("auto", "other", { toolName: tool, outbound: true });
    expect(base.source).toBe("outbound-guard");
    const auto = ownerDecision({ mode: "auto", rules: [], call: { ownerId: ALICE, botId: "b1", tool } });
    expect(auto).toMatchObject({ kind: "allow", source: "owner-auto" });
    expect(ownerVerdictOver(base, auto, tool)).toEqual(base);
    const rule: OwnerRule = { id: "a1", ownerId: ALICE, botId: null, tool, scope: {}, behavior: "allow", description: "ok", createdAt: 1, updatedAt: 1 };
    const ruled = ownerDecision({ mode: "approval", rules: [rule], call: { ownerId: ALICE, botId: "b1", tool } });
    expect(ownerVerdictOver(base, ruled, tool)).toMatchObject({ source: "owner-rule" });
  });
});

describe("Toujours permettre: ce fichier ou tout le dossier (#1065)", () => {
  const DESKTOP_READ = "mcp__sagax-desktop__read_file";
  const DESKTOP_LIST = "mcp__sagax-desktop__list_files";
  const DESKTOP_WRITE = "mcp__sagax-desktop__write_file";
  const read = (path: string) => JSON.stringify({ path });
  const desktop = (tool: string, input: string): RuleCall => ({ ownerId: ALICE, botId: "bot-a", tool, input });
  const folderRule = (path: string, tool = DESKTOP_READ, over: Partial<OwnerRule> = {}): OwnerRule => {
    const candidate = folderRuleCandidate({ tool, input: read(path) }, {})!;
    return { id: "f1", ownerId: ALICE, botId: "bot-a", tool: candidate.tool, scope: candidate.scope, behavior: "allow", description: candidate.description, createdAt: 1, updatedAt: 1, ...over };
  };

  it("keeps the exact path as before and offers the folder beside it", () => {
    const input = read("/repo/docs/TODO.md");
    expect(cardRuleCandidate({ tool: DESKTOP_READ, input }, {})?.scope).toEqual({ path: "/repo/docs/TODO.md" });
    const folder = folderRuleCandidate({ tool: DESKTOP_READ, input }, {});
    expect(folder?.scope).toEqual({ [FOLDER_KEY]: "/repo/docs" });
    expect(folder?.description).toContain("/repo/docs");
    expect(folder?.tool).toBe("sagax-desktop__read_file");
  });

  it("a listing or a search names its own folder", () => {
    expect(folderRuleCandidate({ tool: DESKTOP_LIST, input: read("C:\\Repo\\Docs") }, {})?.scope).toEqual({ [FOLDER_KEY]: "c:/repo/docs" });
    const search = JSON.stringify({ path: "/repo/docs", pattern: "TODO", glob: "*.md" });
    expect(folderRuleCandidate({ tool: "mcp__sagax-desktop__search_files", input: search }, {})?.scope).toEqual({ [FOLDER_KEY]: "/repo/docs" });
  });

  it("covers the folder, its subfolders and the same server's reads", () => {
    const rule = folderRule("/repo/docs/TODO.md");
    for (const path of ["/repo/docs/TODO.md", "/repo/docs/other.md", "/repo/docs/deep/er/x.md", "/repo/docs"]) {
      expect(matchOwnerRule([rule], desktop(DESKTOP_READ, read(path))), path).toBeDefined();
    }
    for (const path of ["/repo/README.md", "/repo/docs-old/x.md", "/repo/docsx", "/other/docs/x.md"]) {
      expect(matchOwnerRule([rule], desktop(DESKTOP_READ, read(path))), path).toBeUndefined();
    }
    expect(matchOwnerRule([rule], desktop(DESKTOP_LIST, read("/repo/docs")))).toBeDefined();
    expect(matchOwnerRule([rule], desktop("mcp__sagax-desktop__search_files", read("/repo/docs/deep")))).toBeDefined();
    expect(matchOwnerRule([rule], desktop("Read", read("/repo/docs/x.md")))).toBeUndefined();
    expect(matchOwnerRule([rule], desktop(DESKTOP_WRITE, read("/repo/docs/x.md")))).toBeUndefined();
    expect(matchOwnerRule([rule], { ...desktop(DESKTOP_READ, read("/repo/docs/x.md")), botId: "bot-b" })).toBeUndefined();
    expect(pathInFolder("/repo/docs/../secret", "/repo/docs")).toBe(false);
  });

  it("never follows a .. out of the folder", () => {
    const rule = folderRule("/repo/docs/TODO.md");
    expect(matchOwnerRule([rule], desktop(DESKTOP_READ, read("/repo/docs/../.ssh/id_rsa")))).toBeUndefined();
    expect(matchOwnerRule([rule], desktop(DESKTOP_READ, read("/repo/docs/../README.md")))).toBeUndefined();
  });

  it("a command or any other exact argument is never covered by a folder rule", () => {
    const rule = folderRule("/repo/docs/TODO.md");
    expect(matchOwnerRule([rule], desktop(DESKTOP_READ, JSON.stringify({ path: "/repo/docs/a.md", command: "cat x" })))).toBeUndefined();
    expect(matchOwnerRule([rule], desktop(DESKTOP_READ, JSON.stringify({ path: "/repo/docs/a.md", file_path: "/repo/src/b.md" })))).toBeUndefined();
  });

  it("never covers a sensitive path (dotfile, credential, /proc), even inside the folder", () => {
    const rule = folderRule("/repo/docs/TODO.md");
    for (const path of ["/repo/docs/.env", "/repo/docs/.git/config", "/repo/docs/id_ed25519", "/repo/docs/server.pem", "/repo/docs/.ssh/config", "/repo/docs/a%2e%2e/x"]) {
      expect(matchOwnerRule([rule], desktop(DESKTOP_READ, read(path))), path).toBeUndefined();
      expect(ownerDecision({ mode: "approval", rules: [rule], call: desktop(DESKTOP_READ, read(path)) }), path).toMatchObject({ kind: "card", reason: "no-rule" });
    }
    expect(matchOwnerRule([rule], desktop(DESKTOP_READ, read("/repo/docs/ok.md")))).toBeDefined();
  });

  it("is not offered for a sensitive file or folder, the root, a drive or the home folder", () => {
    for (const path of ["/repo/.ssh/config", "/repo/.github/workflows/ci.yml", "/repo/.env", "/home/example/.aws/credentials", "/README.md", "README.md", "C:\\README.md", "~/notes.md", "/proc/self/environ", "/repo/../etc/passwd"]) {
      expect(folderRuleCandidate({ tool: DESKTOP_READ, input: read(path) }, {}), path).toBeUndefined();
    }
    expect(folderRuleCandidate({ tool: DESKTOP_LIST, input: read("/") }, {})).toBeUndefined();
    expect(folderRuleCandidate({ tool: DESKTOP_LIST, input: read(".github") }, {})).toBeUndefined();
  });

  it("is not offered for a command, an outward message, a held card or another situation", () => {
    expect(folderRuleCandidate({ tool: "Bash", input: JSON.stringify({ command: "ls /repo/docs" }), command: "ls /repo/docs" }, {})).toBeUndefined();
    expect(folderRuleCandidate({ tool: "mcp__mail__send_email", input: JSON.stringify({ to: ["a@b.ca"], body: "x" }) }, {})).toBeUndefined();
    const input = read("/repo/docs/TODO.md");
    expect(folderRuleCandidate({ tool: DESKTOP_READ, input }, { held: true })).toBeUndefined();
    for (const from of ["hold", "origin"] as const) expect(folderRuleCandidate({ tool: DESKTOP_READ, input }, { from })).toBeUndefined();
    expect(folderRuleCandidate({ tool: DESKTOP_READ, input }, { from: "admin" })).toBeUndefined();
    const roots = ["/data/workspaces/bot-1", "/data/task-workspaces/bot-1/thread-1"];
    expect(folderRuleCandidate({ tool: "Bash", input: JSON.stringify({ command: "ls /data/workspaces/bot-1" }), command: "ls /data/workspaces/bot-1", roots }, { from: "admin" })).toBeUndefined();
    expect(folderRuleCandidate({ tool: DESKTOP_WRITE, input: JSON.stringify({ path: "/data/workspaces/bot-1/inbox/nova/a.txt", content: "x" }), roots }, { from: "admin" })).toBeUndefined();
    expect(folderRuleCandidate({ tool: DESKTOP_READ, input: read("/etc/passwd"), roots }, { from: "admin" })).toBeUndefined();
    const inbox = folderRuleCandidate({ tool: DESKTOP_READ, input: read("/data/workspaces/bot-1/inbox/nova/a.txt"), roots }, { from: "admin" });
    expect(inbox?.scope).toEqual({ [FOLDER_KEY]: "/data/workspaces/bot-1" });
    expect(inbox?.from).toBe("admin");
    expect(inbox?.writes).toBeUndefined();
    const thread = folderRuleCandidate({ tool: DESKTOP_READ, input: read("/data/task-workspaces/bot-1/thread-1/notes.md"), roots }, { from: "admin" });
    expect(thread?.scope).toEqual({ [FOLDER_KEY]: "/data/task-workspaces/bot-1/thread-1" });
    expect(folderRuleCandidate({
      tool: DESKTOP_READ,
      input: JSON.stringify({ path: "/data/workspaces/bot-1/inbox/a.txt", file_path: "/data/task-workspaces/bot-1/thread-1/b.md" }),
      roots,
    }, { from: "admin" })).toBeUndefined();
    const rule: OwnerRule = {
      id: "f-admin", ownerId: ALICE, botId: "bot-a", tool: inbox!.tool, scope: inbox!.scope,
      behavior: "allow", description: inbox!.description, createdAt: 1, updatedAt: 1, from: "admin",
    };
    expect(matchOwnerRule([rule], desktop(DESKTOP_READ, read("/data/workspaces/bot-1/inbox/nova/b.txt")))).toBeDefined();
    expect(matchOwnerRule([rule], desktop(DESKTOP_LIST, read("/data/workspaces/bot-1/inbox")))).toBeDefined();
    expect(matchOwnerRule([rule], desktop("mcp__sagax-desktop__search_files", read("/data/workspaces/bot-1/inbox/nova")))).toBeDefined();
    expect(matchOwnerRule([rule], desktop(DESKTOP_WRITE, JSON.stringify({ path: "/data/workspaces/bot-1/inbox/x.txt", content: "x" })))).toBeUndefined();
    expect(matchOwnerRule([rule], desktop(DESKTOP_READ, read("/data/workspaces/bot-1/inbox/.ssh/id")))).toBeUndefined();
    expect(matchOwnerRule([rule], desktop("Read", read("/data/workspaces/bot-1/inbox/a.txt")))).toBeUndefined();
    expect(matchOwnerRule([rule], { ...desktop(DESKTOP_READ, read("/data/workspaces/bot-1/inbox/a.txt")), botId: "bot-b" })).toBeUndefined();
  });

  const write = (path: string) => JSON.stringify({ path, content: "x" });

  it("covers file writes in the folder and its subfolders, flagged as writes on the card", () => {
    const candidate = folderRuleCandidate({ tool: DESKTOP_WRITE, input: write("/repo/docs/new.md") }, {})!;
    expect(candidate.scope).toEqual({ [FOLDER_KEY]: "/repo/docs" });
    expect(candidate.writes).toBe(true);
    expect(folderRuleCandidate({ tool: DESKTOP_READ, input: read("/repo/docs/a.md") }, {})?.writes).toBeUndefined();
    const rule = folderRule("/repo/docs/new.md", DESKTOP_WRITE);
    for (const path of ["/repo/docs/new.md", "/repo/docs/a/b/c.md"]) {
      expect(ownerDecision({ mode: "approval", rules: [rule], call: desktop(DESKTOP_WRITE, write(path)) }), path).toMatchObject({ kind: "allow", source: "owner-rule" });
    }
    for (const path of ["/repo/src/x.ts", "/repo/docs-old/x.md", "/repo/docs/../src/x.ts"]) {
      expect(ownerDecision({ mode: "approval", rules: [rule], call: desktop(DESKTOP_WRITE, write(path)) }), path).toMatchObject({ kind: "card" });
    }
    // a write rule never answers a read, and a read rule never a write
    expect(matchOwnerRule([rule], desktop(DESKTOP_READ, read("/repo/docs/a.md")))).toBeUndefined();
    expect(matchOwnerRule([folderRule("/repo/docs/a.md")], desktop(DESKTOP_WRITE, write("/repo/docs/a.md")))).toBeUndefined();
  });

  it("a write to a sensitive path inside the folder keeps its card", () => {
    const rule = folderRule("/repo/docs/new.md", DESKTOP_WRITE);
    for (const path of ["/repo/docs/.env", "/repo/docs/.git/hooks/pre-commit", "/repo/docs/id_rsa", "/repo/docs/server.key", "/repo/docs/.ssh/authorized_keys"]) {
      expect(matchOwnerRule([rule], desktop(DESKTOP_WRITE, write(path))), path).toBeUndefined();
      expect(ownerDecision({ mode: "approval", rules: [rule], call: desktop(DESKTOP_WRITE, write(path)) }), path).toMatchObject({ kind: "card", reason: "no-rule" });
    }
    expect(folderRuleCandidate({ tool: DESKTOP_WRITE, input: write("/repo/.ssh/config") }, {})).toBeUndefined();
  });

  const MOVE = "mcp__sagax-desktop__move_file";
  const DELETE = "mcp__sagax-desktop__delete_file";
  const DELETE_MANY = "mcp__sagax-desktop__delete_files";
  const decide = (rules: OwnerRule[], tool: string, input: string) => ownerDecision({ mode: "approval", rules, call: desktop(tool, input) });

  it("a rename or a move is covered when both paths are in the folder, never when one leaves it", () => {
    const rule = folderRule("/repo/docs/new.md", DESKTOP_WRITE);
    expect(decide([rule], MOVE, JSON.stringify({ from: "/repo/docs/a.md", to: "/repo/docs/sub/b.md" }))).toMatchObject({ kind: "allow" });
    expect(decide([rule], MOVE, JSON.stringify({ source: "/repo/docs/a.md", destination: "/repo/docs/b.md" }))).toMatchObject({ kind: "allow" });
    expect(decide([rule], MOVE, JSON.stringify({ from: "/repo/docs/a.md", to: "/repo/src/b.md" }))).toMatchObject({ kind: "card" });
    expect(decide([rule], MOVE, JSON.stringify({ from: "/repo/src/a.md", to: "/repo/docs/b.md" }))).toMatchObject({ kind: "card" });
    expect(decide([rule], MOVE, JSON.stringify({ from: "/repo/docs/a.md", to: "/repo/docs/../src/b.md" }))).toMatchObject({ kind: "card" });
    expect(decide([rule], MOVE, JSON.stringify({ from: "/repo/docs/a.md", to: "/repo/docs/.env" }))).toMatchObject({ kind: "card" });
    const candidate = folderRuleCandidate({ tool: MOVE, input: JSON.stringify({ from: "/repo/docs/a/x.md", to: "/repo/docs/b/y.md" }) }, {})!;
    expect(candidate.scope).toEqual({ [FOLDER_KEY]: "/repo/docs" });
    expect(candidate.writes).toBe(true);
  });

  it("a write rule of the folder also covers deletes in it, recursive or in a batch, with no delete card", () => {
    const rule = folderRule("/repo/docs/new.md", DESKTOP_WRITE);
    expect(decide([rule], DELETE, JSON.stringify({ path: "/repo/docs/old.md" }))).toMatchObject({ kind: "allow", source: "owner-rule" });
    expect(decide([rule], DELETE, JSON.stringify({ path: "/repo/docs/old", recursive: true }))).toMatchObject({ kind: "allow" });
    expect(decide([rule], DELETE_MANY, JSON.stringify({ paths: ["/repo/docs/a.md", "/repo/docs/b/c.md"] }))).toMatchObject({ kind: "allow" });
    // outside, sensitive or escaping: the card stays
    expect(decide([rule], DELETE, JSON.stringify({ path: "/repo/src/old.md", recursive: true }))).toMatchObject({ kind: "card" });
    expect(decide([rule], DELETE_MANY, JSON.stringify({ paths: ["/repo/docs/a.md", "/repo/src/b.md"] }))).toMatchObject({ kind: "card" });
    expect(decide([rule], DELETE_MANY, JSON.stringify({ paths: ["/repo/docs/a.md", "/repo/docs/.env"] }))).toMatchObject({ kind: "card" });
    expect(decide([rule], DELETE, JSON.stringify({ path: "/repo/docs/.git", recursive: true }))).toMatchObject({ kind: "card" });
    expect(decide([rule], DELETE, JSON.stringify({ path: "/repo/docs/../src" }))).toMatchObject({ kind: "card" });
    // another server's tool, and a read rule, never answer a delete
    expect(decide([rule], "mcp__other__delete_file", JSON.stringify({ path: "/repo/docs/x" }))).toMatchObject({ kind: "card" });
    expect(decide([folderRule("/repo/docs/a.md")], DELETE, JSON.stringify({ path: "/repo/docs/x.md" }))).toMatchObject({ kind: "card" });
  });

  it("a delete card offers the folder rule too, and a deny rule, a key and a hold still come first", () => {
    const candidate = folderRuleCandidate({ tool: DELETE, input: JSON.stringify({ path: "/repo/docs/old", recursive: true }) }, {})!;
    expect(candidate.scope).toEqual({ [FOLDER_KEY]: "/repo/docs" });
    expect(candidate.writes).toBe(true);
    expect(candidate.destructive).toBeUndefined();
    const rule = folderRule("/repo/docs/new.md", DESKTOP_WRITE);
    const call = desktop(DELETE, JSON.stringify({ path: "/repo/docs/old.md" }));
    const deny: OwnerRule = { ...rule, id: "d2", behavior: "deny", scope: { [FOLDER_KEY]: "/repo/docs/old.md" } };
    expect(ownerDecision({ mode: "approval", rules: [rule, deny], call })).toMatchObject({ kind: "deny" });
    expect(ownerDecision({ mode: "approval", rules: [rule], call, stepUpRequired: true })).toMatchObject({ kind: "card", reason: "step-up" });
    expect(ownerDecision({ mode: "approval", rules: [rule], call, personMustAnswer: true })).toMatchObject({ kind: "card", reason: "hold" });
  });

  it("an owner Refuser or Demander d'abord rule wins over the folder allow", () => {
    const allow = folderRule("/repo/docs/TODO.md");
    const call = desktop(DESKTOP_READ, read("/repo/docs/TODO.md"));
    const deny: OwnerRule = { ...allow, id: "d1", behavior: "deny", scope: { path: "/repo/docs/TODO.md" } };
    const ask: OwnerRule = { ...allow, id: "k1", behavior: "ask", scope: { [FOLDER_KEY]: "/repo" } };
    expect(ownerDecision({ mode: "bypass", rules: [allow, deny], call })).toMatchObject({ kind: "deny" });
    expect(ownerDecision({ mode: "auto", rules: [allow, ask], call })).toMatchObject({ kind: "card", reason: "ask-rule" });
    expect(ownerDecision({ mode: "approval", rules: [allow], call })).toMatchObject({ kind: "allow", source: "owner-rule" });
  });

  it("an organization Refuser or Demander d'abord rule wins over the folder allow", () => {
    const allow = ownerDecision({ mode: "approval", rules: [folderRule("/repo/docs/TODO.md")], call: desktop(DESKTOP_READ, read("/repo/docs/x.md")) });
    expect(allow.kind).toBe("allow");
    const orgAsk = autoVerdict("auto", DESKTOP_READ, { sagaxGate: true, customRule: { behavior: "ask", id: "orule_ask" } });
    expect(ownerVerdictOver(orgAsk, allow, DESKTOP_READ)).toMatchObject({ approve: null, source: "custom-rule-ask" });
    const orgDeny = autoVerdict("auto", DESKTOP_READ, { sagaxGate: true, customRule: { behavior: "deny", id: "orule_deny" } });
    expect(ownerVerdictOver(orgDeny, allow, DESKTOP_READ)).toMatchObject({ approve: null, source: "custom-rule-deny" });
  });

  it("a security key, a hold and a turn that is not the person's own still keep the card", () => {
    const rule = folderRule("/repo/docs/TODO.md");
    const call = desktop(DESKTOP_READ, read("/repo/docs/x.md"));
    expect(ownerDecision({ mode: "approval", rules: [rule], call, stepUpRequired: true })).toMatchObject({ kind: "card", reason: "step-up" });
    expect(ownerDecision({ mode: "approval", rules: [rule], call, personMustAnswer: true })).toMatchObject({ kind: "card", reason: "hold" });
    expect(ownerDecision({ mode: "approval", rules: [rule], call, autonomyRefused: true })).toMatchObject({ kind: "card", reason: "origin" });
    expect(ownerDecision({ mode: "approval", rules: [rule], call, crossPerson: true })).toMatchObject({ kind: "card", reason: "cross-person" });
  });
});
