// Agents tool family: Shared computers, VM exec and remote sessions.
// Definitions and handlers. Assembled in order by agents-catalog.ts;
// dispatched by agents-call.ts. Never import server/index.ts.

import type { ToolCallContext, ToolCallResult } from "../agents-call-types.ts";
import { wrapUntrusted } from "../../../shared/safety-review.ts";
import type { Json } from "../agents-client.ts";

export const DEF_LIST_SHARED_COMPUTERS = {
    name: "list_shared_computers",
    description: "List online desktop computers explicitly shared with this workspace, and their allowed folders/capabilities. These are the user's computers, not this server. An offline or unshared computer cannot be accessed. Folder paths use opaque folder IDs and relative paths.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  };

export const DEF_SHARED_COMPUTER = {
    name: "shared_computer",
    description: "Use a desktop explicitly shared by the user. Discover computer_id and folder_id with list_shared_computers. list_files/read_file/write_file are confined to chosen folders; paths are relative. read_file returns sha256; overwriting requires expected_sha256. Binary files support base64 encoding. run_command requires a SEPARATE unrestricted terminal grant. computer_tools lists the native computer-control tools; computer_call invokes one with arguments and needs a SEPARATE computer-control grant. Never substitute the server's filesystem when this desktop is offline. read_copy reads the person's own stored copy of a lent folder or their Chrome reading list, which remains when the computer sleeps, and never another member's screen. Actions are not retried automatically; inspect an uncertain outcome before retrying.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      computer_id: { type: "string" }, action: { type: "string", enum: ["list_files", "read_file", "write_file", "run_command", "computer_tools", "computer_call", "read_copy"] },
      folder_id: { type: "string" }, path: { type: "string" }, content: { type: "string" }, encoding: { type: "string", enum: ["utf8", "base64"] }, expected_sha256: { type: "string" },
      command: { type: "string" }, tool_name: { type: "string" }, arguments: { type: "object", additionalProperties: true },
      kind: { type: "string", enum: ["chrome", "folder"] }, name: { type: "string" },
    }, required: ["computer_id", "action"] },
  };

export const DEF_VM_EXEC = {
    name: "vm_exec",
    description:
      "Run a shell command inside your own Local VM (as the desktop user, starting in /home/cua/workspace) and get its exit code, stdout and stderr back as text. Use this for all command-line work in the VM: pip install --user, running a script, generating or converting a file, checking that a file exists. Do not type commands into a terminal window and read screenshots: that is slow and unreliable. GUI programs you start appear on the VM desktop. For a long job raise timeout_seconds (default 60, at most 300). Only available while you have a Local VM desktop.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string", description: "The shell command to run, for example: python3 make_report.py && ls -l report.pdf" },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 300, description: "How long it may run before it is stopped. Default 60." },
      },
      required: ["command"],
    },
  };

export const DEF_PUBLISH_REMOTE_SESSION = {
    name: "publish_remote_session",
    description:
      "Post the connected Tailcat remote-support session into this chat. A session you opened with remote_support_open is posted by itself once remote_support_status says connected: call this only for a session a Flow skill opened, or to refresh the facts. Never pass an address, a key or a token: the tunnel is read from the session folder on this host. A later call with the same flow_session_id refreshes the card.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        flow_session_id: { type: "string", description: "12 lowercase hex id of the session folder." },
        code: { type: "string", description: "The 6-character support code." },
        os: { type: "string", enum: ["windows", "macos", "linux"] },
        rights: { type: "string", enum: ["standard", "elevated"] },
        end_at: { type: "string", description: "ISO-8601 end time, within a day." },
        hostname: { type: "string" },
        user: { type: "string" },
        model: { type: "string" },
        serial: { type: "string" },
        cpu: { type: "string" },
        ram: { type: "string" },
        disk: { type: "string" },
        os_name: { type: "string" },
      },
      required: ["flow_session_id", "code", "os", "rights", "end_at"],
    },
  };

export const DEF_REMOTE_SESSION_SNAPSHOT = {
    name: "remote_session_snapshot",
    description: "Read the connected Tailcat remote computer in one call: OS, uptime, CPU, memory, disks, top processes. No card.",
    inputSchema: { type: "object", additionalProperties: false, properties: { session: { type: "string", description: "Support code; default: this chat's session." } } },
  };

export const DEF_REMOTE_SESSION_EXEC = {
    name: "remote_session_exec",
    description: "Run one command on the connected Tailcat remote computer (sh on macOS/Linux, PowerShell on Windows); returns exit code and output. A read-only command runs at once, any other asks the person.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string", maxLength: 8000 },
        session: { type: "string", description: "Support code; default: this chat's session." },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 120 },
      },
      required: ["command"],
    },
  };

