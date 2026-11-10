// What a step row in the chat says: a plain sentence for each tool call
// ("Read a file", "Coordinated Wren and Olive", "Viewed tickets in
// <product>") in the tense of its state, never the raw tool id. The
// id stays in the row's detail for whoever needs it.
//
// Four phases: running ("Reading a file"), done ("Read a file"), failed
// ("Could not read a file"), and unverified (a historical incomplete
// receipt after a restart: past tense, no shimmer). Tools served by an MCP
// product reuse the approval reading (shared/approval-describe.ts) for the
// verb, the resource and the product, with the step's own verb forms.
// The product's name is the one the server declared for the tool at run
// time (StepTool.product); no product name is written here.
import { activeLocale, t } from "@/lib/i18n";
import { localizedEngineCause, restartSentence } from "@/lib/engine-error-text";
import type { LocaleKey } from "@/locales";
import * as shared from "../../shared/approval-describe";
import { parseArgs, parseToolId } from "@/lib/approval-describe";
import { isOpaqueId, isOpaqueValue } from "../../shared/human-id";
import { readMcpGatewayCall, readUseToolCall, type McpGatewayCall } from "../../shared/mcp-gateway-call";
import { humanPath } from "@/lib/short-path";
import { gatewayToolId, toolDisplayName } from "../../shared/tool-display-name";
import { readConnectorCall } from "../../shared/connector-call";

export type StepPhase = "running" | "done" | "failed" | "unverified";

export type StepTool = {
  name: string;
  ok?: boolean;
  input?: string;
  summary?: string;
  output?: string;
  durationMs?: number;
  /** The product this tool serves, as the connector or the server declared
   * it at run time (shared/wire.ts Message.tool.product), and the id its
   * tool names start with. */
  product?: string;
  productId?: string;
};

/** A teammate's display name from the id a coordination tool was given. */
export type StepNameOf = (id: string) => string | undefined;

/** Verb tense for labels: unverified reuses done (the call already happened). */
function labelTense(phase: StepPhase): "running" | "done" | "failed" {
  return phase === "unverified" ? "done" : phase;
}

/** `live === false` marks a historical incomplete receipt as unverified.
 * Omitted `live` keeps the running tense for live-activity callers that
 * only know the tool chip. */
export function stepPhase(tool: Pick<StepTool, "ok">, live?: boolean): StepPhase {
  if (tool.ok === undefined) return live === false ? "unverified" : "running";
  return tool.ok ? "done" : "failed";
}

type Kind =
  | "think" | "readFile" | "writeFile" | "editFile" | "deleteFile" | "runCommand"
  | "searchFiles" | "listFiles" | "searchWeb" | "fetchPage" | "openPage"
  | "screen" | "computer" | "todo" | "toolSearch" | "subagent"
  | "coordinate" | "ask" | "delegate" | "sendTo" | "checkDelegation"
  | "whosAround" | "rooms" | "postRoom" | "startThread" | "closeThread" | "listThreads"
  | "memory" | "memorySearch" | "readConversations" | "routine" | "skill"
  | "attachFile" | "react" | "card" | "voiceNote" | "readResult" | "phone";

/** Claude and ACP built-ins, by their exact name. */
const BUILTIN: Record<string, Kind> = {
  Bash: "runCommand", shell: "runCommand", execute: "runCommand", BashOutput: "runCommand",
  Read: "readFile", read: "readFile", NotebookRead: "readFile",
  Write: "writeFile",
  Edit: "editFile", MultiEdit: "editFile", NotebookEdit: "editFile", edit: "editFile",
  delete: "deleteFile",
  Glob: "searchFiles", Grep: "searchFiles", search: "searchFiles",
  LS: "listFiles",
  WebSearch: "searchWeb",
  WebFetch: "fetchPage", fetch: "fetchPage",
  TodoWrite: "todo",
  ToolSearch: "toolSearch",
  Agent: "subagent", Task: "subagent",
  think: "think",
};

