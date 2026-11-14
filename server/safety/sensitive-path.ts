// Which paths of a person's server environment hold credentials or secrets
// (2026-10-17, leftovers of the #688/#689/#690 security review). Pure: no
// disk; the environment is another machine, so its links are resolved there
// (server/sandbox/user-sandbox-tools.ts resolveInSandbox) and the answers come back
// here.
//
// Three readings:
// - sensitiveEnvironmentPath: the name check the owner's environment
//   applies before a read runs without a card (member-environment.ts
//   ownEnvironmentSensitiveRead): a `.`-name or `..` anywhere, a key or
//   credentials file name, or a process secret under /proc;
// - procSecretPath: /proc/<pid|self|thread-self>[/task/<tid>]/environ,
//   cmdline, mem (and the links fd, root, cwd, exe, map_files that lead
//   anywhere): the environment variables and memory of a process, where the
//   person's tokens live. Never read through read_file or list_files;
// - credentialLocation: where a symbolic link must never lead (a component
//   of a read that is a link into `.ssh`, `.git-credentials`,
//   `.config/gh`, `.aws`...): the read is refused, whoever asked.
//
// Hard links (2026-10-17, leftovers of #694/#701): a hard link has no
// target to follow, so the environment lists the file's other names
// (`aliases`, user-sandbox-tools.ts RESOLVE_SCRIPT) when a regular file of
// the sandbox user has more than one; a name in a credential location, or
// a dotfile, refuses the call, and a list that could not be completed fails
// closed. Root-owned files are skipped there: an inode has one owner, so a
// root-owned file is never a hard link to the person's credentials.
// Bind mounts cannot be made from inside the environment (no capability,
// no-new-privileges, the runtime's seccomp profile): the only mounts are the
// provisioner's own (docs/user-sandbox.md).

import { programOf } from "../../shared/custom-rules.ts";
import { sagaxFolder } from "../../shared/human-id.ts";

/** A file name that holds credentials even without a leading dot. */
export const CREDENTIAL_NAME = /^(?:credentials?(?:\.[a-z]+)?|hosts\.yml|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|authorized_keys|known_hosts|[^/]*\.(?:pem|key|p12|pfx|kdbx|keychain(?:-db)?)|kubeconfig|secrets?(?:\.[a-z]+)?|token(?:s)?(?:\.[a-z]+)?)$/i;

/** Dot folders and files that hold a login, a key or a token. */
const CREDENTIAL_DOTNAME = /^\.(?:ssh|gnupg|aws|azure|kube|docker|netrc|npmrc|pypirc|git-credentials|gitconfig|env(?:\..*)?|password-store|vault-token|pgpass|my\.cnf)$/i;

/** Credential folders under .config. */
const CREDENTIAL_CONFIG = /^(?:gh|gcloud|hub|git|op|rclone|doctl|helm)$/i;

const PROC_SECRET = /^\/proc\/[^/]+(?:\/task\/[^/]+)?\/(?:environ|cmdline|mem|fd|root|cwd|exe|map_files|maps|auxv|stack|syscall)(?:\/|$)/;
const DEV_FD = /^\/dev\/(?:fd|stdin|stdout|stderr)(?:\/|$)/;

/** The path's lexical parts: `~` is the home, repeated slashes count once. */
function partsOf(path: string): string[] {
  return path.trim().replace(/^~(?=\/|$)/, "").split(/[\\/]+/).filter(Boolean);
}

/** The path as one absolute string, lexically (no link is followed). */
function lexical(path: string): string {
  return `/${partsOf(path).join("/")}`;
}

/** Whether a path names a process's secrets under /proc (or a descriptor
 * link under /dev/fd that leads to one). */
export function procSecretPath(path: string): boolean {
  if (!path.trim().startsWith("/")) return false;
  const flat = lexical(path);
  return PROC_SECRET.test(flat) || DEV_FD.test(flat);
}

/** Whether a resolved path lies in a credential location. */
export function credentialLocation(path: string): boolean {
  if (procSecretPath(path)) return true;
  const parts = partsOf(path);
  return parts.some((part, index) => CREDENTIAL_NAME.test(part) || CREDENTIAL_DOTNAME.test(part)
    || (part === ".config" && CREDENTIAL_CONFIG.test(parts[index + 1] ?? "")));
}

