// Where a coding thread's branch is: the computer the bot ran git on for
// it, and the folder there (2026-11-02). The bot panel's Coding branches
// (server/routes/bot-code-branches.ts) act there, through the same channel
// the bot's own commands used, instead of reading every branch whose
// repository is not on this server as "elsewhere".
//
// Read off the thread's own tool calls, oldest first, each command chain
// followed through its `cd`s and git's `-C`:
//   mcp__sagax-environment__run_command  the person's cloud computer (their
//                                        server environment); commands start
//                                        in the bot's folder there
//   mcp__sagax-desktop__run_command      the person's own computer through
//                                        their desktop app; `cwd`, else home
//   mcp__sagax-desktop__local_vm (run)   the Local VM on the person's computer
//   mcp__agents__vm_exec                 a solo server's Local VM
//                                        (/home/cua/workspace)
//   mcp__agents__remote_session_exec     a computer reached through a remote
//                                        session (a client's)
//   Bash and the engines' own shells     this server (its `cd` carries over
//                                        from one call to the next)
// (`<server>__<tool>`, pi's `<server>_<tool>` and Codex's bare `<tool>`
// alike.) Any other tool that ran git leaves the place unknown.
//
// A folder is absolute, home relative (`~`, `~/x`: the shell expands it on
// that computer) or relative to where that computer's commands start ("" is
// that folder itself), so the panel's command lands where the bot's did.
// Shell variables other than $HOME, substitutions and globs leave it unknown.
import type { BotBranchComputer } from "../../shared/bot-code-branches.ts";
import type { CodeWorkToolCall } from "../activity-code-work.ts";
import { commandTexts, runCommands, shellProgram } from "../activity-coding.ts";

/** The bot's computers a branch can be on, other than this server. */
export type BranchComputer = BotBranchComputer;

export interface BranchWorkPlace {
  /** "host": this server's own shell. */
  computer: BranchComputer | "host";
  /** local_vm: on the person's computer (through their desktop app) or a
   * solo server's own container. */
  vm?: "desktop" | "host";
  /** local_vm through the desktop: the VM the call named. */
  container?: string;
  /** The folder the bot's git ran in for this branch; absent when unknown. */
  folder?: string;
  /** Other folders the thread ran git in on that computer, newest first:
   * where to look when the branch is not in `folder`. */
  others: string[];
}

/** A solo server's Local VM: where vm_exec runs (container-computer.ts). */
const HOST_VM_FOLDER = "/home/cua/workspace";

const SANDBOX_RUN = /^(?:mcp__)?sagax-environment_{1,2}run_command$/;
const DESKTOP_RUN = /^(?:mcp__)?sagax-desktop_{1,2}run_command$/;
/** Codex names an MCP call by its tool alone: `run_command` is the cloud
 * computer's, or the desktop's when it names a `cwd` (only the desktop's
 * takes one). */
const BARE_RUN = "run_command";
const DESKTOP_VM = /^(?:(?:mcp__)?sagax-desktop_{1,2})?local_vm$/;
const HOST_VM = /^(?:(?:mcp__)?agents_{1,2})?vm_exec$/;
const REMOTE_SESSION = /^(?:(?:mcp__)?agents_{1,2})?remote_session_exec$/;
const HOST_SHELL = /^(?:bash|shell|local_shell|exec_command|run_shell_command|run_terminal_cmd|terminal|commandexecution|command_execution|execute)$/i;
const COMMIT_LINE = /^\[([^\]\s]+)(?: \([^)]*\))? [0-9a-f]{7,40}\] /gm;
const CREATE_FLAGS = new Set(["-b", "-B", "-c", "-C", "--create", "--force-create", "--orphan"]);

function args(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input !== "string") return {};
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    // a preview cut short: its leading string fields, read by hand
    const out: Record<string, unknown> = {};
    for (const match of input.matchAll(/"(cwd|action|container)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) out[match[1]!] = match[2]!.replace(/\\(["\\])/g, "$1");
    return out;
  }
}

/** The call's input is a command line: a `command` field, or the bare
 * command a shell's preview kept. */
function hasCommand(input: unknown): boolean {
  if (typeof input === "string" && !input.trim().startsWith("{")) return Boolean(input.trim());
  // a JSON preview cut short still names its command field
  if (typeof input === "string" && /"command"\s*:\s*["[]/.test(input)) return true;
  const command = args(input).command;
  return (typeof command === "string" && Boolean(command.trim())) || Array.isArray(command);
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try { return JSON.stringify(value); } catch { return ""; }
}

/** `base` and `segments` joined, `.` and `..` folded: null when `..` climbs
 * above a home folder (where it lands is not known here). */
function fold(base: "/" | "~" | "", segments: string[]): string | null {
  const kept: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (kept.length && kept.at(-1) !== "..") kept.pop();
      else if (base === "~") return null;
      else if (base === "") kept.push("..");
      continue;
    }
    kept.push(segment);
  }
  if (base === "/") return `/${kept.join("/")}`;
  if (base === "~") return kept.length ? `~/${kept.join("/")}` : "~";
  return kept.join("/");
}

