// The tools a bot gets in a person's server environment: run a command,
// read, write and list files, open a web page in a headless browser, and use
// the environment's desktop (computer use: see the screen, click, type). Each
// call becomes one exec in that person's sandbox through the manager; nothing
// here touches the Sagax server's own filesystem or processes.
//
// Computer use has the desktop bridge's shape (server/desktop-bridge-tools.ts):
// computer_list_tools, then computer_use with one of SANDBOX_COMPUTER_TOOLS,
// the same vocabulary as a cloud computer (server/drivers/chat-boat-tools.ts).
// The desktop starts on the first such call (deploy/sandbox/sagax-desktop).
import { MISUSE_MAX_COMMAND_SECONDS } from "../shared/misuse-guardrails.ts";
import { wrapUntrusted } from "../shared/safety-review.ts";
import type { SandboxExecInput, SandboxExecOutput } from "./sandboxd-core.ts";
import { procSecretPath, resolvedReadRefusal, type ResolvedEnvironmentPath } from "./sensitive-path.ts";

export const USER_SANDBOX_TOOLS = [
  {
    name: "run_command",
    description: "Run a bash command in your server environment (an isolated Linux machine of your own on the server; /workspace persists). Not your computer and not the Sagax server. Your bot's installed plugins are in /workspace/sagax-plugins/<plugin> (run their scripts there), and git and gh use the person's own GitHub connection when they connected one; when git or gh is not signed in, the fix is that connection (Connect apps > GitHub in Sagax): say so, never ask for gh auth login or a token. A sign-in the person made there themselves (gh auth login) is theirs and Sagax leaves it as is. When gh or git answers 404 or 403 for a repository of an organization, the GitHub token in use does not cover that organization: tell the person so in their language (your GitHub token does not cover the organization <name>: reconnect GitHub with access to organizations, Connect apps > GitHub), never a bare 404 or 403. Run commands yourself; never ask the person to run them.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command line." },
        timeout_seconds: { type: "number", description: "Stop after this many seconds (default 120, at most 600)." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "Read a text file in your server environment. Relative paths start at /workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, max_bytes: { type: "number", description: "Default 200000." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description: "Create or replace a file in your server environment. Relative paths start at /workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description: "List a directory in your server environment (default /workspace).",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "browse",
    description: "Open a public web page in a headless browser in your server environment and return its rendered HTML, or a PNG screenshot.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, screenshot: { type: "boolean" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "computer_list_tools",
    description: "List the computer-use tools of the desktop in your server environment (see the screen, click, type, scroll). Use computer_use to call one. The person can watch this desktop live in Sagax.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "computer_use",
    description: "Call one computer-use tool on the desktop of your server environment (from computer_list_tools). Take a screenshot first, then act at its pixel coordinates.",
    inputSchema: {
      type: "object",
      properties: { tool_name: { type: "string" }, arguments: { type: "object" } },
      required: ["tool_name"],
      additionalProperties: false,
    },
  },
] as const;

const coordinate = { type: "integer", minimum: 0, maximum: 32767 };
const computerTool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) =>
  ({ name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } });

/** The desktop's computer-use tools (1280x800, Chromium, a terminal and a
 * file manager from the right-click menu). */
