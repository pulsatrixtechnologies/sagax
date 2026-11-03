// Which of a bot's conversations are coding work, for the bot panel's Coding
// list (server/routes/bot-activity.ts). Read off what the conversation did,
// never its title: a coding job edited code files, ran version control
// (commit, push, a branch or worktree, a pull request), or changed files
// while it worked inside a repository. Writing the bot's own profile or
// memory files (SOUL.md, MEMORY.md, a skill) is not coding, nor is reading
// version control (a log, a diff, `git merge-base`, a dry run) or a
// comment on an issue that quotes git commands.
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { isWriteTool } from "./threads/thread-files.ts";

export interface CodingToolCall {
  name: string;
  summary?: string;
  input?: unknown;
  files?: string[];
  setup?: boolean;
}

export interface CodingSignals {
  /** Files written by an edit tool (profile files left out). */
  edits: number;
  /** Of those, source files (by extension or well-known name). */
  codeFiles: number;
  /** A commit, push, branch, worktree or pull request ran. */
  vcs: boolean;
}

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "swift", "kt", "kts",
  "java", "scala", "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "m", "mm", "cs", "fs", "php", "pl",
  "sh", "bash", "zsh", "ps1", "psm1", "sql", "css", "scss", "sass", "less", "html", "vue", "svelte",
  "astro", "dart", "lua", "r", "ex", "exs", "erl", "clj", "zig", "nim", "tf", "hcl", "gradle", "xcconfig",
  "pbxproj", "csproj", "sln", "proto", "graphql", "gql",
]);
const CODE_NAMES = new Set(["makefile", "dockerfile", "rakefile", "gemfile", "podfile", "cmakelists.txt", "package.json", "tsconfig.json", "cargo.toml", "go.mod", "pyproject.toml"]);
/** The bot's own instructions and memory: editing them is not coding. */
const PROFILE_NAMES = new Set(["soul.md", "identity.md", "memory.md", "user.md", "directive.md", "directives.md", "persona.md", "personality.md", "skill.md", "heartbeat.md", "tools.md"]);
/** The bot's own folder on the server (~/.sagax/bots/<id>/): its profile. */
const PROFILE_FOLDER = /(?:^|\/)\.(?:sagax|openmausbot)\/bots\//i;

/** Claude's sub-agent tool (Task before it was renamed Agent): its input is
 * a request in words, never a command. */
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);
const VCS_TOOL = /(?:^|__|[_-])(?:create_pull_request|update_pull_request|update_pull_request_branch|merge_pull_request|push_files|create_branch|create_or_update_file|create_commit)$/i;
/** git subcommands that write history, matched as whole words: merge-base,
 * merge-tree and commit-graph only read. */
const GIT_WRITES = new Set(["commit", "push", "merge", "rebase", "cherry-pick"]);
const GH_PR_WRITES = new Set(["create", "merge", "edit", "ready"]);

function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
}

export function isProfileFile(path: string): boolean {
  return PROFILE_NAMES.has(baseName(path)) || PROFILE_FOLDER.test(path.replace(/\\/g, "/"));
}

