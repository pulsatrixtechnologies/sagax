// Whether the conversation is development work, where the context pods are
// useful. Purely local: it reads the transcript the chat already holds (tool
// rows, paths, pull request links, code blocks) and the bot's computer
// state. Nothing is fetched and nothing is sent.
//
// The score of the recent window feeds a small hysteresis (devModeStep) so
// the pods do not come and go on every turn: they appear once the score
// reaches ENTER_SCORE and leave only after EXIT_STREAK evaluations in a row
// under EXIT_SCORE.
import type { Message } from "@/state/store";

/** How many of the latest messages the score reads. */
export const DEV_WINDOW = 24;
/** Score that turns the pods on. */
export const ENTER_SCORE = 4;
/** Under this score an evaluation counts toward turning the pods off. */
export const EXIT_SCORE = 2;
/** Evaluations in a row under EXIT_SCORE before the pods turn off. */
export const EXIT_STREAK = 3;

export type DevToolKind = "shell" | "git" | "edit" | "pr";

const SHELL = new Set(["bash", "shell", "execute", "bashoutput", "run_command", "exec", "vm_exec", "terminal", "exec_command", "command_execution", "local_shell"]);
const EDIT = new Set(["write", "edit", "multiedit", "notebookedit", "write_file", "create_file", "edit_file", "str_replace", "str_replace_editor", "apply_patch", "file_change", "patch"]);

const GIT_COMMAND = /(?:^|[\s;&|(])git\s+(?:-C\s+\S+\s+)?(?:commit|push|pull|checkout|switch|branch|merge|rebase|worktree|diff|status|log|add|fetch|clone|cherry-pick|stash|tag)\b/;
const PR_COMMAND = /(?:^|[\s;&|(])gh\s+pr\s+(?:create|merge|view|edit|checkout)\b/;
const PR_URL = /https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i;
const REPO_PATH = /(?:^|[\s"'`(])(?:~|\.{1,2})?\/?(?:[\w.-]+\/)+[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|rs|go|swift|kt|java|rb|php|cs|c|cc|cpp|h|hpp|css|scss|vue|svelte|sql|sh|ya?ml|toml|json|md)\b/;
const CODE_FENCE = /```[\w-]*\n[\s\S]*?```/g;
/** Codex and ACP engines (Grok, Cursor, OpenCode) name a shell call by the
 * command itself: a row whose name starts with a developer command is one. */
const SHELL_HEAD = /^(?:sudo\s+)?(?:cd|ls|cat|rg|grep|sed|awk|find|tree|head|tail|wc|jq|diff|npm|pnpm|pnpx|npx|yarn|node|bun|bunx|deno|tsc|vitest|jest|eslint|prettier|python3?|pip3?|pytest|uv|poetry|ruby|bundle|rake|cargo|rustc|go|make|cmake|swift|swiftc|xcodebuild|xcrun|gradle|\.\/gradlew|mvn|dotnet|docker|kubectl|helm|terraform|bash|sh|zsh|mkdir|rm|mv|cp|touch|chmod|curl|git|gh)(?:\s|$)/;
/** A file an edit wrote that is code or project text, not the bot's own
 * profile or memory notes. */
const CODE_FILE = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts|py|rs|go|swift|kt|kts|java|scala|rb|php|cs|c|cc|cpp|h|hpp|m|mm|css|scss|less|html|vue|svelte|astro|dart|lua|sql|sh|bash|zsh|ps1|ya?ml|toml|json|md|mdx|gradle|proto|graphql|tf)$/i;
const CODE_NAME = /(?:^|\/)(?:Makefile|Dockerfile|Gemfile|Podfile|CMakeLists\.txt)$/;
const PROFILE_FOLDER = /(?:^|\/)\.(?:sagax|openmausbot)\/bots\//i;
/** The bot's own instructions and memory (server/activity/activity-coding.ts). */
const PROFILE_NAME = /(?:^|\/)(?:soul|identity|memory|user|directives?|persona|personality|skill|heartbeat|tools)\.md$/i;

function writesCode(files: readonly string[] | undefined): boolean {
  return (files ?? []).some((file) => {
    const path = file.replace(/\\/g, "/");
    return !PROFILE_FOLDER.test(path) && !PROFILE_NAME.test(path) && (CODE_FILE.test(path) || CODE_NAME.test(path));
  });
}

/** The development signal one tool row carries, if any. */
export function toolKind(tool: NonNullable<Message["tool"]>): DevToolKind | null {
  const name = tool.name.trim();
  const bare = name.toLowerCase().replace(/^mcp__[^_]+__/, "");
  // the name too: Codex and ACP rows carry the command there
  const text = `${name}\n${tool.summary ?? ""}\n${tool.input ?? ""}`;
  if (PR_COMMAND.test(text) || PR_URL.test(tool.output ?? "")) return "pr";
  if (GIT_COMMAND.test(text)) return "git";
  if (writesCode(tool.files)) return "edit";
  if (EDIT.has(bare) && !tool.files?.length) return "edit";
  if (SHELL.has(bare) || SHELL_HEAD.test(name)) return "shell";
  if (bare.startsWith("git_") || bare.startsWith("github")) return "git";
  return null;
}

/** A person asking for the coding view by name, on or off: "turn on coding
 * mode", "active le mode code", "hide the context pods". Only the person's
 * own lines count, and only a verb that asks for a change with a name of the
 * view: a question about the mode, or "code of conduct", is not a request. */
const MODE_NAME = /\b(?:coding|code|dev|developer|development|programming)\s+(?:mode|experience|view|layout)\b|\bmode\s+(?:de\s+)?(?:code|codage|coding|dev|d[ée]veloppe(?:ment|ur)|programmation)(?![\w\u00C0-\u017F])|\bexp[ée]rience\s+(?:de\s+)?(?:code|codage|coding|d[ée]veloppement)(?![\w\u00C0-\u017F])|\b(?:context|dev)\s+pods?\b|\bpods?\s+de\s+(?:contexte|d[ée]veloppement)(?![\w\u00C0-\u017F])/i;
const TURN_OFF = /(?:^|[^\w\u00C0-\u017F])(?:turn(?:ing)?\s+(?:it\s+)?off|switch\s+(?:it\s+)?off|disable|deactivate|close|hide|exit|leave|quit|d[ée]sactiv\w*|ferm\w*|cach\w*|masqu\w*|quitt\w*|sor[st]\b|sortir|[ée]tein\w*|enl[eè]v\w*)/i;
const TURN_ON = /(?:^|[^\w\u00C0-\u017F])(?:turn(?:ing)?\s+(?:it\s+)?on|switch\s+(?:it\s+)?(?:on|to|into)|enable|activate|start|open|show|go\s+(?:in|into|to)|put\s+(?:me\s+)?in|use|activ\w*|allum\w*|ouvr\w*|ouvre|affich\w*|pass\w*|bascul\w*|met[st]?\b|mettre|d[ée]marr\w*|lanc\w*)/i;

export interface DevModeRequest {
  mode: "on" | "off";
  /** The person's message that asked. */
  id: string;
  at: number;
}

/** The newest request for the coding view among the person's own lines. */
export function devModeRequest(messages: readonly Message[]): DevModeRequest | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== "user" || message.kind !== "text" || !message.text) continue;
    const text = message.text.slice(0, 400);
    if (!MODE_NAME.test(text)) continue;
    if (TURN_OFF.test(text)) return { mode: "off", id: message.id, at: message.at };
    if (TURN_ON.test(text)) return { mode: "on", id: message.id, at: message.at };
  }
  return null;
}