export const SANDBOX_COMPUTER_TOOLS = [
  computerTool("screenshot", "See the desktop of the server environment (a JPEG at native resolution)."),
  computerTool("get_screen_size", "Get the desktop width and height."),
  computerTool("click", "Click a point on the desktop.", { x: coordinate, y: coordinate, button: { type: "string", enum: ["left", "middle", "right"] }, count: { type: "integer", minimum: 1, maximum: 3 } }, ["x", "y"]),
  computerTool("move", "Move the mouse pointer.", { x: coordinate, y: coordinate }, ["x", "y"]),
  computerTool("drag", "Drag with the left button.", { x: coordinate, y: coordinate, to_x: coordinate, to_y: coordinate }, ["x", "y", "to_x", "to_y"]),
  computerTool("type_text", "Type Unicode text into the focused application.", { text: { type: "string", maxLength: 4000 } }, ["text"]),
  computerTool("key_press", "Press an X11 key or shortcut (Return, ctrl+l, alt+Tab).", { key: { type: "string", pattern: "^[A-Za-z0-9_+]+$", minLength: 1, maxLength: 100 } }, ["key"]),
  computerTool("scroll", "Scroll at a point on the desktop.", { x: coordinate, y: coordinate, direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: { type: "integer", minimum: 1, maximum: 30 } }, ["x", "y", "direction"]),
  computerTool("open_url", "Open an http or https address in the desktop's Chromium; take a screenshot to see it loaded.", { url: { type: "string", pattern: "^https?://", maxLength: 2000 } }, ["url"]),
] as const;

export type UserSandboxToolName = (typeof USER_SANDBOX_TOOLS)[number]["name"];

const MAX_WRITE_BYTES = 1024 * 1024;
/** Contents up to this size travel in one variable; larger ones on stdin
 * (Linux limits one variable to 128 KiB, its base64 included). */
const MAX_WRITE_ENV_BYTES = 64 * 1024;
const MAX_PATH = 4096;

export interface ToolExec {
  exec(input: SandboxExecInput): Promise<SandboxExecOutput>;
  overQuota(): Promise<boolean>;
  /** A refusal for a shell command, or null to run it (an admin who
   * manages this person's plugins and MCP servers: person-integrations.ts). */
  commandRefusal?(command: string): string | null;
  /** A refusal for a file path, or null to use it (misuse guardrail). */
  pathRefusal?(path: string): string | null;
  /** A refusal for other tool text (a page address, file contents), or null. */
  textRefusal?(text: string): string | null;
  /** Safety review before the tool runs. A string stops the call. Plugin and
   * misuse refusals are checked first, so this cannot hide them. */
  beforeCall?(name: string, detail: string): Promise<string | null> | string | null;
}

type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ToolResult { content: ToolContent[]; isError?: boolean }

const text = (value: string, isError = false): ToolResult => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });

function validPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_PATH || value.includes("\u0000")) throw new Error("path must be a non-empty path");
  return value;
}

function commandOutput(result: SandboxExecOutput): ToolResult {
  const body = [
    result.stdout,
    result.stderr ? `${result.stdout ? "\n" : ""}[stderr]\n${result.stderr}` : "",
    result.truncated ? "\n[output shortened]" : "",
    result.timedOut ? "\n[stopped: time limit reached]" : "",
  ].join("").trimStart();
  const exit = `\n[exit ${result.exitCode ?? "unknown"}]`;
  return text(`${wrapUntrusted("tool", body)}${exit}`, result.exitCode !== 0);
}

/** Plugin and misuse refusals win over the safety review. */
function earlyRefusal(name: string, args: Record<string, unknown>, exec: ToolExec): string | null {
  if (name === "run_command" && typeof args.command === "string") return exec.commandRefusal?.(args.command) ?? null;
  if ((name === "read_file" || name === "write_file" || name === "list_files") && typeof args.path === "string") {
    const pathRefused = exec.pathRefusal?.(args.path);
    if (pathRefused) return pathRefused;
  }
  if (name === "write_file" && typeof args.content === "string") {
    const contentRefused = exec.textRefusal?.(args.content);
    if (contentRefused) return contentRefused;
  }
  if (name === "browse" && typeof args.url === "string") return exec.textRefusal?.(args.url) ?? null;
  if (name === "computer_use" && args.tool_name === "open_url") {
    const toolArgs = args.arguments;
    const url = toolArgs && typeof toolArgs === "object" && !Array.isArray(toolArgs) ? (toolArgs as { url?: unknown }).url : undefined;
    if (typeof url === "string") return exec.textRefusal?.(url) ?? null;
  }
  return null;
}

