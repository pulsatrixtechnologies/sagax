// Plugin lifecycle hooks (parity D3, 2026-10-21).
//
// The ten events Grok's computer runs. Sagax keeps the hook commands out of
// the folder Claude loads with --plugin-dir, and runs them only on the bot's
// computer (sandbox, the person's PC, or this solo machine). Never in the
// Sagax server process, and never on an organization server's own host.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const LIFECYCLE_EVENTS = [
  "pre_compact",
  "subagent_start",
  "subagent_stop",
  "pre_tool_use",
  "post_tool_use",
  "post_tool_use_failure",
  "before_submit_prompt",
  "after_agent_response",
  "after_agent_thought",
  "stop",
] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

const FROM_CLAUDE: Record<string, LifecycleEvent> = {
  PreCompact: "pre_compact",
  SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop",
  PreToolUse: "pre_tool_use",
  PostToolUse: "post_tool_use",
  PostToolUseFailure: "post_tool_use_failure",
  UserPromptSubmit: "before_submit_prompt",
  AfterAgentResponse: "after_agent_response",
  AfterAgentThought: "after_agent_thought",
  Stop: "stop",
};

export type LifecycleHook = {
  event: LifecycleEvent;
  command: string;
  matcher?: string;
  timeoutMs: number;
};

export type CapturedHooks = {
  hooks: LifecycleHook[];
  files: Record<string, string>;
};

const EVENT_SET = new Set<string>(LIFECYCLE_EVENTS);
const FILE_OK = /^[A-Za-z0-9._/-]+$/;
const MAX_FILE = 64 * 1024;
const MAX_FILES = 20;
const MAX_COMMAND = 4_000;

export function lifecycleEvent(name: string): LifecycleEvent | null {
  if (EVENT_SET.has(name)) return name as LifecycleEvent;
  return FROM_CLAUDE[name] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pushHook(out: LifecycleHook[], event: LifecycleEvent, command: unknown, matcher: unknown, timeout: unknown): void {
  if (typeof command !== "string") return;
  const text = command.trim();
  if (!text || text.length > MAX_COMMAND || text.includes("\u0000")) return;
  const timeoutMs = typeof timeout === "number" && timeout >= 1 && timeout <= 30 ? Math.round(timeout * 1000) : 5_000;
  out.push({
    event,
    command: text,
    ...(typeof matcher === "string" && matcher.trim() ? { matcher: matcher.trim().slice(0, 200) } : {}),
    timeoutMs: Math.min(timeoutMs, 8_000),
  });
}

/** Claude's hooks.json, or the object a plugin.json `hooks` key holds. */
export function parseHookDocument(value: unknown): LifecycleHook[] {
  const root = asRecord(value);
  const block = asRecord(root?.hooks) ?? root;
  if (!block) return [];
  const out: LifecycleHook[] = [];
  for (const [name, entries] of Object.entries(block)) {
    const event = lifecycleEvent(name);
    if (!event || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      const row = asRecord(entry);
      if (!row) continue;
      const list = Array.isArray(row.hooks) ? row.hooks : [row];
      for (const hook of list) {
        const item = asRecord(hook);
        if (!item || item.type !== "command" && item.command === undefined) continue;
        if (item.type !== undefined && item.type !== "command") continue;
        pushHook(out, event, item.command, row.matcher, item.timeout);
      }
    }
  }
  return out.slice(0, 50);
}

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

function collectFiles(dir: string, out: Record<string, string>): void {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || Object.keys(out).length >= MAX_FILES) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { collectFiles(path, out); continue; }
    if (!entry.isFile()) continue;
    const rel = relative(dir, path).split(sep).join("/");
    if (!FILE_OK.test(rel) || rel.split("/").includes("..")) continue;
    try {
      const info = statSync(path);
      if (!info.isFile() || info.size > MAX_FILE) continue;
      out[rel] = readFileSync(path, "utf8");
    } catch { /* unreadable file stays out */ }
  }
}

