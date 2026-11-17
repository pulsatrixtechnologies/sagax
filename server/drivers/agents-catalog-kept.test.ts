// #4527 lot C: what a typical product bot's kept listing puts on the wire,
// per engine family, against the whole list it replaced. The bot's own use
// decides (server/tools/tool-keep.ts): six conversations that used a
// product bot's usual tools and none of the rest, read with the system
// prompt a chat turn carries (a tool the prompt names stays listed). The
// numbers are measured from the real proxy process, as
// agents-catalog-wire.test.ts measures the whole list.
//
// A change on purpose: move KEPT_BASELINE by hand (the 2% band below fails
// both ways, so a saving cannot creep back either).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { waitForExit } from "../testing/cleanup.ts";
import { availableTools, catalogProfileFromEnv, keptToolsEnv } from "./agents-catalog.ts";
import { emptyToolKeep, foldToolSession, toolKeepVerdict } from "../tools/tool-keep.ts";
import {
  computerPrompt, CREDENTIAL_PROMPT, LEARN_PROMPT, PROFILE_PROMPT, REACTION_PROMPT, richOutputPrompt, ROUTINE_PROMPT, THREADS_PROMPT,
  WIDGET_APPROVAL_PROMPT, WIDGET_PROMPT,
} from "../system-prompt.ts";
import { approvalLevelPrompt } from "../approvals/approval-level-prompt.ts";
import { SESSION_SEARCH_SYSTEM_PROMPT } from "../workspace/workspace.ts";
import { peerRosterSystemPrompt } from "../peers/peer-roster.ts";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "agents-proxy.ts");
const RPC_PREFIX = '{"jsonrpc":"2.0","id":1,"result":';

/** A Primary Bot's direct chat (the "direct" profile of the goldens). */
const DIRECT = { SAGAX_ROOM_TURN: "0", SAGAX_GROUP_TURN: "0", SAGAX_OWN_THREAD_CREATION: "0", SAGAX_SKILL_AUTHORING_ENABLED: "0", SAGAX_SHARED_COMPUTERS_ENABLED: "0", SAGAX_VOICE_NOTES: "0", SAGAX_CHIEF_OF_STAFF: "1" };

/** What a product bot (a connector's records, cards, files, memory) calls. */
const TYPICAL_USED = [
  "connectors", "call_connector", "show_widget", "update_widget", "attach_file", "ask_choice", "tool_result_read",
  "memory_update", "memory_log", "session_search", "list_routines", "run_routine",
].map((tool) => `agents/${tool}`);

/** The texts a chat turn's system prompt always carries that name tools. */
const CHAT_PROMPT = [
  computerPrompt("vm-private"), approvalLevelPrompt("auto"), peerRosterSystemPrompt([{ id: "wren", name: "Wren", title: "Records" }], true),
  CREDENTIAL_PROMPT, THREADS_PROMPT, WIDGET_PROMPT, WIDGET_APPROVAL_PROMPT, REACTION_PROMPT, SESSION_SEARCH_SYSTEM_PROMPT, ROUTINE_PROMPT,
  PROFILE_PROMPT, LEARN_PROMPT, richOutputPrompt(),
];

/** The tools that bot's sessions leave out, as the rule decides them. */
function typicalLeftOut(): string[] {
  const offered = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-golden", ...DIRECT })).map((tool) => `agents/${tool.name}`);
  let state = emptyToolKeep();
  for (let n = 0; n < 6; n++) state = foldToolSession(state, { prompts: 3, used: TYPICAL_USED, offered });
  return toolKeepVerdict(state, { namedText: CHAT_PROMPT }).leftOut.map((id) => id.slice("agents/".length));
}