// 2026-10-17 (leftovers of the #690 review): a read names a path, but the
// environment is another machine whose links Sagax cannot see. Before
// read_file or list_files runs, the environment itself resolves the path
// (python3, present in the image): its real place and, for each component
// that is a symbolic link, where that link leads. The server then refuses a
// process secret under /proc, a link into a credential location, or a name
// that looked ordinary but leads to a dotfile (sensitive-path.ts). write_file
// goes through the same resolution. The paths go as arguments to fixed
// scripts, never interpolated into them.
//
// Leftovers of #694/#701 (same day):
// - hard links: a regular file of the sandbox user with more than one link
//   also reports its other names (`aliases`), found by a bounded walk of the
//   home folder (then of the file's own mount when some are elsewhere), never
//   crossing a mount and never following a link; an unreadable folder or too
//   many entries leaves the list incomplete, which fails closed. Root-owned
//   files are not walked: an inode has one owner, so a root-owned file is
//   never a second name of the person's credentials.
// - the race between the check and the use: the resolution also reports the
//   object's identity (`dev:ino`). The read, the listing and the write then
//   open the resolved path themselves (OPEN_GUARD: O_NOFOLLOW, no link at
//   the last step), and check on the descriptor they hold that its path
//   (/proc/self/fd/N; F_GETPATH on macOS for the local tests) is still the
//   resolved one and its identity still the one that was checked. Only then
//   does `head` read that descriptor, `ls` list it (its working folder) or
//   the contents go into it: what was checked is what is used.
const RESOLVE_SCRIPT = [
  "import json, os, stat, sys, time",
  "p = sys.argv[1]",
  "cur = os.getcwd() if not p.startswith('/') else '/'",
  "links = []",
  "for part in p.split('/'):",
  "    if part in ('', '.'):",
  "        continue",
  "    if part == '..':",
  "        cur = os.path.dirname(os.path.realpath(cur))",
  "        continue",
  "    cur = os.path.join(cur, part)",
  "    if os.path.islink(cur):",
  "        links.append(os.path.realpath(cur))",
  "        cur = os.path.realpath(cur)",
  "real = os.path.realpath(p)",
  "out = {'sagaxResolved': 1, 'real': real, 'links': links, 'id': None}",
  "def mount_root(path, dev):",
  "    while path != '/':",
  "        up = os.path.dirname(path)",
  "        try:",
  "            if os.lstat(up).st_dev != dev:",
  "                return path",
  "        except OSError:",
  "            return path",
  "        path = up",
  "    return '/'",
  "def walk(root, st, found, budget):",
  "    stack = [root]",
  "    while stack:",
  "        d = stack.pop()",
  "        try:",
  "            entries = list(os.scandir(d))",
  "        except OSError:",
  "            return False",
  "        for e in entries:",
  "            budget[0] -= 1",
  "            if budget[0] < 0 or time.monotonic() > budget[1]:",
  "                return False",
  "            try:",
  "                es = e.stat(follow_symlinks=False)",
  "            except OSError:",
  "                continue",
  "            if es.st_dev != st.st_dev:",
  "                continue",
  "            if stat.S_ISDIR(es.st_mode):",
  "                stack.append(e.path)",
  "            elif es.st_ino == st.st_ino and e.path != real and e.path not in found:",
  "                found.append(e.path)",
  "                if len(found) >= st.st_nlink - 1:",
  "                    return True",
  "    return len(found) >= st.st_nlink - 1",
  "try:",
  "    st = os.lstat(real)",
  "    out['id'] = '%d:%d' % (st.st_dev, st.st_ino)",
  "    if stat.S_ISREG(st.st_mode) and st.st_nlink > 1 and st.st_uid == os.geteuid():",
  "        found, budget = [], [200000, time.monotonic() + 15]",
  "        home = os.path.realpath(os.path.expanduser('~'))",
  "        roots = []",
  "        try:",
  "            if os.lstat(home).st_dev == st.st_dev:",
  "                roots.append(home)",
  "        except OSError:",
  "            pass",
  "        whole = mount_root(real, st.st_dev)",
  "        if whole not in roots:",
  "            roots.append(whole)",
  "        done = False",
  "        for root in roots:",
  "            done = walk(root, st, found, budget)",
  "            if done or budget[0] < 0 or time.monotonic() > budget[1]:",
  "                break",
  "        out['aliases'] = found[:64]",
  "        out['aliasesComplete'] = bool(done) and len(found) <= 64",
  "except FileNotFoundError:",
  "    pass",
  "sys.stdout.write(json.dumps(out))",
].join("\n");

