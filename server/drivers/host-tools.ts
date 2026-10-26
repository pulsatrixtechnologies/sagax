// The engines' own tools that act on THIS machine. On an organization server
// the machine is the Sagax server (a container), never anyone's computer, so
// a turn withholds them (SendTurnInput.withholdHostTools) and shell and files
// go through the person's server environment instead
// (server/user-sandbox-tools.ts, docs/user-sandbox.md).
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { allowsTool, parseToolScope } from "../../shared/tool-scope.ts";
import { DATA_DIR } from "../config.ts";

/** A policy file Sagax owns for withheld turns (a system settings file, a
 * config an engine reads through an environment variable). Written under
 * the data directory, never in a person's home, rewritten only on change. */
export function writeEnginePolicy(name: string, content: string): string {
  const dir = join(DATA_DIR, "engine-policies");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, name);
  let current: string | null = null;
  try { current = readFileSync(path, "utf8"); } catch { current = null; }
  if (current !== content) writeFileSync(path, content, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  return path;
}

/** Claude Code built-ins that run commands, read or write local files, or
 * fetch URLs from this machine (which could reach internal services).
 * Passed to --disallowedTools: deny rules, so they hold for subagents too.
 * Names an older or newer CLI lacks are ignored by the CLI. */
export const CLAUDE_HOST_TOOLS: readonly string[] = [
  "Bash", "BashOutput", "KillShell", "KillBash", "PowerShell", "Monitor",
  "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "NotebookRead",
  "Glob", "Grep", "LS", "WebFetch",
  // git worktrees and local scripted workflows also act on this machine
  "EnterWorktree", "ExitWorktree", "Workflow", "DesignSync",
];

/** Claude Code built-ins a Sagax turn never uses, removed from every turn
 * (2026-10-19 perf parity: about 4,000 prompt tokens a turn). Each one
 * either duplicates a Sagax feature the bot must use instead (Cron* and
 * ScheduleWakeup: routines; ListAgents: the agents tools, which it shadows;
 * PushNotification: Sagax notifications) or reaches a claude.ai service the
 * Sagax turn is not part of (RemoteTrigger, PublishPlugin,
 * ShareOnboardingGuide, DesignSync, ReportFindings). Names an older or newer
 * CLI lacks are ignored by the CLI. */
export const CLAUDE_UNUSED_TOOLS: readonly string[] = [
  "CronCreate", "CronDelete", "CronList", "ScheduleWakeup", "ListAgents", "PushNotification",
  "RemoteTrigger", "PublishPlugin", "ShareOnboardingGuide", "DesignSync", "ReportFindings",
];

/** Claude Code commands that only drive the tools above (/loop schedules a
 * wakeup or a cron, /schedule a remote trigger): hidden from the command
 * list, since a Sagax turn could not run them. Sagax routines do this. */
export const CLAUDE_UNUSED_COMMANDS: ReadonlySet<string> = new Set(["loop", "schedule"]);

/** `explicitTools`: the turn already names its built-ins (--tools), so the
 * unused ones are off without a deny rule. */
export function claudeDisallowedTools(configured: readonly string[] | undefined, withhold: boolean, explicitTools = false): string[] {
  const merged = new Set(configured ?? []);
  if (!explicitTools) for (const tool of CLAUDE_UNUSED_TOOLS) merged.add(tool);
  if (withhold) for (const tool of CLAUDE_HOST_TOOLS) merged.add(tool);
  return [...merged];
}

/** Codex app-server flags removing its shell (classic and unified exec) and
 * local image viewer. apply_patch has no switch: a read-only sandbox plus a
 * declined approval (codexHostToolDecision) stops it. */
export function codexHostToolArgs(withhold: boolean): string[] {
  return withhold
    ? [
        "-c", "features.shell_tool=false",
        "-c", "features.unified_exec=false",
        "-c", "features.shell_snapshot=false",
        "-c", "features.view_image=false",
        "-c", 'sandbox_mode="read-only"',
      ]
    : [];
}