/** Whether the last part of a path is a dotfile name. */
function hiddenName(path: string): boolean {
  return partsOf(path).at(-1)?.startsWith(".") ?? false;
}

/** Whether a read of this path needs a card even in the owner's own
 * environment for a turn that is not the owner's own: a dotfile, a `..`, a
 * credential name, a percent-encoded name or a process secret. */
export function sensitiveEnvironmentPath(path: string): boolean {
  // a percent-encoded or otherwise escaped name is not read here
  if (/%[0-9a-f]{2}/i.test(path)) return true;
  if (procSecretPath(path)) return true;
  return partsOf(path).some((part) => part.startsWith(".") || CREDENTIAL_NAME.test(part));
}

/** What the environment answered about one path (resolveInSandbox). */
export interface ResolvedEnvironmentPath {
  /** The path with every link followed (a missing tail kept as written). */
  real: string;
  /** For each component of the path that is a symbolic link, where it
   * leads (resolved). */
  links: string[];
  /** The opened object's identity (`dev:ino`), checked again when the file
   * is opened (null: nothing there yet). */
  id?: string | null;
  /** The other names of a regular file with more than one hard link. */
  aliases?: string[];
  /** False when those names could not all be found (an unreadable folder,
   * too many entries): the call fails closed. */
  aliasesComplete?: boolean;
}

/** Why a read of `requested`, resolved as `resolved`, is refused, or null.
 * A process secret is never read; a link in any component that leads into
 * a credential location is refused; and a path whose name looked ordinary
 * but whose real place is sensitive (a link laundering a dotfile) is
 * refused, since its card (or its absence) was decided on the name. */
export function resolvedReadRefusal(requested: string, resolved: ResolvedEnvironmentPath): string | null {
  if (procSecretPath(requested) || procSecretPath(resolved.real)) {
    return "This path holds a process's environment or memory (/proc). It is never read here.";
  }
  if (resolved.links.some((target) => credentialLocation(target))) {
    return "A symbolic link in this path leads to a credential location. It is not followed; name the real path instead.";
  }
  if (!sensitiveEnvironmentPath(requested) && sensitiveEnvironmentPath(resolved.real)) {
    return "This path leads through a symbolic link to a dotfile or a credential path. It is not followed; name the real path instead.";
  }
  // A hard link: a name that is already sensitive got its card on that
  // name; an ordinary one must not lead to a dotfile or a credential file.
  if (!sensitiveEnvironmentPath(requested)) {
    if (resolved.aliasesComplete === false) {
      return "This file has other hard links that could not all be checked, so it is not used here.";
    }
    if ((resolved.aliases ?? []).some((alias) => credentialLocation(alias) || hiddenName(alias))) {
      return "This file is a hard link to a dotfile or a credential file. It is not used here; name the real path instead.";
    }
  }
  return null;
}

/** Whether a read of this path in the owner's own environment is a
 * sensitive one (member-environment.ts ownEnvironmentSensitiveRead reads
 * the same way): the bot's own Sagax-made workspace root is not a
 * credential (its data folder begins with a dot), only a credential path
 * below it is. */
export function sensitiveReadPath(path: string): boolean {
  const made = sagaxFolder(path);
  if (made) return made.rest.length > 0 && sensitiveEnvironmentPath(made.rest.join("/"));
  return sensitiveEnvironmentPath(path);
}

/** Programs that never read the files their operands name: they print text,
 * test a name, make, move, link, write (`tee`) or change the mode or owner
 * of a file (an input redirection on their line is still read). */
const NON_READERS: ReadonlySet<string> = new Set(["echo", "printf", "touch", "mkdir", "chmod", "chown", "chgrp", "mv", "ln", "tee", "test", "[", "[["]);
/** Programs whose last operand is the destination they write (`cp a b`),
 * unless the destination is given by `-t`. */
const COPIERS: ReadonlySet<string> = new Set(["cp", "install", "rsync", "scp"]);
/** Programs whose first operand is a pattern, not a file. */
const PATTERN_FIRST: ReadonlySet<string> = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack"]);
/** A flag whose value is a name pattern, not a file (`find -name '*.pem'`). */
const PATTERN_FLAG = /^-(?:i?name|i?path|i?regex|i?wholename|i?lname)$/;
/** ssh-keygen flags that read an existing key (`-y`, `-l`, `-e`, `-i`, `-p`,
 * `-c`, `-B`); without one, `-f` names the key it writes. */
