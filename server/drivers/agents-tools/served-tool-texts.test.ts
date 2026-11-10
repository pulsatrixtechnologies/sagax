// #3370: the tool catalog and the tool results a bot reads agree with the
// product's rules, like the system prompt does since #3293. One unified chat
// per bot: no thread shown as a row, no "#Title" thread link to write, and no
// em or en dash in any text a model reads and imitates.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "../agents-catalog.ts";
import { WIDGET_TOOL_DEFINITIONS } from "../agents-widget-tools.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDENS = join(HERE, "..", "agents-catalog-goldens");

/** Every catalog switch on, in a direct chat and in a room, as a Primary Bot
 * and not, plus the standing external runtime: together they mount every tool. */
function everyProfileEnv(): Array<[string, Record<string, string>]> {
  const on: Record<string, string> = {
    SAGAX_BOT_ID: "bot-scan",
    SAGAX_OWN_THREAD_CREATION: "1",
    SAGAX_SKILL_AUTHORING_ENABLED: "1",
    SAGAX_SHARED_COMPUTERS_ENABLED: "1",
    SAGAX_VOICE_NOTES: "1",
    SAGAX_MEETINGS: "1",
    SAGAX_SINGLE_STREAM: "1",
    SAGAX_ROUTE_MESSAGES: "1",
    SAGAX_VOICE_CALL: "1",
    SAGAX_GITHUB_CONNECT: "1",
    SAGAX_GROUP_MEMORY: "1",
    SAGAX_CREATE_BOTS: "1",
    SAGAX_AGENT_API: "1",
    SAGAX_PERSPICAX_TOOLS: "1",
    SAGAX_CLAIMS: "1",
    SAGAX_GROK_BRIDGE: "1",
    SAGAX_PHONE_TOOLS: "location,contacts,reminders,calendar",
    SAGAX_WEB_SEARCH: "1",
    SAGAX_VAULT_HTTP: "1",
  };
  const out: Array<[string, Record<string, string>]> = [];
  for (const room of [false, true]) {
    for (const chief of [true, false]) {
      for (const singleStream of [true, false]) {
        out.push([`${room ? "room" : "direct"}${chief ? "" : "+non-chief"}${singleStream ? "" : "+no-single-stream"}`, {
          ...on,
          SAGAX_ROOM_TURN: room ? "1" : "0",
          SAGAX_GROUP_TURN: room ? "1" : "0",
          SAGAX_CHIEF_OF_STAFF: chief ? "1" : "0",
          SAGAX_SINGLE_STREAM: singleStream ? "1" : "0",
        }]);
      }
    }
  }
  out.push(["external", { SAGAX_EXTERNAL_RUNTIME: "1" }]);
  out.push(["peer-hop", { ...on, SAGAX_PEER_HOP: "1" }]);
  return out;
}

/** Every description in a tool: its own and each one nested in its schema. */
function descriptionsOf(prefix: string, value: unknown, out: Array<[string, string]>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => descriptionsOf(`${prefix}[${index}]`, item, out));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "description" && typeof child === "string") out.push([prefix, child]);
    else descriptionsOf(`${prefix}.${key}`, child, out);
  }
}

function servedDescriptions(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [name, env] of everyProfileEnv()) {
    for (const tool of availableTools(catalogProfileFromEnv(env))) descriptionsOf(`${name}:${tool.name}`, tool, out);
  }
  for (const tool of WIDGET_TOOL_DEFINITIONS) descriptionsOf(`widget:${tool.name}`, tool, out);
  for (const file of readdirSync(GOLDENS).filter((name) => name.endsWith(".tools-list.json"))) {
    descriptionsOf(file, JSON.parse(readFileSync(join(GOLDENS, file), "utf8")), out);
  }
  return out;
}

/** The tool sources: their descriptions and the result texts they return. */
function toolSources(): Array<[string, string]> {
  return readdirSync(HERE)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => [name, readFileSync(join(HERE, name), "utf8")]);
}

const THREAD_ROW = /\bas a row\b|\brows? under\b|\bthe row's name\b|\bsidebar\b/i;
const THREAD_LINK = /#Title|\bas #\$\{|\bthread #\$\{|\binto #\$\{/;

describe("tool texts served to bots (#3370)", () => {
  it("scans a catalog that mounts every tool", () => {
    const names = new Set(servedDescriptions().map(([where]) => where.split(":")[1]?.split(".")[0]));
    for (const name of ["start_thread", "list_threads", "close_thread", "retry_thread", "coordinate_bots", "post_to_room"]) {
      expect(names, name).toContain(name);
    }
  });

  it("no tool description holds an em or en dash", () => {
    const offenders = servedDescriptions().filter(([, text]) => /[–—]/.test(text)).map(([where]) => where);
    expect(offenders).toEqual([]);
  });

  it("no tool description shows a thread as a row or asks for a #Title link", () => {
    const offenders = servedDescriptions()
      .filter(([, text]) => THREAD_ROW.test(text) || /#Title/.test(text))
      .map(([where]) => where);
    expect(offenders).toEqual([]);
  });

  it("no tool source, result texts included, holds an em or en dash", () => {
    const offenders = toolSources().flatMap(([name, text]) =>
      text.split("\n").flatMap((line, index) => (/[–—]/.test(line) ? [`${name}:${index + 1}`] : [])));
    expect(offenders).toEqual([]);
  });

  it("no tool result names a thread as #Title", () => {
    const offenders = toolSources().flatMap(([name, text]) =>
      text.split("\n").flatMap((line, index) => (THREAD_LINK.test(line) || THREAD_ROW.test(line) ? [`${name}:${index + 1}`] : [])));
    expect(offenders).toEqual([]);
  });
});