/** Codex server requests that would act on this machine. Declined outright
 * when host tools are withheld, before any card or auto-accept. */
export function codexHostToolRequest(method: string): boolean {
  return method === "execCommandApproval" || method === "applyPatchApproval" ||
    method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval";
}

/** Grok Build tools that act on this machine, as `grok agent stdio` advertised
 * them on 1.0.46, plus the older names `--deny` and headless mode still use.
 * `search_tool` and `use_tool` stay: they only reach Sagax MCP servers. */
export const GROK_HOST_TOOL_NAMES: readonly string[] = [
  "run_terminal_command", "run_terminal_cmd", "bash",
  "read_file", "search_replace", "write", "list_dir",
  "grep", "grep_search",
  "kill_command_or_subagent", "todo_write",
  "get_command_or_subagent_output", "spawn_subagent", "task",
  "scheduler_create", "scheduler_delete", "scheduler_list",
  "monitor", "workflow",
  "enter_plan_mode", "exit_plan_mode",
  "ask_user_question", "send_feedback",
  "web_search", "web_fetch",
  "image_gen", "image_edit", "image_to_video", "reference_to_video",
];

/** The only Grok tools an organization turn may keep. */
export const GROK_MCP_TOOLS: readonly string[] = ["search_tool", "use_tool"];

/** Permission classes `--deny` still gates. On `grok agent stdio` these do
 * not remove tools from the advertised list (verified 1.0.46); the ACP
 * profile does. They stay so a leader or a newer CLI cannot loosen the turn. */
const GROK_DENY_CLASSES = ["Bash", "Read", "Edit", "Write", "Grep", "WebFetch", "WebSearch"] as const;

/** Global `grok` flags for a withheld turn. `--tools` and `--disallowed-tools`
 * are ignored in `agent stdio` (headless only). `--sandbox` is not used:
 * its child-network block would cut off the person's MCP tools. */
export function grokHostToolArgs(withhold: boolean): string[] {
  if (!withhold) return [];
  return [
    "--no-subagents",
    "--disable-web-search",
    ...GROK_DENY_CLASSES.flatMap((name) => ["--deny", name]),
  ];
}

export interface GrokOrgAgentProfile {
  name: string;
  description: string;
  injectDefaultTools: false;
  tools: string[];
  disallowedTools: string[];
}

/** ACP `session/new` profile that leaves Grok with Sagax MCP tools only.
 * Verified on grok 1.0.46 `agent stdio`: `available_commands_update` then
 * lists `search_tool` and `use_tool` and nothing else. No `toolConfig`
 * ids, so it does not depend on the 1.0.41 registry pin. */
export function grokOrgAgentProfile(scope: unknown, hasMcp: boolean): GrokOrgAgentProfile {
  const parsed = parseToolScope(scope);
  if (!parsed.ok) throw new Error(parsed.error);
  const tools = GROK_MCP_TOOLS.filter((name) => allowsTool(scope, { kind: "native", name }));
  if (tools.length !== GROK_MCP_TOOLS.length) {
    throw new Error(hasMcp
      ? "Grok requires native:search_tool and native:use_tool to find and call selected MCP tools. Allow both explicitly or use Pi."
      : "Grok on an organization server keeps only its MCP tools. Allow native:search_tool and native:use_tool, or clear the tool selection.");
  }
  return {
    name: "sagax-org",
    description: "Sagax MCP tools only. Host shell, files and web stay off.",
    injectDefaultTools: false,
    tools: [...tools],
    disallowedTools: [...GROK_HOST_TOOL_NAMES],
  };
}

/** pi 0.87.1 built-ins (`createAllTools`). `--no-builtin-tools` empties the
 * active set; `--exclude-tools` keeps an extension from turning them back
 * on; `--no-extensions` drops whatever the person's pi directory adds.
 * An explicit `-e` (the Sagax MCP extension) still loads. */
