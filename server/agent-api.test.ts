import { join } from "node:path";
import { ToolGrantStore } from "./tool-grants.ts";
import { guardDecision } from "./tool-guard.ts";
import { describe, expect, it } from "vitest";

import { createHmac } from "node:crypto";

import {
  AGENT_TOOL_NAMES, AGENT_TOOL_POLICY, agentPromptWithFiles, AWAIT_RECOMMENDED_WAIT_MS, AWAIT_TIMEOUT_MS_DEFAULT, AWAIT_TIMEOUT_MS_MAX, COLD_PAGE_SIZE, createAgentApi, ENTRY_TEXT_MAX, decodeCursor, encodeCursor, FIND_LIMIT_MAX,
  HANDLE_TTL_MS, matchScore, SEND_FILES_MAX, signHandle, signTurnHandle, turnLabel, verifyHandle,
  type AgentApiDeps, type AgentCaller, type AgentScope, type AgentSummary, type AuditEntry, type FileInput, type StoredMessage, type TurnState,
} from "./agent-api.ts";
import { PRIORITY_DOWNGRADED_NOTE, resetPriorityWakeForTests, type PriorityDelivery } from "./priority-wake.ts";

const SECRET = Buffer.alloc(32, 7);
const ALL: AgentScope[] = ["agents.read", "agents.send", "agents.create"];

/** A small Sagax: agents, conversations, a fake runtime that answers a
 * prompt a few polls later, and a virtual clock. */
function world(options: { replyAfterPolls?: number; reply?: (prompt: string) => string; reachable?: (caller: AgentCaller, agent: AgentSummary) => boolean } = {}) {
  let clock = 1_791_500_000_000;
  let ids = 0;
  const agents: AgentSummary[] = [
    { id: "bot-a", name: "Alpha", description: "Answers questions about invoices", status: "idle", owner: null },
    { id: "bot-b", name: "Beta", description: "Dispatch and scheduling of technicians", status: "idle", owner: null },
    { id: "bot-c", name: "Gamma Reports", description: "Writes weekly reports", status: "running", owner: null },
  ];
  const threads = new Map<string, { agentId: string; owner: string; title: string; hidden: boolean }>();
  const messages = new Map<string, StoredMessage[]>();
  const state = new Map<string, TurnState>();
  const pending = new Map<string, { polls: number; prompt: string }>();
  const audits: Array<{ caller: string; entry: AuditEntry }> = [];
  const notified: string[] = [];
  const interrupted: string[] = [];
  const turnStateCalls: string[] = [];
  const posted: Array<{ threadId: string; files: FileInput[]; wake?: PriorityDelivery }> = [];
  const add = (threadId: string, message: Omit<StoredMessage, "id" | "at">) => {
    const row = { ...message, id: `m${++ids}`, at: clock++ } as StoredMessage;
    messages.set(threadId, [...(messages.get(threadId) ?? []), row]);
    return row;
  };
  const tick = () => {
    for (const [threadId, job] of pending) {
      job.polls -= 1;
      if (job.polls <= 0) {
        pending.delete(threadId);
        const text = (options.reply ?? ((p) => `echo: ${p}`))(job.prompt);
        if (text) add(threadId, { role: "bot", kind: "text", text });
        state.set(threadId, "idle");
      }
    }
  };
  const key = (caller: AgentCaller) => `${caller.kind}:${caller.id}`;
  const owners = new Map<string, string>();
  const archived: string[] = [];
  const created: Array<{ name: string; idleHours?: number; workspace?: string }> = [];
  const deps: AgentApiDeps = {
    agents: (caller) => agents.filter((agent) => !archived.includes(agent.id) && (options.reachable ? options.reachable(caller, agent) : true)),
    async createAgent(caller, input) {
      const owner = { principal_id: key(caller), name: "Owner" };
      const agent = { id: `bot-${++ids}`, name: input.name, description: input.description, status: "idle" as const, temporary: true, owner };
      agents.push(agent);
      owners.set(agent.id, key(caller));
      created.push({ name: input.name, ...(input.idleHours !== undefined ? { idleHours: input.idleHours } : {}), ...(input.workspace ? { workspace: input.workspace } : {}) });
      return agent;
    },
    profile(caller, agentId) {
      const agent = agents.find((candidate) => candidate.id === agentId)!;
      const reads = caller.admin === true || owners.get(agentId) === key(caller) || !agent.temporary;
      return {
        title: `${agent.name} title`,
        owner: owners.has(agentId) ? { principal_id: owners.get(agentId)!, name: "Owner" } : null,
        profile: reads ? {
          instructions: "## Persona\nA careful clerk.\n## Rules\nNever invent numbers.",
          instructions_truncated: false, persona: "A careful clerk.", rules: "Never invent numbers.", voice: null, anti_jobs: null,
          headings: ["Persona", "Rules"], voice_settings: { voice: null, speak_replies: false, voice_notes: true },
        } : null,
        temporary: agent.temporary ? { created_at: clock, idle_hours: 24, expires_at: clock + 86_400_000, pinned: false } : null,
        profile_url: `https://perspicax.example.test/console/sagax/bots/${agentId}`,
      };
    },
    async deleteAgent(caller, agentId) {
      if (caller.admin !== true && owners.get(agentId) !== key(caller)) return { status: 403, code: "forbidden_owner", message: "Only this agent's owner or an organization admin can delete it." };
      archived.push(agentId);
      return { archived_at: clock, purge_at: clock + 30 * 86_400_000 };
    },
    threads: (caller, agentId) => [...threads].filter(([, t]) => t.agentId === agentId && t.owner === key(caller)).map(([threadId, t]) => ({ threadId, title: t.title, hidden: t.hidden })),
    messages: (threadId) => messages.get(threadId) ?? [],
    turnState: (_agentId, threadId) => {
      turnStateCalls.push(threadId);
      return state.get(threadId) ?? "idle";
    },
    // #1170: the agent's single chat with the caller's person
    async conversation(caller, agentId) {
      const found = [...threads].find(([, t]) => t.agentId === agentId && t.owner === key(caller));
      if (found) return { threadId: found[0] };
      const threadId = `t${++ids}`;
      threads.set(threadId, { agentId, owner: key(caller), title: `${caller.name} via agent API`, hidden: false });
      return { threadId };
    },
    async post(_caller, _agentId, threadId, prompt, files, wake) {
      posted.push({ threadId, files, ...(wake ? { wake } : {}) });
      // A front send waits; it must not start a turn or move the clock.
      if (wake?.front) return { messageId: null };
      const row = add(threadId, { role: "user", kind: "text", text: prompt });
      state.set(threadId, "running");
      pending.set(threadId, { polls: options.replyAfterPolls ?? 3, prompt });
      return { messageId: row.id };
    },
    async interrupt(_agentId, threadId) {
      interrupted.push(threadId);
      pending.delete(threadId);
      state.set(threadId, "idle");
    },
    notify: (caller, agent, result) => notified.push(`${agent.id}:${result.finished}:${result.reply}${caller.speakerPrincipalId ? `:as:${caller.speakerPrincipalId}` : ""}`),
    audit: (caller, entry) => audits.push({ caller: key(caller), entry }),
    secret: SECRET,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      tick();
    },
  };
  return { deps, api: createAgentApi(deps), agents, owners, archived, created, threads, messages, state, audits, notified, interrupted, turnStateCalls, posted, add, advance: (ms: number) => { clock += ms; }, settle: async () => { for (let i = 0; i < 50; i++) await deps.sleep!(400); } };
}

