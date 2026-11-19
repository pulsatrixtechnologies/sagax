// #4939: two AI-client sessions can no longer overwrite each other's change
// to a bot's profile or a routine (the 2026-11-18 case of bot Marc).
import { describe, expect, it } from "vitest";

import { createAgentApi, type AgentApiDeps, type AgentCaller, type AgentScope, type AgentSummary } from "./agent-api.ts";
import { agentSettingsVersion, routineVersion, VersionReads } from "./write-versions.ts";

const ALL: AgentScope[] = ["agents.read", "agents.send", "agents.create"];

function caller(client: string, via = "perspicax-mcp"): AgentCaller {
  return { kind: "person", id: "pr_ada", name: "Ada", scopes: new Set(ALL), via, client };
}

function world() {
  const bot: Record<string, unknown> = { id: "bot-marc", name: "Marc", title: "", description: "Dispatch", soul: "v1" };
  const routine = { id: "r-1", name: "Morning", prompt: "a", updatedAt: 1_000 };
  let clock = 1_000;
  const summary = (): AgentSummary => ({ id: "bot-marc", name: String(bot.name), description: String(bot.description), status: "idle", owner: { principal_id: "pr_ada", name: "Ada" } });
  const writes: string[] = [];
  const deps = {
    secret: "x".repeat(40),
    audit: () => undefined,
    agents: () => [summary()],
    profile: () => ({ title: "", owner: null, profile: { instructions: String(bot.soul), instructions_truncated: false }, temporary: null, profile_url: null }),
    async updateSettings(_caller: AgentCaller, _agentId: string, fields: Record<string, unknown>) {
      Object.assign(bot, fields);
      writes.push(String(fields.soul ?? ""));
      return { changed: Object.keys(fields), refused: [], agent: summary() };
    },
    async updateRoutine(_caller: AgentCaller, _id: string, patch: { instructions?: string }) {
      if (patch.instructions) routine.prompt = patch.instructions;
      routine.updatedAt = ++clock;
      return { routine: { ...routine } };
    },
    async deleteRoutine() {
      return { deleted: true as const };
    },
    threads: () => [],
    messages: () => [],
    turnState: () => "idle",
    writeVersions: {
      agent: () => agentSettingsVersion(bot),
      routine: () => routineVersion(routine),
      reads: new VersionReads(),
    },
  } as unknown as AgentApiDeps;
  return { api: createAgentApi(deps), bot, routine, writes };
}