/** Sagax's own tools and the common bare names, lower case. */
const BARE: Record<string, Kind> = {
  read_file: "readFile", view: "readFile", open_file: "readFile", workspace_read: "readFile",
  write_file: "writeFile", create_file: "writeFile",
  edit_file: "editFile", str_replace: "editFile", apply_patch: "editFile",
  delete_file: "deleteFile",
  run_command: "runCommand", exec: "runCommand", vm_exec: "runCommand", bash: "runCommand", terminal: "runCommand",
  search_files: "searchFiles", grep: "searchFiles", glob: "searchFiles", find_files: "searchFiles", workspace_search: "searchFiles",
  list_files: "listFiles", list_dir: "listFiles", list_directory: "listFiles",
  web_search: "searchWeb", search_web: "searchWeb",
  web_fetch: "fetchPage", fetch_url: "fetchPage", read_page: "fetchPage", browse: "fetchPage",
  open_url: "openPage", navigate: "openPage",
  screenshot: "screen", screen_capture: "screen", get_screen_size: "screen",
  computer_use: "computer", computer: "computer", click: "computer", type: "computer", keypress: "computer", scroll: "computer",
  coordinate_bots: "coordinate",
  ask_bot: "ask", send_bot_message: "ask",
  delegate_bot: "delegate",
  send_to_bot: "sendTo", send_prompt: "sendTo",
  check_delegation: "checkDelegation", wait_delegation: "checkDelegation", await_turn: "checkDelegation", send_status: "checkDelegation",
  list_bots: "whosAround", list_room_targets: "whosAround", list_agents: "whosAround", find_agents: "whosAround", list_team_setup: "whosAround",
  list_rooms: "rooms",
  post_to_room: "postRoom",
  // #2118: a message to a person lands in their group with the owner
  message_user: "postRoom",
  start_thread: "startThread",
  // a part of the work on another engine (server/run-with-engine.ts)
  run_with_engine: "subagent",
  close_thread: "closeThread",
  list_threads: "listThreads",
  memory_update: "memory", memory_log: "memory", group_memory_update: "memory", rules_update: "memory", docs_update: "memory", memory_write: "memory",
  memory_save: "memory", memory_remove: "memory", memory_forget: "memory", memory_suggestions: "memory",
  memory_search: "memorySearch", memory_recall: "memorySearch", memory_find: "memorySearch",
  session_search: "readConversations", session_read: "readConversations", read_transcript: "readConversations",
  read_transcript_page: "readConversations", read_latest_page: "readConversations",
  read_latest_page_with_threads: "readConversations", read_transcript_cold: "readConversations", read_transcript_attachment: "readConversations",
  list_routines: "routine", propose_routine: "routine", propose_routine_action: "routine", schedule_routine: "routine", manage_routine: "routine",
  skills_list: "skill", skill_manage: "skill", stage_skill: "skill", update_skill: "skill", skills_find: "skill",
  attach_file: "attachFile",
  react_to_message: "react", remove_reaction: "react",
  create_options_card: "card",
  ask_choice: "card",
  send_voice_note: "voiceNote",
  // the person's own iPhone (server/drivers/agents-phone-tools.ts): approved there
  phone_tool: "phone",
  tool_result_read: "readResult",
  todo_write: "todo",
};

/** Servers that are Sagax itself: their tools name no product. */
const INTERNAL = /^(?:mcp__)?(?:agents|sagax|sagax-[a-z-]+|maus|ogb|harness)(?:__|_|\.)/i;


const TARGET_MAX = 80;

/** phone_tool's tools (shared/phone-tools.ts PHONE_TOOLS), each with its words. */
const PHONE_TOOL_LABELS = new Set(["location", "contacts", "reminders", "calendar", "home", "alarms", "photos", "shortcut", "clipboard", "status"]);