const bot = (id: string, scopes: AgentScope[] = ALL): AgentCaller => ({ kind: "bot", id, name: id, scopes: new Set(scopes), via: "agents-mcp", sourceThreadId: `src-${id}` });
const person = (id: string, scopes: AgentScope[] = ALL): AgentCaller => ({ kind: "person", id, name: id, scopes: new Set(scopes), via: "perspicax-mcp" });

describe("send_prompt file prompt (#1169)", () => {
  it("names workspace_read with the relative inbox path, and the full path for file tools", () => {
    const text = agentPromptWithFiles("sum the invoices", ["inbox/bob/invoices.txt"], join("/data", "workspaces", "nova"));
    expect(text.startsWith("sum the invoices")).toBe(true);
    expect(text).toContain("workspace_read");
    expect(text).toContain("inbox/bob/invoices.txt");
    expect(text).toContain(join("/data", "workspaces", "nova", "inbox/bob/invoices.txt"));
    expect(text).not.toMatch(/host file tools/);
    expect(agentPromptWithFiles("hello", [], "/data/workspaces/nova")).toBe("hello");
  });
});

describe("agent API policy", () => {
  it("declares twelve tools, each with a scope, an access level and a read-only flag", () => {
    expect(AGENT_TOOL_NAMES).toHaveLength(12);
    for (const name of AGENT_TOOL_NAMES) {
      const policy = AGENT_TOOL_POLICY[name];
      expect(policy.readOnly).toBe(policy.access === "read");
      expect(policy.rate).toBeGreaterThan(0);
    }
    expect(AGENT_TOOL_POLICY.create_agent.access).toBe("admin");
    expect(AGENT_TOOL_POLICY.send_prompt.scope).toBe("agents.send");
  });

  it("refuses a tool whose scope the caller lacks, and audits the refusal", async () => {
    const w = world();
    const r = await w.api.call(bot("bot-x", ["agents.read"]), "send_prompt", { agent_id: "bot-a", prompt: "hi" });
    expect(r.status).toBe(403);
    expect(r.body.scope).toBe("agents.send");
    expect(w.audits.at(-1)!.entry).toMatchObject({ tool: "send_prompt", outcome: "refused", code: "forbidden_scope" });
    expect(w.posted).toHaveLength(0);
  });

  it("rate-limits per caller and tool", async () => {
    const w = world();
    const caller = person("pr_1");
    for (let i = 0; i < AGENT_TOOL_POLICY.create_agent.rate; i++) {
      expect((await w.api.call(caller, "create_agent", { name: `Bot ${i}` })).status).toBe(200);
    }
    const over = await w.api.call(caller, "create_agent", { name: "One more" });
    expect(over.status).toBe(429);
    expect(over.body.retry_after_ms).toBeGreaterThan(0);
    // another caller is not affected
    expect((await w.api.call(person("pr_2"), "create_agent", { name: "Other" })).status).toBe(200);
  });

  it("audits every call without the prompt or the reply", async () => {
    const w = world();
    await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "top secret plan", mode: "blocking" });
    const row = w.audits.at(-1)!;
    expect(row.entry).toMatchObject({ tool: "send_prompt", agentId: "bot-a", outcome: "ok" });
    expect(JSON.stringify(row)).not.toContain("top secret");
    expect(row.entry.detail).toMatchObject({ mode: "blocking", onBusy: "queue", files: 0, access: "write" });
  });

  it("refuses unknown tools and unknown parameters", async () => {
    const w = world();
    expect((await w.api.call(bot("x"), "drop_agent", {})).status).toBe(404);
    const r = await w.api.call(bot("x"), "list_agents", { foo: 1 });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain("foo");
  });
});

describe("list_agents / find_agents", () => {
  it("list_agents answers id, name, description and status of reachable agents only", async () => {
    const w = world({ reachable: (caller, agent) => caller.id !== "outsider" || agent.id === "bot-b" });
    const r = await w.api.call(bot("bot-x"), "list_agents", {});
    expect(r.body.agents).toEqual(w.agents.map(({ id, name, description, status, owner }) => ({ id, name, description, status, temporary: false, owner })));
    const isolated = await w.api.call(bot("outsider"), "list_agents", {});
    expect((isolated.body.agents as AgentSummary[]).map((a) => a.id)).toEqual(["bot-b"]);
  });

  it("find_agents ranks name over description, keeps best matches, filters status, caps limit at 64", async () => {
    const w = world();
    const r = await w.api.call(bot("x"), "find_agents", { query: "reports" });
    expect((r.body.agents as AgentSummary[]).map((a) => a.id)).toEqual(["bot-c"]);
    const desc = await w.api.call(bot("x"), "find_agents", { query: "technicians" });
    expect((desc.body.agents as AgentSummary[]).map((a) => a.id)).toEqual(["bot-b"]);
    const idle = await w.api.call(bot("x"), "find_agents", { query: "reports", status: "idle" });
    expect(idle.body.agents).toEqual([]);
    expect((await w.api.call(bot("x"), "find_agents", { query: "a", limit: FIND_LIMIT_MAX + 1 })).status).toBe(400);
    expect((await w.api.call(bot("x"), "find_agents", { query: "a", status: "busy" })).status).toBe(400);
    expect((await w.api.call(bot("x"), "find_agents", {})).status).toBe(400);
    expect(matchScore(w.agents[0]!, "alpha")).toBeGreaterThan(matchScore(w.agents[0]!, "invoices"));
  });

  it("find_agents never reveals an agent outside the caller's reach", async () => {
    const w = world({ reachable: (_caller, agent) => agent.id !== "bot-c" });
    const r = await w.api.call(bot("x"), "find_agents", { query: "reports" });
    expect(r.body.agents).toEqual([]);
  });

  it("list_agents and find_agents include owner matching get_agent without calling profile (#1637)", async () => {
    const w = world();
    const owner = { principal_id: "pr_alice", name: "Owner" };
    w.agents[0]!.owner = owner;
    w.owners.set("bot-a", "pr_alice");
    let profileCalls = 0;
    const inner = w.deps.profile!;
    w.deps.profile = (caller, agentId) => {
      profileCalls += 1;
      return inner(caller, agentId);
    };
    const api = createAgentApi(w.deps);

    const listed = await api.call(bot("x"), "list_agents", {});
    expect(profileCalls).toBe(0);
    const fromList = (listed.body.agents as AgentSummary[]).find((a) => a.id === "bot-a");
    expect(fromList?.owner).toEqual(owner);
    expect((listed.body.agents as AgentSummary[]).find((a) => a.id === "bot-b")?.owner).toBeNull();

    const found = await api.call(bot("x"), "find_agents", { query: "Alpha" });
    expect(profileCalls).toBe(0);
    expect((found.body.agents as AgentSummary[])[0]?.owner).toEqual(owner);

    const got = await api.call(person("pr_1"), "get_agent", { agent_id: "bot-a" });
    expect(profileCalls).toBe(1);
    expect(got.body.owner).toEqual(fromList?.owner);
  });
});