/** Where `cd <arg>` (or `git -C <arg>`) lands from `from`, or null when it
 * is not known. */
export function resolveFolder(from: string | null, arg: string): string | null {
  let target = arg.trim();
  if (!target || target.length > 4096 || /[\0\n]/.test(target)) return null;
  target = target.replace(/^\$\{?HOME\}?(?=\/|$)/, "~");
  if (/[$`*?[\]]/.test(target) || /^[a-zA-Z]:[\\/]/.test(target) || target.includes("\\")) return null;
  if (target === "~" || target.startsWith("~/")) return fold("~", target.slice(1).split("/"));
  if (target.startsWith("~")) return null; // another user's home
  if (target.startsWith("/")) return fold("/", target.split("/"));
  if (from === null) return null;
  const base = from.startsWith("/") ? "/" : from === "~" || from.startsWith("~/") ? "~" : "";
  const head = base === "/" ? from.slice(1) : base === "~" ? from.slice(1) : from;
  return fold(base, [...head.split("/"), ...target.split("/")]);
}

function branchName(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const name = ref.replace(/^\+/, "").replace(/^refs\/heads\//, "");
  return name && !name.startsWith("-") ? name : undefined;
}

/** git's own options before its subcommand: the folder they move to
 * (`-C`, `--work-tree`), the subcommand and its arguments. */
function gitCall(words: string[], from: string | null): { folder: string | null; sub: string[] } {
  let folder = from;
  let index = 1;
  while (index < words.length && words[index]!.startsWith("-")) {
    const word = words[index]!;
    if (word === "-C") { folder = resolveFolder(folder, words[index + 1] ?? ""); index += 2; continue; }
    if (word === "-c" || word === "--git-dir" || word === "--namespace" || word === "--exec-path") { index += 2; continue; }
    if (word.startsWith("--work-tree=")) { folder = resolveFolder(folder, word.slice(12)); index += 1; continue; }
    if (word === "--work-tree") { folder = resolveFolder(folder, words[index + 1] ?? ""); index += 2; continue; }
    index += 1;
  }
  return { folder, sub: words.slice(index) };
}

/** The positional arguments of a git subcommand, its value options skipped. */
function positionals(rest: string[], valueOptions: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index]!;
    if (word === "--") { out.push(...rest.slice(index + 1)); break; }
    if (word.startsWith("-")) { if (valueOptions.has(word)) index++; continue; }
    out.push(word);
  }
  return out;
}

const WORKTREE_VALUES = new Set(["-b", "-B", "--reason"]);
const PUSH_VALUES = new Set(["-o", "--push-option", "--receive-pack", "--exec", "--repo"]);
const BRANCH_VALUES = new Set(["-t", "--track", "-u", "--set-upstream-to"]);

/** Where this git subcommand put or used `branch`, run from `folder`; null
 * when it did not touch it (undefined: it did, in a folder not known). */
function touched(sub: string[], folder: string | null, branch: string, output: string): string | null | undefined {
  const [verb, ...rest] = sub;
  const here = folder ?? undefined;
  if (verb === "checkout" || verb === "switch") {
    const create = rest.findIndex((word) => CREATE_FLAGS.has(word));
    if (create >= 0) return branchName(rest[create + 1]) === branch ? here : null;
    if (rest.includes("--")) return null;
    const target = rest.find((word) => !word.startsWith("-"));
    return branchName(target) === branch ? here : null;
  }
  if (verb === "worktree" && rest[0] === "add") {
    const options = rest.slice(1);
    const create = options.findIndex((word) => word === "-b" || word === "-B");
    const [path, commitish] = positionals(options, WORKTREE_VALUES);
    const named = create >= 0 ? branchName(options[create + 1]) === branch : branchName(commitish) === branch;
    if (!named) return null;
    return path ? resolveFolder(folder, path) ?? undefined : undefined;
  }
  if (verb === "branch") {
    if (rest.some((word) => /^-(?:d|D|-delete|-list|l|a|r|-all|-remotes|-show-current|-contains|-merged|-no-merged)$/.test(word))) return null;
    const names = positionals(rest, BRANCH_VALUES);
    const moved = rest.some((word) => /^-(?:m|M|c|C|-move|-copy)$/.test(word));
    const name = moved ? names.at(-1) : names[0];
    return branchName(name) === branch ? here : null;
  }
  if (verb === "commit") {
    for (const match of output.matchAll(COMMIT_LINE)) if (branchName(match[1]) === branch) return here;
    return null;
  }
  if (verb === "push") {
    if (rest.some((word) => word === "-d" || word === "--delete")) return null;
    const refspecs = positionals(rest, PUSH_VALUES).slice(1);
    const hit = refspecs.some((refspec) => {
      const [source, destination] = refspec.includes(":") ? refspec.split(":", 2) : [refspec, refspec];
      return branchName(destination) === branch || branchName(source) === branch;
    });
    return hit ? here : null;
  }
  return null;
}

interface ToolPlace {
  computer: BranchWorkPlace["computer"];
  vm?: BranchWorkPlace["vm"];
  container?: string;
  /** Where its commands start; null when not known. */
  start: string | null;
}

function toolPlace(tool: CodeWorkToolCall, options: { sandboxFolder?: string | null; hostFolder: string | null }): ToolPlace | null {
  const name = tool.name.trim();
  const cwd = args(tool.input).cwd;
  const named = typeof cwd === "string" && cwd.trim() !== "";
  if (SANDBOX_RUN.test(name) || (name === BARE_RUN && !named)) return { computer: "sandbox", start: options.sandboxFolder?.startsWith("/") ? options.sandboxFolder : "" };
  if (DESKTOP_RUN.test(name) || name === BARE_RUN) return { computer: "desktop", start: named ? resolveFolder("~", cwd as string) : "~" };
  if (DESKTOP_VM.test(name)) {
    const input = args(tool.input);
    if (input.action !== "run") return null;
    return { computer: "local_vm", vm: "desktop", ...(typeof input.container === "string" && input.container.trim() ? { container: input.container.trim() } : {}), start: "" };
  }
  if (HOST_VM.test(name)) return { computer: "local_vm", vm: "host", start: HOST_VM_FOLDER };
  if (REMOTE_SESSION.test(name)) return { computer: "remote_session", start: "" };
  if (HOST_SHELL.test(name)) return { computer: "host", start: options.hostFolder };
  return null;
}

const samePlace = (a: ToolPlace, b: { computer: string; vm?: string; container?: string }) =>
  a.computer === b.computer && a.vm === b.vm && (a.container ?? "") === (b.container ?? "");

/** Where `branch` is, read off the thread's calls (oldest first): the
 * newest call that created, checked out, committed on or pushed it (a call
 * that succeeded wins over one that did not), and the computer and folder
 * it ran in. Undefined when no command touched it, or the newest one ran on
 * a computer this cannot name. */
export function branchWorkPlace(
  messages: Iterable<{ at: number; tool?: CodeWorkToolCall }>,
  branch: string,
  options: { sandboxFolder?: string | null; threadFolder?: string | null } = {},
): BranchWorkPlace | undefined {
  let hostFolder: string | null = options.threadFolder?.startsWith("/") ? options.threadFolder : null;
  // the newest call that touched the branch, and the newest that succeeded
  // (a call refused or failed part way may not have done it)
  let newest: { place: ToolPlace | null; folder: string | undefined } | undefined;
  let newestOk: { place: ToolPlace | null; folder: string | undefined } | undefined;
  const folders: Array<{ place: ToolPlace; folder: string }> = [];
  for (const message of messages) {
    const tool = message.tool;
    if (!tool || tool.setup) continue;
    const place = toolPlace(tool, { sandboxFolder: options.sandboxFolder, hostFolder });
    // another tool counts only when it carries a command line of its own
    // (a summary that quotes git is not a command)
    if (!place && !hasCommand(tool.input)) continue;
    const texts = commandTexts(tool).filter((value) => /\b(?:git|cd|pushd)\b/.test(value));
    if (!texts.length) continue;
    const output = text(tool.output).replace(/\\n/g, "\n");
    let touchedHere: string | null | undefined = null;
    for (const value of texts) {
      let folder = place ? place.start : null;
      for (const words of runCommands(value)) {
        const command = shellProgram(words);
        const program = command[0]?.replace(/^.*[\\/]/, "");
        if (program === "cd" || program === "pushd") {
          const target = command.slice(1).find((word) => !/^-[LPe@]*$/.test(word) && word !== "--");
          folder = target === undefined ? "~" : target === "-" ? null : resolveFolder(folder, target);
          continue;
        }
        if (program === "popd") { folder = null; continue; }
        if (program !== "git") continue;
        const call = gitCall(command, folder);
        if (place && call.folder !== null && !folders.some((entry) => samePlace(entry.place, place) && entry.folder === call.folder)) folders.push({ place, folder: call.folder });
        const at = touched(call.sub, call.folder, branch, output);
        if (at !== null) touchedHere = at;
      }
      // a host shell keeps its folder for the next call (Claude Code's Bash)
      if (place?.computer === "host") hostFolder = folder;
    }
    if (touchedHere === null) continue;
    newest = { place, folder: touchedHere };
    if (tool.ok === true) newestOk = newest;
  }
  const found = newestOk ?? newest;
  if (!found?.place) return undefined;
  const { place, folder } = found;
  const others = folders.filter((entry) => samePlace(entry.place, place) && entry.folder !== folder).map((entry) => entry.folder).reverse().slice(0, 6);
  return {
    computer: place.computer,
    ...(place.vm ? { vm: place.vm } : {}),
    ...(place.container ? { container: place.container } : {}),
    ...(folder !== undefined ? { folder } : {}),
    others,
  };
}
