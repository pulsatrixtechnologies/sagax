// What the agents proxy puts on the wire for `tools/list`, pinned byte for
// byte and measured.
//
// Two jobs:
//
// 1. GOLDEN. Every engine turns this JSON into its provider's function-call
//    format, and a schema that changes shape in passing has broken production
//    before (#544: a `oneOf` mangled by a provider's conversion). So the exact
//    serialized result is checked in for every mount profile the harness can
//    ask for, and a refactor of the proxy has to reproduce it to the byte.
//    The proxy is spawned the way a driver's mcpServers entry spawns it, from
//    source and from the esbuild bundle every packaged build ships, so "the
//    same bytes" is a statement about the real process, not about a helper.
//    The default listing is the full catalog. find_tool and use_tool are
//    listed only with SAGAX_CATALOG_BRIDGE=1 on a compact prompt (#1374).
//    These goldens pin the full catalog, which is what find_tool searches.
//
// 2. WIRE SIZE. The catalog is sent to the model on every turn. The often
//    quoted "~37 KB" was a count of indented source, not of this JSON. The
//    numbers printed here are the real ones, and the budget below fails CI
//    when a profile grows by more than 2%.
//
// Changing a tool on purpose: run this file once with
// UPDATE_AGENTS_CATALOG_GOLDENS=1, review the golden diff like any other wire
// change, and move BUDGET_BASELINE by hand. The baseline is deliberately not
// rewritten by the update run: growth should be a decision somebody typed.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitForExit } from "../testing/cleanup.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import {
  AGENTS_CATALOG_BYTES_SOFT_CEILING,
  AGENTS_CATALOG_TOOL_COUNT_LIMIT,
  applyCatalogGroups,
  catalogMargin,
  formatCatalogMargin,
} from "./agents-catalog-budget.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROXY_SOURCE = join(HERE, "agents-proxy.ts");
const GOLDENS = join(HERE, "agents-catalog-goldens");
const UPDATE = process.env.UPDATE_AGENTS_CATALOG_GOLDENS === "1";

interface Profile {
  env: Record<string, string>;
}

const flag = (on: boolean) => (on ? "1" : "0");

/** Every combination server/index.ts agentsIntegration() can produce. One
 * tool surface for every turn (docs/runtime-contract.md §9): a person's
 * chat, a room turn, a routine or webhook run and a standing external
 * runtime all mount the same teamwork tools, so the only switches are the
 * features (skills, shared computers, voice) and the role. The bot id is
 * fixed because start_thread's schema carries it. A name without
 * "+non-chief" is a Primary Bot's turn, which mounts the most. */
function profiles(): Record<string, Profile> {
  const all: Record<string, Profile> = {};
  for (const chief of [true, false]) {
    for (const room of [false, true]) {
      for (const ownThread of room ? [false, true] : [false]) {
        for (const skills of [false, true]) {
          for (const shared of [false, true]) {
            for (const voice of [false, true]) {
              const name = [room ? "room" : "direct", ownThread && "own-thread", skills && "skills", shared && "shared", voice && "voice", !chief && "non-chief"]
                .filter(Boolean).join("+");
              all[name] = {
                family: room ? "room" : "direct",
                env: {
                  SAGAX_ROOM_TURN: flag(room),
                  // the "room" family is a real room; a person's direct chat,
                  // which coordinates too, is pinned in agents-catalog-reachability.test.ts
                  SAGAX_GROUP_TURN: flag(room),
                  SAGAX_OWN_THREAD_CREATION: flag(ownThread),
                  SAGAX_SKILL_AUTHORING_ENABLED: flag(skills),
                  SAGAX_SHARED_COMPUTERS_ENABLED: flag(shared),
                  SAGAX_VOICE_NOTES: flag(voice),
                  SAGAX_CHIEF_OF_STAFF: flag(chief),
                },
              };
            }
          }
        }
      }
    }
  }
  // The switches that once picked a catalog profile (a room turn, own-thread
  // creation) change nothing now; pin that. A standing external runtime still
  // narrows the catalog (below).
  // Sagax has no Cloud home, so no cloud-home profile is pinned.
  all["default+legacy-switches"] = {
    env: { ...all.default!.env, SAGAX_ROOM_TURN: "1", SAGAX_OWN_THREAD_CREATION: "1" },
  };
  return all;
}