const KEYGEN_READS = /^-[A-Za-z]*[ylepicB]/;
/** Programs whose operands are URLs or API routes, never local paths, with
 * the flags whose value is a file they read (`curl -T f`, `gh api --input
 * f`); a value `@file` (`-d @f`, `-F k=@f`) is read too. `-o` and every
 * other value is written or is not a file. */
const URL_FILE_FLAGS: ReadonlyMap<string, RegExp> = new Map([
  ["curl", /^(?:-[TEKb]|--(?:upload-file|cert|key|cacert|capath|config|netrc-file|cookie))$/],
  ["wget", /^(?:-i|--(?:input-file|certificate|private-key|ca-certificate|load-cookies|post-file|body-file))$/],
  ["gh api", /^--input$/],
]);
/** A message, title or body given by its flag (`git commit -m "..."`, `gh
 * issue create --title "..."`): text, not a path. A value with a command
 * substitution in it is kept, since that command runs. */
const MESSAGE_VALUE = /(^|\s)(?:-a?m|--message|--title|--body|--subject)(?:=|\s+)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;&|]+)/g;
/** A source file named like a credential (`src/auth/token.ts`) and a
 * committed example of an env file hold no credential. */
const NOT_A_CREDENTIAL_FILE = /^(?:[^/]*\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|cs|php|md)|\.env\.(?:example|sample|template|dist))$/i;
/** An output redirection and its target (`> f`, `>> f`, `2> f`, `&> f`,
 * `>&2`): written, never read. A process substitution `>(...)` stays. */