describe("create_agent", () => {
  it("creates one agent per call, says it greets the user, refuses a duplicate name", async () => {
    const w = world();
    const r = await w.api.call(person("pr_1"), "create_agent", { name: "Delta", description: "Handles quotes" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ agent: { name: "Delta", description: "Handles quotes", status: "idle" }, greeted: true });
    expect(String(r.body.note)).toContain("never quote its id");
    const dup = await w.api.call(person("pr_1"), "create_agent", { name: "delta" });
    expect(dup.status).toBe(409);
    expect((await w.api.call(person("pr_1"), "create_agent", { name: "two\nlines" })).status).toBe(400);
    expect((await w.api.call(person("pr_1"), "create_agent", { names: ["a", "b"] })).status).toBe(400);
  });

  it("needs the agents.create scope", async () => {
    const w = world();
    expect((await w.api.call(bot("x", ["agents.read", "agents.send"]), "create_agent", { name: "Nope" })).status).toBe(403);
  });

  it("makes a temporary agent and takes an idle expiry of 1 to 720 hours", async () => {
    const w = world();
    const r = await w.api.call(person("pr_1"), "create_agent", { name: "Scratch", idle_hours: 6 });
    expect(r.status).toBe(200);
    expect(r.body.agent).toMatchObject({ name: "Scratch", temporary: true });
    expect(String(r.body.note)).toContain("delete_agent");
    expect(w.created.at(-1)).toEqual({ name: "Scratch", idleHours: 6 });
    expect(w.audits.at(-1)!.entry.detail).toMatchObject({ temporary: true, idleHours: 6 });
    for (const idle_hours of [0, 721, 1.5, "24"]) {
      expect((await w.api.call(person("pr_bad"), "create_agent", { name: `Bad ${String(idle_hours)}`, idle_hours })).status).toBe(400);
    }
    expect((await w.api.call(person("pr_1"), "create_agent", { name: "Default" })).status).toBe(200);
    expect(w.created.at(-1)).toEqual({ name: "Default" });
    // a duplicate of a temporary agent points at delete_agent
    expect(String((await w.api.call(person("pr_1"), "create_agent", { name: "scratch" })).body.message)).toContain("delete_agent");
  });

  it("gives a temporary agent its own Auto workspace (sub-agents, Owner 2026-10-15)", async () => {
    const w = world();
    expect((await w.api.call(person("pr_1"), "create_agent", { name: "Cloud worker", workspace: "cloud" })).status).toBe(200);
    expect(w.created.at(-1)).toEqual({ name: "Cloud worker", workspace: "cloud" });
    expect(w.audits.at(-1)!.entry.detail).toMatchObject({ workspace: "cloud" });
    expect((await w.api.call(person("pr_1"), "create_agent", { name: "VM worker", workspace: "local_vm" })).status).toBe(200);
    expect(w.created.at(-1)).toEqual({ name: "VM worker", workspace: "local_vm" });
    const bad = await w.api.call(person("pr_1"), "create_agent", { name: "Mars", workspace: "mars" });
    expect(bad.status).toBe(400);
    expect(String(bad.body.message)).toContain("this_computer, browser, cloud, local_vm");
  });

  it("passes a dependency's refusal through (the quota, a temporary agent creating another)", async () => {
    const w = world();
    w.deps.createAgent = async () => ({ status: 409, code: "temporary_quota", message: "You already have 10 active temporary agents." });
    const api = createAgentApi(w.deps);
    const r = await api.call(person("pr_1"), "create_agent", { name: "Eleventh" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("temporary_quota");
    expect(w.audits.at(-1)!.entry).toMatchObject({ tool: "create_agent", outcome: "refused", code: "temporary_quota" });
  });
});

describe("get_agent / delete_agent", () => {
  const admin = (id: string): AgentCaller => ({ ...person(id), admin: true });

  it("get_agent answers the full profile of a reachable agent", async () => {
    const w = world();
    const r = await w.api.call(person("pr_1"), "get_agent", { agent_id: "bot-a" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      agent: { id: "bot-a", name: "Alpha", status: "idle", temporary: false, title: "Alpha title" },
      profile: { persona: "A careful clerk.", rules: "Never invent numbers.", headings: ["Persona", "Rules"], voice_settings: { voice_notes: true } },
      temporary: null,
      profile_url: "https://perspicax.example.test/console/sagax/bots/bot-a",
    });
    expect((await w.api.call(person("pr_1"), "get_agent", { agent_id: "bot-a", extra: 1 })).status).toBe(400);
    expect((await w.api.call(person("pr_1"), "get_agent", {})).status).toBe(400);
    // the audit row keeps the shape, never the instructions
    expect(w.audits.at(-1)!.entry).toMatchObject({ tool: "get_agent", outcome: "refused" });
    expect(JSON.stringify(w.audits)).not.toContain("careful clerk");
  });

  it("get_agent hides the instructions from a caller who may only use the agent", async () => {
    const w = world();
    const made = await w.api.call(person("pr_1"), "create_agent", { name: "Scratch" });
    const id = (made.body.agent as { id: string }).id;
    const other = await w.api.call(person("pr_2"), "get_agent", { agent_id: id });
    expect(other.status).toBe(200);
    expect(other.body.profile).toBeNull();
    expect(String(other.body.note)).toContain("owner");
    const own = await w.api.call(person("pr_1"), "get_agent", { agent_id: id });
    expect(own.body.profile).not.toBeNull();
    expect(own.body.temporary).toMatchObject({ idle_hours: 24, pinned: false });
  });

  it("delete_agent archives the owner's temporary agent: gone from every list, the next call is unknown", async () => {
    const w = world();
    const id = ((await w.api.call(person("pr_1"), "create_agent", { name: "Scratch" })).body.agent as { id: string }).id;
    const r = await w.api.call(person("pr_1"), "delete_agent", { agent_id: id });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ agent_id: id, archived: true });
    expect((r.body.purge_at as number) - (r.body.archived_at as number)).toBe(30 * 86_400_000);
    expect(w.archived).toEqual([id]);
    expect(((await w.api.call(person("pr_1"), "list_agents", {})).body.agents as AgentSummary[]).map((a) => a.id)).not.toContain(id);
    expect((await w.api.call(person("pr_1"), "delete_agent", { agent_id: id })).body.code).toBe("unknown_agent");
    expect((await w.api.call(person("pr_1"), "send_prompt", { agent_id: id, prompt: "still there?" })).status).toBe(404);
    expect(w.audits.find((row) => row.entry.tool === "delete_agent" && row.entry.outcome === "ok")!.entry.detail).toMatchObject({ archived: true });
  });

  it("delete_agent refuses anyone but the owner or an organization admin", async () => {
    const w = world();
    const id = ((await w.api.call(person("pr_1"), "create_agent", { name: "Scratch" })).body.agent as { id: string }).id;
    const refused = await w.api.call(person("pr_2"), "delete_agent", { agent_id: id });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("forbidden_owner");
    expect(w.audits.at(-1)!.entry).toMatchObject({ tool: "delete_agent", outcome: "refused", code: "forbidden_owner", agentId: id });
    expect(w.archived).toEqual([]);
    // the scope: a caller without agents.create is refused before anything
    expect((await w.api.call(person("pr_1", ["agents.read"]), "delete_agent", { agent_id: id })).body.code).toBe("forbidden_scope");
    expect((await w.api.call(admin("pr_9"), "delete_agent", { agent_id: id })).status).toBe(200);
    expect(w.archived).toEqual([id]);
  });

  it("delete_agent never touches a lasting agent", async () => {
    const w = world();
    const r = await w.api.call(admin("pr_9"), "delete_agent", { agent_id: "bot-a" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("not_temporary");
    expect(w.archived).toEqual([]);
  });

  it("another organization's agent does not exist for the caller", async () => {
    // reach is the tenant boundary: an agent outside it answers like an unknown id
    const w = world({ reachable: (caller, agent) => (caller.id === "org2-person") === (agent.name === "Org2 Scratch") });
    const id = ((await w.api.call(person("org2-person"), "create_agent", { name: "Org2 Scratch" })).body.agent as { id: string }).id;
    for (const tool of ["get_agent", "delete_agent"]) {
      const r = await w.api.call(admin("org1-admin"), tool, { agent_id: id });
      expect(r.status, tool).toBe(404);
      expect(r.body.code, tool).toBe("unknown_agent");
    }
    expect(w.archived).toEqual([]);
  });
});

describe("send_prompt / await_turn", () => {
  it("fire_and_forget returns a handle once accepted, in the agent's single chat, never hidden (#1170)", async () => {
    const w = world();
    const r = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "hello" });
    expect(r.body).toMatchObject({ accepted: true, mode: "fire_and_forget", finished: false, agent_id: "bot-a" });
    expect(String(r.body.handle)).toMatch(/^turn_/);
    expect(w.threads.get(String(r.body.thread_id))).toMatchObject({ hidden: false, owner: "bot:bot-x" });
  });

  it("a person's send_prompt lands in the single chat unless thread_id names one of theirs; a bot keeps one (#1170)", async () => {
    const w = world();
    const first = await w.api.call(person("p1"), "send_prompt", { agent_id: "bot-a", prompt: "one" });
    const second = await w.api.call(person("p1"), "send_prompt", { agent_id: "bot-a", prompt: "two" });
    expect(second.body.thread_id).toBe(first.body.thread_id);
    const again = await w.api.call(person("p1"), "send_prompt", { agent_id: "bot-a", prompt: "three", thread_id: first.body.thread_id });
    expect(again.body).toMatchObject({ accepted: true, thread_id: first.body.thread_id });
    const foreign = await w.api.call(person("p2"), "send_prompt", { agent_id: "bot-a", prompt: "x", thread_id: first.body.thread_id });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ code: "unknown_thread" });
    const b1 = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "one" });
    const b2 = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "two" });
    expect(b2.body.thread_id).toBe(b1.body.thread_id);
  });

  it("blocking waits for the reply; empty reply with finished=true means no text", async () => {
    const w = world();
    const r = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "2+2?", mode: "blocking", timeout_ms: 30_000 });
    expect(r.body).toMatchObject({ finished: true, status: "finished", reply: "echo: 2+2?" });
    const silent = world({ reply: () => "" });
    const s = await silent.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "be quiet", mode: "blocking" });
    expect(s.body).toMatchObject({ finished: true, reply: "", note: "The turn finished without text." });
  });

  it("blocking past timeout_ms answers still_working with the handle; await_turn resumes without re-sending", async () => {
    const w = world({ replyAfterPolls: 20 });
    const r = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "slow", mode: "blocking", timeout_ms: 1_000 });
    expect(r.body).toMatchObject({
      finished: false,
      status: "still_working",
      recommended_wait_ms: AWAIT_RECOMMENDED_WAIT_MS,
      progress: { turn_state: "running" },
    });
    expect(String(r.body.next)).toContain("still_working");
    expect(String(r.body.next).toLowerCase()).toContain("never send the prompt again");
    const sent = w.posted.length;
    const a = await w.api.call(bot("bot-x"), "await_turn", { agent_id: "bot-a", handle: r.body.handle, timeout_ms: AWAIT_TIMEOUT_MS_MAX });
    expect(a.body).toMatchObject({ finished: true, reply: "echo: slow", handle: r.body.handle });
    expect(w.posted.length).toBe(sent);
  });

  it("async returns a handle and notifies at turn end", async () => {
    const w = world();
    const r = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "later", mode: "async" });
    expect(r.body).toMatchObject({ accepted: true, finished: false, mode: "async" });
    await w.settle();
    expect(w.notified).toEqual(["bot-a:true:echo: later"]);
  });

  it("async notify keeps the person the source turn spoke for (wake mounts their connectors)", async () => {
    const w = world();
    await w.api.call({ ...bot("bot-x"), speakerPrincipalId: "person-owner" }, "send_prompt", { agent_id: "bot-a", prompt: "later", mode: "async" });
    await w.settle();
    expect(w.notified).toEqual(["bot-a:true:echo: later:as:person-owner"]);
  });

  it("on_busy: queue leaves the running turn (default, 2026-10-17), reject refuses, supersede interrupts", async () => {
    const w = world({ replyAfterPolls: 50 });
    const caller = bot("bot-x");
    const first = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "first" });
    // a short label a person can read beside the handle
    expect(String(first.body.label)).toMatch(/: first$/);
    const rejected = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "second", on_busy: "reject" });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({
      code: "busy",
      retryable: true,
      details: { reason: "busy_thread", turn_state: "running", on_busy: "reject", retryable: true, status: 409 },
    });
    expect(String(rejected.body.hint)).toContain("queue");
    const invalidBusy = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "x", on_busy: "later" });
    expect(invalidBusy.status).toBe(400);
    expect(invalidBusy.body).toMatchObject({ code: "bad_request", retryable: false, details: { reason: "invalid_on_busy" } });
    await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "third", on_busy: "queue" });
    await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "fourth" });
    expect(w.interrupted).toEqual([]);
    await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "fifth", on_busy: "supersede" });
    expect(w.interrupted).toHaveLength(1);
  });

  it("validates mode, timeout, prompt and files (8 max, workspace-relative, 25 MiB)", async () => {
    const w = world();
    const c = bot("bot-x");
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", mode: "sync" })).status).toBe(400);
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", timeout_ms: 999 })).status).toBe(400);
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "" })).status).toBe(400);
    const nine = Array.from({ length: SEND_FILES_MAX + 1 }, (_, i) => `f${i}.txt`);
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", files: nine })).status).toBe(400);
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", files: ["../etc/passwd"] })).status).toBe(400);
    expect((await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", files: ["/abs.txt"] })).status).toBe(400);
    const big = "A".repeat(Math.ceil((25 * 1024 * 1024 + 16) * 4 / 3));
    expect((await w.api.call(person("p"), "send_prompt", { agent_id: "bot-a", prompt: "x", files: [{ path: "big.bin", content_base64: big }] })).status).toBe(413);
    const okFiles = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", files: ["docs/a.md", "b.csv"] });
    expect(okFiles.body.files).toBe(2);
    expect(w.posted.at(-1)!.files.map((f) => f.path)).toEqual(["docs/a.md", "b.csv"]);
  });

  it("an agent outside reach is unknown; a handle answers only its caller and agent", async () => {
    const w = world({ reachable: (caller, agent) => caller.id !== "bot-y" || agent.id !== "bot-a" });
    expect((await w.api.call(bot("bot-y"), "send_prompt", { agent_id: "bot-a", prompt: "x" })).status).toBe(404);
    const r = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "x" });
    const otherCaller = await w.api.call(bot("bot-z"), "await_turn", { agent_id: "bot-a", handle: r.body.handle });
    expect(otherCaller.body).toMatchObject({ code: "handle_session_mismatch", details: { reason: "other_caller", family: "bad_handle", status: 400 } });
    expect(otherCaller.body).not.toHaveProperty("thread_id");
    const otherAgent = await w.api.call(bot("bot-x"), "await_turn", { agent_id: "bot-b", handle: r.body.handle });
    expect(otherAgent.body).toMatchObject({ code: "handle_agent_mismatch", details: { reason: "other_agent" } });
    const altered = await w.api.call(bot("bot-x"), "await_turn", { agent_id: "bot-a", handle: `${String(r.body.handle)}x` });
    expect(altered.body).toMatchObject({ code: "bad_handle", details: { reason: "signature" } });
  });

  it("await_turn bad_handle names each cause and the safe fallbacks, never the handle (#1636)", async () => {
    const w = world();
    const c = bot("bot-x");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x" });
    const good = String(sent.body.handle);
    const expectBad = async (handle: unknown, reason: string, code = "bad_handle") => {
      const readsBefore = w.turnStateCalls.length;
      const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code, details: { reason, family: "bad_handle", status: 400 }, hint: expect.stringContaining("await_turn") });
      expect(String(r.body.message)).toContain("read_latest_page");
      expect(String(r.body.hint)).toContain("read_latest_page");
      const blob = JSON.stringify(r.body);
      expect(blob).not.toContain(good);
      expect(blob).not.toMatch(/bot-a|bot-x|bot:bot-x|"thread_id":"[^"]+"/);
      // A refused handle never drives a read of the conversation it names.
      expect(w.turnStateCalls.length).toBe(readsBefore);
    };
    await expectBad("not-a-handle", "format");
    await expectBad("turn_only", "format");
    await expectBad(42, "format");
    await expectBad(`${good}x`, "signature");
    const wrongSecret = signHandle(Buffer.alloc(32, 8), { a: "bot-a", t: "t1", m: null, i: 1, c: "bot:bot-x" });
    await expectBad(wrongSecret, "signature");
    // i: 1 is already older than the TTL at the fixture clock; do not advance
    // the world clock or the valid handle below would expire too.
    const aged = signHandle(SECRET, { a: "bot-a", t: "t-aged", m: null, i: 1, c: "bot:bot-x" });
    await expectBad(aged, "age", "handle_expired");
    // Fixture clock starts near 1_791_500_000_000; keep forged handles inside the TTL.
    const issuedAt = 1_791_500_000_000;
    let readsBefore = w.turnStateCalls.length;
    const forOtherAgent = signHandle(SECRET, { a: "bot-b", t: "t-b", m: null, i: issuedAt, c: "bot:bot-x" });
    const otherAgent = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: forOtherAgent });
    expect(otherAgent.body).toMatchObject({ code: "handle_agent_mismatch", details: { reason: "other_agent" } });
    expect(String(otherAgent.body.message)).toContain("await_turn");
    expect(JSON.stringify(otherAgent.body)).not.toContain("bot-b");
    expect(w.turnStateCalls.length).toBe(readsBefore);
    readsBefore = w.turnStateCalls.length;
    const forOtherCaller = signHandle(SECRET, { a: "bot-a", t: "t-c", m: null, i: issuedAt, c: "bot:other" });
    const otherCaller = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: forOtherCaller });
    expect(otherCaller.body).toMatchObject({ code: "handle_session_mismatch", details: { reason: "other_caller" } });
    expect(JSON.stringify(otherCaller.body)).not.toContain("bot:other");
    expect(w.turnStateCalls.length).toBe(readsBefore);
    // Valid handle for this caller and agent still works.
    const ok = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: good, timeout_ms: AWAIT_TIMEOUT_MS_MAX });
    expect(ok.body).toMatchObject({ finished: true, reply: "echo: x", handle: good });
  });

  it("await_turn without a handle waits for the in-flight turn, else returns the last message", async () => {
    const w = world();
    const c = bot("bot-x");
    const none = await w.api.call(c, "await_turn", { agent_id: "bot-a" });
    expect(none.body).toMatchObject({ finished: true, reply: "" });
    await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "ping" });
    const waited = await w.api.call(c, "await_turn", { agent_id: "bot-a" });
    expect(waited.body).toMatchObject({ finished: true, reply: "echo: ping" });
    const idle = await w.api.call(c, "await_turn", { agent_id: "bot-a" });
    expect(idle.body).toMatchObject({ finished: true, status: "idle", reply: "echo: ping" });
  });

  it("await_turn returns still_working before its ceiling with progress and a resumable wait_cursor", async () => {
    const w = world({ replyAfterPolls: 50 });
    const c = bot("bot-x");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "long", mode: "async" });
    const threadId = String(sent.body.thread_id);
    w.add(threadId, { role: "bot", kind: "activity", text: "", tool: { name: "workspace_read", ok: true } });
    w.add(threadId, { role: "bot", kind: "activity", text: "", tool: { name: "web_search", ok: true } });
    const first = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 800 });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      finished: false,
      status: "still_working",
      thread_id: threadId,
      recommended_wait_ms: AWAIT_RECOMMENDED_WAIT_MS,
      progress: { turn_state: "running", steps_total: 2 },
    });
    const progress = first.body.progress as { summary: string; steps: Array<{ text: string; cursor: string }>; steps_total: number };
    expect(progress.summary).toContain("2 steps");
    const steps = progress.steps;
    expect(steps.map((step) => step.text)).toEqual(["workspace_read", "web_search"]);
    const waitCursor = first.body.wait_cursor as string;
    expect(waitCursor).toBeTruthy();
    expect(decodeCursor(waitCursor)).toMatchObject({ threadId });

    w.add(threadId, { role: "bot", kind: "activity", text: "", tool: { name: "workspace_write", ok: true } });
    const second = await w.api.call(c, "await_turn", {
      agent_id: "bot-a",
      handle: sent.body.handle,
      timeout_ms: 800,
      cursor: waitCursor,
    });
    expect(second.body).toMatchObject({ finished: false, status: "still_working", progress: { steps_total: 3 } });
    const nextSteps = (second.body.progress as { steps: Array<{ text: string }> }).steps;
    expect(nextSteps.map((step) => step.text)).toEqual(["workspace_write"]);
    expect(second.body.wait_cursor).not.toBe(waitCursor);

    expect((await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 60_001 })).status).toBe(400);
    expect((await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: AWAIT_TIMEOUT_MS_DEFAULT, cursor: "nope" })).status).toBe(400);
  });

  it("handles are signed and expire with a discriminated reason", () => {
    const body = { a: "bot-a", t: "t1", m: "m1", i: 1000, c: "bot:x" };
    const handle = signHandle(SECRET, body);
    expect(verifyHandle(SECRET, handle, 2000)).toEqual({ ok: true, body });
    expect(verifyHandle(Buffer.alloc(32, 8), handle, 2000)).toEqual({ ok: false, reason: "signature" });
    expect(verifyHandle(SECRET, handle, 1000 + HANDLE_TTL_MS + 1)).toEqual({ ok: false, reason: "age", body });
    expect(verifyHandle(SECRET, "turn_nope", 2000)).toEqual({ ok: false, reason: "format" });
    expect(verifyHandle(SECRET, "plain", 2000)).toEqual({ ok: false, reason: "format" });
    const payload = Buffer.from(JSON.stringify({ a: 1, t: "t", i: 1, c: "bot:x" }), "utf8").toString("base64url");
    const mac = createHmac("sha256", SECRET).update(payload).digest("base64url").slice(0, 32);
    expect(verifyHandle(SECRET, `turn_${payload}.${mac}`, 2000)).toEqual({ ok: false, reason: "format" });
  });

  it("priority now wakes an idle agent and does not move a busy one ahead by stopping it", async () => {
    resetPriorityWakeForTests();
    const w = world();
    const caller = bot("bot-priority-idle");
    const idle = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "wake", priority: "now" });
    expect(idle.body).toMatchObject({ accepted: true, priority: "now" });
    expect(idle.body).not.toHaveProperty("downgraded");
    expect(w.posted.at(-1)!.wake).toEqual({ priorityNow: true });
    expect(w.interrupted).toEqual([]);

    const busy = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "front", priority: "now" });
    expect(busy.body).toMatchObject({ accepted: true, priority: "now" });
    expect(w.posted.at(-1)!.wake).toEqual({ front: true, priorityNow: true });
    expect(w.interrupted).toEqual([]);
  });

  it("priority now does not supersede a running turn", async () => {
    resetPriorityWakeForTests();
    const w = world();
    const caller = bot("bot-priority-supersede");
    await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "running" });
    await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "now", priority: "now", on_busy: "supersede" });
    expect(w.interrupted).toEqual([]);
    expect(w.posted.at(-1)!.wake).toEqual({ front: true, priorityNow: true });
  });

  it("past ten priority-now sends in an hour the next one is delivered as normal", async () => {
    resetPriorityWakeForTests();
    const w = world();
    const caller = bot("bot-priority-cap");
    const first = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "1", priority: "now" });
    expect(first.body).toMatchObject({ priority: "now" });
    for (let n = 2; n <= 10; n++) {
      const sent = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: String(n), priority: "now" });
      expect(sent.body).toMatchObject({ priority: "now" });
      expect(w.posted.at(-1)!.wake).toEqual({ front: true, priorityNow: true });
    }
    const over = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "11", priority: "now" });
    expect(over.body).toMatchObject({ priority: "normal", downgraded: true, priority_note: PRIORITY_DOWNGRADED_NOTE });
    expect(w.posted.at(-1)!.wake).toBeUndefined();
  });

  it("refuses a priority that is not now or normal, and omits the field when priority is absent", async () => {
    resetPriorityWakeForTests();
    const w = world();
    const caller = bot("bot-priority-shape");
    const bad = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "x", priority: "urgent" });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe("priority is now or normal.");
    expect(w.posted).toHaveLength(0);
    const plain = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "plain" });
    expect(plain.body).not.toHaveProperty("priority");
    expect(w.posted.at(-1)!.wake).toBeUndefined();
  });

  it("await_turn reads a send_to_bot handle, and only for the bot that sent it", async () => {
    resetPriorityWakeForTests();
    const w = world();
    const user = w.add("t-handle", { role: "user", kind: "text", text: "do this" });
    w.add("t-handle", { role: "bot", kind: "text", text: "done" });
    w.threads.set("t-handle", { agentId: "bot-a", owner: "bot:sender", title: "Ship", hidden: false });
    w.state.set("t-handle", "idle");
    const handle = signTurnHandle(SECRET, {
      agentId: "bot-a", threadId: "t-handle", messageId: null, issuedAt: user.at, callerId: "sender", callerKind: "bot",
    });
    const r = await w.api.call(bot("sender"), "await_turn", { agent_id: "bot-a", handle, timeout_ms: 0 });
    expect(r.body).toMatchObject({ finished: true, reply: "done" });
    const other = await w.api.call(bot("other"), "await_turn", { agent_id: "bot-a", handle, timeout_ms: 0 });
    expect(other.body.code).toBe("handle_session_mismatch");
  });

  it("send_prompt and await_turn publish the handle's expires_at (audit 2026-10-29)", async () => {
    const w = world();
    const c = bot("bot-x");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "ttl" });
    expect(typeof sent.body.expires_at).toBe("number");
    expect(Number(sent.body.expires_at) - HANDLE_TTL_MS).toBeGreaterThanOrEqual(1_791_500_000_000);
    const waited = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: AWAIT_TIMEOUT_MS_MAX });
    expect(waited.body).toMatchObject({ finished: true, expires_at: sent.body.expires_at });
  });

  it("an expired handle on the caller's own conversation answers that turn instead of an error", async () => {
    const w = world();
    const user = w.add("t-old", { role: "user", kind: "text", text: "old question" });
    w.add("t-old", { role: "bot", kind: "text", text: "old answer" });
    w.threads.set("t-old", { agentId: "bot-a", owner: "bot:bot-x", title: "Old", hidden: false });
    w.state.set("t-old", "idle");
    const expired = signHandle(SECRET, { a: "bot-a", t: "t-old", m: user.id, i: user.at - HANDLE_TTL_MS - 60_000, c: "bot:bot-x" });
    const r = await w.api.call(bot("bot-x"), "await_turn", { agent_id: "bot-a", handle: expired, timeout_ms: 0 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      agent_id: "bot-a", thread_id: "t-old", finished: true, status: "finished", reply: "old answer",
      handle: null, recovered_from: "handle_expired",
    });
    expect(String(r.body.note)).toContain("t-old");
    // Another caller that cannot read t-old still gets the coded refusal, no thread named.
    const stranger = await w.api.call(bot("bot-z"), "await_turn", { agent_id: "bot-a", handle: expired, timeout_ms: 0 });
    expect(stranger.status).toBe(400);
    expect(stranger.body.code).toBe("handle_expired");
    expect(JSON.stringify(stranger.body)).not.toContain("t-old");
  });

  it("a live handle from another session of a caller who reads the conversation is recovered", async () => {
    const w = world();
    const user = w.add("t-mine", { role: "user", kind: "text", text: "q" });
    w.add("t-mine", { role: "bot", kind: "text", text: "a" });
    w.threads.set("t-mine", { agentId: "bot-a", owner: "bot:bot-x", title: "Mine", hidden: false });
    w.state.set("t-mine", "idle");
    const fromOtherSession = signHandle(SECRET, { a: "bot-a", t: "t-mine", m: user.id, i: user.at, c: "bot:earlier-session" });
    const r = await w.api.call(bot("bot-x"), "await_turn", { agent_id: "bot-a", handle: fromOtherSession, timeout_ms: 0 });
    expect(r.body).toMatchObject({ thread_id: "t-mine", reply: "a", recovered_from: "handle_session_mismatch", handle: null });
  });
});