const PROFILES = profiles();
/** Refused by the server to every bot that is not a Primary Bot. */
const CHIEF_ONLY_TOOLS = ["create_bot", "list_team_setup", "propose_team_setup", "propose_bot_deletion", "archive_bot", "create_room", "manage_room", "retry_thread"];
/** Their for_bot_id, changing another bot, is a Primary Bot's alone. */
const CHIEF_TARGET_TOOLS = ["propose_profile", "propose_model"];
const CHIEF_PROFILE_TARGET = " A Primary Bot may pass for_bot_id (from list_bots) for a requested change to any bot of its person.";
/** The one surface's teamwork tools (docs/runtime-contract.md §9). Every
 * profile mounts all of them. */
const TEAMWORK_TOOLS = ["list_room_targets", "coordinate_bots", "assignment_status", "list_bots", "list_rooms", "list_threads", "close_thread", "start_thread", "post_to_room"];
/** The profile that mounts the most: checked in whole, as readable JSON.
 * Every other profile is a by-name subset of it and is pinned by tool names,
 * byte count and sha256 in profiles.json. */
const FULL = "skills+shared+voice";

/** Bytes measured when the budget was last set. A profile may not exceed this
 * by more than 2%, and may not undercut it by more than 2% either: a smaller
 * catalog is the goal, so lock the win in by lowering the number. */
