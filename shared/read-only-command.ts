// 2026-10-20 (JC): a command that only reads, on the person's own computer
// (their PC through the desktop app, its Local VM, their cloud computer),
// never asks for approval, whatever the engine or the level. This is the
// strict test: every part of the command line must be a known reader with
// no option that writes or runs something else. Anything it cannot read
// with certainty (a substitution, a redirect to a file, an unknown program,
// a credential path, a secret variable) is not read-only and keeps its card.

const READERS = new Set([
  "ls", "cat", "head", "tail", "grep", "egrep", "fgrep", "rg", "find", "echo", "printf",
  "pwd", "wc", "stat", "du", "df", "which", "whoami", "id", "uname", "tree",
  "basename", "dirname", "realpath", "readlink", "cut", "tr", "sort", "nl", "cd", "true",
  "file", "date",
]);

const GIT_READS = new Set(["status", "log", "diff", "show", "rev-parse", "ls-files", "blame", "describe", "shortlog"]);
const GIT_LISTS = new Set(["branch", "remote", "tag"]);
const GIT_LIST_FLAGS = new Set(["-a", "-r", "-v", "-vv", "--list", "-l", "--show-current", "--all", "--remotes", "list"]);

/** Options that write a file or run another program, by reader. */
const FORBIDDEN_OPTIONS: Record<string, RegExp> = {
  find: /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/,
  rg: /^--pre(=|$)/,
  // short options combine (-uo out.txt): any cluster with o writes a file
  sort: /^-[^-]*o|^--output|^--compress-program/,
  tree: /^-[^-]*o/,
  file: /^-[^-]*C|^--compile/,
  date: /^-[^-]*s|^--set/,
  printf: /^-v/,
  git: /^--output(=|$)|^--ext-diff$|^--textconv$|^-c$|^--config-env/,
};

