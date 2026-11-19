// #4720: a connector's tool the provider refuses for one person's access is
// remembered for that person on every engine, said to the person once per
// connector, told to the model on every turn until it answers again, and
// never invented: only a refusal really received counts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeEvent, SteerOutcome } from "../contracts.ts";
import { classifyError, needsReconnect } from "../drivers/retry.ts";
import { classifyRoutineFailure } from "../routines/routine-recovery.ts";
import { createTurnReachPrompt } from "../index-leaves/turnReachPrompt.ts";
import { connectorPrincipalFor } from "../harness-connectors.ts";
import { grokCatalogSection, readGrokCatalog } from "../drivers/acp/grok-tool-catalog.ts";
import { noteTurnReach, reachContributions, registerReachProvider, resetReachProviders, turnPersonFor, turnReachFor } from "../turns/turn-reach.ts";
import { createToolRefusalMemory, permissionRefusalOf, refusalLines, refusalReason, refusalTarget, REFUSAL_TTL_MS } from "../tools/tool-refusals.ts";
import { createLoopGuard } from "./loop-guard.ts";
import { createToolRefusalGuard } from "./tool-refusal-guard.ts";

// What X answered through the grok.com X connection, 2026-11-18, verbatim.
const X_BILLING = 'Failed to call cursor__user-X-get_5fusers_5fby_5fusername___6: {"detail":"This endpoint is billed to the user\'s developer account, and this token does not grant the developer.billing.write scope. Use a user token that grants it, or a different endpoint.","reason":"billing-scope-missing","required_scope":"developer.billing.write","title":"Client Forbidden","type":"https://api.x.com/2/problems/client-forbidden"}';
const X_TITLE = "mcp__cursor__user-X-get_5fusers_5fby_5fusername___6";
// An OAuth resource server's refusal, as Claude Code reports an MCP tool error.
const GITHUB_SCOPE = '{"isError":true,"content":[{"type":"text","text":"HTTP 403: insufficient_scope. The token lacks the repo scope required for this call."}]}';
const RATE_LIMITED = '{"title":"Too Many Requests","detail":"Too Many Requests","type":"about:blank","status":429}';
const UNAUTHORIZED = '{"title":"Unauthorized","type":"about:blank","status":401,"detail":"Unauthorized"}';

const dirs: string[] = [];
const dataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-refusals-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  resetReachProviders();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function rig(options: { person?: Record<string, string>; now?: () => number; dir?: string } = {}) {
  const clock = { at: 1_000_000 };
  const now = options.now ?? (() => clock.at);
  const dir = options.dir ?? dataDir();
  const memory = createToolRefusalMemory({ dataDir: dir, now });
  const told: Array<{ threadId: string; name: string; output: string }> = [];
  const persons = options.person ?? { "chat-a": "ada@example.com", "chat-b": "ada@example.com", "run-1": "ada@example.com", "run-2": "ada@example.com" };
  const guard = createToolRefusalGuard({
    memory,
    person: (threadId) => persons[threadId],
    tell: (threadId, row) => told.push({ threadId, name: row.name, output: row.output }),
    now,
  });
  let seq = 0;
  const call = (threadId: string, start: { title?: string; tool?: string }, result: { ok: boolean; output?: string }) => {
    const itemId = `i${++seq}`;
    const base = { eventId: `e${seq}`, provider: "fake", threadId, createdAt: "2026-11-18T00:00:00.000Z" };
    guard.onEvent({ ...base, type: "item.started", itemType: "tool", itemId, ...start } as RuntimeEvent);
    guard.onEvent({ ...base, type: "item.completed", itemType: "tool", itemId, ...result } as RuntimeEvent);
  };
  return { memory, told, call, clock, dir };
}

describe("classifyError: a durable permission refusal", () => {
  it("is permission for a 403 that names why, auth for a 401 or a bare 403, transient for a 429", () => {
    expect(classifyError({ text: X_BILLING })).toEqual({ transient: false, reason: "permission" });
    expect(classifyError({ text: GITHUB_SCOPE }).reason).toBe("permission");
    expect(classifyError({ text: "403 Resource not accessible by integration" }).reason).toBe("permission");
    expect(classifyError({ text: UNAUTHORIZED }).reason).toBe("auth");
    expect(classifyError({ text: "403 Forbidden" }).reason).toBe("auth");
    expect(classifyError({ text: RATE_LIMITED })).toMatchObject({ transient: true, reason: "rate_limited" });
  });
});