// Chat widgets (show_widget and update_widget, agents-widget-tools.ts) add
// 2,612 B to every agents profile.
// The gap tools (answer_approval, nudge_person, manage_pairing, manage_settings)
// add about 2.4 KB to every non-external profile.
// request_login (the credential vault, 2026-10-16) adds 706 B to every
// non-external profile; the baselines were moved to the measured bytes then.
// Artifacts (save_artifact, update_artifact, list_artifacts, delete_artifact,
// agents-artifact-tools.ts, 2026-10-16) add about 3.3 KB to every
// non-external profile; the baselines were moved to the measured bytes.
// check_widget (the ```widget self-check, server/widgets/widget-check.ts, 2026-10-19)
// is added to every profile; the baselines were moved to the measured bytes.
// sagax_settings (every setting as an action, server/settings-actions.ts,
// 2026-10-19) adds 1744 B to every non-external profile, on purpose: one
// tool for every family instead of one per setting.
// Flexible routine timing adds 1,076 B to every non-external profile: the
// schedule schema is written out twice (propose_routine and
// propose_routine_action). The baselines moved by that amount.
// propose_routine's optional enabled field adds 300 B to every
// non-external profile, so a creator can start a routine live or paused.
// publish_remote_session (the Tailcat card) adds 983 B to every
// non-external profile. Chief profiles stayed inside 2%. The non-chief
// budgets were already close, so those baselines move to the measured bytes.
// resource_usage (the usage card, server/resource-usage/, 2026-10-21) is
// added to every non-external profile; the baselines moved to the measured bytes.
// +861 bytes (2026-10-22): remote_session_snapshot and remote_session_exec,
// loaded directly so "check this computer" is one call (Tailcat 8F2NZU).
// 2026-10-26: the remote-session tools leave the solo profiles (#1093), so
// the two closest non-chief baselines move down to the measured bytes.
// 2026-10-27: the routine triggers on a change (#1202) add 763 B each to
// propose_routine and propose_routine_action, and the tool changes merged
// since 0.8.3 add more to the non-chief profiles; the baselines out of 2%
// move to the measured bytes.
// 2026-10-27: sagax_approvals is offered to every owned bot (750 B, plus the
// list comma). The six direct non-chief profiles already near the ceiling
// move to the measured bytes.
// task_list adds 662 B to every non-external profile. Profiles already
// near the cap move to the measured bytes.
// 2026-10-28: make_video (every profile, external included) had reached the
// catalog without a golden update; the reachability fix (propose_page and
// place_phone_call in a person's direct chat, descriptions that name only
// tools the turn is shown, widgets and live HTML apps out of rooms, which
// refuse them) moves the profiles out of 2% to the measured bytes.
// 2026-10-28: routine folders add a `folder` field to the routine tools; the
// six direct non-chief profiles move to the measured bytes.
// 2026-10-28: run_with_engine (a part of the work on another engine the
// person may use, server/run-with-engine.ts) joins direct turns; the eight
// direct chief profiles move to the measured bytes.
// 2026-10-31: make_video now describes paid async generation, its scoped
// lifecycle and documented formats; baselines use the measured new wire.
// 2026-11-01 (#1703): deliberate raise to the measured wire. The old
// baselines sat inside 40 to 528 bytes of the +2% cap (room+non-chief was
// the tightest), which forced description cuts on every new tool. The soft
// ceiling is now AGENTS_CATALOG_BYTES_SOFT_CEILING (150_000); groups mode
// (SAGAX_CATALOG_GROUPS=1) is the growth path when a profile approaches it.
// 2026-11-05 (#2018): claude_artifact (claude.ai artifacts through the
// person's own Claude account) joins the catalog; baselines move to the
// measured wire.
const BUDGET_BASELINE: Record<string, number> = {

  "direct": 94738,
  "direct+voice": 95705,
  "direct+shared": 96739,
  "direct+shared+voice": 97706,
  "direct+skills": 96360,
  "direct+skills+voice": 97327,
  "direct+skills+shared": 98361,
  "direct+skills+shared+voice": 99328,
  "room": 83709,
  "room+voice": 84676,
  "room+shared": 85710,
  "room+shared+voice": 86677,
  "room+skills": 85331,
  "room+skills+voice": 86298,
  "room+skills+shared": 87332,
  "room+skills+shared+voice": 88299,
  "room+own-thread": 85897,
  "room+own-thread+voice": 86864,
  "room+own-thread+shared": 87898,
  "room+own-thread+shared+voice": 88865,
  "room+own-thread+skills": 87519,
  "room+own-thread+skills+voice": 88486,
  "room+own-thread+skills+shared": 89520,
  "room+own-thread+skills+shared+voice": 90487,
  // #2048: choose_page_target joins the catalog (measured wire).
  "direct+non-chief": 85930,
  "direct+voice+non-chief": 85209,
  "direct+shared+non-chief": 86243,
  "direct+shared+voice+non-chief": 87210,
  "direct+skills+non-chief": 85864,
  "direct+skills+voice+non-chief": 86831,
  "direct+skills+shared+non-chief": 87865,
  "direct+skills+shared+voice+non-chief": 88832,
  "room+non-chief": 73207,
  "room+voice+non-chief": 74174,
  "room+shared+non-chief": 75208,
  "room+shared+voice+non-chief": 76175,
  "room+skills+non-chief": 74829,
  "room+skills+voice+non-chief": 75796,
  "room+skills+shared+non-chief": 76830,
  "room+skills+shared+voice+non-chief": 77797,
  "room+own-thread+non-chief": 75395,
  "room+own-thread+voice+non-chief": 76362,
  "room+own-thread+shared+non-chief": 77396,
  "room+own-thread+shared+voice+non-chief": 78363,
  "room+own-thread+skills+non-chief": 77017,
  "room+own-thread+skills+voice+non-chief": 77984,
  "room+own-thread+skills+shared+non-chief": 79018,
  "room+own-thread+skills+shared+voice+non-chief": 79985,
  "external": 5083,
  "external+everything": 5083,
};

const RPC_PREFIX = '{"jsonrpc":"2.0","id":1,"result":';

/** The exact `result` text of one tools/list answer from a freshly spawned
 * proxy. Sliced out of the raw stdout line, never re-serialized. */
async function toolsListWire(entry: string, env: Record<string, string>): Promise<string> {
  // A developer shell (or a Sagax turn running this suite) can carry
  // SAGAX_* switches of its own; the profile must be the only source.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SAGAX_")));
  const child = spawn(process.execPath, [entry], {
    env: { ...inherited, SAGAX_HARNESS_URL: "http://127.0.0.1:9", SAGAX_BOT_ID: "bot-golden", SAGAX_THREAD_ID: "thread-golden", SAGAX_COMMS_TOKEN: "unused", SAGAX_TURN_DEPTH: "0", ...env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  try {
    const line = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline !== -1) resolve(buffer.slice(0, newline));
      });
      child.on("error", reject);
      child.on("exit", (code) => reject(new Error(`agents proxy exited (${code}) before answering tools/list`)));
      // stdin stays open until the answer is read: closing it makes the proxy
      // exit, and on Windows a pipe write still in flight is lost with it.
      child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    });
    expect(line.startsWith(RPC_PREFIX) && line.endsWith("}")).toBe(true);
    return line.slice(RPC_PREFIX.length, -1);
  } finally {
    await waitForExit(child, { signal: "SIGTERM" });
  }
}

