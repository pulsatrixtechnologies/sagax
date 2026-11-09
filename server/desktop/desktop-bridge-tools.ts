// The tools a bot gets on the person's own computer through their desktop
// app ("sagax-desktop", server/desktop/desktop-bridge.ts): the solo-mode set (shell,
// files, search, fetch, browser, computer use, Local VM). Each call becomes
// one typed operation the desktop validates and runs locally; nothing here
// touches the Sagax server's own filesystem, processes or network.
//
// Never pre-allowed for any engine: every call rides the bot's approval mode
// (Ask shows a card per call), exactly as the engine's own tools do in solo.
import { createHash } from "node:crypto";
import { localVmDesktopSpec } from "../computer/container-computer.ts";
import { cleanCommandVariables } from "../vault/credential-command-env.ts";
import { DESKTOP_BRIDGE_MESSAGES, type DesktopBridgeOperation } from "./desktop-bridge.ts";
import { localVmComputerCall, localVmComputerCatalogText } from "../computer/local-vm-computer.ts";
import { boundToolResult, readOnHint, type BoundToolTextOptions } from "../tools/tool-output-bound.ts";
import { MAC_APP_TOOLS, isMacAppTool, macAppOperation } from "../../electron/mac-apps.mjs";

const where = "on the computer of the person you are working for (their own PC, through their Sagax desktop app), like their own terminal";