export function isCodeFile(path: string): boolean {
  const name = baseName(path);
  if (!name || isProfileFile(path)) return false;
  if (CODE_NAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  return dot > 0 && CODE_EXTENSIONS.has(name.slice(dot + 1));
}

/** A shell command's text with heredoc bodies left out: what a heredoc
 * writes (a SOUL.md that quotes "git push") is data, not a command. */
function withoutHeredocs(text: string): string {
  return text
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\n|$)/g, "")
    .replace(/<<-?\s*(['"]?)\w+\1[^\n]*\n[\s\S]*$/, "");
}

/** The command a tool call ran: its `command` field, from an object or the
 * JSON preview the chat kept (a preview cut short is unescaped by hand). */
function commandOf(input: unknown): string {
  if (Array.isArray(input)) return input.filter((part) => typeof part === "string").join(" ");
  if (input && typeof input === "object") return commandOf((input as { command?: unknown }).command);
  if (typeof input !== "string") return "";
  const text = input.trim();
  if (!text.startsWith("{")) return input;
  try {
    return commandOf(JSON.parse(text));
  } catch {
    const match = /"command"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
    return match ? match[1]!.replace(/\\n/g, "\n").replace(/\\(["\\])/g, "$1") : "";
  }
}

/** Where the shell word that starts at `start` ends, its quotes honored
 * (`'...'`, `"..."`, ANSI-C `$'...'`) and, in a POSIX shell (`escapes`), a
 * backslash escaping the next character: a redirection's target is one
 * word, `"two words"` included. */
function wordEnd(text: string, start: number, escapes: boolean): number {
  let index = start;
  while (index < text.length && !/[\s;&|()`<>]/.test(text[index]!)) {
    const char = text[index]!;
    if (char === "\\" && escapes) index += 2;
    else if (char === "'" || char === "\"" || (char === "$" && text[index + 1] === "'")) {
      const close = char === "\"" ? "\"" : "'";
      // backslashes escape inside ANSI-C quotes, and inside double quotes
      // in a POSIX shell
      const escaping = char === "$" || (char === "\"" && escapes);
      index += char === "$" ? 2 : 1;
      while (index < text.length && text[index] !== close) index += escaping && text[index] === "\\" ? 2 : 1;
      index++;
    } else index++;
  }
  return Math.min(index, text.length);
}

const ANSI_C_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" };

/** A shell command's words, split into the commands it chains (`;`, `&&`,
 * `||`, `|`, a subshell or a new line). Quotes are honored, ANSI-C quotes
 * (`$'it\'s'`) included, so a quoted text that lists commands on its own
 * lines stays one word; redirections and their targets (`2>&1`,
 * `> "out file.log"`, a here-string's `<<< "text"`) are dropped. A double
 * quote a backslash left open to the end breaks a POSIX shell's command,
 * and in PowerShell or cmd, where a backslash escapes nothing, it is a
 * Windows path that ends in one (`cd "C:\work\app\" && git push`): such a
 * command is read again that way. */
export function shellCommands(text: string): string[][] {
  const posix = readShell(text, true);
  return posix.open === "\"" && text.includes("\\\"") ? readShell(text, false).commands : posix.commands;
}

/** shellCommands' reader: `escapes` is a POSIX shell's backslash. `open` is
 * the quote still open at the end of the text, if any. */
function readShell(text: string, escapes: boolean): { commands: string[][]; open: "'" | "\"" | "$'" | null } {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let has = false;
  let quote: "'" | "\"" | "$'" | null = null;
  const endWord = () => {
    if (has) words.push(word);
    word = "";
    has = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (char === (quote === "\"" ? "\"" : "'")) quote = null;
      else if (char === "\\" && (quote === "$'" || (quote === "\"" && escapes)) && index + 1 < text.length) {
        const next = text[++index]!;
        word += quote === "$'" ? ANSI_C_ESCAPES[next] ?? next : next;
      } else word += char;
      continue;
    }
    if (char === "$" && text[index + 1] === "'") { quote = "$'"; has = true; index++; continue; }
    if (char === "'" || char === "\"") { quote = char; has = true; continue; }
    if (char === "\\" && escapes && index + 1 < text.length) {
      const next = text[++index]!;
      if (next !== "\n") { word += next; has = true; }
      continue;
    }
    if (char === ">" || char === "<") {
      // a redirection and its target (`2>&1`, `> out.log`) are not words
      if (/^\d*$/.test(word)) { word = ""; has = false; } else endWord();
      let next = index + 1;
      while (text[next] === ">" || text[next] === "<") next++;
      if (text[next] === "&") {
        next++;
        while (/[\d-]/.test(text[next] ?? "")) next++;
      } else {
        while (text[next] === " " || text[next] === "\t") next++;
        next = wordEnd(text, next, escapes);
      }
      index = next - 1;
      continue;
    }
    if (char === "$" && text[index + 1] === "(") { endCommand(); index++; continue; }
    if ("\n;&|()`".includes(char)) { endCommand(); continue; }
    if (char === " " || char === "\t") { endWord(); continue; }
    word += char;
    has = true;
  }
  endCommand();
  return { commands, open: quote };
}

/** The command a chain runs, without `sudo`, `env`, `VAR=value` or `time`. */
export function shellProgram(words: string[]): string[] {
  let start = 0;
  while (start < words.length && (/^(?:sudo|env|time|command|exec|nohup)$/.test(words[start]!) || /^\w+=/.test(words[start]!))) start++;
  return words.slice(start);
}

/** git's own options before the subcommand (`-C dir`, `-c k=v`, ...). */
export function gitArgs(words: string[]): string[] {
  let index = 1;
  while (index < words.length && words[index]!.startsWith("-")) {
    index += words[index] === "-C" || words[index] === "-c" ? 2 : 1;
  }
  return words.slice(index);
}

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

/** The script a shell is given to run (`bash -lc 'cd app && git push'`,
 * how Codex reports a command): read as commands of its own, as the old
 * pattern read it, while a quoted argument of any other command stays text. */
function shellScript(args: readonly string[]): string | undefined {
  if (!SHELLS.has(args[0]?.replace(/^.*[\\/]/, "") ?? "")) return undefined;
  for (let index = 1; index < args.length && args[index]!.startsWith("-"); index++) {
    if (/^-[a-z]*c[a-z]*$/i.test(args[index]!)) return args[index + 1];
  }
  return undefined;
}

/** The commands a text runs (shellCommands), a shell's own script read as
 * the commands it runs in its place, three shells deep at most. */
export function runCommands(text: string, depth = 0): string[][] {
  return shellCommands(text).flatMap((words) => {
    const script = depth < 3 ? shellScript(shellProgram(words)) : undefined;
    return script === undefined ? [words] : runCommands(script, depth + 1);
  });
}

/** One command of a chain writes version control: a commit, push, merge,
 * rebase or cherry-pick, a new branch or worktree, or a pull request opened
 * or changed. A dry run writes nothing. */
function writesVersionControl(words: string[]): boolean {
  const args = shellProgram(words);
  if (args.includes("--dry-run")) return false;
  const program = args[0]?.replace(/^.*[\\/]/, "");
  if (program === "gh") return args[1] === "pr" && GH_PR_WRITES.has(args[2] ?? "");
  if (program !== "git") return false;
  const [sub, ...rest] = gitArgs(args);
  if (!sub) return false;
  if (GIT_WRITES.has(sub)) return true;
  if (sub === "worktree") return rest[0] === "add";
  if (sub === "checkout") return rest.some((arg) => arg === "-b" || arg === "-B");
  if (sub === "switch") return rest.some((arg) => arg === "-c" || arg === "-C" || arg === "--create" || arg === "--force-create");
  return false;
}

/** The texts a call's command is read from, heredoc bodies left out, each
 * to be read on its own: the `command` its input carries, whole with its
 * new lines, else its summary and its name. A stored call carries its
 * command up to three times, and only the input keeps it whole: the
 * summary folds its lines and cuts it at 200 characters, an ACP title cuts
 * it at 80, and a title in words can hold an apostrophe. Read as one script
 * with the command, a quote one of those cuts left open flipped the quoting
 * of everything after it, so an issue comment's quoted git lines read as
 * commands and a push after a long quoted path read as text. */
export function commandTexts(tool: { name: string; summary?: string; input?: unknown }): string[] {
  const command = commandOf(tool.input);
  const texts = command.trim() ? [command] : [tool.summary, tool.name];
  return [...new Set(texts.map((text) => withoutHeredocs(text ?? "")).filter((text) => text.trim()))];
}

/** git or gh run as a command (its `command`, else its summary or its
 * name), read word by word: a request, a file's text or a quoted argument
 * that quotes "git push" is not version control, nor is a read such as
 * `git merge-base`. */
function ranVersionControl(tool: CodingToolCall): boolean {
  return commandTexts(tool).some((text) => /\b(?:git|gh)\b/.test(text) && runCommands(text).some(writesVersionControl));
}

/** Adds one tool call to the signals so far (a scan can resume). */
export function addCodingSignal(signals: CodingSignals, tool: CodingToolCall): CodingSignals {
  if (tool.setup) return signals;
  // A sub-agent's request is words: what the sub-agent then did (its own
  // calls, nested under it) is read like any other call.
  if (!signals.vcs && !SUBAGENT_TOOLS.has(tool.name) && (VCS_TOOL.test(tool.name) || ranVersionControl(tool))) signals.vcs = true;
  if (isWriteTool(tool.name)) {
    const files = (tool.files ?? []).filter((file) => !isProfileFile(file));
    // A write tool that names no file still changed something, unless it
    // named only profile files.
    if (files.length || !tool.files?.length) signals.edits += Math.max(files.length, 1);
    signals.codeFiles += files.filter(isCodeFile).length;
  }
  return signals;
}

export function codingSignals(tools: Iterable<CodingToolCall>): CodingSignals {
  const signals: CodingSignals = { edits: 0, codeFiles: 0, vcs: false };
  for (const tool of tools) addCodingSignal(signals, tool);
  return signals;
}

/** Coding work: version control ran, source files changed, or files
 * changed while the conversation worked inside a repository. */
export function isCodingWork(signals: CodingSignals, inRepository = false): boolean {
  return signals.vcs || signals.codeFiles > 0 || (inRepository && signals.edits > 0);
}

const repoCache = new Map<string, { at: number; inside: boolean }>();
const REPO_CACHE_MS = 60_000;

/** The folder is inside a git repository or worktree on this server (a
 * `.git` folder or file up the tree). A folder on another computer, or one
 * that is gone, is not. Cached a minute per folder. */
export function inGitRepository(cwd: string, now = Date.now()): boolean {
  if (!cwd || !isAbsolute(cwd)) return false;
  const cached = repoCache.get(cwd);
  if (cached && now - cached.at < REPO_CACHE_MS) return cached.inside;
  let inside = false;
  for (let dir = resolve(cwd), depth = 0; depth < 40; depth++) {
    if (existsSync(join(dir, ".git"))) { inside = true; break; }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (repoCache.size > 500) repoCache.clear();
  repoCache.set(cwd, { at: now, inside });
  return inside;
}