async function wireBytes(env: Record<string, string>): Promise<{ bytes: number; names: string[] }> {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SAGAX_")));
  const child = spawn(process.execPath, [PROXY], {
    env: { ...inherited, SAGAX_HARNESS_URL: "http://127.0.0.1:9", SAGAX_BOT_ID: "bot-golden", SAGAX_THREAD_ID: "thread-golden", SAGAX_COMMS_TOKEN: "unused", SAGAX_TURN_DEPTH: "0", SAGAX_CATALOG_BRIDGE: "0", ...DIRECT, ...env },
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
      child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    });
    const wire = line.slice(RPC_PREFIX.length, -1);
    return { bytes: Buffer.byteLength(wire, "utf8"), names: (JSON.parse(wire) as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name) };
  } finally {
    await waitForExit(child, { signal: "SIGTERM" });
  }
}

/** Bytes of agents tool definitions per model request, measured 2026-11-17:
 * 54 tools left out. The tools the chat prompt names (threads, artifacts,
 * pages, routines, profile, skills) stay listed by the rule, so the saving
 * is about 42 KB (about 10,700 tokens) per request, not the whole rare set. */
const KEPT_BASELINE = {
  // ACP engines, Muse Code, Pi on a cloud model, the chat-completions engines
  plain: { before: 102756, after: 60068 },
  // Codex: each family of what it lists is one tool
  merged: { before: 100533, after: 60061 },
} as const;

let leftOut: string[] = [];
const measured: Record<"plain" | "merged", { before: number; after: number; afterNames: string[] }> = {} as never;

beforeAll(async () => {
  leftOut = typicalLeftOut();
  const [plainBefore, plainAfter, mergedBefore, mergedAfter] = await Promise.all([
    wireBytes({}),
    wireBytes({ SAGAX_COMPACT_TOOLS: keptToolsEnv(leftOut) }),
    wireBytes({ SAGAX_MERGED_TOOLS: "1" }),
    wireBytes({ SAGAX_MERGED_TOOLS: "1", SAGAX_COMPACT_TOOLS: keptToolsEnv(leftOut) }),
  ]);
  measured.plain = { before: plainBefore.bytes, after: plainAfter.bytes, afterNames: plainAfter.names };
  measured.merged = { before: mergedBefore.bytes, after: mergedAfter.bytes, afterNames: mergedAfter.names };
  console.log([
    "#4527 kept listing, a typical product bot (direct chat), bytes of agents tool definitions per request:",
    `  left out: ${leftOut.length} tools`,
    `  plain (ACP, Muse Code, Pi cloud, chat engines): ${measured.plain.before} -> ${measured.plain.after} (saved ${measured.plain.before - measured.plain.after})`,
    `  merged (Codex): ${measured.merged.before} -> ${measured.merged.after} (saved ${measured.merged.before - measured.merged.after})`,
    `  listed: ${measured.plain.afterNames.join(", ")}`,
  ].join("\n"));
}, 60_000);

describe("#4527 kept listing, wire size of a typical product bot", () => {
  it("leaves out the tools it never used, never the core, approvals, memory or what the prompt names", () => {
    expect(leftOut.length).toBeGreaterThan(20);
    for (const kept of ["list_bots", "ask_choice", "memory_update", "connectors", "call_connector", "sagax_approvals", "search_tools", "call_tool"]) {
      expect(leftOut, kept).not.toContain(kept);
    }
    expect(measured.plain.afterNames).toEqual(expect.arrayContaining(["search_tools", "describe_tool", "call_tool"]));
    for (const name of leftOut) expect(measured.plain.afterNames).not.toContain(name);
  });

  it.each(["plain", "merged"] as const)("%s: before and after stay within 2% of their baseline", (family) => {
    const baseline = KEPT_BASELINE[family];
    for (const side of ["before", "after"] as const) {
      const actual = measured[family][side];
      expect(actual, `${family} ${side}: move KEPT_BASELINE to ${actual} on purpose`).toBeLessThanOrEqual(Math.floor(baseline[side] * 1.02));
      expect(actual, `${family} ${side}: move KEPT_BASELINE to ${actual} so the saving cannot creep back`).toBeGreaterThanOrEqual(Math.ceil(baseline[side] * 0.98));
    }
  });
});
