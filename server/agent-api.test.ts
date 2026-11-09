import { join } from "node:path";
import { ToolGrantStore } from "./tools/tool-grants.ts";
import { guardDecision } from "./tools/tool-guard.ts";
import { describe, expect, it } from "vitest";

import { createHmac } from "node:crypto";

import {
  AGENT_SETTINGS_FIELDS, AGENT_TOOL_NAMES, AGENT_TOOL_POLICY, agentPromptWithFiles, AWAIT_RECOMMENDED_WAIT_MS, AWAIT_REVIEW_WAIT_MS, AWAIT_TIMEOUT_MS_DEFAULT, AWAIT_TIMEOUT_MS_MAX, COLD_PAGE_SIZE, createAgentApi, ENTRY_TEXT_MAX, decodeCursor, encodeCursor, FIND_LIMIT_MAX,
  HANDLE_TTL_MS, matchScore, SEND_FILES_MAX, SEND_RECEIPT_TTL_MS, signHandle, signTurnHandle, turnLabel, verifyHandle,
  formatEngineCandidates, partitionAgentSettings, plainFieldRefusalReason, resolveEngineInstance,
  type AgentApiDeps, type AgentCaller, type AgentModelChoice, type AgentModelSummary, type AgentRoutinePatch, type AgentScope, type AgentSettingsResult, type AgentSummary, type AuditEntry, type FileInput, type SendReceipt, type StoredMessage, type TurnState,
} from "./agent-api.ts";
import { PRIORITY_DOWNGRADED_NOTE, resetPriorityWakeForTests, type PriorityDelivery } from "./proactive/priority-wake.ts";
import { failedTurnTool } from "../shared/failed-turn.ts";
import { ENGINE_EXITED_SENTENCE } from "../shared/engine-exit-words.ts";

const SECRET = Buffer.alloc(32, 7);
const ALL: AgentScope[] = ["agents.read", "agents.send", "agents.create"];

/** A small Sagax: agents, conversations, a fake runtime that answers a
 * prompt a few polls later, and a virtual clock. */