describe("transcripts", () => {
  async function seeded() {
    const w = world();
    const c = bot("bot-x");
    for (const prompt of ["one", "two", "three"]) {
      await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt, mode: "blocking" });
    }
    return { w, c };
  }

  it("read_transcript returns every entry the caller may read, oldest first, never tool I/O", async () => {
    const { w, c } = await seeded();
    const tid = [...w.threads.keys()][0]!;
    w.add(tid, { role: "bot", kind: "activity", tool: { name: "Bash", ok: false } });
    w.add(tid, { role: "bot", kind: "reasoning", text: "private thoughts" });
    const r = await w.api.call(c, "read_transcript", { agent_id: "bot-a" });
    const entries = r.body.entries as Array<{ text: string; kind: string; role: string }>;
    expect(entries.map((e) => e.text)).toEqual(["one", "echo: one", "two", "echo: two", "three", "echo: three", "Bash (failed)"]);
    expect(entries.at(-1)!.kind).toBe("tool");
    expect(JSON.stringify(r.body)).not.toContain("private thoughts");
    // another caller reads none of it
    expect((await w.api.call(bot("bot-y"), "read_transcript", { agent_id: "bot-a" })).body.entries).toEqual([]);
  });

  it("read_latest_page pages backwards with sequence cursors", async () => {
    const { w, c } = await seeded();
    const first = await w.api.call(c, "read_latest_page", { agent_id: "bot-a", limit: 4 });
    expect((first.body.entries as Array<{ text: string }>).map((e) => e.text)).toEqual(["two", "echo: two", "three", "echo: three"]);
    const second = await w.api.call(c, "read_latest_page", { agent_id: "bot-a", limit: 4, cursor: first.body.next_cursor });
    expect((second.body.entries as Array<{ text: string }>).map((e) => e.text)).toEqual(["one", "echo: one"]);
    expect(second.body.next_cursor).toBeNull();
    expect((await w.api.call(c, "read_latest_page", { agent_id: "bot-a", cursor: "nope" })).status).toBe(400);
    expect((await w.api.call(c, "read_latest_page", { agent_id: "bot-a", limit: 0 })).status).toBe(400);
  });

  it("an answer stays under the byte budget and continues with next_cursor", async () => {
    const { w, c } = await seeded();
    const tid = [...w.threads.keys()][0]!;
    for (let n = 0; n < 70; n++) w.add(tid, { role: "bot", kind: "text", text: `${String(n).padStart(2, "0")}:${"x".repeat(ENTRY_TEXT_MAX + 50)}` });
    const r = await w.api.call(c, "read_transcript", { agent_id: "bot-a" });
    expect(Buffer.byteLength(JSON.stringify(r.body))).toBeLessThan(1024 * 1024);
    expect(r.body.truncated).toBe(true);
    expect(String(r.body.next)).toContain("next_cursor");
    const entries = r.body.entries as Array<{ text: string }>;
    expect(entries.at(-1)!.text.endsWith("\n[...]")).toBe(true);
    // the rest is reachable page by page, nothing lost or repeated
    const seen = entries.map((e) => e.text.slice(0, 3));
    let cursor = r.body.next_cursor as string | null;
    while (cursor) {
      const page = await w.api.call(c, "read_transcript_cold", { agent_id: "bot-a", cursor });
      expect(Buffer.byteLength(JSON.stringify(page.body))).toBeLessThan(1024 * 1024);
      seen.unshift(...(page.body.entries as Array<{ text: string }>).map((e) => e.text.slice(0, 3)));
      cursor = page.body.next_cursor as string | null;
    }
    expect(seen.length).toBe(6 + 70);
    expect(new Set(seen.slice(6)).size).toBe(70);
  });

  it("read_latest_page_with_threads adds per-thread counts", async () => {
    const { w, c } = await seeded();
    const r = await w.api.call(c, "read_latest_page_with_threads", { agent_id: "bot-a", limit: 2 });
    expect(r.body.threads).toEqual([expect.objectContaining({ count: 6, in_page: 2, hidden: false, status: "idle" })]);
  });

  it("read_latest_page and read_latest_page_with_threads read one conversation by thread_id, the caller's own only", async () => {
    const { w, c } = await seeded();
    const tid = [...w.threads.keys()][0]!;
    const one = await w.api.call(c, "read_latest_page", { agent_id: "bot-a", limit: 2, thread_id: tid });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect((one.body.entries as Array<{ thread_id: string }>).every((e) => e.thread_id === tid)).toBe(true);
    const withThreads = await w.api.call(c, "read_latest_page_with_threads", { agent_id: "bot-a", thread_id: tid });
    expect((withThreads.body.threads as Array<{ thread_id: string }>).map((t) => t.thread_id)).toEqual([tid]);
    expect((await w.api.call(c, "read_latest_page", { agent_id: "bot-a", thread_id: "not-mine" })).body.code).toBe("unknown_thread");
    expect((await w.api.call(bot("bot-y"), "read_latest_page", { agent_id: "bot-a", thread_id: tid })).status).toBe(404);
    expect((await w.api.call(c, "read_latest_page", { agent_id: "bot-a", thread_id: "a/b" })).status).toBe(400);
  });

  it("turnLabel keeps the agent's name and the prompt's first words", () => {
    expect(turnLabel("Quasar", "  check   the\nbackups ")).toBe("Quasar: check the backups");
    const long = turnLabel("Quasar", "word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual("Quasar: ".length + 62);
    expect(long.endsWith("...")).toBe(true);
  });

  it("read_transcript_page bounds by unix ms (inclusive) and a cursor", async () => {
    const { w, c } = await seeded();
    const all = (await w.api.call(c, "read_transcript", { agent_id: "bot-a" })).body.entries as Array<{ at: number; text: string }>;
    const r = await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", limit: 10, before_ms: all[3]!.at, after_ms: all[1]!.at });
    expect((r.body.entries as Array<{ text: string }>).map((e) => e.text)).toEqual(["echo: one", "two", "echo: two"]);
    const paged = await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", limit: 2, before_ms: all[3]!.at, after_ms: all[1]!.at });
    expect((paged.body.entries as Array<{ text: string }>).map((e) => e.text)).toEqual(["two", "echo: two"]);
    const rest = await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", limit: 2, before_ms: all[3]!.at, after_ms: all[1]!.at, cursor: paged.body.next_cursor });
    expect((rest.body.entries as Array<{ text: string }>).map((e) => e.text)).toEqual(["echo: one"]);
    expect((await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", limit: 2 })).status).toBe(400);
    expect((await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", before_ms: 5 })).status).toBe(400);
    expect((await w.api.call(c, "read_transcript_page", { agent_id: "bot-a", limit: 2, before_ms: 5, after_ms: 9 })).status).toBe(400);
  });

  it("read_transcript_cold reads the stored transcript without touching live state", async () => {
    const { w, c } = await seeded();
    for (let i = 0; i < 60; i++) w.add([...w.threads.keys()][0]!, { role: "bot", kind: "text", text: `n${i}` });
    w.turnStateCalls.length = 0;
    const page = await w.api.call(c, "read_transcript_cold", { agent_id: "bot-a" });
    expect((page.body.entries as unknown[]).length).toBe(COLD_PAGE_SIZE);
    expect(page.body.cold).toBe(true);
    const next = await w.api.call(c, "read_transcript_cold", { agent_id: "bot-a", cursor: page.body.next_cursor });
    expect((next.body.entries as unknown[]).length).toBe(66 - COLD_PAGE_SIZE);
    expect(w.turnStateCalls).toEqual([]);
  });

  it("cursors round-trip and reject garbage", () => {
    const key = { at: 5, threadId: "t-1", id: "m_9" };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
    expect(decodeCursor("c1.zzz")).toBeNull();
    expect(decodeCursor("x")).toBeNull();
  });
});

describe("end to end: two bots", () => {
  it("bot A sends async to bot B, awaits the turn, then reads B's latest page", async () => {
    const w = world({ replyAfterPolls: 5, reply: (p) => `B did: ${p}` });
    const a = bot("bot-a");
    const listed = await w.api.call(a, "find_agents", { query: "dispatch" });
    const target = (listed.body.agents as AgentSummary[])[0]!;
    expect(target.id).toBe("bot-b");
    const sent = await w.api.call(a, "send_prompt", { agent_id: target.id, prompt: "schedule Bob on Monday", mode: "async" });
    expect(sent.body.accepted).toBe(true);
    const awaited = await w.api.call(a, "await_turn", { agent_id: target.id, handle: sent.body.handle, timeout_ms: 30_000 });
    expect(awaited.body).toMatchObject({ finished: true, reply: "B did: schedule Bob on Monday" });
    const latestPage = await w.api.call(a, "read_latest_page", { agent_id: target.id, limit: 5 });
    expect((latestPage.body.entries as Array<{ role: string; text: string }>).map((e) => [e.role, e.text])).toEqual([
      ["user", "schedule Bob on Monday"],
      ["agent", "B did: schedule Bob on Monday"],
    ]);
    // #1170: the conversation is not hidden, and belongs to A
    expect(w.threads.get(String(sent.body.thread_id))).toMatchObject({ hidden: false, owner: "bot:bot-a", agentId: "bot-b" });
    expect(w.audits.map((row) => row.entry.tool)).toEqual(["find_agents", "send_prompt", "await_turn", "read_latest_page"]);
  });
});

describe("securable tool layer (B2)", () => {
  const withGuard = (mode: "shadow" | "enforce") => {
    const w = world();
    const grants = new ToolGrantStore(null);
    const api = createAgentApi({
      ...w.deps,
      guardMode: mode,
      guard: (caller, policy) => guardDecision(policy, { kind: caller.kind === "bot" ? "bot" : "user", id: caller.id },
        caller.speakerPrincipalId ? { kind: "user", id: caller.speakerPrincipalId } : null, grants),
    });
    return { w, api, grants };
  };

  it("shadow records the decision and changes nothing", async () => {
    const { w, api } = withGuard("shadow");
    expect((await api.call(bot("bot-x"), "create_agent", { name: "Shadowed" })).status).toBe(200);
    expect(w.audits.at(-1)!.entry.detail).toMatchObject({ access: "admin", scope: "agents:admin", guard: "not_granted", guardAllow: false, guardMode: "shadow" });
    await api.call(bot("bot-x"), "list_agents", {});
    expect(w.audits.at(-1)!.entry.detail).toMatchObject({ readOnly: true, scope: "agents:read", guard: "default", guardAllow: true });
  });

  it("enforce refuses admin without grants, for the bot and its speaker", async () => {
    const { w, api, grants } = withGuard("enforce");
    const caller = { ...bot("bot-x"), speakerPrincipalId: "pr_owner" };
    expect((await api.call(caller, "create_agent", { name: "No" })).body).toMatchObject({ code: "not_granted" });
    expect(w.audits.at(-1)!.entry).toMatchObject({ outcome: "refused", code: "not_granted" });
    grants.grant({ kind: "bot", id: "bot-x" }, "agents:admin", "pr_owner");
    expect((await api.call(caller, "create_agent", { name: "No" })).body.message).toContain("person this turn speaks for");
    grants.grant({ kind: "user", id: "pr_owner" }, "agents:admin", "pr_owner");
    expect((await api.call(caller, "create_agent", { name: "Yes" })).status).toBe(200);
    expect((await api.call(caller, "list_agents", {})).status).toBe(200);
  });

  it("without a guard dependency the audit carries no guard fields", async () => {
    const w = world();
    await w.api.call(bot("bot-x"), "list_agents", {});
    expect(w.audits.at(-1)!.entry.detail).not.toHaveProperty("guard");
  });
});


describe("one error envelope (audit 2026-10-29, B5)", () => {
  it("every refusal answers {code, message, hint, details, retryable} with the real status and keeps older fields", async () => {
    const w = world();
    const unknown = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "nope", prompt: "x" });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({
      error: unknown.body.message, code: "unknown_agent", message: expect.any(String), hint: "", retryable: false,
      details: { status: 404, retryable: false },
    });
    const bad = await w.api.call(bot("bot-x"), "await_turn", { agent_id: "bot-a", handle: "turn_nope" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body).sort()).toEqual(["code", "details", "error", "hint", "message", "retryable"]);
    expect(bad.body.details).toEqual({ reason: "format", family: "bad_handle", status: 400, retryable: false });
    expect(bad.body.retryable).toBe(false);
  });
});
