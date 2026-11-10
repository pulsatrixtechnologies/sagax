// Reachability guard: a tool the bot is told about is a tool it is given.
//
// A person asked their bot for a public page. The bot knew propose_page
// existed (its self-knowledge and save_artifact's description said so) but
// the tool was not in its list: a person's ordinary direct chat coordinates
// (server/index.ts boundedCoordination sets SAGAX_ROOM_TURN), and the catalog
// dropped propose_page from every coordinating turn as if it were a room.
//
// This file pins the real turns server/index.ts agentsIntegration() builds
// and fails when:
// 1. a tool description or schema names another catalog tool the same turn
//    is not shown (steering to a tool the bot cannot call);
// 2. the self-knowledge base (sagax_help) says a tool is available in a turn
//    where it is not;
// 3. a prompt paragraph a person's direct chat is sent names a tool that chat
//    is not shown.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv, PERSPICAX_TOOLS } from "./agents-catalog.ts";
import { GUEST_CONFINED_CODEX_ARGS } from "./codex.ts";
import { engineHasNativeWebSearch } from "../web-search/native.ts";
import { chiefOfStaffSystemPrompt } from "../chief-of-staff.ts";
import { connectorListPrompt } from "../connectors/list-prompt.ts";
import type { ConnectorAccount } from "../connectors/types.ts";
import { incidentText } from "../peers/incidents.ts";
import { peerRosterSystemPrompt } from "../peers/peer-roster.ts";
import {
  CREDENTIAL_PROMPT, LEARN_PROMPT, PROFILE_CREATOR_PROMPT, PROFILE_PROMPT, REACTION_PROMPT, richOutputPrompt,
  ROUTINE_PROMPT, TEAM_MEMORY_PROMPT, WIDGET_APPROVAL_PROMPT, WIDGET_PROMPT,
} from "../system-prompt.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
type Tool = { name: string; description: string; inputSchema?: unknown };
type Env = Record<string, string>;

/** The turns agentsIntegration() builds, by the switches that change the list. */
const TURNS: Record<string, Env> = {
  // a person's own message in a 1:1 chat: bounded coordination, may open its own jobs
  "direct": { SAGAX_ROOM_TURN: "1", SAGAX_OWN_THREAD_CREATION: "1", SAGAX_AGENT_API: "1" },
  // the same chat resumed by a card: no own jobs
  "direct-card": { SAGAX_ROOM_TURN: "1", SAGAX_AGENT_API: "1" },
  // a room (group conversation): no agent-to-agent API there
  "room": { SAGAX_ROOM_TURN: "1", SAGAX_GROUP_TURN: "1" },
  // a routine run, or a delegated turn: no bounded coordination
  "routine": { SAGAX_ROOM_TURN: "0", SAGAX_AGENT_API: "1" },
  // 2026-10-28: a teammate asked through ask_bot, delegate_bot or the agent
  // API, one hop away: its tools without the peer ones
  "teammate": { SAGAX_ROOM_TURN: "0", SAGAX_AGENT_API: "1", SAGAX_PEER_HOP: "1" },
};
const ROLES: Record<string, Env> = { chief: { SAGAX_CHIEF_OF_STAFF: "1" }, member: { SAGAX_CHIEF_OF_STAFF: "0" } };

const tools = (env: Env): Tool[] => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1", ...env })) as Tool[];
const names = (env: Env) => new Set(tools(env).map((tool) => tool.name));

/** Every switch on: the widest catalog, to know what is a catalog tool name. */
const EVERY_SWITCH: Env = {
  SAGAX_SKILL_AUTHORING_ENABLED: "1", SAGAX_SHARED_COMPUTERS_ENABLED: "1", SAGAX_VOICE_NOTES: "1", SAGAX_MEETINGS: "1",
  SAGAX_SINGLE_STREAM: "1", SAGAX_ROUTE_MESSAGES: "1", SAGAX_VOICE_CALL: "1", SAGAX_GITHUB_CONNECT: "1", SAGAX_GROUP_MEMORY: "1",
  SAGAX_CREATE_BOTS: "1", SAGAX_PERSPICAX_TOOLS: "1", SAGAX_CLAIMS: "1", SAGAX_WEB_SEARCH: "1", SAGAX_VAULT_HTTP: "1",
  SAGAX_PHONE_TOOLS: "location",
};
const CATALOG_NAMES = new Set<string>(PERSPICAX_TOOLS.map((tool) => tool.name));
for (const turn of Object.values(TURNS)) for (const role of Object.values(ROLES)) {
  for (const name of names({ ...turn, ...role, ...EVERY_SWITCH })) CATALOG_NAMES.add(name);
  for (const name of names({ ...turn, ...role })) CATALOG_NAMES.add(name);
}