function world(options: {
  replyAfterPolls?: number;
  reply?: (prompt: string) => string;
  reachable?: (caller: AgentCaller, agent: AgentSummary) => boolean;
  /** The rows one turn writes after its prompt (progress, tools, answer). */
  replyRows?: (prompt: string) => Array<Omit<StoredMessage, "id" | "at">>;
  /** A send into a busy conversation waits in the server queue (busyMode
   * after): the 202 answers its queueId and the row is stored when its own
   * turn starts, carrying that queueId (#2575). */
  queueWhenBusy?: boolean;
} = {}) {
  let clock = 1_791_500_000_000;
  let ids = 0;
  const agents: AgentSummary[] = [
    { id: "bot-a", name: "Alpha", description: "Answers questions about invoices", status: "idle", owner: null, model: { instance_id: "claude-work", model: "claude-sonnet", effort: "high" } },
    { id: "bot-b", name: "Beta", description: "Dispatch and scheduling of technicians", status: "idle", owner: null, model: { instance_id: "grok", model: "grok-3" } },
    { id: "bot-c", name: "Gamma Reports", description: "Writes weekly reports", status: "running", owner: null, model: { instance_id: "codex", model: "gpt-5" } },
  ];
  const modelCatalog: AgentModelChoice[] = [
    { instance_id: "claude-work", label: "Claude Work", models: [{ id: "claude-sonnet", label: "Sonnet" }, { id: "claude-opus", label: "Opus" }], effort_levels: ["low", "high"], auto: true },
    { instance_id: "claude-home", label: "Claude Home", models: [{ id: "claude-sonnet", label: "Sonnet" }], auto: true },
    { instance_id: "grok", label: "Grok", models: [{ id: "grok-3", label: "Grok 3" }, { id: "grok-4", label: "Grok 4" }], auto: true },
  ];
  /** Permission keys the person holds (simulates BOT_FIELD_PERMISSIONS checks). */
  const heldPermissions = new Map<string, Set<string>>();
  const runtimeByBot = new Map<string, Record<string, unknown>>();
  const primaryByOwner = new Map<string, string>();
  const settingsByBot = new Map<string, Record<string, unknown>>();
  const routinePatches: AgentRoutinePatch[] = [];
  const routines = new Map<string, { id: string; name: string; enabled: boolean; instructions: string; owner: string }>([
    ["r-own", { id: "r-own", name: "Morning brief", enabled: true, instructions: "Summarise the inbox.", owner: "person:pr_1" }],
    ["r-other", { id: "r-other", name: "Other brief", enabled: true, instructions: "Not yours.", owner: "person:pr_2" }],
  ]);
  const threads = new Map<string, { agentId: string; owner: string; title: string; hidden: boolean }>();
  const messages = new Map<string, StoredMessage[]>();
  const state = new Map<string, TurnState>();
  const pending = new Map<string, { polls: number; prompt: string }>();
  const waiting = new Map<string, Array<{ queueId: string; prompt: string; queuedAt: number }>>();
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
        if (options.replyRows) for (const row of options.replyRows(job.prompt)) add(threadId, row);
        else {
          const text = (options.reply ?? ((p) => `echo: ${p}`))(job.prompt);
          if (text) add(threadId, { role: "bot", kind: "text", text });
        }
        state.set(threadId, "idle");
        // the next queued send starts its own turn, one per send
        const next = waiting.get(threadId)?.shift();
        if (next) {
          add(threadId, { role: "user", kind: "text", text: next.prompt, queueId: next.queueId });
          state.set(threadId, "running");
          pending.set(threadId, { polls: options.replyAfterPolls ?? 3, prompt: next.prompt });
        }
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
        model: agent.model ?? null,
      };
    },
    async listModels(_caller, agentId) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) return { status: 404, code: "unknown_agent", message: "No such agent." };
      return { models: modelCatalog, current: agent.model ?? null };
    },
    async updateModel(caller, agentId, selection) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) return { status: 404, code: "unknown_agent", message: "No such agent." };
      if (caller.kind !== "person") {
        return { status: 403, code: "forbidden_caller", message: "update_agent_model is for a person's AI client." };
      }
      const ownerKey = owners.get(agentId);
      const isOwner = ownerKey === key(caller);
      if (ownerKey && !isOwner && caller.admin !== true) {
        return { status: 403, code: "forbidden_owner", message: "Only the owner or an organization admin changes this agent's model." };
      }
      let instanceId = selection.instanceId ?? agent.model?.instance_id;
      if (selection.instanceId) {
        const candidates = modelCatalog.map((entry) => ({
          instanceId: entry.instance_id,
          driverKind: entry.instance_id.startsWith("claude") ? "claude" : entry.instance_id,
          displayName: entry.label,
        }));
        const exact = modelCatalog.some((entry) => entry.instance_id === selection.instanceId);
        if (!exact) {
          const resolved = resolveEngineInstance(selection.instanceId, candidates);
          if (!resolved.ok && resolved.reason === "ambiguous") {
            return {
              status: 400,
              code: "ambiguous_engine",
              message: `Several engines match "${selection.instanceId}": ${formatEngineCandidates(resolved.candidates)}. Pass the exact instance_id from list_agent_models.`,
            };
          }
          if (resolved.ok) instanceId = resolved.instanceId;
        }
      }
      const modelId = selection.model ?? agent.model?.model;
      if (selection.auto !== true) {
        const engine = modelCatalog.find((entry) => entry.instance_id === instanceId);
        if (!engine || !engine.models.some((entry) => entry.id === modelId)) {
          const hint = modelCatalog.map((entry) => `${entry.instance_id}: ${entry.models.map((m) => m.id).join(", ")}`).join("; ");
          return { status: 400, code: "model_refused", message: `Unknown model ${modelId} on ${instanceId}.`, extra: { hint: `Valid choices: ${hint}.` } };
        }
      }
      const next: AgentModelSummary = {
        instance_id: instanceId!,
        model: modelId!,
        ...(selection.effort ? { effort: selection.effort } : {}),
        ...(selection.auto === true ? { auto: true } : {}),
      };
      agent.model = next;
      return { model: next, agent };
    },
    async updateSettings(caller, agentId, fields) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) return { status: 404, code: "unknown_agent", message: "No such agent." };
      if (caller.kind !== "person") {
        return { status: 403, code: "forbidden_caller", message: "update_agent_settings is for a person's AI client." };
      }
      const ownerKey = owners.get(agentId);
      const isOwner = ownerKey === key(caller);
      if (ownerKey && !isOwner && caller.admin !== true) {
        return { status: 403, code: "forbidden_owner", message: "Only the owner or an organization admin edits this agent." };
      }
      const held = heldPermissions.get(key(caller)) ?? new Set<string>();
      const needs: Record<string, string> = {
        voiceNotes: "bots.behaviour",
        approvalMode: "bots.approvalLevel",
        cwd: "folders.botWorkingFolder",
        toolScope: "bots.tools",
        cloudBackend: "bots.computer",
        maxConcurrentThreads: "bots.behaviour",
      };
      // Admin-only in this fixture (not in MEMBER_BOT_FIELDS / BOT_FIELD_PERMISSIONS).
      const adminOnly = new Set(["cacheKeepWarm"]);
      const { patch, runtime, primary, primaryInvalid } = partitionAgentSettings(fields);
      const changed: string[] = [];
      const refused: AgentSettingsResult["refused"] = [];
      if (primaryInvalid) {
        refused.push({ field: "primary", reason: "primary is true (make Primary Bot) or false (clear it)." });
      }
      if (primary === true) {
        if (!isOwner && caller.admin !== true) {
          refused.push({ field: "primary", reason: "only the owner can make or clear the Primary Bot" });
        } else {
          primaryByOwner.set(key(caller), agentId);
          changed.push("primary");
        }
      } else if (primary === false) {
        if (primaryByOwner.get(key(caller)) === agentId) primaryByOwner.delete(key(caller));
        changed.push("primary");
      }
      for (const [field, value] of Object.entries(runtime)) {
        const need = needs[field];
        if (need && !held.has(need) && caller.admin !== true) {
          refused.push({
            field,
            reason: plainFieldRefusalReason(field, { permission: need, message: `Your profile does not include ${need}. Ask an admin to add it in Perspicax.` }),
          });
          continue;
        }
        const current = runtimeByBot.get(agentId) ?? {};
        current[field] = value;
        runtimeByBot.set(agentId, current);
        changed.push(field);
      }
      for (const [field, value] of Object.entries(patch)) {
        if (!AGENT_SETTINGS_FIELDS.includes(field)) {
          refused.push({ field, reason: `Field ${field} is not editable in this fixture.` });
          continue;
        }
        if (adminOnly.has(field) && caller.admin !== true) {
          refused.push({
            field,
            reason: plainFieldRefusalReason(field, { error: `forbidden: a member may change their bot's name, look, instructions and model, not "${field}"` }),
          });
          continue;
        }
        const need = needs[field];
        if (need && !held.has(need) && caller.admin !== true) {
          refused.push({
            field,
            reason: plainFieldRefusalReason(field, { permission: need, message: `Your profile does not include ${need}. Ask an admin to add it in Perspicax.` }),
          });
          continue;
        }
        if (field === "name" && typeof value === "string" && value.trim()) agent.name = value.trim();
        if (field === "description" && typeof value === "string") agent.description = value;
        const stored = settingsByBot.get(agentId) ?? {};
        stored[field] = value;
        settingsByBot.set(agentId, stored);
        changed.push(field);
      }
      if (!changed.length && refused.length) {
        return { status: 403, code: "settings_refused", message: refused[0]!.reason, extra: { refused } };
      }
      return { changed, refused, agent };
    },
    async updateRoutine(caller, routineId, patch: AgentRoutinePatch) {
      routinePatches.push(patch);
      if (caller.kind !== "person") {
        return { status: 403, code: "forbidden_caller", message: "update_routine is for a person's AI client." };
      }
      const routine = routines.get(routineId);
      if (!routine || routine.owner !== key(caller)) {
        return { status: 404, code: "not_found", message: "No such routine." };
      }
      if (patch.enabled !== undefined) routine.enabled = patch.enabled;
      if (patch.name !== undefined) routine.name = patch.name;
      if (patch.instructions !== undefined) routine.instructions = patch.instructions;
      if (patch.requiresComputer !== undefined) (routine as Record<string, unknown>).requiresComputer = patch.requiresComputer;
      return { routine: { ...routine } };
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
    // #1170: a bot keeps the agent's single chat with its person; a
    // person's AI client opens a fresh conversation per send (#2575)
    async conversation(caller, agentId) {
      const found = caller.kind === "person" ? undefined : [...threads].find(([, t]) => t.agentId === agentId && t.owner === key(caller));
      if (found) return { threadId: found[0] };
      const threadId = `t${++ids}`;
      threads.set(threadId, { agentId, owner: key(caller), title: `${caller.name} via agent API`, hidden: false });
      return { threadId };
    },
    async post(_caller, _agentId, threadId, prompt, files, wake) {
      posted.push({ threadId, files, ...(wake ? { wake } : {}) });
      // A front send waits; it must not start a turn or move the clock.
      if (wake?.front) return { messageId: null };
      if (options.queueWhenBusy && (state.get(threadId) ?? "idle") !== "idle") {
        const queueId = `q${++ids}`;
        waiting.set(threadId, [...(waiting.get(threadId) ?? []), { queueId, prompt, queuedAt: clock }]);
        return { messageId: queueId };
      }
      const row = add(threadId, { role: "user", kind: "text", text: prompt });
      state.set(threadId, "running");
      pending.set(threadId, { polls: options.replyAfterPolls ?? 3, prompt });
      return { messageId: row.id };
    },
    queuedPrompts: (threadId) => (waiting.get(threadId) ?? []).map((item) => ({ id: item.queueId, text: item.prompt, queuedAt: item.queuedAt })),
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
  return {
    routinePatches, deps, api: createAgentApi(deps), agents, owners, archived, created, threads, messages, state, audits, notified, interrupted, turnStateCalls, posted,
    heldPermissions, runtimeByBot, primaryByOwner, settingsByBot,
    add, advance: (ms: number) => { clock += ms; }, settle: async () => { for (let i = 0; i < 50; i++) await deps.sleep!(400); },
  };
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
  it("declares the agent tools, each with a scope, an access level and a read-only flag", () => {
    expect(AGENT_TOOL_NAMES).toHaveLength(17);
    for (const name of AGENT_TOOL_NAMES) {
      const policy = AGENT_TOOL_POLICY[name];
      expect(policy.readOnly).toBe(policy.access === "read");
      expect(policy.rate).toBeGreaterThan(0);
    }
    expect(AGENT_TOOL_POLICY.create_agent.access).toBe("admin");
    expect(AGENT_TOOL_POLICY.send_prompt.scope).toBe("agents.send");
    expect(AGENT_TOOL_POLICY.update_agent_model.scope).toBe("agents.send");
    expect(AGENT_TOOL_POLICY.list_agent_models.readOnly).toBe(true);
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
    expect(r.body.agents).toEqual(w.agents.map(({ id, name, description, status, owner, model }) => ({ id, name, description, status, temporary: false, owner, ...(model ? { model } : {}) })));
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

  it("a person's send_prompt opens a fresh conversation unless thread_id names one of theirs; a bot keeps one (#1170, #2575)", async () => {
    const w = world();
    const first = await w.api.call(person("p1"), "send_prompt", { agent_id: "bot-a", prompt: "one" });
    const second = await w.api.call(person("p1"), "send_prompt", { agent_id: "bot-a", prompt: "two" });
    expect(second.body.thread_id).not.toBe(first.body.thread_id);
    const again = await w.api.call(person("p1"), "send_prompt", { agent_id: "bot-a", prompt: "three", thread_id: first.body.thread_id });
    expect(again.body).toMatchObject({ accepted: true, thread_id: first.body.thread_id });
    const foreign = await w.api.call(person("p2"), "send_prompt", { agent_id: "bot-a", prompt: "x", thread_id: first.body.thread_id });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ code: "unknown_thread" });
    const b1 = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "one" });
    const b2 = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "two" });
    expect(b2.body.thread_id).toBe(b1.body.thread_id);
  });

  it("send_prompt with an idempotency_key starts one turn; a resend replays it (Perspicax #1265)", async () => {
    const w = world();
    const args = { agent_id: "bot-a", prompt: "ship the report", mode: "async", idempotency_key: "run-42:step.1" };
    const [first, concurrent] = await Promise.all([
      w.api.call(person("p1"), "send_prompt", args),
      w.api.call(person("p1"), "send_prompt", args),
    ]);
    const again = await w.api.call(person("p1"), "send_prompt", args);
    expect(w.posted).toHaveLength(1);
    expect(first.body).toMatchObject({ accepted: true });
    expect(first.body.replayed).toBeUndefined();
    for (const r of [concurrent, again]) {
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ accepted: true, replayed: true, thread_id: first.body.thread_id });
      expect(String(r.body.handle)).toMatch(/^turn_/);
    }
    const reused = await w.api.call(person("p1"), "send_prompt", { ...args, prompt: "something else" });
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ code: "idempotency_key_reused", thread_id: first.body.thread_id });
    // The key is per caller: another person's same key is a new send.
    const other = await w.api.call(person("p2"), "send_prompt", args);
    expect(other.body.replayed).toBeUndefined();
    expect(w.posted).toHaveLength(2);
    const bad = await w.api.call(person("p1"), "send_prompt", { ...args, idempotency_key: "has space" });
    expect(bad.body).toMatchObject({ code: "bad_request", details: { reason: "invalid_idempotency_key" } });
  });

  it("an idempotency_key lasts the handle's lifetime: after it, a resend is a new send with a valid handle (#2849)", async () => {
    const w = world();
    const args = { agent_id: "bot-a", prompt: "ship the report", mode: "async", idempotency_key: "run-7:step.1" };
    const first = await w.api.call(person("p1"), "send_prompt", args);
    await w.settle();
    w.advance(SEND_RECEIPT_TTL_MS - 60_000);
    const within = await w.api.call(person("p1"), "send_prompt", args);
    expect(within.body).toMatchObject({ replayed: true, thread_id: first.body.thread_id, expires_at: first.body.expires_at });
    expect(w.posted).toHaveLength(1);
    w.advance(120_000);
    const after = await w.api.call(person("p1"), "send_prompt", args);
    expect(after.body.replayed).toBeUndefined();
    expect(after.body).toMatchObject({ accepted: true });
    expect(w.posted).toHaveLength(2);
    const waited = await w.api.call(person("p1"), "await_turn", { agent_id: "bot-a", handle: after.body.handle, timeout_ms: 30_000 });
    expect(waited.status).toBe(200);
    expect(waited.body).toMatchObject({ finished: true, reply: "echo: ship the report" });
    // Within the new lifetime the key replays the new send.
    const again = await w.api.call(person("p1"), "send_prompt", args);
    expect(again.body).toMatchObject({ replayed: true, thread_id: after.body.thread_id });
    expect(w.posted).toHaveLength(2);
  });

  it("an idempotency_key receipt is pending before the post: a crash after the post replays, a crash before it sends anew (#2849)", async () => {
    const receipts = new Map<string, SendReceipt>();
    const writes: Array<{ key: string; pending: boolean }> = [];
    const store = {
      get: (key: string) => receipts.get(key) ?? null,
      put: (key: string, receipt: SendReceipt) => { writes.push({ key, pending: receipt.pending === true }); receipts.set(key, receipt); },
      delete: (key: string) => void receipts.delete(key),
    };
    const w = world();
    const api = createAgentApi({ ...w.deps, sendReceipts: store });
    const args = { agent_id: "bot-a", prompt: "ship the report", mode: "async", idempotency_key: "run-9:step.1" };
    const first = await api.call(person("p1"), "send_prompt", args);
    expect(writes.map((write) => write.pending)).toEqual([true, false]);
    // Simulate a crash after the post, before the final receipt.
    const key = writes[0]!.key;
    receipts.set(key, { ...receipts.get(key)!, message_id: null, pending: true });
    const restarted = createAgentApi({ ...w.deps, sendReceipts: store });
    const replay = await restarted.call(person("p1"), "send_prompt", args);
    expect(replay.body).toMatchObject({ replayed: true, thread_id: first.body.thread_id });
    expect(w.posted).toHaveLength(1);
    expect(receipts.get(key)?.pending).toBeUndefined();
    // A crash before the post: no user line after issued_at, the key is free.
    await w.settle();
    w.advance(60_000);
    receipts.set(key, { ...receipts.get(key)!, message_id: null, issued_at: w.deps.now!(), pending: true });
    const resend = await restarted.call(person("p1"), "send_prompt", args);
    expect(resend.body.replayed).toBeUndefined();
    expect(w.posted).toHaveLength(2);
    // A refused post leaves no receipt behind.
    const refusing = createAgentApi({ ...w.deps, sendReceipts: store, post: async () => ({ status: 503, code: "unavailable", message: "down" }) });
    const refused = await refusing.call(person("p1"), "send_prompt", { ...args, idempotency_key: "run-9:step.2" });
    expect(refused.status).toBe(503);
    expect([...receipts.keys()].some((stored) => stored.endsWith("run-9:step.2"))).toBe(false);
  });

  it("a pending receipt finds a queued send (busyMode after) and only a line with its own text (#2858)", async () => {
    const receipts = new Map<string, SendReceipt>();
    const store = {
      get: (key: string) => receipts.get(key) ?? null,
      put: (key: string, receipt: SendReceipt) => void receipts.set(key, receipt),
      delete: (key: string) => void receipts.delete(key),
    };
    const w = world({ queueWhenBusy: true, replyAfterPolls: 20 });
    // no background watcher: the clock moves only when the test says so
    const api = createAgentApi({ ...w.deps, notify: undefined, sendReceipts: store });
    const first = await api.call(person("p1"), "send_prompt", { agent_id: "bot-a", prompt: "first job", mode: "async" });
    const threadId = first.body.thread_id as string;
    // The conversation is busy: this send waits in the queue, no user line yet.
    const args = { agent_id: "bot-a", prompt: "second job", mode: "async", thread_id: threadId, on_busy: "queue", idempotency_key: "run-11:step.1" };
    const queued = await api.call(person("p1"), "send_prompt", args);
    expect(queued.body).toMatchObject({ accepted: true });
    expect(w.posted).toHaveLength(2);
    // Crash after the post, before the final receipt; the queue survives.
    const key = [...receipts.keys()].find((stored) => stored.endsWith("run-11:step.1"))!;
    receipts.set(key, { ...receipts.get(key)!, message_id: null, pending: true });
    expect(w.messages.get(threadId)!.some((message) => message.text === "second job")).toBe(false);
    const restarted = createAgentApi({ ...w.deps, notify: undefined, sendReceipts: store });
    const replay = await restarted.call(person("p1"), "send_prompt", args);
    expect(replay.body).toMatchObject({ replayed: true, thread_id: threadId });
    expect(w.posted).toHaveLength(2);
    expect(receipts.get(key)).toMatchObject({ message_id: expect.stringMatching(/^q/) });
    expect(receipts.get(key)?.pending).toBeUndefined();
    const waited = await restarted.call(person("p1"), "await_turn", { agent_id: "bot-a", handle: replay.body.handle, timeout_ms: 30_000 });
    expect(waited.body).toMatchObject({ finished: true, reply: "echo: second job" });

    // Crash before the post while another sender writes in that conversation:
    // its line is not this prompt, so the key is free and the send goes out.
    await w.settle();
    receipts.set(key, { ...receipts.get(key)!, message_id: null, issued_at: w.deps.now!(), pending: true });
    w.add(threadId, { role: "user", kind: "text", text: "a line from someone else" });
    const resend = await restarted.call(person("p1"), "send_prompt", args);
    expect(resend.body.replayed).toBeUndefined();
    expect(w.posted).toHaveLength(3);
  });

  it("a pending receipt ignores a queued item older than its issued_at: K1 queued before K2, K2's resend posts (#2858)", async () => {
    const receipts = new Map<string, SendReceipt>();
    const store = {
      get: (key: string) => receipts.get(key) ?? null,
      put: (key: string, receipt: SendReceipt) => void receipts.set(key, receipt),
      delete: (key: string) => void receipts.delete(key),
    };
    const w = world({ queueWhenBusy: true, replyAfterPolls: 200 });
    const api = createAgentApi({ ...w.deps, notify: undefined, sendReceipts: store });
    const first = await api.call(person("p1"), "send_prompt", { agent_id: "bot-a", prompt: "first job", mode: "async" });
    const threadId = first.body.thread_id as string;
    // K1 queues "same job" behind the busy turn.
    const k1 = { agent_id: "bot-a", prompt: "same job", mode: "async", thread_id: threadId, on_busy: "queue", idempotency_key: "run-12:K1" };
    const queued = await api.call(person("p1"), "send_prompt", k1);
    expect(queued.body).toMatchObject({ accepted: true });
    expect(w.posted).toHaveLength(2);
    // Later, K2 sends the same text and crashes before its post.
    w.advance(5_000);
    const k2 = { ...k1, idempotency_key: "run-12:K2" };
    const k1Key = [...receipts.keys()].find((stored) => stored.endsWith("run-12:K1"))!;
    const k2Key = k1Key.replace(/run-12:K1$/, "run-12:K2");
    receipts.set(k2Key, { ...receipts.get(k1Key)!, message_id: null, issued_at: w.deps.now!(), pending: true });
    const restarted = createAgentApi({ ...w.deps, notify: undefined, sendReceipts: store });
    const resend = await restarted.call(person("p1"), "send_prompt", k2);
    // K1's queued item is older than K2's issued_at: K2 posts, never replays K1.
    expect(resend.body.replayed).toBeUndefined();
    expect(resend.body).toMatchObject({ accepted: true });
    expect(w.posted).toHaveLength(3);
    expect(receipts.get(k2Key)?.message_id).not.toBe(receipts.get(k1Key)?.message_id);
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

  it("supersede retires the stopped turn's open question after the interrupt (#2608)", async () => {
    const w = world({ replyAfterPolls: 50 });
    const order: string[] = [];
    const interrupt = w.deps.interrupt;
    w.deps.interrupt = async (agentId, threadId) => { order.push(`interrupt:${threadId}`); await interrupt(agentId, threadId); };
    w.deps.retireQuestions = (_agentId, threadId) => { order.push(`retire:${threadId}`); };
    const api = createAgentApi(w.deps);
    const caller = bot("bot-x");
    const first = await api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "first" });
    const thread = first.body.thread_id;
    // queue (the default) never retires the question
    await api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "queued", thread_id: thread });
    expect(order).toEqual([]);
    await api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "instead", thread_id: thread, on_busy: "supersede" });
    expect(order).toEqual([`interrupt:${thread}`, `retire:${thread}`]);
  });

  it("each prompt queued behind a busy conversation gets its own reply, never an empty finished (#2575)", async () => {
    const w = world({ queueWhenBusy: true });
    const caller = person("p1");
    const first = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "first" });
    const thread = first.body.thread_id;
    const second = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "second", thread_id: thread });
    const third = await w.api.call(caller, "send_prompt", { agent_id: "bot-a", prompt: "third", thread_id: thread });
    expect([second.body.thread_id, third.body.thread_id]).toEqual([thread, thread]);
    const a1 = await w.api.call(caller, "await_turn", { agent_id: "bot-a", handle: first.body.handle, timeout_ms: AWAIT_TIMEOUT_MS_MAX });
    expect(a1.body).toMatchObject({ finished: true, reply: "echo: first" });
    const a2 = await w.api.call(caller, "await_turn", { agent_id: "bot-a", handle: second.body.handle, timeout_ms: AWAIT_TIMEOUT_MS_MAX });
    expect(a2.body).toMatchObject({ finished: true, reply: "echo: second" });
    const a3 = await w.api.call(caller, "await_turn", { agent_id: "bot-a", handle: third.body.handle, timeout_ms: AWAIT_TIMEOUT_MS_MAX });
    expect(a3.body).toMatchObject({ finished: true, reply: "echo: third" });
  });

  it("reply is the final answer only; progress lines stay in the steps (#2579)", async () => {
    const w = world({
      replyRows: (prompt) => [
        { role: "bot", kind: "text", text: "Je cherche d'abord les billets ouverts." },
        { role: "bot", kind: "activity", text: "cw_psa_find_tickets", tool: { name: "cw_psa_find_tickets", ok: true } },
        { role: "bot", kind: "text", text: "Je regarde maintenant le temps saisi." },
        { role: "bot", kind: "activity", text: "cw_psa_find_time_entries", tool: { name: "cw_psa_find_time_entries", ok: true } },
        { role: "bot", kind: "text", text: `Réponse finale : ${prompt}` },
        { role: "bot", kind: "text", text: "Trois billets ouverts." },
      ],
    });
    const r = await w.api.call(bot("bot-x"), "send_prompt", { agent_id: "bot-a", prompt: "bilan", mode: "blocking", timeout_ms: 30_000 });
    expect(r.body).toMatchObject({ finished: true, reply: "Réponse finale : bilan\n\nTrois billets ouverts." });
    expect(String(r.body.reply)).not.toContain("Je cherche");
    const again = await w.api.call(bot("bot-x"), "await_turn", { agent_id: "bot-a", handle: r.body.handle, timeout_ms: 1_000 });
    expect(again.body.reply).toBe("Réponse finale : bilan\n\nTrois billets ouverts.");
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

  // Scorecard V8 (2026-11-02): held await_turn p95 was 45 s. Short default +
  // cursor resume frees MCP slots; callers poll with recommended_wait_ms.
  it("V8: default and recommended await waits are 15 s (was 45 s)", () => {
    const beforeDefaultMs = 45_000;
    const beforeHeldBudget = beforeDefaultMs * 118; // scorecard: 118 await_turn calls / 7 d
    const afterHeldBudget = AWAIT_TIMEOUT_MS_DEFAULT * 118;
    expect(AWAIT_TIMEOUT_MS_DEFAULT).toBe(15_000);
    expect(AWAIT_RECOMMENDED_WAIT_MS).toBe(15_000);
    expect(AWAIT_TIMEOUT_MS_MAX).toBe(55_000);
    expect(afterHeldBudget).toBe(beforeHeldBudget / 3);
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

  it("send_prompt async publishes the handle's lifetime as ttl_ms and an ISO expiry (#1896)", async () => {
    const w = world();
    const c = person("pr_ana");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "ttl", mode: "async" });
    expect(sent.body).toMatchObject({ status: "accepted", ttl_ms: HANDLE_TTL_MS });
    expect(sent.body.ttl_ms).toBe(7 * 24 * 3_600_000);
    expect(typeof sent.body.expires_at).toBe("number");
    expect(sent.body.expires_at_iso).toBe(new Date(Number(sent.body.expires_at)).toISOString());
    expect(String(sent.body.expires_at_iso)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const waited = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: AWAIT_TIMEOUT_MS_MAX });
    expect(waited.body).toMatchObject({ finished: true, ttl_ms: HANDLE_TTL_MS, expires_at: sent.body.expires_at, expires_at_iso: sent.body.expires_at_iso });
  });

  it("after an idle gap, the same person in a new MCP session keeps the handle; another person is refused (#1896)", async () => {
    const w = world({ replyAfterPolls: 1000 });
    const carSession: AgentCaller = { ...person("pr_ana"), client: "voice-car", sub: "sess-1" };
    const sent = await w.api.call(carSession, "send_prompt", { agent_id: "bot-a", prompt: "long job", mode: "async" });
    const threadId = String(sent.body.thread_id);
    w.advance(35 * 60_000);
    // A re-established session: another MCP session and AI client, same person.
    const reconnected: AgentCaller = { ...person("pr_ana"), client: "desktop", sub: "sess-2", via: "console" };
    const again = await w.api.call(reconnected, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 0 });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ handle: sent.body.handle, thread_id: threadId, status: "still_working" });
    expect(again.body).not.toHaveProperty("recovered_from");
    // Another person is refused and is not told the conversation.
    const stranger = await w.api.call(person("pr_bo"), "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 0 });
    expect(stranger.status).toBe(400);
    expect(stranger.body).toMatchObject({ code: "handle_session_mismatch", details: { reason: "other_caller" } });
    expect(JSON.stringify(stranger.body)).not.toContain(threadId);
  });

  it("a handle passed with the wrong agent_id carries its own thread_id and agent_id for recovery (#1896)", async () => {
    const w = world();
    const c = person("pr_ana");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "x", mode: "async" });
    const wrong = await w.api.call(c, "await_turn", { agent_id: "bot-b", handle: sent.body.handle, timeout_ms: 0 });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toMatchObject({
      code: "handle_agent_mismatch", thread_id: sent.body.thread_id, agent_id: "bot-a",
      details: { reason: "other_agent", thread_id: sent.body.thread_id, agent_id: "bot-a" },
    });
    const recovered = await w.api.call(c, "read_latest_page", { agent_id: wrong.body.agent_id, thread_id: wrong.body.thread_id });
    expect(recovered.status).toBe(200);
    // Another person with the same mix-up learns nothing.
    const stranger = await w.api.call(person("pr_bo"), "await_turn", { agent_id: "bot-b", handle: sent.body.handle, timeout_ms: 0 });
    expect(stranger.body.code).toBe("handle_agent_mismatch");
    expect(JSON.stringify(stranger.body)).not.toContain(String(sent.body.thread_id));
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

  it("a failed step carries its own error text, never a successful output (#3126)", async () => {
    const { w, c } = await seeded();
    const tid = [...w.threads.keys()][0]!;
    w.add(tid, { role: "bot", kind: "activity", tool: { name: "mcp__agents__sagax_settings", ok: false, output: "Unknown setting key \"rules\".\nUse list first." } });
    w.add(tid, { role: "bot", kind: "activity", tool: { name: "mcp__agents__sagax_settings", ok: true, output: "the whole result" } });
    const r = await w.api.call(c, "read_latest_page", { agent_id: "bot-a", limit: 2 });
    const texts = (r.body.entries as Array<{ text: string }>).map((e) => e.text);
    expect(texts).toEqual(["mcp__agents__sagax_settings (failed): Unknown setting key \"rules\". Use list first.", "mcp__agents__sagax_settings"]);
  });

  it("a routine run's result card in the chat reads as a note (#3152)", async () => {
    const { w, c } = await seeded();
    const tid = [...w.threads.keys()][0]!;
    w.add(tid, { role: "bot", kind: "routine.run", text: "Completed with problems.\n\nQuatre GO attendent la personne." });
    const r = await w.api.call(c, "read_latest_page", { agent_id: "bot-a", limit: 1 });
    expect(r.body.entries).toMatchObject([{ kind: "note", role: "agent", text: "Completed with problems.\n\nQuatre GO attendent la personne." }]);
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

  // #3203: an image attached in one bot's conversation, read by another bot
  // of the same person; never by a caller outside that conversation.
  it("read_transcript_attachment hands over an image of a conversation the caller reads, never another's", async () => {
    const { w, c } = await seeded();
    const tid = [...w.threads.keys()][0]!;
    const png = Buffer.from("png-bytes");
    const asked: string[] = [];
    w.deps.attachmentImage = async (name) => { asked.push(name); return name === "abc-1.png" ? { bytes: png, mime: "image/png" } : null; };
    const saved: string[] = [];
    w.deps.saveAttachment = (caller, name) => { saved.push(`${caller.id}:${name}`); return `inbox/attachments/${name}`; };
    w.add(tid, {
      role: "user", kind: "text", text: '<attached-image path="/data/attachments/abc-1.png" name="image.png" />',
      attachments: [{ name: "image.png", path: "/data/attachments/abc-1.png", image: true, inline: true }],
    });
    w.add(tid, { role: "user", kind: "text", text: "a report", attachments: [{ name: "report.pdf", path: "/data/attachments/r.pdf" }] });

    const page = await w.api.call(c, "read_latest_page", { agent_id: "bot-a" });
    const entries = page.body.entries as Array<{ text: string; images?: unknown; files?: string[] }>;
    const withImage = entries.find((entry) => entry.images)!;
    expect(withImage.images).toEqual([{ ref: "abc-1.png", name: "image.png" }]);
    expect(withImage.files).toBeUndefined();
    expect(entries.find((entry) => entry.text === "a report")?.files).toEqual(["report.pdf"]);

    for (const attachment of ["abc-1.png", "/data/attachments/abc-1.png", "/api/attachments/abc-1.png"]) {
      const read = await w.api.call(c, "read_transcript_attachment", { agent_id: "bot-a", attachment });
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ agent_id: "bot-a", thread_id: tid, attachment: "abc-1.png", mime: "image/png", bytes: png.length, image_base64: png.toString("base64") });
      expect(read.body.saved_to).toBeUndefined();
    }
    const kept = await w.api.call(c, "read_transcript_attachment", { agent_id: "bot-a", attachment: "abc-1.png", save: true });
    expect(kept.body.saved_to).toBe("inbox/attachments/abc-1.png");
    expect(saved).toEqual(["bot-x:abc-1.png"]);

    // Another caller (another person's bot, or a person) reads none of it,
    // and its bytes are never read for it.
    asked.length = 0;
    for (const other of [bot("bot-y"), person("pr_other")]) {
      const refused = await w.api.call(other, "read_transcript_attachment", { agent_id: "bot-a", attachment: "abc-1.png" });
      expect(refused.status).toBe(404);
      expect(refused.body.code).toBe("not_found");
    }
    expect(asked).toEqual([]);
    // Not in that conversation, not an image of the transcript, not a name.
    expect((await w.api.call(c, "read_transcript_attachment", { agent_id: "bot-a", attachment: "abc-1.png", thread_id: "t-elsewhere" })).status).toBe(404);
    expect((await w.api.call(c, "read_transcript_attachment", { agent_id: "bot-a", attachment: "zzz-9.png" })).status).toBe(404);
    expect((await w.api.call(c, "read_transcript_attachment", { agent_id: "bot-a", attachment: "../../etc/passwd" })).status).toBe(400);
    expect((await w.api.call(c, "read_transcript_attachment", { agent_id: "bot-a" })).status).toBe(400);
    // save copies into a bot's own workspace: a person caller has none.
    const ana = person("pr_ana");
    w.threads.set("t-ana", { agentId: "bot-a", owner: "person:pr_ana", title: "Ana", hidden: false });
    w.add("t-ana", { role: "user", kind: "text", text: "", attachments: [{ path: "/data/attachments/abc-1.png", image: true }] });
    expect((await w.api.call(ana, "read_transcript_attachment", { agent_id: "bot-a", attachment: "abc-1.png" })).status).toBe(200);
    expect((await w.api.call(ana, "read_transcript_attachment", { agent_id: "bot-a", attachment: "abc-1.png", save: true })).status).toBe(400);
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

describe("fleet tools (#1944)", () => {
  it("get_agent and list_agents include the agent's model", async () => {
    const w = world();
    const listed = await w.api.call(person("pr_1"), "list_agents", {});
    expect(listed.status).toBe(200);
    expect((listed.body.agents as AgentSummary[]).find((a) => a.id === "bot-a")?.model).toEqual({
      instance_id: "claude-work", model: "claude-sonnet", effort: "high",
    });
    const got = await w.api.call(person("pr_1"), "get_agent", { agent_id: "bot-a" });
    expect(got.status).toBe(200);
    expect(got.body.model).toEqual({ instance_id: "claude-work", model: "claude-sonnet", effort: "high" });
    expect((got.body.agent as AgentSummary).model).toEqual(got.body.model);
  });

  it("owner changes own bot model; non-owner refused unless admin; invalid model hints choices", async () => {
    const w = world();
    w.owners.set("bot-a", "person:pr_1");
    const owner = person("pr_1");
    const other = person("pr_2");
    const listed = await w.api.call(owner, "list_agent_models", { agent_id: "bot-a" });
    expect(listed.status).toBe(200);
    expect(listed.body.models).toHaveLength(3);
    expect((listed.body.current as AgentModelSummary).instance_id).toBe("claude-work");

    const changed = await w.api.call(owner, "update_agent_model", {
      agent_id: "bot-a", instance_id: "grok", model: "grok-4",
    });
    expect(changed.status).toBe(200);
    expect(changed.body.model).toEqual({ instance_id: "grok", model: "grok-4" });
    expect(((await w.api.call(owner, "get_agent", { agent_id: "bot-a" })).body.model as AgentModelSummary).model).toBe("grok-4");

    const refused = await w.api.call(other, "update_agent_model", {
      agent_id: "bot-a", instance_id: "claude-work", model: "claude-opus",
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("forbidden_owner");

    const admin = person("pr_admin");
    admin.admin = true;
    expect((await w.api.call(admin, "update_agent_model", {
      agent_id: "bot-a", instance_id: "claude-work", model: "claude-opus",
    })).status).toBe(200);

    const bad = await w.api.call(owner, "update_agent_model", {
      agent_id: "bot-a", instance_id: "claude-work", model: "no-such-model",
    });
    expect(bad.status).toBe(400);
    expect(String(bad.body.hint || bad.body.message)).toMatch(/claude-sonnet|Valid choices/i);
  });

  it("update_agent_model refuses an ambiguous engine with the candidate list", async () => {
    const w = world();
    w.owners.set("bot-a", "person:pr_1");
    const ambiguous = await w.api.call(person("pr_1"), "update_agent_model", {
      agent_id: "bot-a", instance_id: "claude", model: "claude-sonnet",
    });
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.code).toBe("ambiguous_engine");
    expect(String(ambiguous.body.message)).toMatch(/claude-work/);
    expect(String(ambiguous.body.message)).toMatch(/claude-home/);
    expect(String(ambiguous.body.message)).not.toMatch(/bots\./);
  });

  it("update_agent_settings patches editable fields; non-owner refused", async () => {
    const w = world();
    w.owners.set("bot-a", "person:pr_1");
    const ok = await w.api.call(person("pr_1"), "update_agent_settings", {
      agent_id: "bot-a", name: "Osprey", description: "Fleet scout",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.changed).toEqual(expect.arrayContaining(["name", "description"]));
    expect(ok.body.refused).toEqual([]);
    expect((ok.body.agent as AgentSummary).name).toBe("Osprey");

    const other = await w.api.call(person("pr_2"), "update_agent_settings", {
      agent_id: "bot-a", name: "Hijack",
    });
    expect(other.status).toBe(403);
  });

  it("member owner changes a held permission-gated field and is refused on one they do not hold (plain reason)", async () => {
    const w = world();
    w.owners.set("bot-a", "person:pr_1");
    w.heldPermissions.set("person:pr_1", new Set(["bots.behaviour"]));
    const owner = person("pr_1");

    const held = await w.api.call(owner, "update_agent_settings", {
      agent_id: "bot-a", voiceNotes: false,
    });
    expect(held.status).toBe(200);
    expect(held.body.changed).toEqual(["voiceNotes"]);
    expect(w.settingsByBot.get("bot-a")?.voiceNotes).toBe(false);

    const denied = await w.api.call(owner, "update_agent_settings", {
      agent_id: "bot-a", cwd: "/tmp/osprey",
    });
    expect(denied.status).toBe(403);
    const refused = (denied.body.refused as Array<{ field: string; reason: string }>)
      ?? (denied.body.extra as { refused?: Array<{ field: string; reason: string }> })?.refused;
    expect(refused?.[0]?.field).toBe("cwd");
    expect(refused?.[0]?.reason).toMatch(/does not allow changing where this bot's files live/i);
    expect(refused?.[0]?.reason).not.toMatch(/folders\.botWorkingFolder|Perspicax|console\//);
  });

  it("admin changes an admin-only field on another person's bot", async () => {
    const w = world();
    w.owners.set("bot-a", "person:pr_1");
    const owner = person("pr_1");
    const denied = await w.api.call(owner, "update_agent_settings", {
      agent_id: "bot-a", cacheKeepWarm: true,
    });
    expect(denied.status).toBe(403);
    const refused = (denied.body.refused as Array<{ field: string; reason: string }>)
      ?? (denied.body.extra as { refused?: Array<{ field: string; reason: string }> })?.refused;
    expect(refused?.[0]?.field).toBe("cacheKeepWarm");
    expect(refused?.[0]?.reason).toMatch(/cacheKeepWarm/i);
    expect(refused?.[0]?.reason).not.toMatch(/\b[a-z]+\.[a-z]+\b|Perspicax|console\//);

    const admin = person("pr_admin");
    admin.admin = true;
    const ok = await w.api.call(admin, "update_agent_settings", {
      agent_id: "bot-a", cacheKeepWarm: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.changed).toEqual(["cacheKeepWarm"]);
    expect(w.settingsByBot.get("bot-a")?.cacheKeepWarm).toBe(true);
  });

  it("runtime setting round trip and Primary Bot switch", async () => {
    const w = world();
    w.owners.set("bot-a", "person:pr_1");
    w.heldPermissions.set("person:pr_1", new Set(["bots.behaviour"]));
    const owner = person("pr_1");

    const runtime = await w.api.call(owner, "update_agent_settings", {
      agent_id: "bot-a", maxConcurrentThreads: 3, primary: true,
    });
    expect(runtime.status).toBe(200);
    expect(runtime.body.changed).toEqual(expect.arrayContaining(["maxConcurrentThreads", "primary"]));
    expect(w.runtimeByBot.get("bot-a")?.maxConcurrentThreads).toBe(3);
    expect(w.primaryByOwner.get("person:pr_1")).toBe("bot-a");

    const cleared = await w.api.call(owner, "update_agent_settings", {
      agent_id: "bot-a", primary: false,
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.changed).toEqual(["primary"]);
    expect(w.primaryByOwner.has("person:pr_1")).toBe(false);
  });

  it("update_routine accepts and clears routine model and effort", async () => {
    const w = world();
    const answer = await w.api.call(person("pr_1"), "update_routine", { routine_id: "r-own", model: "fast", effort: "low" });
    expect(answer.status).toBe(200);
    expect(w.routinePatches.at(-1)).toEqual({ model: "fast", effort: "low" });
    expect((await w.api.call(person("pr_1"), "update_routine", { routine_id: "r-own", model: null, effort: null })).status).toBe(200);
    expect(w.routinePatches.at(-1)).toEqual({ model: null, effort: null });
    expect((await w.api.call(person("pr_1"), "update_routine", { routine_id: "r-own", effort: "invalid" })).status).toBe(400);
  });

  it("update_routine sets and clears the sub-agent model (#2049)", async () => {
    const w = world();
    expect((await w.api.call(person("pr_1"), "update_routine", { routine_id: "r-own", subagent_model: "sonnet" })).status).toBe(200);
    expect(w.routinePatches.at(-1)).toEqual({ subagentModel: "sonnet" });
    expect((await w.api.call(person("pr_1"), "update_routine", { routine_id: "r-own", subagent_model: null })).status).toBe(200);
    expect(w.routinePatches.at(-1)).toEqual({ subagentModel: null });
    expect((await w.api.call(person("pr_1"), "update_routine", { routine_id: "r-own", subagent_model: 7 })).status).toBe(400);
  });

  it("update_routine enables and disables a routine the caller owns", async () => {
    const w = world();
    const paused = await w.api.call(person("pr_1"), "update_routine", {
      routine_id: "r-own", enabled: false,
    });
    expect(paused.status).toBe(200);
    expect((paused.body.routine as { enabled: boolean }).enabled).toBe(false);
    const resumed = await w.api.call(person("pr_1"), "update_routine", {
      routine_id: "r-own", enabled: true, name: "Morning brief (on)",
    });
    expect(resumed.status).toBe(200);
    expect(resumed.body.routine).toMatchObject({ enabled: true, name: "Morning brief (on)" });
    expect((await w.api.call(person("pr_1"), "update_routine", {
      routine_id: "r-other", enabled: false,
    })).status).toBe(404);
  });

  it("update_routine sets and clears \"Needs its computer\" (#1996)", async () => {
    const w = world();
    const on = await w.api.call(person("pr_1"), "update_routine", { routine_id: "r-own", requires_computer: true });
    expect(on.status).toBe(200);
    expect(on.body.routine).toMatchObject({ requiresComputer: true });
    const off = await w.api.call(person("pr_1"), "update_routine", { routine_id: "r-own", requires_computer: false });
    expect(off.body.routine).toMatchObject({ requiresComputer: false });
    expect((await w.api.call(person("pr_1"), "update_routine", { routine_id: "r-own", requires_computer: "yes" })).status).toBe(400);
  });

  it("fleet writes need agents.send; list_agent_models needs agents.read", async () => {
    const w = world();
    expect((await w.api.call(person("pr_1", ["agents.read"]), "update_agent_model", {
      agent_id: "bot-a", auto: true,
    })).status).toBe(403);
    expect((await w.api.call(person("pr_1", ["agents.read"]), "list_agent_models", {
      agent_id: "bot-a",
    })).status).toBe(200);
  });
});

describe("await_turn and a turn that failed (#3008)", () => {
  const exited = "pi process exited before replying: Error: spawn npm ENOENT (npm install pi-subagents --prefix /data/principals/p/piAgent-key/npm)";

  it("an engine that died before replying answers status failed with plain words, never finished with an empty reply", async () => {
    const w = world({ replyAfterPolls: 1, replyRows: () => [{ role: "bot", kind: "activity", text: "", tool: { ...failedTurnTool(exited), ok: false } }] });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "hi", mode: "async" });
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 5_000 });
    expect(r.body).toMatchObject({ finished: true, status: "failed", reply: "", error: ENGINE_EXITED_SENTENCE });
    expect(String(r.body.error)).not.toContain("ENOENT");
  });

  it("words after the failed row win: the turn finished", async () => {
    const w = world({
      replyAfterPolls: 1,
      replyRows: () => [
        { role: "bot", kind: "activity", text: "", tool: { ...failedTurnTool("provider refused"), ok: false } },
        { role: "bot", kind: "text", text: "Recovered answer." },
      ],
    });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "hi", mode: "async" });
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 5_000 });
    expect(r.body).toMatchObject({ finished: true, status: "finished", reply: "Recovered answer." });
  });
});

describe("await_turn and a pending card (#2922)", () => {
  const card = (threadId: string, id = "perm-1", answerWith: "decision" | "option" = "decision") =>
    ({ id, threadId, kind: answerWith === "option" ? "question" : "permission", answerWith, choices: [{ id: "1", label: "allow" }, { id: "2", label: "deny" }] });

  it("a permission card two levels down while the root still runs: waiting_for_approval with that card and its threadId", async () => {
    const w = world({ replyAfterPolls: 50 });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "do it", mode: "async" });
    w.deps.pendingApproval = () => ({ approvals: [card("child-2")], reviewing: false });
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 2_000 });
    expect(r.body).toMatchObject({ finished: false, status: "waiting_for_approval", thread_id: sent.body.thread_id, approval: { id: "perm-1", threadId: "child-2" } });
    expect(r.body.approvals).toHaveLength(1);
    expect(String(r.body.next)).toContain("thread_id child-2");
    expect(String(r.body.next)).toContain("approval_id perm-1");
  });

  it("the card wins over a turn that looks finished", async () => {
    const w = world({ replyAfterPolls: 1 });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "hi", mode: "async" });
    await w.settle();
    w.deps.pendingApproval = () => ({ approvals: [card(String(sent.body.thread_id), "q-1", "option")], reviewing: false });
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 2_000 });
    expect(r.body).toMatchObject({ status: "waiting_for_approval", approval: { id: "q-1" } });
    expect(String(r.body.next)).toContain("option");
  });

  it("a card under model review keeps the turn going: still_working, phase approval_under_review, short wait", async () => {
    const w = world({ replyAfterPolls: 1 });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "hi", mode: "async" });
    w.deps.pendingApproval = () => ({ approvals: [], reviewing: true });
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 2_000 });
    expect(r.body).toMatchObject({ finished: false, status: "still_working", recommended_wait_ms: AWAIT_REVIEW_WAIT_MS, progress: { phase: "approval_under_review" } });
  });

  it("a question raised right after the words is not read as finished (confirmation look)", async () => {
    const w = world({ replyAfterPolls: 1 });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "hi", mode: "async" });
    let looks = 0;
    w.deps.pendingApproval = () => {
      looks += 1;
      // the reply is there at the first look; the card lands on the next poll
      return { approvals: looks >= 2 ? [card(String(sent.body.thread_id), "q-2", "option")] : [], reviewing: false };
    };
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 5_000 });
    expect(r.body).toMatchObject({ status: "waiting_for_approval", approval: { id: "q-2" } });
  });

  it("a card this caller does not answer keeps the turn running, never waiting with no card (#2922)", async () => {
    const w = world({ replyAfterPolls: 50 });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "do it", mode: "async" });
    w.deps.turnState = () => "waiting";
    w.deps.pendingApproval = () => ({ approvals: [], reviewing: false, blockedElsewhere: true, engineBusy: false });
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 300 });
    expect(r.body.status).not.toBe("waiting_for_approval");
    expect(r.body.finished).toBe(false);
  });

  it("the cards are asked from the handle time minus a small slack (turn scope, #2922)", async () => {
    const w = world({ replyAfterPolls: 50 });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "do it", mode: "async" });
    const seen: unknown[] = [];
    w.deps.pendingApproval = (...args: unknown[]) => { seen.push(args[3]); return { approvals: [], reviewing: false }; };
    await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 300 });
    expect(seen.length).toBeGreaterThan(0);
    expect(typeof seen[0]).toBe("number");
    expect(seen[0] as number).toBeLessThanOrEqual(Date.now());
  });

  it("without a card, a finished turn still answers finished", async () => {
    const w = world({ replyAfterPolls: 1 });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "hi", mode: "async" });
    w.deps.pendingApproval = () => ({ approvals: [], reviewing: false });
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 5_000 });
    expect(r.body).toMatchObject({ finished: true, status: "finished", reply: "echo: hi" });
  });

  it("the person's answer to a card (replyToId) is part of the turn: the reply is the words after it; a plain line still cuts", async () => {
    const w = world({ replyAfterPolls: 1, replyRows: () => [] });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "pick", mode: "async" });
    const threadId = String(sent.body.thread_id);
    w.add(threadId, { role: "bot", kind: "text", text: "Which one?" });
    const cardRow = w.add(threadId, { role: "bot", kind: "options", text: "" });
    w.add(threadId, { role: "user", kind: "text", text: "B", replyToId: cardRow.id });
    w.add(threadId, { role: "bot", kind: "text", text: "Done with B." });
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 5_000 });
    expect(r.body).toMatchObject({ finished: true, reply: "Done with B." });
    w.add(threadId, { role: "user", kind: "text", text: "another prompt" });
    w.add(threadId, { role: "bot", kind: "text", text: "Not this turn." });
    const again = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 5_000 });
    expect(again.body).toMatchObject({ finished: true, reply: "Done with B." });
  });

  it("an answered ask_choice waits for the answer's own turn: never the words before it as the reply (#3007)", async () => {
    const w = world({ replyAfterPolls: 1, replyRows: () => [] });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "ask me", mode: "async" });
    const threadId = String(sent.body.thread_id);
    w.add(threadId, { role: "bot", kind: "text", text: "Je pose la question." });
    const cardRow = w.add(threadId, { role: "bot", kind: "options", text: "", question: { answered: true, late: true } });
    w.add(threadId, { role: "bot", kind: "text", text: "NEEDS INPUT" });
    // answered, but the answer line still waits for the turn before it to end
    const early = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 1_500 });
    expect(early.body.finished).toBe(false);
    expect(early.body.reply ?? "").not.toContain("NEEDS INPUT");
    w.add(threadId, { role: "user", kind: "text", text: "299783", replyToId: cardRow.id });
    w.add(threadId, { role: "bot", kind: "text", text: "Noté : 299783." });
    const done = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 5_000 });
    expect(done.body).toMatchObject({ finished: true, reply: "Noté : 299783." });
  });

  it("an answered question whose turn ended with no words after it returns at once, not after the follow-up wait", async () => {
    const w = world({ replyAfterPolls: 1, replyRows: () => [] });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "ask me", mode: "async" });
    const threadId = String(sent.body.thread_id);
    w.add(threadId, { role: "bot", kind: "text", text: "Une question d'abord." });
    w.add(threadId, { role: "bot", kind: "options", text: "", question: { answered: true, late: false } });
    const startedAt = w.deps.now!();
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 30_000 });
    expect(r.body).toMatchObject({ finished: true, status: "finished" });
    expect(r.body.reply ?? "").not.toContain("Une question d'abord.");
    expect(w.deps.now!() - startedAt).toBeLessThan(3_000);
  });

  it("an ask_choice answered with the person's line and a silent answer turn returns at once", async () => {
    const w = world({ replyAfterPolls: 1, replyRows: () => [] });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "ask me", mode: "async" });
    const threadId = String(sent.body.thread_id);
    const cardRow = w.add(threadId, { role: "bot", kind: "options", text: "", question: { answered: true, late: true } });
    await w.settle();
    w.add(threadId, { role: "user", kind: "text", text: "B", replyToId: cardRow.id });
    // the answer's own turn runs (one poll) and ends with no words
    w.state.set(threadId, "running");
    // waited time counts this call's own polls only (the async send's
    // notification waiter shares the clock)
    let waited = 0;
    const api = createAgentApi({ ...w.deps, sleep: async (ms) => { waited += ms; await w.deps.sleep!(ms); w.state.set(threadId, "idle"); } });
    const r = await api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 30_000 });
    expect(r.body).toMatchObject({ finished: true, status: "finished" });
    expect(waited).toBeLessThan(3_000);
  });

  it("an ask_choice answer recorded a while ago with a silent answer turn already over returns at once (#3056)", async () => {
    const w = world({ replyAfterPolls: 1, replyRows: () => [] });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "ask me", mode: "async" });
    const threadId = String(sent.body.thread_id);
    const cardRow = w.add(threadId, { role: "bot", kind: "options", text: "", question: { answered: true, late: true } });
    w.add(threadId, { role: "user", kind: "text", text: "B", replyToId: cardRow.id });
    w.advance(10_000);
    const startedAt = w.deps.now!();
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 30_000 });
    expect(r.body).toMatchObject({ finished: true, status: "finished" });
    expect(w.deps.now!() - startedAt).toBeLessThan(3_000);
  });

  /** A world whose ask_choice answer line is recorded while the answer's own
   * turn has not started yet: it starts after `startAfterMs` (never when
   * null) and says `words` one poll later. */
  const answeredNotStarted = async (startAfterMs: number | null, words: string) => {
    const w = world({ replyAfterPolls: 1, replyRows: () => [] });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "ask me", mode: "async" });
    const threadId = String(sent.body.thread_id);
    const cardRow = w.add(threadId, { role: "bot", kind: "options", text: "", question: { answered: true, late: true } });
    await w.settle();
    expect(w.state.get(threadId)).toBe("idle");
    const answerAt = w.deps.now!();
    w.add(threadId, { role: "user", kind: "text", text: "B", replyToId: cardRow.id });
    let phase: "before" | "running" | "done" = "before";
    const api = createAgentApi({
      ...w.deps,
      sleep: async (ms) => {
        await w.deps.sleep!(ms);
        if (phase === "before" && startAfterMs !== null && w.deps.now!() - answerAt >= startAfterMs) {
          phase = "running";
          w.state.set(threadId, "running");
        } else if (phase === "running") {
          phase = "done";
          w.add(threadId, { role: "bot", kind: "text", text: words });
          w.state.set(threadId, "idle");
        }
      },
    });
    return { w, c, api, sent, answerAt };
  };

  it("an ask_choice answer recorded before its turn starts: never finished empty before that turn runs and ends", async () => {
    const { c, api, sent } = await answeredNotStarted(2_000, "Option B retenue.");
    const r = await api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 30_000 });
    expect(r.body).toMatchObject({ finished: true, status: "finished", reply: "Option B retenue." });
  });

  it("an ask_choice answer whose turn never starts: the wait is bounded, finished without text", async () => {
    const { w, c, api, sent, answerAt } = await answeredNotStarted(null, "");
    const r = await api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 55_000 });
    expect(r.body).toMatchObject({ finished: true, status: "finished" });
    expect(w.deps.now!() - answerAt).toBeLessThan(7_000);
  });

  it("an engine-held question answered mid-turn: the reply is the words after the card (#3007)", async () => {
    const w = world({ replyAfterPolls: 1, replyRows: () => [] });
    const c = person("p1");
    const sent = await w.api.call(c, "send_prompt", { agent_id: "bot-a", prompt: "ask me", mode: "async" });
    const threadId = String(sent.body.thread_id);
    w.add(threadId, { role: "bot", kind: "text", text: "Une question d'abord." });
    w.add(threadId, { role: "bot", kind: "options", text: "", question: { answered: true, late: false } });
    w.add(threadId, { role: "bot", kind: "text", text: "Merci, c'est fait." });
    const r = await w.api.call(c, "await_turn", { agent_id: "bot-a", handle: sent.body.handle, timeout_ms: 5_000 });
    expect(r.body).toMatchObject({ finished: true, reply: "Merci, c'est fait." });
  });
});