describe("the tool refusal memory, fed by the runtime bus", () => {
  it("reads a Grok gateway call as its connector and decoded tool", () => {
    expect(refusalTarget({ title: X_TITLE })).toEqual({ connector: "X", tool: "get_users_by_username" });
    expect(refusalTarget({ title: "mcp__github__create_issue" })).toEqual({ connector: "github", tool: "create_issue" });
    expect(refusalTarget({ title: "Bash" })).toBeNull();
    expect(permissionRefusalOf(X_BILLING, 5)).toMatchObject({ reason: "billing-scope-missing", requiredScope: "developer.billing.write", at: 5 });
  });

  it("remembers X's billing refusal for the person and tells them once for two bots and three runs", () => {
    const r = rig();
    for (const threadId of ["chat-a", "chat-b", "run-1", "run-2", "run-1"]) call(r, threadId);
    expect(r.memory.list("ada@example.com")).toEqual([expect.objectContaining({ connector: "X", tool: "get_users_by_username", reason: "billing-scope-missing" })]);
    expect(r.told).toHaveLength(1);
    expect(r.told[0]!.name).toContain("X refused get_users_by_username for your access (billing-scope-missing, it needs developer.billing.write)");
    expect(r.told[0]!.name).toContain("X bills this to your own X developer account");
    expect(r.told[0]!.output).toContain("This endpoint is billed to the user's developer account");
    function call(rr: typeof r, threadId: string) { rr.call(threadId, { title: X_TITLE }, { ok: false, output: X_BILLING }); }
  });

  it("forgets it when the tool answers, when the connector is signed in again, and after the TTL", () => {
    const r = rig();
    const refuse = () => r.call("chat-a", { title: X_TITLE }, { ok: false, output: X_BILLING });
    refuse();
    r.call("chat-a", { title: X_TITLE }, { ok: true, output: '{"data":{"id":"1"}}' });
    expect(r.memory.list("ada@example.com")).toEqual([]);
    refuse();
    r.memory.forgetConnector("ada@example.com", "X");
    expect(r.memory.list("ada@example.com")).toEqual([]);
    // signed in again and still refused: said again, the access is new
    refuse();
    expect(r.told).toHaveLength(2);
    r.clock.at += REFUSAL_TTL_MS + 1;
    expect(r.memory.list("ada@example.com")).toEqual([]);
  });

  it("follows the same path for another connector on another engine (Claude's mcp__ title, Codex's tool id)", () => {
    const r = rig();
    r.call("chat-a", { title: "mcp__github__create_issue" }, { ok: false, output: GITHUB_SCOPE });
    r.call("chat-b", { title: "create_issue", tool: "github/create_pull_request" }, { ok: false, output: GITHUB_SCOPE });
    expect(r.memory.list("ada@example.com").map((row) => `${row.connector}/${row.tool}/${row.reason}`)).toEqual([
      "github/create_issue/insufficient_scope", "github/create_pull_request/insufficient_scope",
    ]);
    expect(r.told).toHaveLength(1);
    expect(r.told[0]!.name).toContain("github refused create_issue for your access (insufficient_scope)");
  });

  it("never remembers a 401, a 429, a plain failure, a built-in tool or a turn with no person", () => {
    const r = rig({ person: { "chat-a": "ada@example.com" } });
    r.call("chat-a", { title: X_TITLE }, { ok: false, output: UNAUTHORIZED });
    r.call("chat-a", { title: X_TITLE }, { ok: false, output: RATE_LIMITED });
    r.call("chat-a", { title: X_TITLE }, { ok: false, output: "Not found" });
    r.call("chat-a", { title: "Bash" }, { ok: false, output: X_BILLING });
    r.call("room-1", { title: X_TITLE }, { ok: false, output: X_BILLING });
    expect(r.memory.list("ada@example.com")).toEqual([]);
    expect(r.told).toEqual([]);
  });

  it("keeps people apart and survives a restart", () => {
    const r = rig({ person: { "chat-a": "ada@example.com", "chat-z": "zed@example.com" } });
    r.call("chat-a", { title: X_TITLE }, { ok: false, output: X_BILLING });
    expect(r.memory.list("zed@example.com")).toEqual([]);
    const again = createToolRefusalMemory({ dataDir: r.dir, now: () => r.clock.at });
    expect(again.get("ada@example.com", "X", "get_users_by_username")).toMatchObject({ reason: "billing-scope-missing" });
    // told is kept too: a restart does not tell the person again
    expect(again.record("ada@example.com", "X", "get_users_by_id", permissionRefusalOf(X_BILLING, r.clock.at)!).tell).toBe(false);
  });
});