// Separators are / or \ (a Windows path, security review of #965), and the
// raw line is checked too: an unquoted C:\Users\bob\.ssh\id_rsa loses its
// backslashes to the word splitter.
const SENSITIVE_PATH = /(^|[/\\~\s'"])\.(ssh|aws|gnupg|kube|docker|netrc|git-credentials|npmrc|pypirc|azure|password-store)([/\\\s'"]|$)|\.config[/\\](gh|gcloud)([/\\\s'"]|$)|(^|[/\\\s'"])id_(rsa|dsa|ecdsa|ed25519)|\.(pem|key|p12|pfx|kdbx)(['"]|\s|$)|credentials|(^|[/\\\s'"])proc[/\\]|[/\\]etc[/\\](shadow|sudoers)|(^|[/\\\s'"])\.env(\.|['"]|\s|$)|keychain/i;
/** Quote and space lookalikes a shell does not treat as quotes or spaces but
 * a reader of the line (or PowerShell) may: typographic quotes, primes, no-break
 * and zero-width spaces, line and paragraph separators, fullwidth quotes. */
const LOOKALIKE = /[\u00a0\u02bc\u1680\u180e\u2000-\u200f\u2018-\u201f\u2028\u2029\u202f\u2032\u2033\u205f\u3000\ufeff\uff02\uff07]/;
// oxlint-disable-next-line no-control-regex -- control characters other than tab and newline are refused
const CONTROL_CHAR = /[\u0000-\u0008\u000b-\u001f\u007f]/;
/** A PowerShell drive other than a disk letter (env:, HKLM:, cert:,
 * variable:), or a provider path (FileSystem::\\host). Not a URL. */
const PROVIDER_PATH = /::|(^|[\s'"])[A-Za-z][A-Za-z0-9.]+:(?!\/\/)/;
const SECRET_VARIABLE = /TOKEN|SECRET|KEY|PASS|AUTH|CRED|COOKIE|SESSION|PRIVATE/i;

const RECURSIVE = new Set(["grep", "egrep", "fgrep", "rg", "find", "du", "tree", "ls", "cat"]);
const WHOLE_TREE = new Set(["~", "~/", "/", "$HOME", "${HOME}", "$HOME/", "/root", "/home", "/Users", "~/*", "/*"]);

type Part = { words: string[] };

/** Split a command line into its programs, quote-aware. Null when the line
 * has anything that is not a plain sequence of programs. */
function parts(line: string): Part[] | null {
  // Discarding errors or merging them into the output only reads.
  const text = line.replace(/\s\d?>\s*\/dev\/null/g, " ").replace(/\s2>&1/g, " ");
  const out: Part[] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: "'" | "\"" | null = null;
  const endWord = () => { if (inWord) words.push(word); word = ""; inWord = false; };
  const endPart = () => { endWord(); if (!words.length) return false; out.push({ words }); words = []; return true; };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote === "'") { if (c === "'") quote = null; else word += c; continue; }
    if (c === "`") return null;
    if (c === "$") {
      const rest = text.slice(i + 1);
      const name = /^\{([A-Za-z_][A-Za-z0-9_]*)\}|^([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
      if (!name) return null;
      if (SECRET_VARIABLE.test(name[1] ?? name[2] ?? "")) return null;
      // PowerShell's $env:NAME (and any scoped variable) names another variable
      if (text[i + 1 + name[0].length] === ":") return null;
      word += `$${name[0]}`; inWord = true; i += name[0].length; continue;
    }
    if (quote === "\"") { if (c === "\"") quote = null; else if (c === "\\") { word += text[i + 1] ?? ""; i += 1; } else word += c; continue; }
    if (c === "'" || c === "\"") { quote = c; inWord = true; continue; }
    if (c === "\\") { word += text[i + 1] ?? ""; i += 1; inWord = true; continue; }
    if (c === ">" || c === "<" || c === "(" || c === ")" || c === "{" || c === "}") return null;
    if (c === ";" || c === "\n" || c === "|" || c === "&") {
      const pair = text[i + 1] === c && (c === "|" || c === "&");
      if (c === "&" && !pair) return null; // a background job
      if (!endPart()) return null;
      if (pair) i += 1;
      continue;
    }
    if (/\s/.test(c)) { endWord(); continue; }
    word += c; inWord = true;
  }
  if (quote) return null;
  endWord();
  if (words.length) out.push({ words });
  else if (!out.length) return null;
  else if (/[;|&]\s*$/.test(text) && !/;\s*$/.test(text)) return null; // a dangling pipe
  return out;
}

function readerOnly(words: string[]): boolean {
  const [program, ...args] = words;
  if (!program || program.includes("=") || program.includes("/")) return false;
  if (args.some((arg) => SENSITIVE_PATH.test(arg))) return false;
  // a glob that starts a hidden name (.s*, ~/.ss?/) reaches dotfiles; a
  // network path (\\host\share, //host) leaks credentials on Windows
  if (args.some((arg) => /(^|\/)\.[^/]*[*?[]/.test(arg) || /^(\\\\|\/\/)/.test(arg))) return false;
  // a recursive search of the whole home or disk reads every key file
  if (RECURSIVE.has(program) && args.some((arg) => WHOLE_TREE.has(arg))) return false;
  const forbidden = FORBIDDEN_OPTIONS[program];
  if (forbidden && args.some((arg) => forbidden.test(arg))) return false;
  if (program === "git") {
    let rest = args;
    while (rest[0] === "--no-pager" || rest[0] === "-C") rest = rest[0] === "-C" ? rest.slice(2) : rest.slice(1);
    const [sub, ...subArgs] = rest;
    if (!sub) return false;
    if (GIT_READS.has(sub)) return true;
    if (GIT_LISTS.has(sub)) return subArgs.every((arg) => GIT_LIST_FLAGS.has(arg));
    return false;
  }
  return READERS.has(program);
}

/** Whether a command line only reads: every program in it is a known reader
 * used without an option that writes or runs something else. */
export function isReadOnlyCommand(command: string | undefined): boolean {
  if (typeof command !== "string") return false;
  const line = command.trim();
  if (!line || line.length > 4000) return false;
  // a carriage return, a control character or a quote/space lookalike may
  // split or quote the line differently on the other side: fail to a card
  if (line.includes("\r") || CONTROL_CHAR.test(line) || LOOKALIKE.test(line)) return false;
  // PowerShell (the desktop on Windows) keeps backslashes: \\host\share
  if (/\\\\/.test(line)) return false;
  if (SENSITIVE_PATH.test(line) || PROVIDER_PATH.test(line)) return false;
  const list = parts(line);
  return Boolean(list?.length) && list!.every((part) => readerOnly(part.words));
}

/** The command of a run_command call's arguments (JSON), when there is one. */
export function runCommandOf(input: string | undefined): string | undefined {
  if (!input) return undefined;
  try {
    const args = JSON.parse(input) as Record<string, unknown> | null;
    if (!args || typeof args !== "object") return undefined;
    const nested = args.arguments && typeof args.arguments === "object" ? (args.arguments as Record<string, unknown>).command : undefined;
    const command = typeof args.command === "string" ? args.command : nested;
    return typeof command === "string" ? command : undefined;
  } catch {
    return undefined;
  }
}

/** Programs that run another program or reach the network: a rule for
 * them would cover anything, so they keep an exact rule. */
const LAUNCHERS = new Set([
  "bash", "sh", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "pwsh", "powershell", "cmd", "cmd.exe",
  "python", "python3", "node", "deno", "bun", "ruby", "perl", "php", "lua", "osascript", "awk", "gawk",
  "env", "sudo", "doas", "su", "xargs", "timeout", "nohup", "nice", "exec", "eval", "command", "builtin",
  "time", "watch", "parallel", "npx", "pnpx", "bunx", "uvx", "pipx", "make", "docker", "kubectl",
  "ssh", "scp", "sftp", "rsync", "curl", "wget", "nc", "ncat", "socat", "telnet", "ftp",
  "start-process", "invoke-expression", "iex",
]);

/** 2026-10-20 (JC: "Toujours permettre" = this program, not the exact
 * string): the one program a plain command line runs (`cd` aside), when
 * it parses as plain programs (no substitution, redirect or background
 * job) and runs a single one. Undefined otherwise: such a line keeps an
 * exact rule. */
export function singleProgramOf(command: string | undefined): string | undefined {
  if (typeof command !== "string") return undefined;
  const line = command.trim();
  if (!line || line.length > 4000) return undefined;
  const list = parts(line);
  if (!list?.length) return undefined;
  // a cd elsewhere would carry the rule to another folder
  if (list.some((part) => part.words[0] === "cd")) return undefined;
  const programs = new Set(list.map((part) => part.words[0] ?? ""));
  if (programs.size !== 1) return undefined;
  const [program] = [...programs];
  if (!program || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(program) || LAUNCHERS.has(program.toLowerCase())) return undefined;
  // git -C <elsewhere> / -c <config> runs in another place or another way
  if (program === "git" && list.some((part) => part.words.some((word) => word === "-C" || word === "-c" || word.startsWith("--git-dir") || word.startsWith("--work-tree")))) return undefined;
  return program;
}