function oneLine(text: string, max = TARGET_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function str(args: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!args) return undefined;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function basename(path: string): string {
  const clean = path.replace(/[/\\]+$/, "");
  return clean.split(/[/\\]/).pop() || clean;
}

function host(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** A UUID in a command token becomes "…". */
const COMMAND_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** One shell token as a short target piece: UUIDs become "…", a path keeps
 * only its last readable segment (`…/sagax-plugins` -> `sagax-plugins`). */
function shortCommandToken(token: string): string {
  const bare = token.replace(/^['"]|['"]$/g, "");
  if (!bare) return token;
  if (isOpaqueId(bare)) return "…";
  const masked = bare.replace(COMMAND_UUID, "…");
  if (!/[/\\]/.test(masked)) return masked === bare ? bare : masked;
  const parts = masked.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean);
  const last = [...parts].reverse().find((part) => part !== "…") ?? parts.at(-1) ?? masked;
  return last;
}

/** The quiet target for a shell step: the program and its first short
 * argument (`ls sagax-plugins`). The full command stays in `title` for the
 * tooltip and Copy. */
export function commandAim(command: string): { target: string; title: string } {
  const title = command.replace(/\s+/g, " ").trim();
  const line = command.split("\n", 1)[0]!.trim();
  const tokens = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (!tokens.length) return { target: oneLine(title), title: title || command };
  const program = shortCommandToken(tokens[0]!);
  let arg: string | undefined;
  for (const token of tokens.slice(1)) {
    const plain = token.replace(/^['"]|['"]$/g, "");
    if (plain.startsWith("-") && !/[/\\]/.test(plain)) continue;
    arg = shortCommandToken(token);
    break;
  }
  const target = oneLine(arg ? `${program} ${arg}` : program);
  return { target, title: title || command };
}

/** The bare name of one of Sagax's own tools, or undefined. */
function internalName(name: string): string | undefined {
  if (!INTERNAL.test(name)) return undefined;
  return name.replace(INTERNAL, "");
}

const HOST_VM_STEP: Record<string, LocaleKey> = {
  vm_provision: "step.hostVm.provision",
  vm_rebuild: "step.hostVm.rebuild",
  vm_delete: "step.hostVm.delete",
  vm_status: "step.hostVm.status",
  set_mode: "step.hostVm.mode",
  ask_mode: "step.hostVm.mode",
};

function isHostComputerTool(name: string): boolean {
  const internal = internalName(name);
  const bare = (internal ?? parseToolId(name).name ?? name).toLowerCase();
  return bare === "host_computer";
}

/** A call that hands work to a teammate bot (coordinate, ask, delegate, send to). */
export function isTeammateStep(name: string | undefined): boolean {
  if (!name) return false;
  const kind = kindOf(name);
  return kind === "coordinate" || kind === "ask" || kind === "delegate" || kind === "sendTo";
}

/** A teammate hand-off that failed, or a delivery the server could not make
 * (a failed send, a Full access answer the engine never got): shown even
 * with tool calls off, so the person sees why the teammate never answered
 * or why a question card expired (2026-11-09, #3288). */
export function isFailedTeammateStep(step: { kind?: string; tool?: { name?: string; ok?: boolean } }): boolean {
  if (step.kind !== "activity" || step.tool?.ok !== false) return false;
  return isTeammateStep(step.tool.name) || Boolean(step.tool.name && deliveryFailure(step.tool.name.trim()));
}

/** Delivery failures the server writes in English (server/index.ts report(),
 * server/index-leaves/finalizeDelegationWatch.ts,
 * server/runtime-events/request-opened-present.ts). Rows stored before #3288
 * carry a long dash where the server now writes a hyphen. */
const SEND_FAILED = /^Send failed [-–—] ([\s\S]+)$/;
const SEND_TO_DELETED = /^Send to (.+) failed [-–—] its thread was deleted( before it could start)?$/;
const FULL_ACCESS_UNDELIVERED = "Full access could not deliver the answer to the engine; retry the task after reconnecting.";

/** One of those rows in the person's language, with no dash: a failed
 * send's cause stays quiet after the label, in the app's language when it
 * is a known server line. */
function deliveryFailure(name: string): StepReading | undefined {
  let match = SEND_FAILED.exec(name);
  if (match) {
    const cause = localizedServerLine(match[1]!.trim());
    const target = oneLine(cause);
    return { label: t("step.sendFailed"), target, ...(target !== cause ? { title: cause } : {}) };
  }
  match = SEND_TO_DELETED.exec(name);
  if (match) return { label: t(match[2] ? "step.sendTo.deletedEarly" : "step.sendTo.deleted", { name: match[1]! }) };
  if (name === FULL_ACCESS_UNDELIVERED) return { label: t("step.fullAccess.undelivered") };
  return undefined;
}

function kindOf(name: string): Kind | undefined {
  const builtin = BUILTIN[name];
  if (builtin) return builtin;
  const internal = internalName(name);
  if (internal !== undefined) return BARE[internal.toLowerCase()];
  const parsed = parseToolId(name);
  if (parsed.server) return BARE[parsed.name.toLowerCase()];
  return BARE[name.toLowerCase()];
}

function names(ids: string[], nameOf?: StepNameOf): string {
  const shown = ids.map((id) => nameOf?.(id) ?? id).map((value) => value.replace(/^@/, ""));
  try {
    return new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(shown);
  } catch {
    return shown.join(", ");
  }
}

/** The teammates a coordination call names, as a readable list. Ids the
 * person would not recognise (no known name, opaque) read "teammates". */
function teammates(args: Record<string, unknown> | undefined, nameOf?: StepNameOf): string | undefined {
  const raw = args?.bot_ids ?? args?.botIds ?? args?.bot_id ?? args?.botId ?? args?.agent_id ?? args?.agent;
  const ids = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!ids.length) return undefined;
  const readable = ids.filter((id) => nameOf?.(id) || !/^[0-9a-f-]{12,}$/i.test(id));
  if (readable.length !== ids.length) return undefined;
  return names(ids, nameOf);
}

function kindLabel(kind: Kind, phase: StepPhase, args: Record<string, unknown> | undefined, nameOf?: StepNameOf): string {
  const tense = labelTense(phase);
  if (kind === "coordinate" || kind === "ask" || kind === "delegate" || kind === "sendTo") {
    const who = teammates(args, nameOf);
    if (who) return t(`step.${kind}.${tense}` as LocaleKey, { names: who });
    return t(`step.${kind}.bare.${tense}` as LocaleKey);
  }
  if (kind === "subagent") {
    const about = str(args, "description", "subagent_type");
    if (about) return t(`step.subagent.${tense}` as LocaleKey, { description: oneLine(about, 60) });
    return t(`step.subagent.bare.${tense}` as LocaleKey);
  }
  return t(`step.${kind}.${tense}` as LocaleKey);
}

/** What the step acted on: quiet target words, and an optional title when
 * the target is a shortened form of something longer (a shell command). */
function kindAim(kind: Kind, args: Record<string, unknown> | undefined, tool: StepTool): { target?: string; title?: string } {
  switch (kind) {
    case "readFile":
    case "writeFile":
    case "editFile":
    case "deleteFile":
    case "attachFile": {
      const path = str(args, "file_path", "path", "filePath", "notebook_path", "file", "filename");
      return path ? { target: basename(path) } : {};
    }
    case "runCommand": {
      const command = str(args, "command", "cmd", "script") ?? (tool.summary && tool.summary !== tool.name ? tool.summary : undefined);
      return command ? commandAim(command) : {};
    }
    case "searchFiles": {
      const target = oneLine(str(args, "pattern", "query", "glob", "regex") ?? "") || undefined;
      return target ? { target } : {};
    }
    case "searchWeb": {
      const target = oneLine(str(args, "query", "q", "search") ?? "") || undefined;
      return target ? { target } : {};
    }
    case "fetchPage":
    case "openPage": {
      const url = str(args, "url", "href", "uri");
      return url ? { target: host(url) } : {};
    }
    case "memorySearch":
    case "readConversations": {
      const target = oneLine(str(args, "query", "q") ?? "") || undefined;
      return target ? { target } : {};
    }
    case "phone": {
      const phone = str(args, "tool");
      return phone && PHONE_TOOL_LABELS.has(phone) ? { target: t(`step.phone.tool.${phone}` as LocaleKey) } : {};
    }
    case "postRoom":
    case "startThread": {
      const target = oneLine(str(args, "title", "room", "room_name", "user") ?? "") || undefined;
      return target ? { target } : {};
    }
    default:
      return {};
  }
}

function mcpLabel(tool: StepTool, phase: StepPhase): { label: string; target?: string } | undefined {
  const parsed = parseToolId(tool.name);
  if (!parsed.server) return undefined;
  const tense = labelTense(phase);
  // a gateway tool (`<gateway>__<product>__query`) reads as its product's
  // own, named as the server declared it (shared/approval-describe.ts)
  const declared = tool.product?.trim() || undefined;
  const hints: shared.ToolHints | undefined = declared || tool.productId ? { ...(declared ? { product: declared } : {}), ...(tool.productId ? { productId: tool.productId } : {}) } : undefined;
  const words: shared.ApprovalWords = {
    locale: activeLocale(),
    t: (key, vars) => {
      // the approval reads "view tickets"; a step reads "Viewed tickets"
      if (key.startsWith("approval.verb.")) return t(`step.verb.${key.slice("approval.verb.".length)}.${tense}` as LocaleKey, vars);
      if (key === "approval.tool.runCommand") return t(`step.runCommand.${tense}` as LocaleKey, vars);
      return t(key as LocaleKey, vars);
    },
  };
  const reading = shared.describeApproval(tool.name, tool.input ?? tool.summary, hints, new Date(), words);
  const internal = parsed.server.startsWith("sagax-");
  const product = declared ?? (internal ? undefined : reading.product);
  // A failed call names where it went, never the raw tool id: the verb the
  // reading guessed from its arguments may be what failed, and the id
  // (acme_api__query) stays in the opened row's detail.
  if (phase === "failed" && !internal) {
    return { label: t("step.use.failed", { name: product ?? serverName(parsed.server) }), target: reading.summary };
  }
  // A tool named for itself (flow, query) reads as the product it serves:
  // "Used Acme", not "Used query in Acme".
  if (!reading.action || reading.verbless) {
    const name = product ?? (reading.action ?? parsed.name).replace(/_+/g, " ").trim();
    return { label: capitalize(t(`step.use.${tense}` as LocaleKey, { name })), target: reading.summary };
  }
  const action = reading.action;
  const label = product ? t("approval.phrase.inProduct", { action, product }) : action;
  return { label: capitalize(label), target: reading.summary };
}

/** A server id as a person reads it: its product when one is known, else
 * its words titled (acme_api reads "Acme API"). Never the raw id. */
function serverName(server: string): string {
  return shared.productFor({ server, name: "" }).product ?? shared.titleCase(server);
}

/** pi-mcp-adapter's `mcp` gateway housekeeping, read as what it did. */
function gatewayLabel(call: Extract<McpGatewayCall, { kind: "admin" }>, phase: StepPhase): StepReading {
  const tense = labelTense(phase);
  if (call.action === "search") return { label: t(`step.mcp.search.${tense}` as LocaleKey), target: call.query ? oneLine(call.query) : undefined };
  if (call.server) return { label: t(`step.mcp.${call.action}.${tense}` as LocaleKey, { server: serverName(call.server) }) };
  return { label: t(`step.mcp.${call.action}.bare.${tense}` as LocaleKey) };
}

function capitalize(text: string): string {
  return text ? text[0]!.toLocaleUpperCase() + text.slice(1) : text;
}

export type StepReading = {
  /** the sentence: "Read a file", "Coordinated Wren and Olive" */
  label: string;
  /** what it acted on, quiet after the label: a file name, a short command */
  target?: string;
  /** the full target for the tooltip / Copy when `target` is shortened */
  title?: string;
};

/** A server line (restart, engine cause, server sentence) in the app's
 * language, for any surface that shows a stored tool name or failure cause
 * as text (task timeline, screen reader). Other words stay as they are. */
export function localizedServerLine(name: string): string {
  const delivery = deliveryFailure(name);
  if (delivery) {
    const cause = delivery.title ?? delivery.target;
    return cause ? t("step.sendFailed.cause", { cause }) : delivery.label;
  }
  return localizedEngineCause(name) ?? commSentence(name, "done") ?? serverSentence(name) ?? name;
}

/** A bot-to-bot receipt the server names in English (server/comms-visibility.ts
 * "Messaged @X", "Message from @X"; a person's "Messaged X"), said again from
 * the catalog in the tense of its state, so a failed send in a French chat
 * reads French (#3275). */
function commSentence(name: string, phase: StepPhase): string | undefined {
  let match = /^Message from @(.+)$/.exec(name);
  if (match) return t("step.messageFrom", { name: match[1]! });
  match = /^Messaged @?(.+)$/.exec(name);
  if (match) return t(labelTense(phase) === "failed" ? "step.messaged.failed" : "step.messaged.done", { name: match[1]! });
  return undefined;
}

/** Server rows written in English as a sentence (server/index.ts), read
 * again in the person's language. Unknown sentences stay as they are. */
function serverSentence(name: string): string | undefined {
  let match = /^Resumed with (.+) results( after a restart)?, reviewing$/.exec(name);
  if (match) {
    const who = match[1] === "delegated work" ? t("step.resumed.work") : names(match[1]!.split(/,\s*/));
    return t(match[2] ? "step.resumed.afterRestart" : "step.resumed", { names: who });
  }
  if (name === "Resuming after a restart") return t("step.resuming");
  const restart = restartSentence(name);
  if (restart) return restart;
  match = /^Sent to (.+?)(?: · (.+))?$/.exec(name);
  if (match) return match[2] ? t("step.sentToIn", { names: match[1]!, room: match[2] }) : t("step.sentTo", { names: match[1]! });
  match = /^Posted in (.+)$/.exec(name);
  if (match) return t("step.postedIn", { room: match[1]! });
  match = /^(.+) replied(?: · (.+))?$/.exec(name);
  if (match) return match[2] ? t("step.repliedIn", { name: match[1]!, room: match[2] }) : t("step.replied", { name: match[1]! });
  return undefined;
}

/** The loop guard's notice (server/host/loop-guard.ts), "Same call repeated
 * 5× - tool: git status - it may be stuck"; rows written before 2026-11-02
 * carry long dashes where it has hyphens, and a call quoted on several
 * lines (an ACP or Codex title, before the guard folded it to one). */
const STUCK_NOTICE = /^Same call repeated (\d+)× [-\u2013\u2014] ([\s\S]+) [-\u2013\u2014] it may be stuck$/;
/** The guard's word for a call it knows by its title, and an ACP agent's
 * kind for an MCP call: neither says anything to a person. */
const GENERIC_CALL = /^(?:tool|other): /;

/** That notice in the person's language, with no dash: the count in the
 * sentence, the call quiet after it. */
function stuckNotice(name: string): StepReading | undefined {
  const match = STUCK_NOTICE.exec(name);
  if (!match) return undefined;
  const call = match[2]!.replace(GENERIC_CALL, "").trim();
  return { label: t("step.stuck", { count: Number(match[1]) }), target: oneLine(call), title: call };
}

/** A stuck notice by its count and its call, whatever its dashes: servers
 * before 2026-11-02 wrote each one twice, once with long dashes, and the
 * same notice twice is one (src/lib/step-group.ts). */
export function stuckNoticeKey(name: string): string | undefined {
  const match = STUCK_NOTICE.exec(name.trim());
  return match ? `${match[1]} ${oneLine(match[2]!)}` : undefined;
}

/** Grok's meta tools, as rows stored before the driver named the tool a
 * use_tool ran (grok 1.0.62 titles them `use_tool` and `search_tool`, or
 * "Use Tool" and "Search Tool"): a use_tool reads as the MCP tool it ran,
 * a search_tool as looking for a tool, never "Used use tool". */
function grokMetaTool(tool: StepTool, phase: StepPhase): StepReading | undefined {
  const meta = tool.name.trim().toLowerCase().replace(/\s+/g, "_");
  const tense = labelTense(phase);
  if (meta === "search_tool") {
    const args = parseArgs(tool.input) ?? parseArgs(tool.summary);
    return { label: t(`step.toolSearch.${tense}` as LocaleKey), target: oneLine(str(args, "query", "q") ?? "") || undefined };
  }
  if (meta !== "use_tool") return undefined;
  const call = readUseToolCall(tool.input ?? tool.summary, { title: "use_tool" });
  const named = call ? mcpLabel({ ...tool, name: call.id, input: JSON.stringify(call.args), summary: undefined }, phase) : undefined;
  return named ?? { label: t(`step.useTool.${tense}` as LocaleKey) };
}

/** #3349 (L6): a call through the hub (call_connector) reads as the same
 * call made natively: the connector, the tool in words, and the account
 * the route answered with (from the result, never guessed). */
function connectorCallStep(tool: StepTool, phase: StepPhase): StepReading | undefined {
  const call = readConnectorCall(tool.name, tool.input ?? tool.summary, tool.output);
  if (!call) return undefined;
  const args = parseArgs(tool.input) ?? parseArgs(tool.summary);
  const inner = args?.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? JSON.stringify(args.arguments) : undefined;
  const id = call.tool.replace(/^mcp__/i, "");
  const server = call.connector.replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "") || "connector";
  const name = gatewayToolId(id) ?? (id.includes("__") ? id : `${server}__${id}`);
  const reading = mcpLabel({ ...tool, name: `mcp__${name}`, input: inner, summary: undefined, product: tool.product?.trim() || call.connector }, phase);
  const label = reading?.label ?? capitalize(t(`step.use.${labelTense(phase)}` as LocaleKey, { name: call.connector }));
  const summary = reading?.target;
  const target = call.account
    ? summary ? t("step.connectorCall.summaryAccount", { summary, account: call.account }) : t("step.connectorCall.account", { account: call.account })
    : summary;
  return { label, ...(target ? { target } : {}) };
}

/** True when the name is already a sentence (a server row), not a tool id. */
function isSentence(name: string): boolean {
  return /\s/.test(name.trim());
}

/** The words for one step. `nameOf` turns a teammate id into its name.
 * Pass `live: false` for a historical incomplete receipt (past tense). */
export function readStep(tool: StepTool, nameOf?: StepNameOf, live?: boolean): StepReading {
  // a gateway title without its gateway part (`user-Outlook-get_5fmail_5fmessage___12`)
  // reads as the connector it is, never "Get 5fmail 5fmessage" (2026-11-03)
  const gatewayId = gatewayToolId(tool.name);
  if (gatewayId && gatewayId !== tool.name.trim()) tool = { ...tool, name: gatewayId };
  const phase = stepPhase(tool, live);
  const name = tool.name.trim();
  const meta = grokMetaTool(tool, phase);
  if (meta) return meta;
  const stuck = stuckNotice(name);
  if (stuck) return stuck;
  const comm = commSentence(name, phase);
  if (comm) return { label: comm };
  const delivery = deliveryFailure(name);
  if (delivery) return delivery;
  const sentence = serverSentence(name);
  if (sentence) return { label: sentence };
  if (isSentence(name)) return { label: name };
  const hubCall = connectorCallStep(tool, phase);
  if (hubCall) return hubCall;
  // rows stored before the driver named the tool a gateway call ran
  const gateway = readMcpGatewayCall(name, tool.input ?? tool.summary);
  if (gateway?.kind === "admin") return gatewayLabel(gateway, phase);
  if (gateway?.kind === "tool") {
    const named = mcpLabel({ ...tool, name: gateway.id, input: JSON.stringify(gateway.args), summary: undefined }, phase);
    if (named) return named;
  }
  const args = parseArgs(tool.input) ?? parseArgs(tool.summary);
  // Bot computers (#2726, #2727): a host's shell reads as a command, its
  // screen as the screen, and its VM work as one compact provisioning line.
  if (isHostComputerTool(name)) {
    const action = typeof args?.action === "string" ? args.action : "";
    if (action === "exec") return { label: kindLabel("runCommand", phase, args, nameOf), ...kindAim("runCommand", args, tool) };
    if (action === "screenshot") return { label: kindLabel("screen", phase, args, nameOf) };
    const vmKey = HOST_VM_STEP[action];
    if (vmKey) return { label: t(vmKey) };
    return { label: kindLabel("computer", phase, args, nameOf) };
  }
  const kind = kindOf(name);
  if (kind) {
    const aim = kindAim(kind, args, tool);
    return { label: kindLabel(kind, phase, args, nameOf), ...aim };
  }
  const mcp = mcpLabel(tool, phase);
  if (mcp) return mcp;
  const display = name.replace(/_+/g, " ");
  const summary = tool.summary && tool.summary !== tool.name && !/^[[{]/.test(tool.summary.trim()) ? oneLine(tool.summary) : undefined;
  return { label: t(`step.use.${labelTense(phase)}` as LocaleKey, { name: display }), target: summary };
}

/** 2026-11-02: what a tool is called in an opened step, never its raw id
 * (`mcp__sagax-environment__list_files`): "List files" for the file,
 * command, page and screen tools, else its own name in words. The id stays
 * in the folded JSON record. */
const TOOL_NAME: Partial<Record<Kind, LocaleKey>> = {
  readFile: "step.toolName.readFile",
  writeFile: "step.toolName.writeFile",
  editFile: "step.toolName.editFile",
  deleteFile: "step.toolName.deleteFile",
  runCommand: "step.toolName.runCommand",
  searchFiles: "step.toolName.searchFiles",
  listFiles: "step.toolName.listFiles",
  searchWeb: "step.toolName.searchWeb",
  fetchPage: "step.toolName.fetchPage",
  openPage: "step.toolName.openPage",
  screen: "step.toolName.screen",
  computer: "step.toolName.computer",
};

export function stepToolName(tool: Pick<StepTool, "name" | "product">): string {
  const name = (tool.name ?? "").trim();
  const kind = kindOf(name);
  const key = kind ? TOOL_NAME[kind] : undefined;
  if (key) return t(key);
  // the tool's own part of an MCP id, in words: no server, no underscores,
  // no gateway escape or number (2026-11-03: "12"); with the product the
  // server declared for it, when it declared one (shared/tool-display-name.ts)
  return toolDisplayName(name, tool.product);
}

/** The label alone, for callers that only need the sentence. */
export function stepLabel(tool: StepTool, nameOf?: StepNameOf, live?: boolean): string {
  return readStep(tool, nameOf, live).label;
}

/** A quiet duration: "2s", "1m 05s"; under a second reads "<1s". */
export function stepDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1_000) return t("step.duration.underSecond");
  const total = Math.round(ms / 1_000);
  if (total < 60) return t("step.duration.seconds", { seconds: total });
  const minutes = Math.floor(total / 60);
  return t("step.duration.minutes", { minutes, seconds: String(total % 60).padStart(2, "0") });
}

const ARG_MAX = 6;

/** The arguments a person can read: a few `key: value` pairs, long values
 * cut, nested ones counted. The full JSON stays one click further. */
export function stepArgs(input: string | undefined, nameOf?: StepNameOf): Array<{ key: string; value: string; full?: string }> {
  const args = parseArgs(input);
  if (!args) return [];
  const pairs: Array<{ key: string; value: string; full?: string }> = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === "") continue;
    // An identifier a person cannot read (a GUID, a mail's message_id) reads
    // as "…": the value stays in the tooltip and the folded JSON record.
    if (typeof value === "string" && isOpaqueValue(value)) {
      pairs.push({ key, value: "…", full: value });
      if (pairs.length >= ARG_MAX) break;
      continue;
    }
    // 2026-11-02: a path with an id in it (/data/.../workspaces/<bot id>)
    // reads with the bot's name, else as the folder it is; the path as
    // written stays in the tooltip.
    const path = typeof value === "string" ? readablePath(value, nameOf) : undefined;
    if (path !== undefined) {
      pairs.push({ key, value: oneLine(path, 120), full: value as string });
      if (pairs.length >= ARG_MAX) break;
      continue;
    }
    let shown: string;
    if (typeof value === "string") shown = oneLine(value, 120);
    else if (typeof value === "number" || typeof value === "boolean") shown = String(value);
    else if (Array.isArray(value)) shown = value.every((entry) => typeof entry === "string" || typeof entry === "number")
      ? oneLine(value.join(", "), 120)
      : t("step.detail.items", { count: value.length });
    else shown = t("step.detail.fields", { count: Object.keys(value as object).length });
    pairs.push({ key, value: shown });
    if (pairs.length >= ARG_MAX) break;
  }
  return pairs;
}

/** A path whose segments hold an opaque id, as a person reads it: a known
 * bot's id becomes its name, any other id the folder it names or "…"
 * (short-path.ts humanPath). Undefined for a path with no id. */
function readablePath(value: string, nameOf?: StepNameOf): string | undefined {
  if (!/[\\/]/.test(value) || !value.split(/[\\/]/).some(isOpaqueId)) return undefined;
  const named = value.split(/([\\/])/).map((part) => (isOpaqueId(part) ? nameOf?.(part) ?? part : part)).join("");
  return humanPath(named);
}

/** The first lines of a result, enough to see what came back. */
export function stepResult(output: string | undefined, maxLines = 4, maxChars = 320): { text: string; cut: boolean } | undefined {
  if (!output?.trim()) return undefined;
  const trimmed = output.trim();
  const lines = trimmed.split("\n");
  let text = lines.slice(0, maxLines).join("\n");
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1).trimEnd()}…`;
  return { text, cut: text.length < trimmed.length };
}

/** The full technical record a person can copy: tool id, input, result. */
export function stepJson(tool: StepTool): string {
  const input = parseArgs(tool.input);
  let output: unknown = tool.output;
  try {
    if (tool.output && /^[[{]/.test(tool.output.trim())) output = JSON.parse(tool.output);
  } catch {
    // not JSON: kept as text
  }
  return JSON.stringify({ tool: tool.name, ok: tool.ok, input: input ?? tool.input ?? tool.summary, output }, null, 2);
}