export const DESKTOP_BRIDGE_TOOLS = [
  {
    name: "run_command",
    description: `Run a shell command ${where}: bash or zsh on macOS and Linux, PowerShell on Windows. Their files, apps, network and VPN are all reachable. Not the Sagax server.`,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command line. A script goes in plain text (a heredoc, or write_file then run it), never encoded: the person reads what runs." },
        cwd: { type: "string", description: "Working directory (default: their home folder). ~ is their home." },
        timeout_seconds: { type: "number", description: "Stop after this many seconds (default 120, at most 600)." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: `Read a file ${where}. Absolute paths, or ~/... for their home folder.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "number", description: "Byte offset to start at (default 0)." },
        max_bytes: { type: "number", description: "Default 256000, at most 1000000." },
        encoding: { type: "string", enum: ["utf8", "base64"], description: "base64 for a binary file." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description: `Create or replace a file ${where}. Missing folders are created. Send a script or any text as is, in plain text: it arrives byte for byte.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string", description: "The file's text as is. base64 only with encoding base64, for binary bytes." },
        encoding: { type: "string", enum: ["utf8", "base64"], description: "utf8 (default) for any text, a script included. base64 only for a binary file (image, archive)." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description: `List a folder ${where} (default: their home folder).`,
    inputSchema: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "search_files",
    description: `Search ${where}: file names matching a glob (glob, e.g. "*.md") and/or lines matching a regular expression (pattern), under a folder.`,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Folder to search (default: their home folder)." }, pattern: { type: "string" }, glob: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "fetch_url",
    description: `Fetch a URL from the person's computer (their network, VPN and intranet; requests leave from their IP). Returns the status, type and text.`,
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
  },
  {
    name: "browse",
    description: `Open a web page in a browser on the person's computer (their network) and return its rendered HTML, or a PNG screenshot. It runs out of sight: no window opens on their screen. Use it, fetch_url or web search for any lookup, then show the result in the chat.`,
    inputSchema: { type: "object", properties: { url: { type: "string" }, screenshot: { type: "boolean" } }, required: ["url"], additionalProperties: false },
  },
  {
    name: "computer_list_tools",
    description: "List the computer-use tools of the person's screen (see windows, point, click, type). Use computer_use to call one.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "computer_use",
    description: "Call one computer-use tool on the person's own screen (from computer_list_tools): it acts in front of them. Only when they asked for work on their screen or in their own browser, or no out-of-sight way (browse, fetch_url, web search) works; say so in one line in the chat before the first call. When they ask where something is or to show it on their screen (\"where is\", \"show me\", \"où est\", \"montre-moi\"), point at it: find it (get_window_state with a query, or a screenshot), call move_cursor with its x and y so the agent cursor glides onto it on their screen, then say where it is in one line. Never answer such a question in text only.",
    inputSchema: {
      type: "object",
      properties: { tool_name: { type: "string" }, arguments: { type: "object" } },
      required: ["tool_name"],
      additionalProperties: false,
    },
  },
  {
    name: "local_vm",
    description: "The person's Local VM (the Sagax Linux desktop container on their computer), never their own screen. action status lists it, start starts it, run runs a bash command inside it, create makes one when none exists (the person confirms it on their computer; the first time downloads and builds the desktop image, which takes several minutes; while it runs the conversation shows the bot's computer being set up, and the steps come back in this tool's result). action tools lists the screen tools. action use calls one of them (tool_name, arguments): screenshot or get_desktop_state returns the screen, get_screen_size, list_apps, click, move_cursor, drag, type_text, press_key, scroll.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "start", "run", "create", "tools", "use"] },
        command: { type: "string" },
        container: { type: "string", description: "Which Local VM, from status (default: the first one)." },
        timeout_seconds: { type: "number" },
        tool_name: { type: "string", description: "A screen tool from action tools. Used with action use." },
        arguments: { type: "object", description: "That screen tool's arguments. A screenshot takes none." },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
] as const;

export type DesktopBridgeToolName = (typeof DESKTOP_BRIDGE_TOOLS)[number]["name"];

type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ToolResult { content: ToolContent[]; isError?: boolean }

const text = (value: string, isError = false): ToolResult => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });
const str = (value: unknown, field: string, max = 100_000): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} must be a non-empty string`);
  return value;
};
const optionalStr = (value: unknown, field: string, max = 4096): string | undefined =>
  value === undefined ? undefined : str(value, field, max);
const optionalNumber = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : undefined;

/** The operation one tool call becomes. Throws on bad arguments. */
/** The text a base64 payload holds, or null when it is binary (#2740):
 * strict base64, valid UTF-8, no NUL and no other control byte than tab,
 * newline, carriage return and form feed. */
export function base64Text(content: string): string | null {
  const compact = content.replace(/\s+/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  const bytes = Buffer.from(compact, "base64");
  if (bytes.toString("base64") !== compact) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 0x7f || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d)) return null;
  }
  return text;
}

/** The decoders a blob can be piped into (#2774, extended #2823):
 * `base64` with a decode flag among its options (`-d`, `-D`, `--decode`,
 * `-di`, `-D -i -`), and `openssl base64|enc` with `-d` (`-A`, `-base64`,
 * `-a` allowed around it). */
const DECODER = String.raw`(?:base64|openssl\s+(?:base64|enc))(?:\s+(?:-{1,2}[A-Za-z][\w-]*|-))+`;
const BLOB = String.raw`([A-Za-z0-9+/]{16,}={0,2})`;
const BASE64_DECODE_IN_COMMAND = new RegExp(
  String.raw`(?:\b(?:echo|printf)(?:\s+-[neE]+)*(?:\s+(['"])%s\1)?\s+(['"]?)${BLOB}\2\s*\|\s*(${DECODER})(?![\w-])`
  + String.raw`|\b(${DECODER})\s*<<<\s*(['"]?)${BLOB}\6)`,
  "g",
);

/** What may follow a decoder that reads the blob: the end of the line, a
 * pipe, a list operator, a closing paren or backtick, or an output
 * redirection. Anything else is an operand or an input it reads instead. */
const DECODER_ENDS = /^\s*(?:$|[|;&)`]|\d*>)/;

/** True when the options of a matched decoder ask to decode: `base64`
 * with `-d`, `-D`, `--decode` or a short cluster holding d/D; `openssl`
 * with `-d` and a base64 mode (`base64`, or `enc` with `-base64`/`-a`). */
function decodes(decoder: string): boolean {
  const words = decoder.trim().split(/\s+/);
  if (words[0] === "openssl") {
    const flags = words.slice(2);
    if (!flags.includes("-d")) return false;
    if (!flags.every((flag) => ["-d", "-A", "-a", "-base64"].includes(flag))) return false;
    return words[1] === "base64" || flags.includes("-base64") || flags.includes("-a");
  }
  const flags = words.slice(1);
  if (!flags.every((flag) => flag === "-" || /^(?:-[dDiw0-9]+|--decode|--ignore-garbage|--wrap=\d+|-i)$/.test(flag))) return false;
  return flags.some((flag) => flag === "--decode" || /^-[A-Za-z0-9]*[dD]/.test(flag));
}

/** `b64decode('<blob>')` in a `python -c` program (also `base64.`,
 * `standard_`, `__import__('base64').`, a bytes blob and, #2823 follow-up,
 * the names an `import base64 as B` or `from base64 import b64decode as d`
 * gives them). A call reached through any other attribute (`x.b64decode`)
 * is not ours to rewrite: its prefix would be left in front of the literal
 * and break the program. */
const PYTHON_C = /\bpython(?:\d+(?:\.\d+)*)?\s+(?:-[A-Za-z]+\s+)*-c\s/;
const PY_NAME = String.raw`[A-Za-z_][A-Za-z0-9_]*`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The regex of the decode calls of one `python -c` line: module aliases
 * from `import base64 as X`, function aliases from `from base64 import
 * b64decode as d`. Every call must start a name (no `.` or word before). */
function pythonB64Decode(line: string): RegExp {
  const modules = new Set(["base64"]);
  for (const m of line.matchAll(new RegExp(String.raw`\bimport\s+[^;\n]*?\bbase64\s+as\s+(${PY_NAME})`, "g"))) modules.add(m[1]!);
  const functions = new Set(["b64decode", "standard_b64decode"]);
  for (const m of line.matchAll(new RegExp(String.raw`\bfrom\s+base64\s+import\s+([^;\n]*)`, "g"))) {
    for (const part of m[1]!.replace(/[()]/g, " ").split(",")) {
      const alias = /^\s*((?:standard_)?b64decode)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(part);
      if (alias) functions.add(alias[2]!);
    }
  }
  const moduleAlt = [...modules].map(escapeRegExp).join("|");
  const fnAlt = [...functions].map(escapeRegExp).join("|");
  return new RegExp(
    String.raw`(?<![\w.])(?:__import__\(\s*(['"])base64\1\s*\)\.(?:standard_)?b64decode|(?:${moduleAlt})\.(?:standard_)?b64decode|(?:${fnAlt}))\(\s*b?(['"])${BLOB}\2\s*\)`,
    "g",
  );
}

/** A Python string literal of `text`, delimited by `quote`, that holds no
 * quote, `$`, backtick or backslash other than its escapes, so it sits
 * unchanged in the shell quoting the original blob sat in. */
function pythonLiteral(text: string, quote: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (char === "\n") out += "\\n";
    else if (char === "\t") out += "\\t";
    else if (code >= 0x20 && code < 0x7f && !`'"$\`\\!`.includes(char)) out += char;
    else if (code <= 0xffff) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += `\\U${code.toString(16).padStart(8, "0")}`;
  }
  return `${quote}${out}${quote}`;
}

/** A command with every base64 script it decodes turned back into the text
 * it is (#2774): the blob and its decoder become a quoted heredoc that
 * prints the same text, and a `b64decode('<blob>')` of a `python -c`
 * program becomes the same bytes as a readable literal, so the person, the
 * audit and the guard read the script. Binary bytes, and a blob inside a
 * multi-line command, stay as is. */
export function plainTextCommand(command: string): string {
  if (command.includes("\n")) return command;
  let line = command;
  if (PYTHON_C.test(line)) {
    line = line.replace(pythonB64Decode(line), (match, _q1, quote, blob) => {
      const decoded = base64Text(String(blob));
      return decoded === null ? match : `${pythonLiteral(decoded, String(quote))}.encode()`;
    });
  }
  const bodies: string[] = [];
  const rewritten = line.replace(BASE64_DECODE_IN_COMMAND, (match, _q1, _q2, piped, pipedDecoder, hereDecoder, _q6, herestring, offset: number) => {
    if (!decodes(String(pipedDecoder ?? hereDecoder ?? ""))) return match;
    // An operand after the decoder (`-i file` on macOS, `-w 0`, a file
    // name, `< file`) changes what it reads: only a decoder that ends its
    // command reads the blob, so only that one becomes a heredoc.
    if (!DECODER_ENDS.test(line.slice(offset + match.length))) return match;
    const decoded = base64Text(String(piped ?? herestring ?? ""));
    if (decoded === null || decoded.includes("\r")) return match;
    let tag = `SAGAX_PLAIN_${bodies.length + 1}`;
    while (decoded.split("\n").includes(tag)) tag += "_";
    bodies.push(`${decoded}${decoded.endsWith("\n") || decoded === "" ? "" : "\n"}${tag}`);
    return `cat <<'${tag}'`;
  });
  return bodies.length ? `${rewritten}\n${bodies.join("\n")}` : rewritten;
}

export function desktopToolOperation(name: string, args: Record<string, unknown>): DesktopBridgeOperation {
  // The Apple apps of the person's Mac: validated and bounded here, again on the desktop.
  if (isMacAppTool(name)) return { action: "mac_app", tool_name: name, arguments: macAppOperation(name, args) };
  switch (name) {
    case "run_command":
      // #2774: a script sent in base64 runs as the text it is.
      return { action: "run_command", command: plainTextCommand(str(args.command, "command")), cwd: optionalStr(args.cwd, "cwd"), timeout_seconds: optionalNumber(args.timeout_seconds, 1, 600) ?? 120 };
    case "read_file":
      return {
        action: "read_file", path: str(args.path, "path", 4096), offset: optionalNumber(args.offset, 0, 100 * 1024 * 1024),
        max_bytes: optionalNumber(args.max_bytes, 1, 1_000_000) ?? 256_000, encoding: args.encoding === "base64" ? "base64" : "utf8",
      };
    case "write_file": {
      if (typeof args.content !== "string") throw new Error("content must be a string");
      if (args.content.length > 1_400_000) throw new Error("content is larger than 1 MiB; write it in parts or generate it with run_command");
      const path = str(args.path, "path", 4096);
      if (args.encoding !== "base64") return { action: "write_file", path, content: args.content, encoding: "utf8" };
      // #2740: a script sent in base64 is written as the text it is, so the
      // audit, the guard and the person see the script, not an encoded blob.
      const text = base64Text(args.content);
      return text === null ? { action: "write_file", path, content: args.content, encoding: "base64" } : { action: "write_file", path, content: text, encoding: "utf8" };
    }
    case "list_files":
      return { action: "list_files", path: optionalStr(args.path, "path") };
    case "search_files": {
      const pattern = optionalStr(args.pattern, "pattern", 1000);
      const glob = optionalStr(args.glob, "glob", 400);
      if (!pattern && !glob) throw new Error("give a glob, a pattern, or both");
      return { action: "search_files", path: optionalStr(args.path, "path"), pattern, glob };
    }
    case "fetch_url":
      return { action: "fetch_url", url: webUrl(args.url) };
    case "browse":
      return { action: "browse", url: webUrl(args.url), screenshot: args.screenshot === true };
    case "computer_list_tools":
      return { action: "computer_tools" };
    case "computer_use": {
      const toolArgs = args.arguments;
      if (toolArgs !== undefined && (!toolArgs || typeof toolArgs !== "object" || Array.isArray(toolArgs))) throw new Error("arguments must be an object");
      return { action: "computer_call", tool_name: str(args.tool_name, "tool_name", 100), ...(toolArgs ? { arguments: toolArgs as Record<string, unknown> } : {}) };
    }
    case "local_vm": {
      const container = optionalStr(args.container, "container", 200);
      if (args.action === "status") return { action: "vm_status" };
      if (args.action === "start") return { action: "vm_start", ...(container ? { container } : {}) };
      if (args.action === "run") return { action: "vm_run_command", command: plainTextCommand(str(args.command, "command")), ...(container ? { container } : {}), timeout_seconds: optionalNumber(args.timeout_seconds, 1, 600) ?? 120 };
      // Waits up to ten minutes; a creation that takes longer keeps going on
      // the computer and status says where it is.
      if (args.action === "create") return { action: "vm_create", arguments: { spec: localVmDesktopSpec() }, timeout_seconds: 600 };
      if (args.action === "tools") throw new Error("action tools is answered by the server");
      if (args.action === "use") {
        const toolArgs = args.arguments;
        if (toolArgs !== undefined && (!toolArgs || typeof toolArgs !== "object" || Array.isArray(toolArgs))) throw new Error("arguments must be an object");
        const checked = localVmComputerCall(str(args.tool_name, "tool_name", 100), toolArgs ?? {});
        if ("error" in checked) throw new Error(checked.error);
        return { action: "vm_computer_call", tool_name: checked.tool, arguments: checked.arguments, timeout_seconds: 60 };
      }
      throw new Error("action must be status, start, run, create, tools or use");
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

/** http(s) only, no credentials in the URL. Private and intranet addresses
 * are allowed on purpose: this runs on the person's own computer. */
export function webUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("url must be an http or https address");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("url must be an http or https address");
  if (url.username || url.password) throw new Error("url must not carry credentials");
  return url.href;
}

/** What the model reads of a desktop answer (tool-output-bound.ts): a
 * command's output, a text file, a search or a page is cut to a size the
 * conversation can keep; a base64 file must stay whole to decode, and a
 * screen or tool catalog is no machine dump. Optional `hold` saves the
 * full text so the cut marker can name tool_result_read (TST-02). */
export function boundDesktopResult(operation: DesktopBridgeOperation, result: ToolResult, hold?: BoundToolTextOptions["hold"]): ToolResult {
  const bound = (hint?: string) => boundToolResult(result, { ...(hint ? { hint } : {}), ...(hold ? { hold } : {}) });
  switch (operation.action) {
    case "read_file":
      return operation.encoding === "base64" ? result : bound(readOnHint());
    case "run_command": case "vm_run_command": case "search_files": case "list_files": case "fetch_url": case "browse":
      return bound();
    default:
      return result;
  }
}

/** Keep only a well-formed MCP tool result from the desktop. */
/** What a mac_* call says when the person's Mac is not connected: the tool
 * stays listed, and the bot can tell the person why nothing ran. */
export const MAC_OFFLINE_MESSAGE = "Your Mac is offline: the Sagax app on your Mac is not connected to this server right now. Open the Sagax app on your Mac, signed in to this server, then try again. Nothing was done.";

/** One Apple app tool (mac_*) run on the person's Mac through their desktop
 * app (organization server). Never throws: offline, a stale desktop app or a
 * refusal comes back as an error result the bot can read. */
export async function relayMacAppCall(
  request: (operation: DesktopBridgeOperation) => Promise<unknown>,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  let operation: DesktopBridgeOperation;
  try { operation = desktopToolOperation(tool, args); } catch (error) { return text(error instanceof Error ? error.message : String(error), true); }
  if (operation.action !== "mac_app") return text(`Unknown tool: ${tool}`, true);
  try {
    const result = desktopToolResult(await request(operation));
    const first = result.content[0];
    if (result.isError === true && first?.type === "text" && (first.text === "Invalid request" || first.text === "Unsupported operation")) {
      return text("The Sagax app on your Mac is too old to use its Apple apps. Update the Sagax app on your Mac.", true);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: unknown }).code;
    if (message === DESKTOP_BRIDGE_MESSAGES.offline || message === DESKTOP_BRIDGE_MESSAGES.chosenOffline || code === "not_connected") return text(MAC_OFFLINE_MESSAGE, true);
    if (message === DESKTOP_BRIDGE_MESSAGES.capability) return text("The Sagax app connected for you is not on a Mac that offers its Apple apps, or it is too old. Open the Sagax app on your Mac, updated, signed in to this server.", true);
    return text(message, true);
  }
}

export function desktopToolResult(value: unknown): ToolResult {
  const result = value as { content?: unknown; isError?: unknown } | null;
  if (!result || !Array.isArray(result.content)) return text("Your computer answered with something unexpected.", true);
  const content: ToolContent[] = [];
  for (const item of result.content.slice(0, 20)) {
    const entry = item as Record<string, unknown> | null;
    if (entry?.type === "text" && typeof entry.text === "string") content.push({ type: "text", text: entry.text });
    else if (entry?.type === "image" && typeof entry.data === "string" && typeof entry.mimeType === "string" && /^image\/(png|jpeg|webp|gif)$/.test(entry.mimeType)) {
      content.push({ type: "image", data: entry.data, mimeType: entry.mimeType });
    }
  }
  if (!content.length) content.push({ type: "text", text: "" });
  return { content, ...(result.isError === true ? { isError: true } : {}) };
}

/** #2828: the operations that carry the asking bot's temporary folder. */
const TMP_SCOPED_ACTIONS: ReadonlySet<string> = new Set(["run_command", "read_file", "write_file", "list_files", "search_files", "vm_run_command"]);

/** The asking bot's temporary folder name on the desktop and in the Local
 * VM (#2828): a short hash of the bot, so its id never shows on the computer. */
export function botTmpScope(botId: string): string {
  return createHash("sha256").update(`sagax-bot-tmp:${botId}`).digest("hex").slice(0, 16);
}

/** One JSON-RPC MCP request from the proxy (tools/list or tools/call). */
export async function handleDesktopBridgeMcp(
  method: string,
  params: unknown,
  request: (operation: DesktopBridgeOperation) => Promise<unknown>,
  options?: {
    commandRefusal?: (command: string) => string | null;
    payloadRefusal?: (text: string) => string | null;
    /** The command variables the person exposed to this bot, read for this
     * command (server/vault/credential-command-env.ts). Added after the refusal
     * checks, which never see a value. */
    commandVariables?: () => Record<string, string>;
    /** Save a cut's full text for tool_result_read (TST-02). */
    hold?: BoundToolTextOptions["hold"];
    /** The person's desktop is a Mac that offers its Apple apps (mac_*). */
    macApps?: () => boolean;
    /** #2828: the asking bot's temporary folder scope (botTmpScope). */
    tmpScope?: () => string | null;
  },
): Promise<unknown> {
  if (method === "tools/list") {
    if (!options?.macApps?.()) return { tools: DESKTOP_BRIDGE_TOOLS };
    return { tools: [...DESKTOP_BRIDGE_TOOLS, ...MAC_APP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))] };
  }
  if (method === "tools/call") {
    const call = (params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof call.name !== "string") throw Object.assign(new Error("tools/call needs a tool name"), { status: 400 });
    const args = call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? call.arguments as Record<string, unknown> : {};
    // The screen catalog is fixed. Answering it here keeps a closed desktop
    // from hiding the tools, and sends nothing to the computer.
    if (call.name === "local_vm" && args.action === "tools") return text(localVmComputerCatalogText());
    let operation: DesktopBridgeOperation;
    try { operation = desktopToolOperation(call.name, args); } catch (error) { return text(error instanceof Error ? error.message : String(error), true); }
    if ((operation.action === "run_command" || operation.action === "vm_run_command") && operation.command) {
      const refusal = options?.commandRefusal?.(operation.command);
      if (refusal) return text(refusal, true);
    }
    const payloadRefusal = options?.payloadRefusal?.(JSON.stringify(operation));
    if (payloadRefusal) return text(payloadRefusal, true);
    const commandVariables = operation.action === "run_command" || operation.action === "vm_run_command"
      ? cleanCommandVariables(options?.commandVariables?.()) : [];
    const scope = TMP_SCOPED_ACTIONS.has(operation.action) ? options?.tmpScope?.() ?? null : null;
    const extras = {
      ...(commandVariables.length ? { env: Object.fromEntries(commandVariables) } : {}),
      ...(scope && /^[a-f0-9]{16}$/.test(scope) ? { tmp_scope: scope } : {}),
    };
    try {
      const stale = (value: ToolResult) => value.isError === true && value.content[0]?.type === "text" && (value.content[0].text === "Invalid request" || value.content[0].text === "Unsupported operation");
      let result = desktopToolResult(await request(Object.keys(extras).length ? { ...operation, ...extras } : operation));
      // A desktop app from before command variables (or the bots' own
      // temporary folders, #2828) refuses the field before running anything:
      // the operation runs without them, and the bot is told of the variables.
      if (Object.keys(extras).length && stale(result)) {
        result = desktopToolResult(await request(operation));
        if (commandVariables.length && !stale(result)) result = { ...result, content: [...result.content, { type: "text", text: "The Sagax desktop app on this computer is too old to receive your command variables, so this command ran without them. Update the Sagax app." }] };
      }
      const staleDesktop = stale(result);
      // A desktop app from before Local VM creation refuses the operation.
      if (operation.action === "vm_create" && staleDesktop) {
        return text("The Sagax desktop app on this computer is too old to create a Local VM. Update it, or create the Local VM from its settings.", true);
      }
      if (operation.action === "mac_app" && staleDesktop) {
        return text("The Sagax desktop app on this computer is too old to use its Apple apps. Update the Sagax app.", true);
      }
      if (operation.action === "vm_computer_call" && staleDesktop) {
        return text("The Sagax desktop app on this computer is too old to control the Local VM screen. Update the Sagax app.", true);
      }
      return boundDesktopResult(operation, result, options?.hold);
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true);
    }
  }
  throw Object.assign(new Error("method not found"), { status: 404 });
}
