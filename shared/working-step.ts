// The step a bot is on, named for people (2026-10-29): "Reading your email",
// "Opening Chrome", "Running scrape.py". The working line under the
// transcript shows it while a tool call runs, on the desktop and on the
// phone, and it reads the same whatever engine made the call (Claude Code,
// Codex, an ACP agent, an OpenAI-compatible model, ...): every engine names
// its tools differently, so the server folds the name, the command and the
// arguments into one key and one short detail here, once, when the call
// starts (server/index.ts, item.started). Clients only translate the key.
//
// The detail is a file name, an app, a web host or a program name. Never
// the arguments, a query, a path or a whole command line: the server passes
// it through its redaction before it leaves (server/working-step.ts).

export type WorkingStepKey =
  | "readMail"
  | "writeMail"
  | "calendar"
  | "writeCalendar"
  | "readChat"
  | "writeChat"
  | "openApp"
  | "browse"
  | "readPage"
  | "searchWeb"
  | "run"
  | "readFile"
  | "writeFile"
  | "editFile"
  | "searchFiles"
  | "screen"
  | "computer"
  | "teammate"
  | "subagent"
  | "memory"
  | "tool";

export const WORKING_STEP_KEYS: readonly WorkingStepKey[] = [
  "readMail", "writeMail", "calendar", "writeCalendar", "readChat", "writeChat",
  "openApp", "browse", "readPage", "searchWeb", "run", "readFile", "writeFile",
  "editFile", "searchFiles", "screen", "computer", "teammate", "subagent", "memory", "tool",
];

/** Keys that read with a detail ("Opening {detail}"); the others show the
 * plain phrase even when a detail came along. */
export const WORKING_STEP_DETAIL_KEYS: readonly WorkingStepKey[] = [
  "readChat", "writeChat", "openApp", "browse", "readPage", "run", "readFile", "writeFile", "editFile", "computer", "tool",
];

export interface WorkingStep {
  key: WorkingStepKey;
  /** A short name: a file, an app, a host, a program. At most 40 characters. */
  detail?: string;
}

/** What a tool call carries when it starts, whatever the engine. */
export interface WorkingStepCall {
  /** The tool's name as the engine reported it (item.started title). */
  name: string;
  /** The shell command it runs, already redacted (commandSummary). */
  summary?: string;
  /** Its arguments as the bounded, redacted preview (toolDetailPreview). */
  input?: string;
  /** The product a connector declared for this tool (tool.product). */
  product?: string;
}

const DETAIL_MAX = 40;

function cleanDetail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!text || /\[redacted\]|\*{3,}/i.test(text)) return undefined;
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

function baseName(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] ?? trimmed;
}