describe("what the model is told", () => {
  it("one line per connector for every engine, the way around only beside a refusal really held", () => {
    const memory = createToolRefusalMemory({ now: () => 10 });
    expect(refusalLines(memory.list("ada@example.com"))).toEqual([]);
    memory.record("ada@example.com", "X", "get_users_by_username", permissionRefusalOf(X_BILLING, 10)!);
    memory.record("ada@example.com", "github", "create_issue", permissionRefusalOf(GITHUB_SCOPE, 10)!);
    const lines = refusalLines(memory.list("ada@example.com"));
    expect(lines).toEqual([
      "github last refused create_issue for this person (insufficient_scope) at 00:00 UTC; its access may have changed since, call it when the task needs it.",
      "X last refused get_users_by_username for this person (billing-scope-missing) at 00:00 UTC; its access may have changed since, call it when the task needs it. Another way: search_users with the handle, then get_users_posts with its id",
    ]);
    registerReachProvider("tool-refusals", ({ speakerPrincipalId, room }) => {
      if (room || !speakerPrincipalId) return null;
      const refused = memory.list(speakerPrincipalId);
      return refused.length ? { lines: refusalLines(refused), refused: refused.map((row) => `${row.connector}/${row.tool}`) } : null;
    });
    const reach = reachContributions({ speakerPrincipalId: "ada@example.com" });
    expect(reach.lines[1]).toContain("X last refused get_users_by_username for this person");
    expect(reach.lines[0]).toContain("github last refused create_issue for this person");
    expect(reach.refused).toEqual(["github/create_issue", "x/get_users_by_username"]);
    expect(reachContributions({ speakerPrincipalId: "zed@example.com" }).lines).toEqual([]);
    expect(reachContributions({ speakerPrincipalId: "ada@example.com", room: true }).lines).toEqual([]);
    noteTurnReach("t1", reach, "Ada@example.com");
    expect(turnPersonFor("t1")).toBe("ada@example.com");
    expect(turnReachFor("t1")?.refused).toEqual(["github/create_issue", "x/get_users_by_username"]);
  });

  it("Grok's catalog never names a refused tool as the example", () => {
    const tools = ["get_5fusage_5fcredits", "get_5fusers_5fby_5fusername", "get_5fusers_5fme", "search_5fusers"].map((name) => ({ name: `cursor__user-X-${name}___6`, enabled: true }));
    const catalog = readGrokCatalog({ servers: [{ name: "managed_gateway:cursor", type: "managedGateway", session: { enabled: true, status: "ready", tools } }] });
    expect(grokCatalogSection({ catalog })!.text).toContain("X (4 tools, e.g. cursor__user-X-get_5fusage_5fcredits___6)");
    const text = grokCatalogSection({ catalog, refused: ["x/get_usage_credits", "x/get_users_by_username"] })!.text;
    expect(text).toContain("X (4 tools, e.g. cursor__user-X-get_5fusers_5fme___6)");
  });

  it("a call already known refused that fails again gets one loop guard note with the reason, at once", async () => {
    const memory = createToolRefusalMemory({ now: () => 10 });
    memory.record("ada@example.com", "X", "get_users_by_username", permissionRefusalOf(X_BILLING, 10)!);
    const steers: string[] = [];
    const guard = createLoopGuard({
      settings: () => ({ enabled: true, steerAt: 5 }),
      append: () => {},
      live: () => true,
      waiting: () => false,
      canSteer: () => true,
      steer: (_threadId, note): Promise<SteerOutcome> => { steers.push(note); return Promise.resolve("steered"); },
      interrupt: () => Promise.resolve(),
      knownRefusal: (_threadId, step) => {
        const target = refusalTarget(step);
        const refusal = target ? memory.get("ada@example.com", target.connector, target.tool) : undefined;
        return refusal && target ? refusalReason(target.connector, refusal) : undefined;
      },
      log: () => {},
    });
    let seq = 0;
    const play = (title: string, ok: boolean) => {
      const itemId = `i${++seq}`;
      const base = { eventId: `e${seq}`, provider: "fake", threadId: "t", createdAt: "2026-11-18T00:00:00.000Z" };
      guard.onEvent({ ...base, type: "item.started", itemType: "tool", itemId, title, input: `{"username":"u${seq}"}` } as RuntimeEvent);
      guard.onEvent({ ...base, type: "item.completed", itemType: "tool", itemId, ok, output: X_BILLING } as RuntimeEvent);
    };
    play("mcp__cursor__user-X-get_5fusers_5fme___6", false);
    expect(steers).toEqual([]);
    play(X_TITLE, false);
    play(X_TITLE, false);
    expect(steers).toHaveLength(1);
    expect(steers[0]).toContain("was refused for this person before too: X answered billing-scope-missing, needs developer.billing.write");
    expect(steers[0]).toContain("Instead: search_users with the handle, then get_users_posts with its id.");
    // #4919: the note says why, never that calling again is useless
    expect(steers[0]).not.toMatch(/will not help|never (?:call|retry)/i);
  });
});