/** Opens the resolved path (argv: mode read|list|write, the resolved path,
 * the identity the resolution saw or "", then the byte count for a read or
 * the temporary file for a write) and checks the descriptor before using
 * it. Exit 3: the path changed. */
const OPEN_GUARD = [
  "import errno, os, stat, sys",
  "mode, real, want = sys.argv[1], sys.argv[2], sys.argv[3]",
  "def fail(message, code):",
  "    sys.stderr.write(message + '\\n')",
  "    sys.exit(code)",
  "def changed():",
  "    fail('the path changed while it was read', 3)",
  "def where(fd):",
  "    try:",
  "        return os.readlink('/proc/self/fd/%d' % fd)",
  "    except OSError:",
  "        pass",
  "    import fcntl",
  "    if hasattr(fcntl, 'F_GETPATH'):",
  "        return os.fsdecode(fcntl.fcntl(fd, fcntl.F_GETPATH, bytes(1024)).split(b'\\0', 1)[0])",
  "    fail('the opened path could not be checked', 5)",
  "flags = os.O_NOFOLLOW | getattr(os, 'O_CLOEXEC', 0) | os.O_NONBLOCK",
  "created = False",
  "try:",
  "    if mode == 'write':",
  "        try:",
  "            fd = os.open(real, flags | os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666)",
  "            created = True",
  "        except FileExistsError:",
  "            fd = os.open(real, flags | os.O_WRONLY)",
  "    else:",
  "        fd = os.open(real, flags | os.O_RDONLY)",
  "except OSError as error:",
  "    if error.errno == errno.ELOOP:",
  "        changed()",
  "    fail('%s: %s' % (real, error.strerror), 1)",
  "st = os.fstat(fd)",
  "here = where(fd)",
  "ident = '%d:%d' % (st.st_dev, st.st_ino)",
  "if here != real or (ident != want if not created else want != ''):",
  "    if created:",
  "        try:",
  "            if os.lstat(here).st_ino == st.st_ino:",
  "                os.unlink(here)",
  "        except OSError:",
  "            pass",
  "    changed()",
  "os.set_blocking(fd, True)",
  "if mode == 'read':",
  "    if stat.S_ISDIR(st.st_mode):",
  "        fail('%s is a folder; list it with list_files' % real, 1)",
  "    os.dup2(fd, 0)",
  "    os.execvp('head', ['head', '-c', sys.argv[4]])",
  "if mode == 'list':",
  "    if stat.S_ISDIR(st.st_mode):",
  "        os.fchdir(fd)",
  "        os.execvp('ls', ['ls', '-la'])",
  "    os.execvp('ls', ['ls', '-la', '--', real])",
  "if not stat.S_ISREG(st.st_mode):",
  "    fail('%s is not a regular file' % real, 1)",
  "os.ftruncate(fd, 0)",
  "with open(sys.argv[4], 'rb') as source:",
  "    while True:",
  "        chunk = source.read(65536)",
  "        if not chunk:",
  "            break",
  "        view = memoryview(chunk)",
  "        while view:",
  "            view = view[os.write(fd, view):]",
  "os.close(fd)",
].join("\n");