async function wireForEveryProfile(entry: string): Promise<Record<string, string>> {
  const names = Object.keys(PROFILES);
  const wires = await Promise.all(names.map((name) => toolsListWire(entry, { ...PROFILES[name]!.env, SAGAX_CATALOG_BRIDGE: "0" })));
  return Object.fromEntries(names.map((name, index) => [name, wires[index]!]));
}

const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
type Tool = { name: string };
const toolsOf = (wire: string) => (JSON.parse(wire) as { tools: Tool[] }).tools;

const goldenPath = join(GOLDENS, "full.tools-list.json");
const manifestPath = join(GOLDENS, "profiles.json");
// Goldens are stored pretty-printed so a wire change reads as a diff, and are
// compared after JSON.parse, so a CRLF checkout on Windows cannot fail them.
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const manifestOf = (wires: Record<string, string>) =>
  Object.fromEntries(Object.entries(wires).map(([name, wire]) => [
    name,
    { bytes: bytes(wire), sha256: sha256(wire), tools: toolsOf(wire).map((tool) => tool.name) },
  ]));

let wires: Record<string, string> = {};

beforeAll(async () => {
  wires = await wireForEveryProfile(PROXY_SOURCE);
  if (UPDATE) {
    writeJson(goldenPath, JSON.parse(wires[FULL]!));
    writeJson(manifestPath, manifestOf(wires));
  }
}, 120_000);

