// The tools a bot gets on the person's own computer through their desktop
// app ("sagax-desktop", server/desktop-bridge.ts): the solo-mode set (shell,
// files, search, fetch, browser, computer use, Local VM). Each call becomes
// one typed operation the desktop validates and runs locally; nothing here
// touches the Sagax server's own filesystem, processes or network.
//
// Never pre-allowed for any engine: every call rides the bot's approval mode
// (Ask shows a card per call), exactly as the engine's own tools do in solo.
import { localVmDesktopSpec } from "./computer/container-computer.ts";
import { cleanCommandVariables } from "./vault/credential-command-env.ts";
import type { DesktopBridgeOperation } from "./desktop-bridge.ts";
import { localVmComputerCall, localVmComputerCatalogText } from "./computer/local-vm-computer.ts";
import { boundToolResult, readOnHint, type BoundToolTextOptions } from "./tool-output-bound.ts";

const where = "on the computer of the person you are working for (their own PC, through their Sagax desktop app), like their own terminal";

export const DESKTOP_BRIDGE_TOOLS = [
  {
    name: "run_command",
    description: `Run a shell command ${where}: bash or zsh on macOS and Linux, PowerShell on Windows. Their files, apps, network and VPN are all reachable. Not the Sagax server.`,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command line." },
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
    description: `Create or replace a file ${where}. Missing folders are created.`,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" }, encoding: { type: "string", enum: ["utf8", "base64"] } },
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
    description: "List the computer-use tools of the person's screen (see windows, click, type). Use computer_use to call one.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "computer_use",
    description: "Call one computer-use tool on the person's own screen (from computer_list_tools): it acts in front of them. Only when they asked for work on their screen or in their own browser, or no out-of-sight way (browse, fetch_url, web search) works; say so in one line in the chat before the first call.",
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
export function desktopToolOperation(name: string, args: Record<string, unknown>): DesktopBridgeOperation {
  switch (name) {
    case "run_command":
      return { action: "run_command", command: str(args.command, "command"), cwd: optionalStr(args.cwd, "cwd"), timeout_seconds: optionalNumber(args.timeout_seconds, 1, 600) ?? 120 };
    case "read_file":
      return {
        action: "read_file", path: str(args.path, "path", 4096), offset: optionalNumber(args.offset, 0, 100 * 1024 * 1024),
        max_bytes: optionalNumber(args.max_bytes, 1, 1_000_000) ?? 256_000, encoding: args.encoding === "base64" ? "base64" : "utf8",
      };
    case "write_file": {
      if (typeof args.content !== "string") throw new Error("content must be a string");
      if (args.content.length > 1_400_000) throw new Error("content is larger than 1 MiB; write it in parts or generate it with run_command");
      return { action: "write_file", path: str(args.path, "path", 4096), content: args.content, encoding: args.encoding === "base64" ? "base64" : "utf8" };
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
      if (args.action === "run") return { action: "vm_run_command", command: str(args.command, "command"), ...(container ? { container } : {}), timeout_seconds: optionalNumber(args.timeout_seconds, 1, 600) ?? 120 };
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
  },
): Promise<unknown> {
  if (method === "tools/list") return { tools: DESKTOP_BRIDGE_TOOLS };
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
    try {
      const stale = (value: ToolResult) => value.isError === true && value.content[0]?.type === "text" && (value.content[0].text === "Invalid request" || value.content[0].text === "Unsupported operation");
      let result = desktopToolResult(await request(commandVariables.length ? { ...operation, env: Object.fromEntries(commandVariables) } : operation));
      // A desktop app from before command variables refuses the field before
      // running anything: the command runs without them, and the bot is told.
      if (commandVariables.length && stale(result)) {
        result = desktopToolResult(await request(operation));
        if (!stale(result)) result = { ...result, content: [...result.content, { type: "text", text: "The Sagax desktop app on this computer is too old to receive your command variables, so this command ran without them. Update the Sagax app." }] };
      }
      const staleDesktop = stale(result);
      // A desktop app from before Local VM creation refuses the operation.
      if (operation.action === "vm_create" && staleDesktop) {
        return text("The Sagax desktop app on this computer is too old to create a Local VM. Update it, or create the Local VM from its settings.", true);
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