export interface DevSignalInput {
  messages: readonly Message[];
  /** The bot's computer is starting, or the thread runs on one with a screen. */
  computerActive?: boolean;
  /** An explicit mark. Absent: the person's own request in the recent
   * window (devModeRequest) decides. */
  explicit?: boolean;
}

export interface DevSignals {
  score: number;
  tools: Record<DevToolKind, number>;
  repoPaths: number;
  codeBlocks: number;
  prLinks: number;
  /** The newest request for the coding view in the recent window. */
  request: DevModeRequest | null;
}

const WEIGHT: Record<DevToolKind, number> = { shell: 1, git: 3, edit: 3, pr: 4 };

/** The score of the recent window. Each kind of signal is capped so one
 * chatty signal (a long run of reads, a reply full of snippets) cannot
 * outweigh the others on its own. */
export function devSignals({ messages, computerActive, explicit }: DevSignalInput): DevSignals {
  const recent = messages.slice(-DEV_WINDOW);
  const tools: Record<DevToolKind, number> = { shell: 0, git: 0, edit: 0, pr: 0 };
  let repoPaths = 0;
  let codeBlocks = 0;
  let prLinks = 0;
  for (const message of recent) {
    if (message.kind === "activity" && message.tool) {
      const kind = toolKind(message.tool);
      if (kind) tools[kind] += 1;
      if (REPO_PATH.test(`${message.tool.summary ?? ""} ${message.tool.input ?? ""}`)) repoPaths += 1;
      continue;
    }
    if (message.kind !== "text" || !message.text) continue;
    codeBlocks += message.text.match(CODE_FENCE)?.length ?? 0;
    if (PR_URL.test(message.text)) prLinks += 1;
    if (REPO_PATH.test(message.text)) repoPaths += 1;
  }
  let score = 0;
  for (const kind of Object.keys(tools) as DevToolKind[]) score += Math.min(2, tools[kind]) * WEIGHT[kind];
  score += Math.min(2, repoPaths);
  score += Math.min(2, codeBlocks);
  score += Math.min(1, prLinks) * 3;
  if (computerActive) score += 1;
  const request = devModeRequest(recent);
  if (explicit ?? request?.mode === "on") score += ENTER_SCORE;
  // the person turned it off: nothing else turns it back on until they ask
  if (explicit === undefined && request?.mode === "off") score = 0;
  return { score, tools, repoPaths, codeBlocks, prLinks, request };
}

export interface DevModeState {
  active: boolean;
  /** Evaluations in a row under EXIT_SCORE while active. */
  quiet: number;
}

export const DEV_MODE_OFF: DevModeState = { active: false, quiet: 0 };

/** One evaluation of the hysteresis. */
export function devModeStep(previous: DevModeState, score: number): DevModeState {
  if (!previous.active) return score >= ENTER_SCORE ? { active: true, quiet: 0 } : previous;
  if (score >= EXIT_SCORE) return previous.quiet === 0 ? previous : { active: true, quiet: 0 };
  const quiet = previous.quiet + 1;
  return quiet >= EXIT_STREAK ? DEV_MODE_OFF : { active: true, quiet };
}