/** Names mentioned only as a fact, never as "use it": reviewed one by one. */
const INFORMATIONAL: ReadonlyArray<[tool: string, mentions: string]> = [
  // "A temporary agent (create_agent) archived is gone for good."
  ["archive_bot", "create_agent"],
];

function mentionedTools(text: string): string[] {
  return [...new Set([...text.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)].map((match) => match[0]).filter((name) => CATALOG_NAMES.has(name)))];
}

describe("reachability guard: an engine's own web search (2026-10-28)", () => {
  // native.ts says Codex searches by itself, so a turn never gets
  // sagax_web_search on Codex: its guest turn must then keep its own search.
  it("never turns off the search of an engine native.ts counts on, in a guest's turn", () => {
    expect(engineHasNativeWebSearch("codex", true)).toBe(true);
    expect(GUEST_CONFINED_CODEX_ARGS).not.toContain('web_search="disabled"');
    expect(GUEST_CONFINED_CODEX_ARGS).toContain('web_search="cached"');
  });
});

describe("reachability guard: the turns a person really has", () => {
  it("offers propose_page in a person's direct chat and routines, for every role, never in a room", () => {
    for (const role of Object.values(ROLES)) {
      expect(names({ ...TURNS.direct, ...role })).toContain("propose_page");
      expect(names({ ...TURNS["direct-card"], ...role })).toContain("propose_page");
      expect(names({ ...TURNS.routine, ...role })).toContain("propose_page");
      expect(names({ ...TURNS.room, ...role })).not.toContain("propose_page");
    }
  });

  it("names, in each tool's description and schema, only tools the same turn is shown", () => {
    const problems: string[] = [];
    for (const [turnName, turn] of Object.entries(TURNS)) for (const [roleName, role] of Object.entries(ROLES)) {
      for (const extra of [{}, EVERY_SWITCH]) {
        const list = tools({ ...turn, ...role, ...extra });
        const shown = new Set(list.map((tool) => tool.name));
        for (const tool of list) {
          for (const name of mentionedTools(`${tool.description} ${JSON.stringify(tool.inputSchema ?? {})}`)) {
            if (shown.has(name) || INFORMATIONAL.some(([from, to]) => from === tool.name && to === name)) continue;
            problems.push(`${turnName}/${roleName}${extra === EVERY_SWITCH ? "/all-switches" : ""}: ${tool.name} names ${name}, not shown`);
          }
        }
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });
});

/** What a self-knowledge `where` label promises: the turns that must show the tool. */
const ALL_TURNS = Object.keys(TURNS);
function promisedTurns(where: string): { turns: string[]; env: Env; roles: string[] } | null {
  const label = where.replace(/^bot tool, /, "");
  const flag = (env: Env, roles = Object.keys(ROLES)) => ({ turns: ["direct"], env, roles });
  if (label === "every conversation") return { turns: ALL_TURNS, env: {}, roles: Object.keys(ROLES) };
  if (label === "not in rooms") return { turns: ["direct", "direct-card", "routine"], env: {}, roles: Object.keys(ROLES) };
  if (label.startsWith("in routines and delegated turns only")) return { turns: ["routine"], env: {}, roles: Object.keys(ROLES) };
  if (label.startsWith("in routines and delegated turns; in a person's chat when they ask for separate jobs")) return { turns: ["routine", "direct"], env: {}, roles: Object.keys(ROLES) };
  if (label.startsWith("in a person's chat or a room")) return { turns: ["direct", "direct-card", "room"], env: {}, roles: Object.keys(ROLES) };
  if (label.startsWith("in a room whose shared memory is on")) return { turns: ["room"], env: { SAGAX_GROUP_MEMORY: "1" }, roles: Object.keys(ROLES) };
  if (label.startsWith("for a Primary Bot with the agent-to-agent API")) return flag({}, ["chief"]);
  if (label.startsWith("for a Primary Bot only")) return { turns: ALL_TURNS, env: {}, roles: ["chief"] };
  if (label.startsWith("with the agent-to-agent API (direct turns)")) return flag({});
  if (label.startsWith("on an organization server linked to Perspicax")) return flag({ SAGAX_PERSPICAX_TOOLS: "1" });
  if (label.startsWith("when a Perspicax profile is mounted for the person speaking")) return flag({ SAGAX_CLAIMS: "1" });
  if (label.startsWith("when the bot has a voice configured")) return flag({ SAGAX_VOICE_NOTES: "1" });
  if (label.startsWith("during a live phone call")) return flag({ SAGAX_VOICE_CALL: "1" });
  if (label.startsWith("when Settings > Developer > Experimental > Meeting notetaker is on")) return flag({ SAGAX_MEETINGS: "1" });
  if (label.startsWith("when computer sharing is on")) return flag({ SAGAX_SHARED_COMPUTERS_ENABLED: "1" });
  if (label.startsWith("when skill authoring is on")) return flag({ SAGAX_SKILL_AUTHORING_ENABLED: "1" });
  if (label.startsWith("in a single-stream conversation")) return flag({ SAGAX_SINGLE_STREAM: "1" });
  if (label.startsWith("when the bot routes messages sent while it is busy")) return flag({ SAGAX_ROUTE_MESSAGES: "1" });
  if (label.startsWith("in a person's 1:1 chat on a server with a GitHub app")) return flag({ SAGAX_GITHUB_CONNECT: "1" });
  if (label.startsWith("when the engine has no web search of its own")) return flag({ SAGAX_WEB_SEARCH: "1" });
  if (label.startsWith("when the bot may send an API key of the person")) return flag({ SAGAX_VAULT_HTTP: "1" });
  if (label.startsWith("when the person's phone offers tools now")) return flag({ SAGAX_PHONE_TOOLS: "location" });
  return null;
}

describe("reachability guard: a teammate one hop away (ask_bot, delegate_bot, agent API)", () => {
  // 2026-10-28: MAX_COMMS_DEPTH used to drop the whole agents server from a
  // teammate's turn. It keeps its tools; only the ones that start another
  // hop are gone, the one stop against chains and loops.
  const PEER_TOOLS = ["ask_bot", "delegate_bot", "check_delegation", "wait_delegation", "coordinate_bots", "send_to_bot",
    "list_room_targets", "start_thread", "route_message", "send_prompt", "await_turn", "create_agent", "delete_agent"];
  const KEPT = ["memory_update", "memory_log", "attach_file", "propose_page", "show_widget", "make_video", "session_search",
    "save_artifact", "request_credential", "list_bots"];

  it("keeps the teammate's own tools for every role", () => {
    for (const role of Object.values(ROLES)) {
      const shown = names({ ...TURNS.teammate, ...role, ...EVERY_SWITCH });
      for (const name of KEPT) expect(shown, name).toContain(name);
    }
  });

  it("shows no tool that starts another hop", () => {
    for (const role of Object.values(ROLES)) for (const extra of [{}, EVERY_SWITCH, { SAGAX_ROOM_TURN: "1" }]) {
      const shown = names({ ...TURNS.teammate, ...role, ...extra });
      for (const name of PEER_TOOLS) expect(shown.has(name), name).toBe(false);
    }
  });

  it("is off unless the harness says so", () => {
    expect(names({ ...TURNS.routine, ...ROLES.member })).toContain("ask_bot");
    expect(names({ ...TURNS.routine, ...ROLES.member, SAGAX_PEER_HOP: "0" })).toContain("ask_bot");
  });
});

describe("reachability guard: the self-knowledge base (sagax_help)", () => {
  const knowledge = JSON.parse(readFileSync(join(HERE, "..", "self-knowledge", "knowledge.generated.json"), "utf8")) as {
    sections: Array<{ id: string; kind: string; where?: string; text: string }>;
  };
  const toolSections = knowledge.sections.filter((section) => section.kind === "tool");

  it("shows every tool in each turn its entry says it is available in", () => {
    const problems: string[] = [];
    for (const section of toolSections) {
      const name = section.id.replace(/^tool:/, "");
      const promise = promisedTurns(section.where ?? "");
      if (!promise) {
        problems.push(`${section.id}: unknown availability "${section.where}" (classify it in promisedTurns)`);
        continue;
      }
      for (const turn of promise.turns) for (const role of promise.roles) {
        if (!names({ ...TURNS[turn], ...ROLES[role], ...promise.env }).has(name)) problems.push(`${section.id} (${section.where}): not shown in ${turn}/${role}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("describes only catalog tools a turn can be shown", () => {
    const missing = toolSections.map((section) => section.id.replace(/^tool:/, "")).filter((name) => !CATALOG_NAMES.has(name) && name !== "make_video");
    expect(missing).toEqual([]);
  });
});

describe("reachability guard: a bot shared with the person speaking (2026-10-28)", () => {
  // The harness now hands a shared bot the speaker's own phone tools and
  // OpenAPI operations (server/index.ts phoneToolTurn, openApiToolsEnv); the
  // catalog must then offer them in that person's direct chat, never in a room.
  const speakerOwn = { SAGAX_PHONE_TOOLS: "location", SAGAX_OPENAPI_TOOLS: JSON.stringify([{ name: "list_notes", method: "get", path: "/notes", summary: "List notes" }]) };
  it("offers the speaker's own phone and API operations in their direct chat", () => {
    for (const turn of [TURNS.direct, TURNS["direct-card"]]) {
      const shown = names({ ...turn, ...ROLES.member, ...speakerOwn });
      expect(shown).toContain("phone_tool");
      expect([...shown].some((name) => name.startsWith("openapi_"))).toBe(true);
    }
  });
});

const LIST_ACCOUNTS: ConnectorAccount[] = [
  { provider: "grok-com", driver: "grokAgent", instanceId: "default", slot: "primary", key: "grok-com:default:primary", label: "Grok", auth: "subscription", at: 1, connectors: [
    { name: "Outlook (Exchange)", state: "connected", tools: [] },
    { name: "Microsoft Teams", state: "needs-sign-in", tools: [] },
  ] },
  { provider: "claude-ai", driver: "claudeAgent", instanceId: "default", slot: "primary", key: "claude-ai:default:primary", label: "Claude", auth: "subscription", at: 1, connectors: [
    { name: "Example Docs", state: "connected", tools: [] },
  ] },
];

describe("reachability guard: what a person's direct chat is told", () => {
  // server/index.ts startTurn: a person's own message, boundedCoordination on
  const team = [{ id: "chief", name: "Atlas" }, { id: "b2", name: "Nova" }];
  const PROMPTS: Record<string, string> = {
    chief: chiefOfStaffSystemPrompt("chief", team, true),
    roster: peerRosterSystemPrompt(team.slice(1), true, false),
    rosterCreator: peerRosterSystemPrompt(team.slice(1), true, true),
    // #3351: the one connector list, whatever engine the bot runs on
    connectorsNone: connectorListPrompt({ principal: "person-a", accounts: [], callable: () => false, callTool: true }),
    // a person's own direct turn with a provider with no host yet, in Full or not (#3356: never pointed at run_with_engine)
    connectorsList: connectorListPrompt({ principal: "person-a", accounts: LIST_ACCOUNTS, callable: (provider) => provider === "grok-com", callTool: true }),
    connectorsListFull: connectorListPrompt({ principal: "person-a", accounts: LIST_ACCOUNTS, callable: (provider) => provider === "grok-com", callTool: true, full: true }),
    // the Team incidents report: a turn of the Primary Bot with no automation source
    incident: incidentText({ kind: "failed", bot: { id: "b2", name: "Nova" }, threadId: "t1", detail: "crash" }, { count: 1, mayRetry: true, muted: false }),
    credential: CREDENTIAL_PROMPT,
    widget: WIDGET_PROMPT + WIDGET_APPROVAL_PROMPT,
    reaction: REACTION_PROMPT,
    richOutput: richOutputPrompt(true),
    routine: ROUTINE_PROMPT,
    learn: LEARN_PROMPT,
    teamMemory: TEAM_MEMORY_PROMPT,
    profile: PROFILE_PROMPT,
    profileCreator: PROFILE_CREATOR_PROMPT,
  };

  it("names only tools the direct chat is shown", () => {
    // not on a live call: the reaction prompt is left out of a call turn, as its tools are
    const shown = names({ ...TURNS.direct, ...ROLES.chief, ...EVERY_SWITCH, SAGAX_VOICE_CALL: "0" });
    const problems = Object.entries(PROMPTS).flatMap(([prompt, text]) =>
      mentionedTools(text).filter((name) => !shown.has(name)).map((name) => `${prompt} names ${name}`));
    expect(problems).toEqual([]);
  });
});

describe("reachability guard: run_with_engine (2026-10-28)", () => {
  it("is offered where it can run: a person's direct chat and a routine, chief or member", () => {
    for (const turn of [TURNS.direct, TURNS["direct-card"], TURNS.routine]) {
      for (const role of Object.values(ROLES)) expect(names({ ...turn, ...role })).toContain("run_with_engine");
    }
  });
  it("is never offered where it cannot: a room (the bot is busy there) or a part already one hop away", () => {
    for (const turn of [TURNS.room, TURNS.teammate]) {
      for (const role of Object.values(ROLES)) expect(names({ ...turn, ...role })).not.toContain("run_with_engine");
    }
  });
});

describe("reachability guard: a member's own environment (2026-10-28)", () => {
  // vm_exec, shared_computer, attach_file and add_mcp_server are no longer
  // an admin's when they stay in the member's own environment
  // (engine-access.ts memberOwnHostToolCall): they must be offered there.
  it("offers the host-level tools a member now answers in their own direct chat and routines", () => {
    for (const turn of [TURNS.direct, TURNS["direct-card"], TURNS.routine]) {
      const shown = names({ ...turn, ...ROLES.member, SAGAX_SHARED_COMPUTERS_ENABLED: "1" });
      for (const name of ["vm_exec", "shared_computer", "attach_file", "add_mcp_server"]) expect(shown, name).toContain(name);
    }
  });
});