const OUTPUT_REDIRECTION = /(?:\d*|&)>>?[|&]?(?!\()\s*['"]?[^\s<>'"&;|()]*['"]?/g;
/** An input redirection and its source (`< f`), not a here-doc. */
const INPUT_REDIRECTION = /(?<!<)<(?![<(])\s*['"]?([^\s<>'"]+)['"]?/g;

/** Whether a shell word reads as a path: it has a `/`, starts with `~` or
 * `.`, or is a file name with an extension. A bare word (`token`, `secret`,
 * a commit message's words, a search term) is not a file. */
function pathLike(word: string): boolean {
  return word.includes("/") || /^[~.]/.test(word) || /[^.]\.[A-Za-z0-9]+$/.test(word);
}

/** A standard stream (`/dev/stdin`, `/dev/stdout`, `/dev/stderr`,
 * `/dev/fd/0` to `/dev/fd/2`): the call's own input and output, not a
 * process secret. */
const STANDARD_STREAM = /^\/dev\/(?:stdin|stdout|stderr|fd\/[0-2])$/;

/** #3697: whether a read of this path, by a file tool or by a shell line,
 * reads a credential (one predicate for both): a process secret, or a
 * credential location (credentialLocation) other than a standard stream, a
 * source file or an env example. A source file or an env example is still
 * one inside a credential dot folder (`~/.ssh`, `~/.aws`) or a credential
 * folder under .config; a folder only named like a credential (`src/tokens`,
 * `server/secrets`) does not make its source files credentials. */
export function credentialReadPath(path: string): boolean {
  if (path.trim().startsWith("/") && STANDARD_STREAM.test(lexical(path))) return false;
  if (!credentialLocation(path)) return false;
  if (procSecretPath(path)) return true;
  const parts = partsOf(path);
  if (!NOT_A_CREDENTIAL_FILE.test(parts.at(-1) ?? "")) return true;
  const folders = parts.slice(0, -1);
  return folders.some((part, index) => CREDENTIAL_DOTNAME.test(part)
    || (part === ".config" && CREDENTIAL_CONFIG.test(folders[index + 1] ?? "")));
}

/** #3697: the credential locations and process secrets a shell line reads
 * (credentialLocation): every path-like word of each command on the line
 * (`;`, `&&`, `|`, `$(...)`, `(`, backticks), the program word included (a
 * quoted path inside an interpreter's one-liner lands there), a value after
 * `=` (`--env-file=.env`, `if=/proc/self/environ`) and every input
 * redirection (`< file`). Not read, so not counted: an output redirection's
 * target, the operands of a program that does not read them (echo, printf,
 * touch, mkdir, chmod, chown, chgrp, mv, ln, tee, test, `git check-ignore`,
 * ssh-keygen writing a key), a copy's destination, a search or name pattern
 * (grep's first operand, `find -name`), a message (`-m`, `--title`,
 * `--body`), a URL or API route (curl, wget and `gh api` operands, a word
 * with a scheme). `$HOME` reads as `~`. The program is found by
 * shared/custom-rules.ts programOf (wrappers and their flags skipped).
 * Each path is judged by credentialReadPath, the same rule as a file
 * tool's path. Lexical: no link is followed, and the line is read as text,
 * so a name joined from quoted pieces (`cat ."env"`), a path built while
 * the command runs, a list of paths fed to another program (`xargs cat <
 * list.txt`) and an interactive terminal's keystrokes are not seen. */
export function shellCredentialPaths(line: string): string[] {
  const found: string[] = [];
  const check = (word: string) => {
    const path = word.replace(/^\$\{?HOME\}?(?=\/|$)/, "~");
    if (!path || path.includes("://") || !pathLike(path)) return;
    if (credentialReadPath(path) && !found.includes(path)) found.push(path);
  };
  const reads = line
    .replace(MESSAGE_VALUE, (whole, lead: string, value: string) => (/\$\(|`/.test(value) ? whole : lead))
    .replace(OUTPUT_REDIRECTION, " ");
  for (const segment of reads.split(/\n|\r|;|&&?|\|\|?|`|\$\(|\(|\)/)) {
    for (const match of segment.matchAll(INPUT_REDIRECTION)) check(match[1]!);
    const words = segment.replace(INPUT_REDIRECTION, " ").split(/[\s<>'"{}]+/).filter(Boolean);
    const { index, program } = programOf(words);
    const rest = words.slice(index + 1);
    if (NON_READERS.has(program) || (program === "git" && rest[0] === "check-ignore")) continue;
    if (program === "ssh-keygen" && !rest.some((word) => KEYGEN_READS.test(word))) continue;
    if (index < words.length) check(words[index]!);
    const fileFlags = URL_FILE_FLAGS.get(program === "gh" && rest[0] === "api" ? "gh api" : program);
    const operands: string[] = [];
    let patternPending = PATTERN_FIRST.has(program);
    let skipNext = false;
    let readNext = false;
    let target = false;
    for (const word of rest) {
      if (readNext) { readNext = false; check(word); continue; }
      if (skipNext) { skipNext = false; continue; }
      const eq = word.indexOf("=");
      if (fileFlags) {
        // a URL or route is never a local path; a file flag's value and an
        // `@file` value are read
        const at = word.indexOf("@");
        if (word.startsWith("-") && fileFlags.test(eq > 0 ? word.slice(0, eq) : word)) {
          if (eq > 0) check(word.slice(eq + 1));
          else readNext = true;
        } else if (at === 0 || (at > 0 && word[at - 1] === "=")) check(word.slice(at + 1));
        continue;
      }
      if (word.startsWith("-")) {
        if (eq > 0) check(word.slice(eq + 1));
        if (PATTERN_FLAG.test(word)) skipNext = true;
        else if (COPIERS.has(program) && /^(?:-t|--target-directory)$/.test(word)) { skipNext = true; target = true; }
        else if (COPIERS.has(program) && word.startsWith("--target-directory=")) target = true;
        // a pattern given by its flag (`-e token`): every operand is a file
        else if (patternPending && /^-(?:e|-regexp)$/.test(word)) { patternPending = false; skipNext = true; }
        else if (patternPending && /^-(?:f|-file)$/.test(word)) patternPending = false;
        continue;
      }
      if (patternPending) { patternPending = false; continue; }
      const value = /^[A-Za-z_][A-Za-z0-9_]*=/.exec(word);
      if (value) check(word.slice(value[0].length));
      operands.push(word);
    }
    // a copy's last operand is the destination it writes
    for (const word of COPIERS.has(program) && !target ? operands.slice(0, -1) : operands) check(word);
  }
  return found;
}