/** Where one path really is in the environment, or a refusal. Anything
 * that cannot be read fails closed. */
export async function resolveInSandbox(path: string, exec: ToolExec): Promise<{ resolved: ResolvedEnvironmentPath } | { refused: string }> {
  // a process secret named outright is refused before anything runs
  const named = resolvedReadRefusal(path, { real: "/", links: [] });
  if (named && procSecretPath(path)) return { refused: named };
  const result = await exec.exec({ argv: ["python3", "-I", "-c", RESOLVE_SCRIPT, path], timeoutSec: 30, maxOutputBytes: 256 * 1024 });
  const unreadable = { refused: `could not resolve ${path} in the environment, so it is not read` };
  if (result.exitCode !== 0 || result.truncated) return unreadable;
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout); } catch { return unreadable; }
  const value = parsed as { sagaxResolved?: unknown; real?: unknown; links?: unknown; id?: unknown; aliases?: unknown; aliasesComplete?: unknown };
  const strings = (list: unknown): list is string[] => Array.isArray(list) && list.every((item) => typeof item === "string");
  if (!value || value.sagaxResolved !== 1 || typeof value.real !== "string" || !value.real.startsWith("/") || !strings(value.links)
    || (value.id !== undefined && value.id !== null && (typeof value.id !== "string" || !/^\d+:\d+$/.test(value.id)))
    || (value.aliases !== undefined && !strings(value.aliases))
    || (value.aliasesComplete !== undefined && typeof value.aliasesComplete !== "boolean")) return unreadable;
  const resolved: ResolvedEnvironmentPath = {
    real: value.real,
    links: value.links,
    id: typeof value.id === "string" ? value.id : null,
    ...(value.aliases !== undefined ? { aliases: value.aliases } : {}),
    ...(value.aliasesComplete !== undefined ? { aliasesComplete: value.aliasesComplete } : {}),
  };
  const others = [...(resolved.real !== path ? [resolved.real] : []), ...(resolved.aliases ?? [])];
  const refused = resolvedReadRefusal(path, resolved) ?? others.map((other) => exec.pathRefusal?.(other)).find((reason) => reason);
  return refused ? { refused } : { resolved };
}

/** The read, listing or write of the resolved path through OPEN_GUARD:
 * `sh -c` with $1 the requested path, $2 the resolved one, $3 the identity
 * the resolution saw, $4 the byte count, $5 the guard. */
function guarded(path: string, resolved: ResolvedEnvironmentPath, command: string, count: string): { argv: string[] } {
  return { argv: ["sh", "-c", command, "sh", path, resolved.real, resolved.id ?? "", count, OPEN_GUARD] };
}

const READ_SCRIPT = 'exec python3 -I -c "$5" read "$2" "$3" "$4"';
const LIST_SCRIPT = 'exec python3 -I -c "$5" list "$2" "$3" ""';

// $4 is the size in bytes. The contents land in a temporary file first and
// reach the target only when all of them arrived (a provisioner from before
// stdin gives an empty stdin: the write is refused, the file untouched);
// the guard then opens the target itself, checks it and truncates and fills
// that descriptor, which keeps the target's own mode.
const WRITE_SCRIPT = [
  'mkdir -p -- "$(dirname -- "$2")" || exit 1',
  't=$(mktemp) || exit 1',
  'trap \'rm -f -- "$t"\' EXIT',
  'if [ -n "${SAGAX_CONTENT_B64+x}" ]; then printf %s "$SAGAX_CONTENT_B64" | base64 -d > "$t"; else head -c "$4" > "$t"; fi',
  '[ "$(wc -c < "$t" | tr -d \' \')" -eq "$4" ] || { echo "the file contents did not all arrive; nothing was written" >&2; exit 4; }',
  'python3 -I -c "$5" write "$2" "$3" "$t"',
].join("\n");