describe("agents proxy tools/list golden", () => {
  it("lists find_tool and use_tool only with SAGAX_CATALOG_BRIDGE=1 on a compact prompt (#1374)", async () => {
    const wire = await toolsListWire(PROXY_SOURCE, { SAGAX_CATALOG_BRIDGE: "1", SAGAX_COMPACT_TOOLS: "{}" });
    // #1367: the heart of a chat turn stays listed by name, before the bridge
    const names = toolsOf(wire).map((tool) => tool.name);
    expect(names.slice(-2)).toEqual(["find_tool", "use_tool"]);
    const listed = names.slice(0, -2);
    expect(listed).toEqual([...listed].sort());
    const plain = await toolsListWire(PROXY_SOURCE, { SAGAX_CATALOG_BRIDGE: "1" });
    expect(toolsOf(plain).map((tool) => tool.name)).not.toContain("use_tool");
  }, 30_000);

  it("round-trips through JSON.parse unchanged, so a parsed golden can stand for the bytes", () => {
    for (const wire of Object.values(wires)) expect(JSON.stringify(JSON.parse(wire))).toBe(wire);
  });

  it("the fullest profile is byte-identical to its golden", () => {
    const golden = readJson(goldenPath);
    const wire = wires[FULL]!;
    // Structural first: a readable diff naming the tool and field that moved.
    expect(JSON.parse(wire)).toEqual(golden);
    // Then the bytes: key order and number formatting included.
    expect(wire).toBe(JSON.stringify(golden));
  });

  it("every profile matches its pinned tool names, byte count and sha256", () => {
    expect(manifestOf(wires)).toEqual(readJson(manifestPath));
  });

  it("every profile is a by-name subset of the full golden, tool bytes included", () => {
    const full = new Map(toolsOf(wires[FULL]!).map((tool) => [tool.name, JSON.stringify(tool)]));
    for (const [name, profile] of Object.entries(PROFILES)) {
      for (const tool of toolsOf(wires[name]!)) {
        // A non-Primary Bot's propose_profile and propose_model are pinned by
        // the next test.
        if (profile.env.SAGAX_CHIEF_OF_STAFF === "0" && CHIEF_TARGET_TOOLS.includes(tool.name)) continue;
        // A description names only tools its turn is shown (agents-catalog.ts
        // OFFERED_REFERENCES, pinned by agents-catalog-reachability.test.ts):
        // post_to_room without a voice, send_to_bot without own threads.
        if (profile.env.SAGAX_VOICE_NOTES === "0" && tool.name === "post_to_room") continue;
        if (profile.env.SAGAX_OWN_THREAD_CREATION === "0" && tool.name === "send_to_bot") continue;
        expect(JSON.stringify(tool), `${name}: ${tool.name}`).toBe(full.get(tool.name));
      }
    }
  });

  it("gives every turn the one teamwork surface, with start_thread on the bot itself", () => {
    type SchemaTool = Tool & { description: string; inputSchema: { properties: Record<string, { enum?: string[]; description?: string }> } };
    for (const [name, wire] of Object.entries(wires)) {
      const tools = new Map((toolsOf(wire) as SchemaTool[]).map((tool) => [tool.name, tool]));
      for (const tool of TEAMWORK_TOOLS) expect(tools.has(tool), `${name}: ${tool}`).toBe(true);
      // the one-release aliases of the old names are gone (docs/runtime-contract.md §9)
      for (const alias of ["delegate_bot", "ask_bot", "send_to_bot", "check_delegation", "wait_delegation"]) expect(tools.has(alias), `${name}: ${alias}`).toBe(false);
      expect(JSON.stringify([...tools.values()])).not.toMatch(/Deprecated alias|works for this release/);
      // the contract's fields, in the contract's words
      const coordinate = tools.get("coordinate_bots")!.inputSchema.properties;
      expect(Object.keys(coordinate)).toEqual(["group_id", "bot_ids", "message", "reason", "rework", "thread", "reply", "consult", "relay", "done_when"]);
      expect(coordinate.thread!.enum).toEqual(["standing", "new"]);
      expect(coordinate.reply!.enum).toEqual(["resume", "none"]);
      expect(Object.keys(tools.get("assignment_status")!.inputSchema.properties)).toEqual(["id", "wait_ms"]);
      // start_thread opens a job on the bot itself: its bot_id takes one value
      expect(tools.get("start_thread")!.inputSchema.properties.bot_id!.enum).toEqual(["bot-golden"]);
      // nothing in the catalog teaches the legacy wait
      expect(wire).not.toMatch(/Brief synchronous consultation|DEFAULT FOR ASSIGNING WORK|BLOCKING status tool/);
    }
  });

  it("ignores the switches that once picked a catalog profile", () => {
    expect(wires["default+legacy-switches"]).toBe(wires.default);
    const profile = catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-golden", SAGAX_CHIEF_OF_STAFF: "1", SAGAX_ROOM_TURN: "1", SAGAX_OWN_THREAD_CREATION: "1" });
    expect(JSON.stringify({ tools: availableTools(profile) })).toBe(wires.default);
    expect(profile).not.toHaveProperty("coordinating");
    expect(profile).not.toHaveProperty("ownThreadCreation");
  });

  it("gives a standing external runtime the peer surface only, never act", () => {
    const profile = catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-golden", SAGAX_CHIEF_OF_STAFF: "1", SAGAX_EXTERNAL_RUNTIME: "1" });
    expect(availableTools(profile).map((tool) => tool.name).sort()).toEqual(["assignment_status", "coordinate_bots", "list_bots"]);
  });

  it("shows only a Primary Bot the Primary-Bot-only tools, and for_bot_id on another bot's profile or model", () => {
    // Every route behind these refuses a bot that is not a Primary Bot, so the rest
    // are not shown them; otherwise the two catalogs are the same to the byte.
    type SchemaTool = Tool & { description: string; inputSchema: { properties: Record<string, unknown> } };
    const nonChief = Object.keys(PROFILES).filter((name) => PROFILES[name]!.env.SAGAX_CHIEF_OF_STAFF === "0");
    expect(nonChief).toHaveLength(8);
    for (const name of nonChief) {
      const chiefTools = toolsOf(wires[name === "non-chief" ? "default" : name.replace("+non-chief", "")]!) as SchemaTool[];
      const tools = new Map((toolsOf(wires[name]!) as SchemaTool[]).map((tool) => [tool.name, tool]));
      expect(chiefTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(CHIEF_ONLY_TOOLS));
      expect([...tools.keys()], name).toEqual(chiefTools.map((tool) => tool.name).filter((tool) => !CHIEF_ONLY_TOOLS.includes(tool)));
      for (const chiefTool of chiefTools.filter((tool) => tools.has(tool.name))) {
        let expected: SchemaTool = chiefTool;
        if (CHIEF_TARGET_TOOLS.includes(chiefTool.name)) {
          const { for_bot_id: forBotId, ...properties } = chiefTool.inputSchema.properties;
          expect(forBotId, `${name}: ${chiefTool.name}`).toBeDefined();
          expected = { ...chiefTool, description: chiefTool.description.replace(CHIEF_PROFILE_TARGET, ""), inputSchema: { ...chiefTool.inputSchema, properties } };
        }
        expect(JSON.stringify(tools.get(chiefTool.name)), `${name}: ${chiefTool.name}`).toBe(JSON.stringify(expected));
      }
      expect(chiefTools.find((tool) => tool.name === "propose_profile")!.description).toContain(CHIEF_PROFILE_TARGET);
      expect(JSON.stringify(CHIEF_TARGET_TOOLS.map((tool) => tools.get(tool)))).not.toContain("for_bot_id");
      // Any bot may ask to change a reachable section peer's routine.
      for (const routine of ["propose_routine", "propose_routine_action"]) {
        expect(tools.get(routine)!.inputSchema.properties, `${name}: ${routine}`).toHaveProperty("for_bot_id");
      }
    }
  });

  it("is what the catalog module computes in-process, so another front end mounts the same tools", () => {
    for (const [name, profile] of Object.entries(PROFILES)) {
      const tools = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-golden", ...profile.env }));
      expect(JSON.stringify({ tools }), name).toBe(wires[name]);
    }
  });

  it("writes the routine fields out identically in both routine tools", () => {
    // One source constant, serialized in full twice: see the wire-size table
    // for what that costs, and the next test for why it is not a $ref.
    type RoutineTool = Tool & { inputSchema: { properties: Record<string, unknown> & { changes: { properties: Record<string, unknown> } } } };
    const tools = new Map(toolsOf(wires[FULL]!).map((tool) => [tool.name, tool as RoutineTool]));
    const created = tools.get("propose_routine")!.inputSchema.properties;
    const changed = tools.get("propose_routine_action")!.inputSchema.properties.changes.properties;
    expect(Object.keys(changed).length).toBeGreaterThan(0);
    for (const field of Object.keys(changed)) expect(JSON.stringify(created[field]), field).toBe(JSON.stringify(changed[field]));
    expect(Object.keys(created).slice(0, Object.keys(changed).length)).toEqual(Object.keys(changed));
  });

  it("uses no JSON-Schema keyword a provider conversion is known to drop or mangle", () => {
    // #544. Reuse in the source is one constant referenced twice; on the wire
    // the schema stays written out in full, with no indirection or branches.
    for (const [name, wire] of Object.entries(wires)) {
      expect(wire.match(/"(\$ref|\$defs|definitions|oneOf|anyOf|allOf)":/g), name).toBeNull();
    }
  });
});