export const PI_HOST_TOOLS: readonly string[] = [
  "read", "bash", "powershell", "edit", "write", "grep", "find", "ls",
];

export function piHostToolArgs(withhold: boolean): string[] {
  if (!withhold) return [];
  return ["--no-builtin-tools", "--exclude-tools", PI_HOST_TOOLS.join(","), "--no-extensions"];
}

/** Sagax MCP tools a withheld turn may still call. A title that merely
 * starts with "mcp" is not one of them. */
const SAGAX_MCP_TITLE = /^mcp__(?:agents|browser|computer)(?:__|$)/i;

/** An ACP `session/request_permission` that would act on this machine.
 * A command, a file change, a move or a delete is declined whatever its
 * title. A read or a fetch is declined unless the title is one of Sagax's
 * own MCP tools. Declined outright on a withheld turn (acp/core.ts). */
export function acpHostToolRequest(toolCall: { kind?: unknown; title?: unknown }): boolean {
  const kind = String(toolCall.kind ?? "");
  if (["execute", "edit", "delete", "move"].includes(kind)) return true;
  if (kind === "read" || kind === "fetch") return !SAGAX_MCP_TITLE.test(String(toolCall.title ?? ""));
  return false;
}

/** The approval parameters of a withheld Codex turn: read-only, asking (so
 * every write or command becomes a request the driver declines). */