/** A public http(s) URL only; the host egress policy also blocks private
 * destinations, this check just fails fast with a clear message. */
export function browsableUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("url must be an http or https address");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("url must be an http or https address");
  if (url.username || url.password) throw new Error("url must not carry credentials");
  return url.href;
}

const CHROMIUM = ["chromium", "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--hide-scrollbars", "--user-data-dir=/tmp/sagax-chromium"];

const BUTTONS: Record<string, string> = { left: "1", middle: "2", right: "3" };
const SCROLL_BUTTONS: Record<string, string> = { up: "4", down: "5", left: "6", right: "7" };

function intArg(value: unknown, field: string, min: number, max: number, fallback?: number): string {
  if (value === undefined && fallback !== undefined) return String(fallback);
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${field} must be an integer from ${min} to ${max}`);
  return String(value);
}

/** One computer-use call as the exec it becomes: a fixed argv for
 * sagax-desktop, never a shell line; text and addresses travel in SAGAX_*
 * variables. Throws on bad arguments. */
export function sandboxComputerExec(name: string, args: Record<string, unknown>): { argv: string[]; env?: Record<string, string>; timeoutSec: number; maxOutputBytes?: number } {
  const point = () => [intArg(args.x, "x", 0, 32767), intArg(args.y, "y", 0, 32767)];
  switch (name) {
    case "screenshot":
      return { argv: ["sagax-desktop", "screenshot"], timeoutSec: 30, maxOutputBytes: 1024 * 1024 };
    case "get_screen_size":
      return { argv: ["sagax-desktop", "xdotool", "getdisplaygeometry"], timeoutSec: 30 };
    case "click": {
      const button = BUTTONS[String(args.button ?? "left")];
      if (!button) throw new Error("button must be left, middle or right");
      return { argv: ["sagax-desktop", "xdotool", "mousemove", "--sync", ...point(), "click", "--repeat", intArg(args.count, "count", 1, 3, 1), "--delay", "100", button], timeoutSec: 30 };
    }
    case "move":
      return { argv: ["sagax-desktop", "xdotool", "mousemove", "--sync", ...point()], timeoutSec: 30 };
    case "drag":
      return {
        argv: ["sagax-desktop", "xdotool", "mousemove", "--sync", ...point(), "mousedown", "1", "mousemove", "--sync",
          intArg(args.to_x, "to_x", 0, 32767), intArg(args.to_y, "to_y", 0, 32767), "mouseup", "1"],
        timeoutSec: 30,
      };
    case "type_text": {
      if (typeof args.text !== "string" || !args.text || args.text.length > 4000 || args.text.includes("\u0000")) throw new Error("text must be 1 to 4000 characters");
      return { argv: ["sagax-desktop", "type"], env: { SAGAX_TEXT: args.text }, timeoutSec: 120 };
    }
    case "key_press": {
      if (typeof args.key !== "string" || !/^[A-Za-z0-9_+]{1,100}$/.test(args.key)) throw new Error("key must be an X11 key name such as Return or ctrl+l");
      return { argv: ["sagax-desktop", "xdotool", "key", "--clearmodifiers", args.key], timeoutSec: 30 };
    }
    case "scroll": {
      const button = SCROLL_BUTTONS[String(args.direction)];
      if (!button) throw new Error("direction must be up, down, left or right");
      return { argv: ["sagax-desktop", "xdotool", "mousemove", "--sync", ...point(), "click", "--repeat", intArg(args.amount, "amount", 1, 30, 3), "--delay", "80", button], timeoutSec: 30 };
    }
    case "open_url":
      return { argv: ["sagax-desktop", "open-url"], env: { SAGAX_URL: browsableUrl(args.url) }, timeoutSec: 30 };
    default:
      throw new Error(`unknown computer-use tool ${name}; list them with computer_list_tools`);
  }
}

async function callSandboxComputerTool(name: string, args: Record<string, unknown>, exec: ToolExec): Promise<ToolResult> {
  if (name === "open_url" && typeof args.url === "string") {
    const refused = exec.textRefusal?.(args.url);
    if (refused) return text(refused, true);
  }
  const call = sandboxComputerExec(name, args);
  const result = await exec.exec(call);
  if (name === "screenshot") {
    const data = result.stdout.trim();
    if (result.exitCode !== 0 || !data || result.truncated || !/^[A-Za-z0-9+/=]+$/.test(data)) {
      return text(result.stderr.trim() || "The desktop could not be captured.", true);
    }
    return { content: [{ type: "image", data, mimeType: "image/jpeg" }] };
  }
  if (result.exitCode !== 0) return text(result.stderr.trim() || `${name} failed`, true);
  if (name === "get_screen_size") {
    const [width, height] = result.stdout.trim().split(/\s+/).map(Number);
    return text(JSON.stringify({ width, height }));
  }
  if (name === "open_url") return text("Opening the page in Chromium. Take a screenshot to see it loaded.");
  return text("done");
}

export async function callUserSandboxTool(name: string, args: Record<string, unknown>, exec: ToolExec): Promise<ToolResult> {
  try {
    const refusedEarly = earlyRefusal(name, args, exec);
    if (refusedEarly) return text(refusedEarly, true);
    if (exec.beforeCall) {
      const held = await exec.beforeCall(name, JSON.stringify({ name, arguments: args }));
      if (held) return text(held, true);
    }
    if (name === "run_command") {
      const command = args.command;
      if (typeof command !== "string" || !command.trim() || command.length > 100_000) return text("command must be a non-empty string", true);
      const refused = exec.commandRefusal?.(command);
      if (refused) return text(refused, true);
      const asked = typeof args.timeout_seconds === "number" ? args.timeout_seconds : 120;
      const timeout = Math.min(MISUSE_MAX_COMMAND_SECONDS, Math.max(1, Number.isFinite(asked) ? asked : 120));
      return commandOutput(await exec.exec({ argv: ["bash", "-lc", command], timeoutSec: timeout }));
    }
    if (name === "read_file") {
      const path = validPath(args.path);
      const pathRefused = exec.pathRefusal?.(path);
      if (pathRefused) return text(pathRefused, true);
      const max = Math.min(1_000_000, Math.max(1, Math.floor(typeof args.max_bytes === "number" ? args.max_bytes : 200_000)));
      const where = await resolveInSandbox(path, exec);
      if ("refused" in where) return text(where.refused, true);
      const result = await exec.exec({ ...guarded(path, where.resolved, READ_SCRIPT, String(max)), timeoutSec: 30, maxOutputBytes: max + 1024 });
      if (result.exitCode !== 0) return text(result.stderr.trim() || `could not read ${path}`, true);
      return text(wrapUntrusted("file", result.stdout));
    }
    if (name === "write_file") {
      const path = validPath(args.path);
      const pathRefused = exec.pathRefusal?.(path);
      if (pathRefused) return text(pathRefused, true);
      if (typeof args.content !== "string") return text("content must be a string", true);
      const contentRefused = exec.textRefusal?.(args.content);
      if (contentRefused) return text(contentRefused, true);
      const bytes = Buffer.from(args.content, "utf8");
      if (bytes.length > MAX_WRITE_BYTES) return text("content is larger than 1 MiB; write it in parts or generate it with run_command", true);
      if (await exec.overQuota()) return text("Your server environment is over its disk quota. Delete files in /workspace first.", true);
      // The same resolution as a read: a write through a link into `.ssh`
      // (authorized_keys), `.git-credentials` or a dotfile is refused, and
      // the write lands on the resolved path only while the path still
      // leads there. The contents never ride the command line: a variable
      // when small, stdin beyond (sandboxd-k8s.ts withExecEnv carries both
      // on stdin on Kubernetes).
      const where = await resolveInSandbox(path, exec);
      if ("refused" in where) return text(where.refused, true);
      const content = bytes.toString("base64");
      const result = await exec.exec({
        ...guarded(path, where.resolved, WRITE_SCRIPT, String(bytes.length)),
        ...(bytes.length <= MAX_WRITE_ENV_BYTES ? { env: { SAGAX_CONTENT_B64: content } } : { stdinBase64: content }),
        timeoutSec: 60,
      });
      return result.exitCode === 0 ? text(`wrote ${bytes.length} bytes to ${path}`) : text(result.stderr.trim() || `could not write ${path}`, true);
    }
    if (name === "list_files") {
      const path = args.path === undefined ? "/workspace" : validPath(args.path);
      const pathRefused = exec.pathRefusal?.(path);
      if (pathRefused) return text(pathRefused, true);
      const where = await resolveInSandbox(path, exec);
      if ("refused" in where) return text(where.refused, true);
      return commandOutput(await exec.exec({ ...guarded(path, where.resolved, LIST_SCRIPT, ""), timeoutSec: 30 }));
    }
    if (name === "browse") {
      const url = browsableUrl(args.url);
      const refused = exec.textRefusal?.(url);
      if (refused) return text(refused, true);
      if (args.screenshot === true) {
        const result = await exec.exec({
          argv: ["sh", "-c", `${CHROMIUM.join(" ")} --window-size=1280,900 --screenshot=/tmp/sagax-shot.png "$SAGAX_URL" >/dev/null 2>&1; base64 -w0 /tmp/sagax-shot.png; rm -f /tmp/sagax-shot.png`],
          env: { SAGAX_URL: url },
          timeoutSec: 90,
          maxOutputBytes: 1024 * 1024,
        });
        const data = result.stdout.trim();
        if (result.exitCode !== 0 || !data || result.truncated) return text("The page could not be captured.", true);
        return { content: [{ type: "image", data, mimeType: "image/png" }, { type: "text", text: `screenshot of ${url}` }] };
      }
      const result = await exec.exec({ argv: [...CHROMIUM, "--dump-dom", url], timeoutSec: 90, maxOutputBytes: 512 * 1024 });
      if (result.exitCode !== 0) return text(`The page could not be opened.${result.stderr ? `\n${result.stderr.slice(0, 2000)}` : ""}`, true);
      return text(wrapUntrusted("page", `${result.stdout}${result.truncated ? "\n[page shortened]" : ""}`));
    }
    if (name === "computer_list_tools") return text(JSON.stringify({ tools: SANDBOX_COMPUTER_TOOLS }));
    if (name === "computer_use") {
      if (typeof args.tool_name !== "string" || !args.tool_name) return text("tool_name must name a tool from computer_list_tools", true);
      const toolArgs = args.arguments;
      if (toolArgs !== undefined && (!toolArgs || typeof toolArgs !== "object" || Array.isArray(toolArgs))) return text("arguments must be an object", true);
      return await callSandboxComputerTool(args.tool_name, (toolArgs ?? {}) as Record<string, unknown>, exec);
    }
    return text(`unknown tool ${name}`, true);
  } catch (error) {
    return text(error instanceof Error ? error.message : String(error), true);
  }
}

/** One JSON-RPC MCP request from the proxy (tools/list or tools/call). */
export async function handleUserSandboxMcp(method: string, params: unknown, exec: ToolExec): Promise<unknown> {
  if (method === "tools/list") return { tools: USER_SANDBOX_TOOLS };
  if (method === "tools/call") {
    const call = (params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof call.name !== "string") throw Object.assign(new Error("tools/call needs a tool name"), { status: 400 });
    const args = call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? call.arguments as Record<string, unknown> : {};
    return callUserSandboxTool(call.name, args, exec);
  }
  throw Object.assign(new Error("method not found"), { status: 404 });
}