export const SHARED_COMPUTER_TOOL_NAMES = new Set(["list_shared_computers", "shared_computer"]);
export const COMPUTERS_TOOL_NAMES: ReadonlySet<string> = new Set(['list_shared_computers', 'shared_computer', 'vm_exec', 'publish_remote_session', 'remote_session_snapshot', 'remote_session_exec'] as const);

/** Handle a tool of this family, or return null when the name is not ours. */
export async function callComputersTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult | null> {
  const { api, apiResponse } = context.client;
  if (!COMPUTERS_TOOL_NAMES.has(name)) return null;
  if (name === "vm_exec") {
    const { ok, body } = await apiResponse("/api/internal/vm-exec", {
      method: "POST",
      body: JSON.stringify({ command: args.command, ...(typeof args.timeout_seconds === "number" ? { timeout_seconds: args.timeout_seconds } : {}) }),
    });
    if (!ok) return { text: String(body.error ?? "Could not run that command."), isError: true };
    const exitCode = Number(body.exitCode ?? 0);
    const stdout = String(body.stdout ?? "");
    const stderr = String(body.stderr ?? "");
    const lines = [body.timedOut ? "The command was stopped: it ran past its time limit." : `exit code ${exitCode}`];
    if (stdout) lines.push("--- stdout ---", stdout.replace(/\s+$/, ""));
    if (stderr) lines.push("--- stderr ---", stderr.replace(/\s+$/, ""));
    if (!stdout && !stderr && !body.timedOut) lines.push("(no output)");
    return { text: lines.join("\n"), ...(exitCode !== 0 || body.timedOut ? { isError: true } : {}) };
  }
  if (SHARED_COMPUTER_TOOL_NAMES.has(name) && !context.sharedComputers) {
    return { text: "Computer sharing is turned off in this workspace. There are no shared computers to use.", isError: true };
  }
  if (name === "list_shared_computers") {
    return { text: JSON.stringify(await api("/api/internal/shared-computers")) };
  }
  if (name === "shared_computer") {
    const response = await api("/api/internal/shared-computers", { method: "POST", body: JSON.stringify(args) });
    const result = response.result as Json;
    if (Array.isArray(result?.content)) return { text: "", passthrough: result };
    return { text: JSON.stringify(result) };
  }
  if (name === "publish_remote_session") {
    const banned = ["address", "nodekey", "node_key", "token", "key", "client_key"];
    if (banned.some((field) => Object.prototype.hasOwnProperty.call(args ?? {}, field))) {
      return { text: "Do not send a tunnel address or a key. publish_remote_session takes the session id, the code, the OS, the rights and the end time.", isError: true };
    }
    const published = await apiResponse("/api/internal/remote-sessions/publish", { method: "POST", body: JSON.stringify(args ?? {}) });
    const r = published.body;
    if (!published.ok || r.error) return { text: String(r.error ?? "The remote session card could not be posted."), isError: true };
    const host = typeof r.hostLabel === "string" && r.hostLabel.trim() ? r.hostLabel.trim() : "the remote computer";
    const reach = r.reachable === false
      ? " The tunnel folder is not on this server yet, so a shell and file transfer will wait until it is."
      : " The person can open a shell, send a file, or close the session from that card.";
    return { text: `A remote session card for ${host} is in the chat.${reach} Never repeat a tunnel address or a key.` };
  }
  if (name === "remote_session_exec" || name === "remote_session_snapshot") {
    const exec = name === "remote_session_exec";
    if (exec && (typeof args.command !== "string" || !args.command.trim())) return { text: "command: the command line to run on the remote computer.", isError: true };
    const body = {
      ...(typeof args.session === "string" && args.session.trim() ? { session: args.session.trim() } : {}),
      ...(exec ? { command: String(args.command) } : {}),
      ...(exec && typeof args.timeout_seconds === "number" ? { timeout_seconds: args.timeout_seconds } : {}),
    };
    const { ok, body: r } = await apiResponse(`/api/internal/remote-sessions/${exec ? "exec" : "snapshot"}`, { method: "POST", body: JSON.stringify(body) });
    if (!ok || r.error) return { text: String(r.error ?? "The remote computer did not run that command."), isError: true };
    const exitCode = Number(r.exitCode ?? 0);
    const stdout = String(r.stdout ?? "");
    const stderr = String(r.stderr ?? "");
    const lines = [`${String(r.host ?? "remote computer")} (${String(r.os ?? "")}): ${r.timedOut ? "stopped at its time limit" : `exit code ${exitCode}`}`];
    // the client's computer wrote this: data, never instructions (review of #965)
    if (stdout) lines.push(wrapUntrusted("remote stdout", stdout.replace(/\s+$/, "")));
    if (stderr) lines.push(wrapUntrusted("remote stderr", stderr.replace(/\s+$/, "")));
    if (!stdout && !stderr && !r.timedOut) lines.push("(no output)");
    return { text: lines.join("\n"), ...(exitCode !== 0 || r.timedOut ? { isError: true } : {}) };
  }
  return null;
}