function hostOf(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(/^[a-z][\w+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

function parseInput(input: string | undefined): Record<string, unknown> | unknown[] | undefined {
  if (!input) return undefined;
  try {
    const value: unknown = JSON.parse(input);
    if (value && typeof value === "object") return value as Record<string, unknown> | unknown[];
  } catch { /* a plain-text preview: no fields */ }
  return undefined;
}

function field(input: Record<string, unknown> | unknown[] | undefined, names: readonly string[]): string | undefined {
  if (!input) return undefined;
  // Codex's file change is a list of { path, ... }
  const record = Array.isArray(input) ? input.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined : input;
  if (!record) return undefined;
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

const FILE_FIELDS = ["file_path", "path", "notebook_path", "filename", "file", "target_file", "absolute_path"];
const URL_FIELDS = ["url", "uri", "href", "link"];
const APP_FIELDS = ["app", "application", "app_name", "appName", "name", "bundle_id", "bundleId"];

function fileDetail(input: Record<string, unknown> | unknown[] | undefined): string | undefined {
  const path = field(input, FILE_FIELDS);
  return path ? cleanDetail(baseName(path)) : undefined;
}

const INTERPRETERS = new Set([
  "python", "python3", "python2", "py", "node", "bun", "deno", "ruby", "perl", "php", "bash", "sh", "zsh",
  "fish", "pwsh", "powershell", "tsx", "ts-node", "rscript", "lua", "osascript", "swift", "java",
]);
const PREFIXES = new Set(["sudo", "env", "time", "nohup", "exec", "command", "caffeinate"]);

/** A line shown to a person (a running entry's current step): every
 * absolute path keeps only its last two segments, never the server's
 * `/workspace/bots/<slug>/...` prefix (2026-11-03). */
export function shortPathsIn(text: string): string {
  return text.replace(/(?<![\w.~:/-])\/(?:[\w.@+-]+\/)+[\w.@+-]+\/?/g, (path) => {
    const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
    return parts.length <= 2 ? path : parts.slice(-2).join("/");
  });
}

/** The program or the script a shell command runs, never its arguments:
 * `python scrape.py --key x` reads `scrape.py`, `cd app && pnpm test` reads
 * `pnpm`, `open -a "Google Chrome"` opens an app. */
export function commandStep(command: string): WorkingStep {
  // the first command that is not a cd
  const segments = command.split(/&&|\|\||;|\|/).map((part) => part.trim()).filter(Boolean);
  const segment = segments.find((part) => !/^(cd|pushd|export|set|source|\.)\s/.test(part) && part !== "cd") ?? segments[0] ?? "";
  const words = segment.match(/"[^"]*"|'[^']*'|\S+/g)?.map((word) => word.replace(/^["']|["']$/g, "")) ?? [];
  let index = 0;
  while (index < words.length && (PREFIXES.has(words[index]!) || /^\w+=/.test(words[index]!))) index++;
  const program = words[index];
  if (!program) return { key: "run" };
  const name = baseName(program);
  const lower = name.toLowerCase();
  if (lower === "open") {
    const flag = words.indexOf("-a", index);
    const app = flag >= 0 ? words[flag + 1] : undefined;
    if (app) return { key: "openApp", ...withDetail(baseName(app).replace(/\.app$/i, "")) };
    const target = words.slice(index + 1).find((word) => !word.startsWith("-"));
    const host = target && /^https?:\/\//i.test(target) ? hostOf(target) : undefined;
    if (host) return { key: "browse", ...withDetail(host) };
  }
  if (lower === "start" && words[index + 1]) return { key: "openApp", ...withDetail(words[index + 1]) };
  // `uv run x.py`, `poetry run x.py`, `python -m module`, `node script.js`
  let rest = words.slice(index + 1);
  if ((lower === "uv" || lower === "poetry" || lower === "pipenv") && rest[0] === "run") rest = rest.slice(1);
  if (INTERPRETERS.has(lower.replace(/\.exe$/, "")) || ((lower === "uv" || lower === "poetry" || lower === "pipenv") && words[index + 1] === "run")) {
    const module = rest[0] === "-m" ? rest[1] : undefined;
    if (module) return { key: "run", ...withDetail(module) };
    const script = rest.find((word) => !word.startsWith("-"));
    if (script && /[./\\]/.test(script)) return { key: "run", ...withDetail(baseName(script)) };
    return { key: "run", ...withDetail(name) };
  }
  return { key: "run", ...withDetail(name) };
}

function withDetail(value: string | undefined): { detail?: string } {
  const detail = cleanDetail(value);
  return detail ? { detail } : {};
}

/** mcp__<server>__<tool>, or a bare tool name. */
function splitName(name: string): { server?: string; tool: string } {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return { server: mcp[1], tool: mcp[2]! };
  // Codex and ACP agents may report `server.tool` or `server/tool`
  const dotted = /^([\w-]+)[./]([\w-]+)$/.exec(name);
  if (dotted && !/\.(py|js|ts|sh|rb|md|json|txt)$/i.test(name)) return { server: dotted[1], tool: dotted[2]! };
  return { tool: name };
}

const WRITE_VERB = /(send|reply|forward|draft|compose|create|update|delete|move|post|write|respond|cancel|schedule|book|set_)/;

/** The step for a tool call, or null when there is nothing better to say
 * than the line already shows (a to-do list update, a tool search). */
export function workingStepFor(call: WorkingStepCall): WorkingStep | null {
  const raw = call.name.trim();
  if (!raw || /^(auto-approved|error):/i.test(raw)) return null;
  const input = parseInput(call.input);
  const { server, tool } = splitName(raw);
  const bare = tool.toLowerCase();
  const scope = `${(server ?? "").toLowerCase()} ${bare}`;

  // Bookkeeping the person does not need named.
  if (/^(todowrite|todo_write|update_plan|toolsearch|tool_search|exitplanmode|think|sleep)$/.test(bare)) return null;

  // An engine that reports the shell command itself as the tool's name
  // (Codex, ACP agents), or a shell tool with its command beside it.
  const shellName = /^(bash|shell|sh|zsh|terminal|exec|execute|run_command|run_shell_command|run_terminal_cmd|command|commandexecution|command_execution|computer_exec|powershell|local_shell|bashoutput)$/.test(bare);
  if (shellName) {
    const command = call.summary ?? field(input, ["command", "cmd"]);
    return command ? commandStep(command) : { key: "run" };
  }

  // Sub-agents and other bots.
  if (/^(task|agent|spawn_agent|subagent|run_subagent|run_with_engine)$/.test(bare)) return { key: "subagent" };
  if (/(ask_bot|delegate_bot|coordinate_bots|list_bots|post_to_room|message_user|send_prompt|await_turn|list_agents|find_agents)/.test(bare)) return { key: "teammate" };
  if (bare === "send_message" && (!server || /^agents$/i.test(server))) return { key: "teammate" };
  if (/^memory_|(^|_)memory$|recall_topic|remember/.test(bare)) return { key: "memory" };

  // Mail, calendar and chat apps (Microsoft 365, Gmail, Teams, Slack, ...).
  if (/calendar|meeting|availab|(^|[\s_])events?($|_)|freebusy/.test(scope)) {
    return { key: WRITE_VERB.test(bare) || /respond_to_event/.test(bare) ? "writeCalendar" : "calendar" };
  }
  if (/teams|slack|chat_message|channel_message|(^|[\s_])chats?($|_)|discord|imessage|whatsapp/.test(scope)) {
    const app = /teams/.test(scope) ? "Teams" : /slack/.test(scope) ? "Slack" : /discord/.test(scope) ? "Discord" : /whatsapp/.test(scope) ? "WhatsApp" : undefined;
    return { key: /(send|reply|post|create|write)/.test(bare) ? "writeChat" : "readChat", ...withDetail(app) };
  }
  if (/e?mail|outlook|gmail|inbox|(^|[\s_])messages?($|_)|thread_label|vacation/.test(scope) && !/sms|voice/.test(scope)) {
    return { key: /(send|reply|forward|draft|compose)/.test(bare) ? "writeMail" : "readMail" };
  }

  // Apps and the screen.
  if (/^(open_application|open_app|launch_app|launch_application|activate_app|switch_app)$/.test(bare)) {
    return { key: "openApp", ...withDetail(field(input, APP_FIELDS)?.replace(/\.app$/i, "")) };
  }
  if (/^(screenshot|screen_capture|take_screenshot|zoom|cursor_position)$/.test(bare) || /screenshot/.test(bare)) return { key: "screen" };

  // The web.
  if (/^(web_?search|websearch|google_web_search|search_web|brave_search|tavily_search|search_query)$/.test(bare) || /web_search/.test(bare)) return { key: "searchWeb" };
  if (/^(web_?fetch|fetch|fetch_url|read_page|get_page_text|read_url|scrape|browse_page)$/.test(bare)) {
    return { key: "readPage", ...withDetail(hostOf(field(input, URL_FIELDS))) };
  }
  if (/^(open_url|navigate|browser_navigate|goto|go_to|open_page|tabs_create(_mcp)?|new_tab)$/.test(bare) || bare.startsWith("browser_") || /chrome|browser|playwright|puppeteer/.test(server?.toLowerCase() ?? "")) {
    const host = hostOf(field(input, URL_FIELDS));
    return { key: "browse", ...withDetail(host) };
  }
  if (/^(computer|computer_batch|click|left_click|right_click|double_click|triple_click|type|type_text|key|press_key|hold_key|scroll|mouse_move|left_click_drag|wait_for|wait)$/.test(bare)) {
    return { key: "computer", ...withDetail(field(input, ["app", "application"])) };
  }

  // Files.
  if (/^(read|read_file|view|open_file|cat|notebookread|read_many_files|view_file)$/.test(bare)) return { key: "readFile", ...fileDetailOf(input) };
  if (/^(write|write_file|create_file|save_file)$/.test(bare)) return { key: "writeFile", ...fileDetailOf(input) };
  if (/^(edit|multiedit|multi_edit|apply_patch|str_replace|str_replace_editor|str_replace_based_edit_tool|replace|notebookedit|edit_file|patch|filechange|file_change)$/.test(bare)) {
    return { key: "editFile", ...fileDetailOf(input) };
  }
  if (/^(grep|glob|find|search|ls|list_dir|list_directory|search_files|file_search|search_file_content|codebase_search|find_files)$/.test(bare)) return { key: "searchFiles" };

  // An ACP agent's own title ("Read src/app.ts", "Editing notes.md").
  if (/\s/.test(raw)) {
    const [first = "", ...rest] = raw.split(/\s+/);
    const verb = first.toLowerCase();
    const target = rest.join(" ");
    const detail = target && /[./\\]/.test(target) ? withDetail(baseName(target)) : {};
    if (/^(read|reading|view|viewing)$/.test(verb)) return { key: "readFile", ...detail };
    if (/^(write|writing|create|creating)$/.test(verb)) return { key: "writeFile", ...detail };
    if (/^(edit|editing|update|updating|patch|patching)$/.test(verb)) return { key: "editFile", ...detail };
    if (/^(search|searching|grep|find|finding)$/.test(verb)) return { key: "searchFiles" };
    if (/^(fetch|fetching)$/.test(verb)) return { key: "readPage", ...withDetail(hostOf(target)) };
    // anything else with spaces is the command line itself (Codex)
    return commandStep(call.summary ?? raw);
  }

  // Any other connector: the product it serves, else its server's name.
  const product = cleanDetail(call.product) ?? (server && !/^(agents|sagax|harness|perspicax|omb)/i.test(server) ? cleanDetail(server.replace(/^claude_ai_/i, "").replace(/[_-]+/g, " ")) : undefined);
  return { key: "tool", ...(product ? { detail: product } : {}) };
}

function fileDetailOf(input: Record<string, unknown> | unknown[] | undefined): { detail?: string } {
  const detail = fileDetail(input);
  return detail ? { detail } : {};
}

/** A message the working line can read: the transcript's newest row. */
export interface WorkingStepRow {
  kind?: string;
  at?: number;
  comm?: unknown;
  tool?: { ok?: boolean; step?: WorkingStep };
}

/** The step the working line names now: the newest row's, while its call is
 * still running. Null between calls and once the turn is over. */
export function currentWorkingStep(row: WorkingStepRow | undefined): (WorkingStep & { since?: number }) | null {
  if (!row || row.kind !== "activity" || row.comm || !row.tool || row.tool.ok !== undefined) return null;
  const step = row.tool.step;
  if (!step || !WORKING_STEP_KEYS.includes(step.key)) return null;
  return { ...step, ...(typeof row.at === "number" ? { since: row.at } : {}) };
}

/** From this age on, the working line says how long ago the last output came. */
export const WORKING_STEP_QUIET_MS = 60_000;

/** The quiet time to show, in whole units, or null while the step is young. */
export function quietAge(since: number | undefined, now: number): { unit: "min" | "h"; count: number } | null {
  if (since === undefined) return null;
  const elapsed = now - since;
  if (!(elapsed >= WORKING_STEP_QUIET_MS)) return null;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return { unit: "min", count: minutes };
  return { unit: "h", count: Math.floor(minutes / 60) };
}