describe("agents proxy tools/list from the packaged bundle", () => {
  let directory = "";
  afterAll(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("serves the same bytes with no source tree beside it", async () => {
    // Same esbuild options as scripts/bundle-server.mjs, which produces the
    // dist-server/ that the desktop app, the npm package and the container
    // image all copy whole. The proxy runs as its own process there, so every
    // module it imports has to be inlined into this one file.
    directory = realpathSync(mkdtempSync(join(tmpdir(), "omb-agents-proxy-bundle-")));
    await build({
      entryPoints: [PROXY_SOURCE],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      // the banner scripts/bundle-server.mjs adds: a CommonJS dependency
      // (yaml) requires node built-ins at load time
      banner: { js: 'import { createRequire as __ombCreateRequire } from "node:module"; const require = __ombCreateRequire(import.meta.url);' },
      outbase: join(HERE, ".."),
      outdir: directory,
      logLevel: "silent",
    });
    const bundled = join(directory, "drivers", "agents-proxy.js");
    expect(existsSync(bundled)).toBe(true);
    expect(readFileSync(bundled, "utf8")).not.toMatch(/from\s+["']\.{1,2}\//);
    expect(await wireForEveryProfile(bundled)).toEqual(wires);
  }, 120_000);
});

describe("agents proxy tools/list wire size", () => {
  it("prints per-tool and total UTF-8 bytes", () => {
    const shown = [FULL, `${FULL}+non-chief`];
    const perTool = new Map<string, Record<string, number>>();
    for (const name of shown) {
      for (const tool of toolsOf(wires[name]!)) {
        perTool.set(tool.name, { ...perTool.get(tool.name), [name]: bytes(JSON.stringify(tool)) });
      }
    }
    const largest = (sizes: Record<string, number>) => Math.max(...Object.values(sizes));
    const rows = [...perTool.entries()].sort((a, b) => largest(b[1]) - largest(a[1]));
    const lines = [
      "agents proxy tools/list, UTF-8 bytes of the serialized result",
      "",
      "total per profile:",
      ...Object.entries(wires).map(([name, wire]) => `  ${String(bytes(wire)).padStart(6)}  ${String(toolsOf(wire).length).padStart(2)} tools  ${name}`),
      "",
      `per tool (${shown.join(" | ")}); every other profile is a by-name subset with identical tool bytes:`,
      ...rows.map(([tool, sizes]) => `  ${shown.map((name) => String(sizes[name] ?? "-").padStart(6)).join(" ")}  ${tool}`),
    ];
    console.log(lines.join("\n"));
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(Object.keys(PROFILES))("%s stays within 2% of its budget baseline", (name) => {
    const baseline = BUDGET_BASELINE[name];
    expect(baseline, `${name} has no BUDGET_BASELINE entry`).toBeTypeOf("number");
    const actual = bytes(wires[name]!);
    expect(actual, `${name} grew past its budget (${baseline} + 2%). Trim the catalog, or raise BUDGET_BASELINE on purpose.`)
      .toBeLessThanOrEqual(Math.floor(baseline! * 1.02));
    expect(actual, `${name} shrank by more than 2%. Lower BUDGET_BASELINE to ${actual} so the saving cannot creep back.`)
      .toBeGreaterThanOrEqual(Math.ceil(baseline! * 0.98));
  });

  it("stays under the measured soft ceiling and tool count limit, and prints margin per profile (#1703)", () => {
    const lines = [
      "agents catalog budget margins (#1703)",
      `soft_ceiling_bytes=${AGENTS_CATALOG_BYTES_SOFT_CEILING}`,
      `tool_count_limit=${AGENTS_CATALOG_TOOL_COUNT_LIMIT}`,
      "",
    ];
    for (const [name, wire] of Object.entries(wires)) {
      const toolCount = toolsOf(wire).length;
      const actual = bytes(wire);
      const margin = catalogMargin({
        profile: name,
        bytes: actual,
        tools: toolCount,
        baseline: BUDGET_BASELINE[name]!,
      });
      expect(actual, `${name} past soft ceiling ${AGENTS_CATALOG_BYTES_SOFT_CEILING}`).toBeLessThanOrEqual(AGENTS_CATALOG_BYTES_SOFT_CEILING);
      expect(toolCount, `${name} past tool limit ${AGENTS_CATALOG_TOOL_COUNT_LIMIT}`).toBeLessThanOrEqual(AGENTS_CATALOG_TOOL_COUNT_LIMIT);
      expect(margin.headroomToSoftCeiling, name).toBeGreaterThan(0);
      expect(margin.headroomToToolLimit, name).toBeGreaterThanOrEqual(0);
      const full = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-golden", ...PROFILES[name]!.env }));
      const grouped = applyCatalogGroups(full, { SAGAX_CATALOG_GROUPS: "1" });
      const groupBytes = bytes(JSON.stringify({ tools: grouped }));
      lines.push(formatCatalogMargin(margin));
      lines.push(`  groups_mode_bytes=${groupBytes} saved=${actual - groupBytes}`);
    }
    console.log(lines.join("\n"));
    expect(lines.length).toBeGreaterThan(5);
  });
});