describe("conditional writes (#4939)", () => {
  it("replays Marc: the second session writing from its older copy is refused with the current version", async () => {
    const w = world();
    const a = caller("session-a");
    const b = caller("session-b");
    // Both sessions read Marc's profile.
    const readA = await w.api.call(a, "get_agent", { agent_id: "bot-marc" });
    const readB = await w.api.call(b, "get_agent", { agent_id: "bot-marc" });
    expect(readA.status).toBe(200);
    expect(typeof readA.body.version).toBe("string");
    expect(readB.body.version).toBe(readA.body.version);
    // A adds the owner's decisions.
    const wroteA = await w.api.call(a, "update_agent_settings", { agent_id: "bot-marc", soul: "v1 + decisions", expected_version: readA.body.version });
    expect(wroteA.status).toBe(200);
    expect(wroteA.body.version).not.toBe(readA.body.version);
    // Seven minutes later B rewrites from its own, older copy: refused.
    const wroteB = await w.api.call(b, "update_agent_settings", { agent_id: "bot-marc", soul: "v1 + plugin refs", expected_version: readB.body.version });
    expect(wroteB.status).toBe(409);
    expect(wroteB.body.code).toBe("version_conflict");
    expect(wroteB.body.current_version).toBe(wroteA.body.version);
    expect(wroteB.body.conflict).toBe("stale");
    expect(w.bot.soul).toBe("v1 + decisions");
    // B reads again and writes on that base.
    const reread = await w.api.call(b, "get_agent", { agent_id: "bot-marc" });
    const merged = await w.api.call(b, "update_agent_settings", { agent_id: "bot-marc", soul: "v1 + decisions + plugin refs", expectedVersion: reread.body.version });
    expect(merged.status).toBe(200);
    expect(w.bot.soul).toBe("v1 + decisions + plugin refs");
  });

  it("without expected_version an AI client's copy must be the current version", async () => {
    const w = world();
    const a = caller("session-a");
    const b = caller("session-b");
    const blind = await w.api.call(a, "update_agent_settings", { agent_id: "bot-marc", soul: "blind" });
    expect(blind.status).toBe(409);
    expect(blind.body.conflict).toBe("not_read");
    expect(typeof blind.body.current_version).toBe("string");
    expect(w.bot.soul).toBe("v1");

    await w.api.call(a, "get_agent", { agent_id: "bot-marc" });
    await w.api.call(b, "get_agent", { agent_id: "bot-marc" });
    expect((await w.api.call(a, "update_agent_settings", { agent_id: "bot-marc", soul: "a1" })).status).toBe(200);
    // B read before A's write: stale.
    const stale = await w.api.call(b, "update_agent_settings", { agent_id: "bot-marc", soul: "b1" });
    expect(stale.status).toBe(409);
    expect(stale.body.conflict).toBe("stale");
    // A's own write answered the current version: its copy is current.
    const again = await w.api.call(a, "update_agent_settings", { agent_id: "bot-marc", soul: "a2" });
    expect(again.status).toBe(200);
    expect(w.bot.soul).toBe("a2");
  });

  it("a bot writes as before without a version, but never from a stale one", async () => {
    const w = world();
    const bot: AgentCaller = { kind: "bot", id: "bot-chief", name: "Chief", scopes: new Set(ALL), via: "agents-mcp" };
    expect((await w.api.call(bot, "update_agent_settings", { agent_id: "bot-marc", soul: "from bot" })).status).toBe(200);
    const stale = await w.api.call(bot, "update_agent_settings", { agent_id: "bot-marc", soul: "old", expected_version: "0".repeat(32) });
    expect(stale.status).toBe(409);
    expect(w.bot.soul).toBe("from bot");
  });

  it("the person in their console writes as before, with no version", async () => {
    const w = world();
    const ok = await w.api.call(caller("console", "console"), "update_agent_settings", { agent_id: "bot-marc", description: "Répartiteur" });
    expect(ok.status).toBe(200);
    expect(w.bot.description).toBe("Répartiteur");
  });

  it("two concurrent writes on the same read: one lands, the other is refused", async () => {
    const w = world();
    const a = caller("session-a");
    const read = await w.api.call(a, "get_agent", { agent_id: "bot-marc" });
    const [one, two] = await Promise.all([
      w.api.call(a, "update_agent_settings", { agent_id: "bot-marc", soul: "one", expected_version: read.body.version }),
      w.api.call(caller("session-b"), "update_agent_settings", { agent_id: "bot-marc", soul: "two", expected_version: read.body.version }),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect(w.writes).toHaveLength(1);
  });

  it("update_routine and delete_routine check the routine's version", async () => {
    const w = world();
    const a = caller("session-a");
    const stale = await w.api.call(a, "update_routine", { routine_id: "r-1", instructions: "b", expected_version: "999" });
    expect(stale.status).toBe(409);
    expect(stale.body.current_version).toBe("1000");
    const ok = await w.api.call(a, "update_routine", { routine_id: "r-1", instructions: "b", expected_version: "1000" });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe("1001");
    expect(w.routine.prompt).toBe("b");
    const gone = await w.api.call(a, "delete_routine", { routine_id: "r-1", expected_version: "1000" });
    expect(gone.status).toBe(409);
    expect((await w.api.call(a, "delete_routine", { routine_id: "r-1", expected_version: "1001" })).status).toBe(200);
  });

  it("a malformed expected_version is a bad request", async () => {
    const w = world();
    const bad = await w.api.call(caller("a"), "update_routine", { routine_id: "r-1", enabled: false, expected_version: 7 });
    expect(bad.status).toBe(400);
  });
});