describe("a refusal is told, never an order not to call (#4919)", () => {
  // Liberty audit 2026-11-19 G1: #4737 told every bot of the person "never
  // call or retry" a refused tool for 24 h, on every connector, with no owner
  // decision (owner 2026-11-09: no block without a decision; 2026-11-18: the
  // bots give up too fast). The reason, the way around and the reconnect
  // invitation stay; nothing tells a bot not to call the tool again.
  const FORBIDDING = /never (?:call|retry)|not call|do not retry|will not help|don't call/i;

  it("the reach line, the person's row and the loop guard note never forbid calling again", () => {
    const r = rig();
    r.call("chat-a", { title: X_TITLE }, { ok: false, output: X_BILLING });
    r.call("chat-a", { title: "mcp__github__create_issue" }, { ok: false, output: GITHUB_SCOPE });
    const lines = refusalLines(r.memory.list("ada@example.com"));
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).not.toMatch(FORBIDDING);
    expect(lines.join("\n")).toContain("billing-scope-missing");
    for (const row of r.told) expect(row.name).not.toMatch(FORBIDDING);
    expect(r.told.map((row) => row.name).join("\n")).toContain("github refused create_issue for your access (insufficient_scope");
  });
});

describe("second review (#4720)", () => {
  it("a permission refusal still invites the owner to connect again, as a sign-in refusal did", () => {
    for (const text of [GITHUB_SCOPE, "403 Resource not accessible by integration", X_BILLING]) {
      expect(classifyRoutineFailure(text)).toEqual({ kind: "owner", cause: "signed_out" });
    }
    expect(needsReconnect("permission")).toBe(true);
    expect(needsReconnect("auth")).toBe(true);
    expect(needsReconnect("rate_limited")).toBe(false);
  });

  it("keeps every connector's line whole: five X tools and a GitHub refusal, the way around included", () => {
    const memory = createToolRefusalMemory({ now: () => 10 });
    for (const tool of ["get_users_by_username", "get_users_by_usernames", "get_users_by_id", "search_posts_all", "get_usage_credits"]) {
      memory.record("ada@example.com", "X", tool, permissionRefusalOf(X_BILLING, 10)!);
    }
    memory.record("ada@example.com", "github", "create_issue", permissionRefusalOf(GITHUB_SCOPE, 10)!);
    registerReachProvider("tool-refusals", ({ connectorPrincipalId }) => {
      const refused = connectorPrincipalId ? memory.list(connectorPrincipalId) : [];
      return refused.length ? { lines: refusalLines(refused) } : null;
    });
    const { lines } = reachContributions({ connectorPrincipalId: "ada@example.com" });
    expect(lines).toEqual(refusalLines(memory.list("ada@example.com")));
    expect(lines[1]).toBe("X last refused get_usage_credits, get_users_by_id, get_users_by_username, get_users_by_usernames, search_posts_all for this person (billing-scope-missing) at 00:00 UTC; its access may have changed since, call it when the task needs it. Another way: search_users with the handle, then get_users_posts with its id");
  });

  it("is kept for whoever's connections the turn uses: a routine run as B on A's bot uses A's", () => {
    const host = {
      connectorPlanForTurn: () => ({}),
      effectiveBotOwner: () => "a@example.com",
      IDENTITY: { kind: "perspicax" },
      autoPayerKey: () => "a@example.com",
      connectorPrincipalFor,
      localPrincipalId: () => "",
    };
    const reachPrompt = createTurnReachPrompt(() => host);
    reachPrompt({ id: "bot-a" }, { instanceId: "i" }, { origin: "owner-routine", principalId: "b@example.com" }, "run-1", {}, false, { claudeAi: false, grokCloudOnTurn: false });
    expect(turnPersonFor("run-1")).toBe("a@example.com");
    reachPrompt({ id: "bot-a" }, { instanceId: "i" }, { origin: "person", principalId: "b@example.com" }, "chat-b", {}, false, { claudeAi: false, grokCloudOnTurn: false });
    expect(turnPersonFor("chat-b")).toBe("b@example.com");
  });

  it("one person's refusals never push out another's, and a long tool id is read whole", () => {
    const memory = createToolRefusalMemory({ now: () => 10 });
    memory.record("zed@example.com", "github", "create_issue", permissionRefusalOf(GITHUB_SCOPE, 10)!);
    for (let i = 0; i < 150; i += 1) memory.record("ada@example.com", "github", `tool_${i}`, permissionRefusalOf(GITHUB_SCOPE, 10)!);
    expect(memory.list("ada@example.com")).toHaveLength(100);
    expect(memory.list("zed@example.com")).toHaveLength(1);
    const long = "mcp__cursor__user-Outlook-calendar-respond_5fto_5fcalendar_5fevent_5fwith_5fa_5fvery_5flong_5fname___21";
    expect(refusalTarget({ title: long.slice(0, 80), tool: "cursor/user-Outlook-calendar-respond_5fto_5fcalendar_5fevent_5fwith_5fa_5fvery_5flong_5fname___21" }))
      .toEqual({ connector: "Outlook-calendar", tool: "respond_to_calendar_event_with_a_very_long_name" });
  });
});