export const CODEX_WITHHELD_APPROVAL = {
  thread: { approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "read-only" },
  turn: { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" } },
} as const;

/** A withheld Codex turn in Full access: Codex never asks (`never`) and its
 * own sandbox stays read-only, so nothing runs or writes on the Sagax server
 * (the target there is the person's environment or desktop, reached through
 * Sagax's MCP tools, which Full lets through without a prompt). */
export const CODEX_WITHHELD_FULL_APPROVAL = {
  thread: { approvalPolicy: "never", approvalsReviewer: "user", sandbox: "read-only" },
  turn: { approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" } },
} as const;

/** The folder a withheld turn of an engine that reads workspace files runs
 * in: empty, owned by Sagax. Without file tools the engine needs no folder
 * of the person's, and a `.gemini/` or `.qwen/` file in the turn's folder
 * could otherwise declare a hook or an MCP server, both commands run here. */
export function withheldWorkspace(): string {
  const dir = join(DATA_DIR, "engine-policies", "workspace");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** The MCP server names Sagax passes an ACP engine for a turn (the same
 * names as acp/core.ts mcpServersFor, before a tool scope filter). */
export function sagaxMcpServerNames(integrations: {
  agents?: unknown; browser?: unknown; localComputer?: unknown; custom?: Record<string, unknown>;
} | undefined): string[] {
  const names = [
    ...(integrations?.agents ? ["agents"] : []),
    ...(integrations?.browser ? ["browser"] : []), ...(integrations?.localComputer ? ["computer"] : []),
    ...Object.keys(integrations?.custom ?? {}),
  ];
  return [...new Set(names)];
}

/** Qwen Code 0.24.7 built-ins that act on this machine, as `qwen --acp`
 * offered them to the model, plus the older names of the same tools. */
export const QWEN_HOST_TOOLS: readonly string[] = [
  "run_shell_command", "read_file", "read_many_files", "write_file", "edit", "replace",
  "glob", "grep_search", "search_file_content", "list_directory", "ls", "notebook_edit",
  "web_fetch", "web_search", "google_web_search", "save_memory", "todo_write",
  "agent", "task", "list_agents", "skill", "lsp", "monitor",
];

/** The only Qwen built-ins an organization turn keeps: MCP search and call
 * (they reach Sagax's MCP servers only) and a question to the person. */
export const QWEN_KEPT_TOOLS: readonly string[] = ["tool_search", "tool_call", "ask_user_question"];

/** `--core-tools` is an allowlist (a non-empty one enables nothing else);
 * `--exclude-tools` holds even if a later setting widens the list. Never
 * `--bare` or `--safe-mode`: both drop the core-tools allowlist.
 * `--allowed-mcp-server-names` keeps an MCP server a workspace or home file
 * declares from starting on the server: only Sagax's servers connect. */
export function qwenHostToolArgs(withhold: boolean, mcpServerNames: readonly string[] = []): string[] {
  if (!withhold) return [];
  return [
    "--core-tools", ...QWEN_KEPT_TOOLS, "--exclude-tools", ...QWEN_HOST_TOOLS,
    "--allowed-mcp-server-names", ...(mcpServerNames.length ? mcpServerNames : ["sagax-none"]),
  ];
}

/** Qwen system settings for a withheld turn (QWEN_CODE_SYSTEM_SETTINGS_PATH,
 * which outranks the user and workspace files). The same tool lists as the
 * flags, and no background memory, dream or skill agent: on 0.24.7 the
 * memory extractor runs with read_file, grep_search, glob, write_file and
 * edit of its own, whatever `--core-tools` says. */
export const QWEN_ORG_SETTINGS = {
  tools: { core: [...QWEN_KEPT_TOOLS], exclude: [...QWEN_HOST_TOOLS] },
  memory: { enableManagedAutoMemory: false, enableManagedAutoDream: false, enableAutoSkill: false, enableTeamMemory: false },
  // a hook is a command run on this machine
  disableAllHooks: true,
} as const;

export function qwenHostToolEnv(env: Record<string, string | undefined>, withhold: boolean): void {
  if (!withhold) return;
  env.QWEN_CODE_SYSTEM_SETTINGS_PATH = writeEnginePolicy("qwen-org-settings.json", `${JSON.stringify(QWEN_ORG_SETTINGS, null, 2)}\n`);
}

/** Gemini CLI 0.62.0 built-ins that act on this machine, as `gemini --acp`
 * offered them to the model, plus names of the same tools in other releases. */
export const GEMINI_HOST_TOOLS: readonly string[] = [
  "run_shell_command", "list_background_processes", "read_background_output",
  "read_file", "read_many_files", "write_file", "replace", "edit",
  "glob", "grep_search", "search_file_content", "list_directory",
  "web_fetch", "google_web_search", "save_memory", "write_todos",
  "invoke_agent", "codebase_investigator", "activate_skill",
];

/** Gemini admin policy for a withheld turn (`--admin-policy`, the top
 * policy tier, above YOLO's allow-all and any user or workspace rule). A
 * tool an unconditional deny matches is left out of the tools the model is
 * offered (PolicyEngine.getExcludedTools, 0.62.0), not only refused when
 * called. Priority 999 is the highest within the tier. */
export function geminiOrgPolicy(): string {
  return [
    "# Sagax organization server: Gemini CLI gets no tool that acts on the",
    "# Sagax server. Written by server/drivers/host-tools.ts.",
    "[[rule]]",
    `toolName = [${GEMINI_HOST_TOOLS.map((name) => JSON.stringify(name)).join(", ")}]`,
    'decision = "deny"',
    "priority = 999",
    'denyMessage = "This tool is not available on an organization server."',
    "",
  ].join("\n");
}

/* No Gemini system settings file: 0.62.0 skips one whose folder is not
 * owned by root ("Security Warning: Skipping system settings file"), and
 * the Sagax server does not run as root. The admin policy, the empty
 * workspace and the MCP allowlist below carry the guarantee. */

/** `--admin-policy` holds the deny rules; `-e none` loads no extension (an
 * extension can add tools, hooks or policies). `--skip-trust`: Gemini
 * connects no MCP server in an untrusted folder (verified 0.62.0), and
 * Sagax's own MCP servers are the only tools left; `--allowed-mcp-server-names`
 * then keeps a server a workspace file might declare out, so only the
 * servers Sagax passed this turn connect. */
export function geminiHostToolArgs(withhold: boolean, mcpServerNames: readonly string[] = []): string[] {
  if (!withhold) return [];
  return [
    "--admin-policy", writeEnginePolicy("gemini-org-policy.toml", geminiOrgPolicy()),
    "--extensions", "none",
    "--skip-trust",
    "--allowed-mcp-server-names", ...(mcpServerNames.length ? mcpServerNames : ["sagax-none"]),
  ];
}

/** Kimi Code 2.1.1 built-ins that act on this machine (or run an agent or
 * a schedule that would), as `kimi acp` offered them to the model. */
export const KIMI_HOST_TOOLS: readonly string[] = [
  "Bash", "Read", "ReadMediaFile", "Write", "Edit", "Glob", "Grep", "FetchURL", "WebSearch",
  "Agent", "AgentSwarm", "Skill", "TaskList", "TaskOutput", "TaskStop", "WaitFor",
  "CronCreate", "CronDelete", "CronList", "NotebookEdit",
];

/** The only Kimi built-ins an organization turn keeps (questions, plan mode,
 * goals and the todo list: state of the conversation, not of this machine). */
export const KIMI_KEPT_TOOLS: readonly string[] = [
  "AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "TodoList", "CreateGoal", "GetGoal", "SetGoalBudget", "UpdateGoal",
];

/** Kimi agent profile for a withheld turn. `kimi acp` ignores
 * `--agent-file` (2.1.1 starts the ACP server without the CLI's agent
 * options), so the profile replaces the default one, `agent`, the way Kimi
 * documents: `<KIMI_CODE_HOME>/agents/agent.md` with `override: true`.
 * `tools` is the allowlist (`mcp__*` keeps the MCP servers Sagax passed;
 * without it Kimi drops them too), `disallowedTools` holds if a name moves,
 * the body keeps Kimi's own system prompt. */
export function kimiOrgAgentFile(): string {
  return [
    "---",
    "name: agent",
    "description: Sagax MCP tools only. Host shell, files and web stay off.",
    "override: true",
    `tools: [${[...KIMI_KEPT_TOOLS, "mcp__*"].join(", ")}]`,
    `disallowedTools: [${KIMI_HOST_TOOLS.join(", ")}]`,
    "subagents: []",
    "---",
    "${base_prompt}",
    "",
  ].join("\n");
}

/** Writes the profile into the turn's Kimi home (on an organization server
 * the payer's own, principals/<pid>/kimi or a key home, both Sagax's). */
export function kimiHostToolProfile(withhold: boolean, kimiHome: string): void {
  if (!withhold) return;
  const dir = join(kimiHome, "agents");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "agent.md");
  const content = kimiOrgAgentFile();
  let current: string | null = null;
  try { current = readFileSync(path, "utf8"); } catch { current = null; }
  if (current !== content) writeFileSync(path, content, { mode: 0o600 });
}

/** OpenCode 1.18.34 built-ins that act on this machine, as `opencode acp`
 * offered them to the model (write, patch and multiedit ride the `edit`
 * permission; list and lsp their own). */
export const OPENCODE_HOST_TOOLS: readonly string[] = [
  "bash", "read", "write", "edit", "patch", "multiedit", "apply_patch", "glob", "grep", "list",
  "lsp", "task", "skill", "webfetch", "websearch", "codesearch",
];

/** OpenCode permission keys a withheld turn denies. A tool whose permission
 * is a plain `deny` is left out of the tools the model is offered, not only
 * refused when called (verified 1.18.34). */
export const OPENCODE_HOST_PERMISSIONS: readonly string[] = [
  "bash", "read", "edit", "glob", "grep", "list", "lsp", "task", "skill",
  "webfetch", "websearch", "codesearch", "external_directory",
];

/** OPENCODE_PERMISSION for a withheld turn: every host permission denied;
 * the rest (Sagax's MCP tools, the todo list) asks, or runs in Full. */
export function opencodeOrgPermission(fullAuto: boolean): string {
  return JSON.stringify({
    "*": fullAuto ? "allow" : "ask",
    todoread: "allow", todowrite: "allow", doom_loop: fullAuto ? "allow" : "ask",
    ...Object.fromEntries(OPENCODE_HOST_PERMISSIONS.map((permission) => [permission, "deny"])),
  });
}

export function opencodeHostToolEnv(env: Record<string, string | undefined>, withhold: boolean, fullAuto: boolean): void {
  if (!withhold) return;
  env.OPENCODE_PERMISSION = opencodeOrgPermission(fullAuto);
  // no opencode.json, agent, command or plugin of a project folder loads
  env.OPENCODE_DISABLE_PROJECT_CONFIG = "1";
}

/** Droid 0.230.0 built-ins that act on this machine or run an agent, a
 * schedule or a remote action of Factory's (`droid exec --list-tools`, and
 * what `droid exec -o acp` offered the model). */
export const DROID_HOST_TOOLS: readonly string[] = [
  "Execute", "Read", "LS", "Edit", "Create", "ApplyPatch", "MultiEdit", "Grep", "Glob",
  "FetchUrl", "WebSearch", "Task", "TaskOutput", "TaskStop", "Skill", "GenerateImage", "GenerateDroid",
  "Loop", "CreateAutomation", "DeleteAutomation", "EditAutomation", "ListAutomations",
  "ListAutomationTemplates", "ReadAutomation", "StageSettingsChanges", "ProposeMission",
  "StartMissionRun", "EndFeatureRun", "DismissHandoffItems",
];

/* Droid stays refused on an organization server: `droid exec -o acp`
 * ignores `--only-tools` and `--remove-tools` (0.230.0 still offered the
 * model Execute, Read, Edit and the rest with them) and its ACP session
 * takes no tool selection, so nothing withholds these tools there. */

/** Hermes Agent 0.21.5 (v2026.9.24) tools that act on this machine, as
 * `hermes acp` offered them to the model (the `hermes-acp` toolset). */
export const HERMES_HOST_TOOLS: readonly string[] = [
  "terminal", "process_manage", "process", "read_file", "write_file", "patch", "search_files",
  "execute_code", "delegate_task", "vision_analyze", "web_search", "web_extract",
  "skills_list", "skill_view", "skill_manage", "memory", "session_search", "manage_connections", "cronjob",
  "browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_scroll", "browser_back",
  "browser_press", "browser_get_images", "browser_vision", "browser_console", "browser_cdp", "browser_dialog",
  "browser_vault_list", "browser_vault_unlock", "browser_vault_fill", "browser_vault_save_login",
  "browser_vault_enter_code", "browser_exec", "computer_use", "image_generate", "text_to_speech",
];

/** Hermes toolsets a withheld turn turns off (agent.disabled_toolsets),
 * beside the empty `platform_toolsets.acp` list that enables none. */
export const HERMES_HOST_TOOLSETS: readonly string[] = [
  "terminal", "file", "web", "search", "x_search", "browser", "code_execution", "delegation", "vision",
  "video", "image_gen", "video_gen", "computer_use", "skills", "memory", "session_search", "cronjob", "tts",
  "connections", "project", "bot_room", "desktop_ui", "setup", "kanban", "homeassistant", "debugging",
  "safe", "coding", "context_engine", "spotify", "discord", "discord_admin", "yuanbao", "feishu_doc", "feishu_drive",
];

/** The Hermes configuration of a withheld turn, from the server's own:
 * same model and providers; no toolset for ACP (an explicit empty list
 * enables none, so only the MCP servers Sagax passes in session/new
 * remain), every host toolset disabled, no MCP server, hook, plugin or
 * skill directory of the configuration. */
export function hermesOrgConfig(source: string): string {
  let config: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(source) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
  } catch {
    throw new Error("Hermes's config.yaml could not be read, so its tools cannot be held back on this server.");
  }
  const agent = config.agent && typeof config.agent === "object" && !Array.isArray(config.agent) ? config.agent as Record<string, unknown> : {};
  const next: Record<string, unknown> = {
    ...config,
    platform_toolsets: { acp: [] },
    agent: { ...agent, disabled_toolsets: [...HERMES_HOST_TOOLSETS] },
    hooks_auto_accept: false,
  };
  for (const key of ["mcp_servers", "hooks", "plugins", "skills", "toolsets", "custom_toolsets", "terminal", "browser"]) delete next[key];
  return stringifyYaml(next);
}

/** A Hermes turn gets a home Sagax owns and never reads the source `.env`.
 * Withheld (organization): `engine-policies/hermes-org`, config rewritten by
 * hermesOrgConfig. Solo: `engine-policies/hermes-solo`, config.yaml copied
 * only when it is a regular file. `auth.json` may be a link to a regular
 * file. `.env` is a regular file of the lines Sagax manages, or absent. */
export function hermesTurnHome(
  env: Record<string, string | undefined>,
  options: { withhold: boolean; sourceHome: string; envText: string; dataDir?: string },
): void {
  const root = options.dataDir ?? DATA_DIR;
  const home = join(root, "engine-policies", options.withhold ? "hermes-org" : "hermes-solo");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const configPath = join(home, "config.yaml");
  if (options.withhold) {
    let source = "";
    try {
      const stat = lstatSync(join(options.sourceHome, "config.yaml"));
      if (stat.isFile()) source = readFileSync(join(options.sourceHome, "config.yaml"), "utf8");
    } catch { source = ""; }
    const config = hermesOrgConfig(source);
    let current: string | null = null;
    try { current = readFileSync(configPath, "utf8"); } catch { current = null; }
    if (current !== config) writeFileSync(configPath, config, { mode: 0o600 });
  } else {
    let copied: string | null = null;
    try {
      const stat = lstatSync(join(options.sourceHome, "config.yaml"));
      if (stat.isFile()) copied = readFileSync(join(options.sourceHome, "config.yaml"), "utf8");
    } catch { copied = null; }
    if (copied !== null) {
      let current: string | null = null;
      try { current = readFileSync(configPath, "utf8"); } catch { current = null; }
      if (current !== copied) writeFileSync(configPath, copied, { mode: 0o600 });
    }
  }
  const authLink = join(home, "auth.json");
  const authTarget = join(options.sourceHome, "auth.json");
  let existingAuth: string | null = null;
  try { existingAuth = lstatSync(authLink).isSymbolicLink() ? readlinkSync(authLink) : "not-a-link"; } catch { existingAuth = null; }
  if (existingAuth !== authTarget) {
    if (existingAuth !== null) rmSync(authLink, { force: true });
    let regular = false;
    try { regular = lstatSync(authTarget).isFile(); } catch { regular = false; }
    if (regular) symlinkSync(authTarget, authLink);
  }
  const envPath = join(home, ".env");
  try {
    if (lstatSync(envPath).isSymbolicLink()) rmSync(envPath);
  } catch { /* absent */ }
  if (options.envText) writeFileSync(envPath, options.envText, { mode: 0o600 });
  else rmSync(envPath, { force: true });
  env.HERMES_HOME = home;
}

/** Host tool names per ACP engine, as each real CLI offered them to the
 * model (scripts/verify-org-host-tools.ts). */
export const HOST_TOOL_NAMES_BY_ENGINE: Readonly<Record<string, readonly string[]>> = {
  qwen: QWEN_HOST_TOOLS,
  gemini: GEMINI_HOST_TOOLS,
  kimi: KIMI_HOST_TOOLS,
  opencode: OPENCODE_HOST_TOOLS,
  droid: DROID_HOST_TOOLS,
  hermes: HERMES_HOST_TOOLS,
};