/** Read hooks from a plugin folder before they are stripped. Does not run them. */
export function capturePluginHooks(pluginDir: string): CapturedHooks {
  const manifest = asRecord(readJson(join(pluginDir, ".claude-plugin", "plugin.json")));
  const declared = manifest?.hooks;
  let document: unknown = null;
  if (typeof declared === "string" && FILE_OK.test(declared.replace(/^\.\//, "")) && !declared.includes("..")) {
    document = readJson(join(pluginDir, declared.replace(/^\.\//, "")));
  } else if (asRecord(declared)) document = declared;
  if (!document) document = readJson(join(pluginDir, "hooks", "hooks.json"));
  const files: Record<string, string> = {};
  collectFiles(join(pluginDir, "hooks"), files);
  return { hooks: parseHookDocument(document), files };
}

export type HookTarget =
  | { kind: "refuse"; reason: "server" | "no_computer" }
  | { kind: "sandbox"; principal: string }
  | { kind: "desktop"; principal: string }
  | { kind: "pc" };

/** Where a hook may run for this turn. `host` on an organization server is
 * the Sagax machine, which is refused. `host` on a solo server is the bot's
 * own computer. */
export function chooseHookTarget(input: {
  identityKind: string;
  workplace: "host" | "user-sandbox" | "user-desktop" | "none" | null;
  principal: string | null;
}): HookTarget {
  if (input.identityKind === "perspicax") {
    if (input.workplace === "user-sandbox" && input.principal) return { kind: "sandbox", principal: input.principal };
    if (input.workplace === "user-desktop" && input.principal) return { kind: "desktop", principal: input.principal };
    return { kind: "refuse", reason: input.workplace === "none" || !input.principal ? "no_computer" : "server" };
  }
  if (input.workplace === "none") return { kind: "refuse", reason: "no_computer" };
  return { kind: "pc" };
}

/** Environment of a hook process on the solo machine. No Sagax token. */
export function scrubHookEnv(env: NodeJS.ProcessEnv, cwd: string, hookRoot?: string): Record<string, string> {
  return {
    PATH: env.PATH && !env.PATH.includes("\u0000") ? env.PATH : "/usr/bin:/bin",
    HOME: cwd,
    TMPDIR: env.TMPDIR && !env.TMPDIR.includes("\u0000") ? env.TMPDIR : "/tmp",
    LANG: env.LANG && !env.LANG.includes("\u0000") ? env.LANG : "C.UTF-8",
    ...(hookRoot ? { CLAUDE_PLUGIN_ROOT: hookRoot, HOOK_ROOT: hookRoot } : {}),
  };
}

function shSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** One shell line that writes hook files, then runs the command with the
 * event JSON on stdin. Used in a sandbox or on the desktop bridge, where
 * the plugin folder is not already on that machine. */
export function commandWithFiles(command: string, files: Record<string, string>, stdin: string, root = "/tmp/sagax-hooks"): string {
  const writes: string[] = [`mkdir -p ${shSingle(root)}`];
  for (const [name, body] of Object.entries(files)) {
    if (!FILE_OK.test(name) || name.split("/").includes("..")) continue;
    const dir = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
    if (dir) writes.push(`mkdir -p ${shSingle(`${root}/${dir}`)}`);
    const b64 = Buffer.from(body, "utf8").toString("base64");
    writes.push(`printf %s ${shSingle(b64)} | base64 -d > ${shSingle(`${root}/${name}`)}`);
  }
  const rewritten = command.replaceAll("${CLAUDE_PLUGIN_ROOT}", root).replaceAll("$CLAUDE_PLUGIN_ROOT", root);
  const b64 = Buffer.from(stdin, "utf8").toString("base64");
  return `${writes.join(" && ")} && printf %s ${shSingle(b64)} | base64 -d | /bin/sh -c ${shSingle(rewritten)}`;
}

export type HookRun = {
  command: string;
  stdin: string;
  timeoutMs: number;
  /** Files staged next to the command, relative names only. */
  files: Record<string, string>;
};

export function hookRuns(event: LifecycleEvent, hooks: readonly LifecycleHook[], toolName?: string): LifecycleHook[] {
  return hooks.filter((hook) => {
    if (hook.event !== event) return false;
    if (!hook.matcher) return true;
    if (!toolName) return false;
    return toolName === hook.matcher || toolName.startsWith(`${hook.matcher}:`);
  });
}

export type HookOutput = { stdout: string; code: number };

export type HookReport = {
  ran: boolean;
  reason?: "owner_off" | "no_hooks" | "server" | "no_computer" | "timeout";
  blocked: boolean;
  context: string;
};

/** Run the matching hooks through `exec`. `exec` is not called when the
 * target is the server or the owner left hooks off. */
export async function dispatchLifecycleHooks(input: {
  enabled: boolean;
  event: LifecycleEvent;
  hooks: readonly LifecycleHook[];
  target: HookTarget;
  payload: unknown;
  toolName?: string;
  files?: Record<string, string>;
  exec: (target: Exclude<HookTarget, { kind: "refuse" }>, run: HookRun) => Promise<HookOutput>;
}): Promise<HookReport> {
  if (!input.enabled) return { ran: false, reason: "owner_off", blocked: false, context: "" };
  const matched = hookRuns(input.event, input.hooks, input.toolName);
  if (!matched.length) return { ran: false, reason: "no_hooks", blocked: false, context: "" };
  if (input.target.kind === "refuse") return { ran: false, reason: input.target.reason, blocked: false, context: "" };
  const stdin = JSON.stringify(input.payload ?? {}).slice(0, 32_000);
  let blocked = false;
  const notes: string[] = [];
  for (const hook of matched) {
    let output: HookOutput;
    try {
      output = await input.exec(input.target, {
        command: hook.command,
        stdin,
        timeoutMs: hook.timeoutMs,
        files: input.files ?? {},
      });
    } catch {
      continue;
    }
    const parsed = parseHookOutput(output.stdout);
    if (parsed.decision === "deny" || parsed.decision === "block") blocked = true;
    if (parsed.reason) notes.push(parsed.reason.slice(0, 500));
    if (parsed.additionalContext) notes.push(parsed.additionalContext.slice(0, 2_000));
  }
  return { ran: true, blocked, context: notes.join("\n").slice(0, 4_000) };
}

export function parseHookOutput(stdout: string): { decision?: "allow" | "deny" | "block"; reason?: string; additionalContext?: string } {
  try {
    const value = JSON.parse(stdout) as { decision?: unknown; reason?: unknown; additionalContext?: unknown };
    const decision = value.decision === "allow" || value.decision === "deny" || value.decision === "block" ? value.decision : undefined;
    return {
      ...(decision ? { decision } : {}),
      ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
      ...(typeof value.additionalContext === "string" ? { additionalContext: value.additionalContext } : {}),
    };
  } catch {
    return {};
  }
}

/** Shell on the solo machine. The caller spawns it. Windows uses PowerShell. */
export function pcShell(platform: string, command: string): { file: string; args: string[] } {
  if (platform === "win32") return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", command] };
  return { file: "/bin/sh", args: ["-c", command] };
}
