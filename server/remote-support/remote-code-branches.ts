// The bot panel's Coding branches when the repository is not on this server
// but on the bot's own working computer (Details > Coding). The git repo
// lives where the bot cloned and worked; this runs the same actions there,
// over the computer's connected session, and returns the result to the UI.
//
// The transport is one injected `RemoteExec`: it runs one shell command on
// the bot's computer and gives back its exit code and output, or an error
// when the computer cannot be reached (server/remote-support/branch-channels.ts
// wires each kind of computer). The folder is found on that computer first
// (locateBranchFolder), then every git call there does its own `cd`.
//
// One branch read is one round trip (2026-11-02, review: the desktop app
// runs one job at a time and keeps eight, so a read of ten git calls held
// its queue while the bot worked): every value state() needs comes back
// from one script, each git call's exit code and output base64 on its own
// line (`@tag code base64`).
//
// Security: folders, the branch, the commit message and every path go to
// the shell as quoted data (q), never as syntax. The words hold no
// backslash, no `!` and no line break (a word that has one is decoded from
// base64 there), so a channel can pass the whole command through any login
// shell inside `/bin/sh -c '...'` (branch-channels.ts: fish reads
// backslashes in single quotes, csh expands `!` and refuses a line break
// there). A word is never sent as another one: the files a commit names
// keep every byte (setWords), and a word q() cannot carry exactly (a
// trailing line break) is refused. A commit is one command (add, then
// commit), so a refusal before it runs leaves nothing staged. The push
// never forces and never touches the
// default branch; offline and unknown-OS answers carry no address. git's
// reads take no optional lock (GIT_OPTIONAL_LOCKS=0): a status read from the
// panel never holds .git/index.lock while the bot commits in that same
// repository. Credentials (server/routes/bot-code-branches.ts picks them):
// - "computer" (a client's computer through a remote session, the person's
//   own computer or its Local VM): gh and git use that computer's OWN
//   sign-in, and no token of the person's or the server's is ever sent;
// - "person" (the person's cloud computer, their server environment): push
//   and pull requests to GitHub use the person's own GitHub connection, as
//   the server path does on an organization server. The token travels in
//   the exec's variables (`$SAGAX_GH_TOKEN`), never on a command line, and
//   only for the push, the remote HEAD read before it and gh; the push goes
//   to https://github.com/<repo>.git named in the command. Without a
//   connection, that environment's own git and gh sign-in is used, as the
//   bot's own commands there do (a sign-in the person made there is
//   theirs; Sagax only ever puts the person's own connection there); when
//   it is refused, the answer says to connect GitHub
//   (`github_not_connected`). A commit there is authored by the person
//   (their profile's name and email) when the route knows them.
import { parseUnifiedDiff } from "../../shared/code-runs.ts";
import type { BotBranchChange, BotBranchDiff, BotBranchPull, BotBranchState } from "../../shared/bot-code-branches.ts";
import { BranchActionError, firstLine, ghError, githubRepo, parseStatus, PROTECTED_BRANCHES, pushError, stripCredentials, validBranchName } from "../code-branches.ts";

export interface RemoteGitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  /** The channel cut the output (a long diff). */
  truncated?: boolean;
}

/** Runs one shell command on the bot's computer. The command does its own
 * `cd`. `env`: variables for this one command (never on its command line);
 * a channel that must not carry them drops them. `{ error }` means the
 * computer could not be reached (no session, the tunnel is down, the OS is
 * unknown); the message never carries an address. `busy`: it is there but
 * refused more work for now (the desktop app's queue is full, a job of its
 * own holds it, the person's bots run every command their cloud computer
 * takes at once). `tooLong`: the command is longer than that channel
 * carries, so it was not sent. Nothing ran in any of these cases. */
export interface RemoteExec {
  (command: string, timeoutMs?: number, env?: Record<string, string>): Promise<RemoteGitResult | { error: string; busy?: boolean; tooLong?: boolean }>;
  /** Whether that channel carries `command`, measured as it measures it
   * (framed, wrapped, in bytes where Linux caps one argument); nothing is
   * sent. Absent: taken to carry it. */
  fits?(command: string): boolean;
}

/** Who signs the push and the pull request (see the header). */
export interface RemoteBranchCredentials {
  mode: "computer" | "person";
  /** "person": their GitHub connection's token, when they connected one. */
  token?: string;
}

/** The variable that carries the person's token to their own computer. */
const TOKEN_VARIABLE = "SAGAX_GH_TOKEN";
/** git's extra header for github.com from that variable (env assignments,
 * never an argument: no process ever shows the token in its argv). */
const TOKEN_GIT_ENV = `GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0='http.https://github.com/.extraheader' GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$${TOKEN_VARIABLE}" | base64 | tr -d '[:space:]')"`;
const TOKEN_GH_ENV = `GH_TOKEN="$${TOKEN_VARIABLE}" GH_HOST=github.com GH_PROMPT_DISABLED=1`;
/** git's reads never take an optional lock (index.lock for a status). */
const NO_OPTIONAL_LOCKS = "GIT_OPTIONAL_LOCKS=0";

/** Only reads, no hooks, no signing, no config of the repository (the bot)
 * can change what git runs. A reduced set of server/code-branches.ts's
 * overrides, POSIX only (the caller runs this on a known macOS/Linux). */
const GIT_OVERRIDES = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "gpg.program=false", "-c", "log.showSignature=false", "-c", "commit.gpgSign=false", "-c", "protocol.ext.allow=never"];

/** What git answers when no name or email is set to sign a commit. */
const IDENTITY_UNKNOWN = /identity unknown|tell me who you are|unable to auto-detect email|empty ident name|no email was given/i;

/** What a word that goes through base64 holds: a backslash, a `!` or a
 * control character (a line break in a commit message, a tab in a file
 * name). */
// oxlint-disable-next-line no-control-regex -- control characters are exactly what goes through base64
const NOT_PLAIN = /[\\!\u0000-\u001f\u007f]/;
/** base64 decoded on that computer: `base64 --decode`, else BusyBox's `-d`
 * (an option it does not know stops it before it reads anything). */
const DECODE = "{ base64 --decode 2>/dev/null || base64 -d; }";
const base64 = (word: string) => Buffer.from(word, "utf8").toString("base64");

/** A shell word as data: nothing in it is read as syntax, and it holds no
 * backslash, no `!` and no line break (see the header). Single quoted, a
 * quote written '"'"'; a word that is not plain (NOT_PLAIN) is decoded from
 * base64 on that computer, its data written once. A word that ends with a
 * line break is refused (`unsupported_name`): the command substitution that
 * decodes it drops that line break, so it would name another file or folder
 * there (the files a commit names keep every byte: setWords). */
export function q(word: string): string {
  if (word.endsWith("\n")) throw new BranchActionError("A name that ends with a line break cannot be sent to that computer exactly, so nothing ran there. Ask the bot to do it.", "unsupported_name", 409);
  if (NOT_PLAIN.test(word)) return `"$(printf %s '${base64(word)}' | ${DECODE})"`;
  return `'${word.replace(/'/g, `'"'"'`)}'`;
}

/** Commands that set the shell's arguments ("$@") to exactly `words` (after
 * those already there with `append`), every byte kept: plain words quoted
 * (q), the others decoded from base64 with an `x` after them that comes off
 * once out of the command substitution, which drops trailing line breaks (a
 * file "dup<LF>" picked alone was committed as "dup"). A decode that fails
 * ends the command with `failed`. Each word once on the command line,
 * however many commands use them. */
function setWords(words: readonly string[], failed: number, append = false): string {
  return [
    `set --${append ? " \"$@\"" : ""}${words.filter((word) => !NOT_PLAIN.test(word)).map((word) => ` ${q(word)}`).join("")}`,
    ...words.filter((word) => NOT_PLAIN.test(word)).map((word) => `v=$(printf %s '${base64(word)}' | ${DECODE} && printf x) || exit ${failed}; set -- "$@" "\${v%x}"`),
  ].join("; ");
}

/** `cd` to a folder as branch-place.ts writes it: absolute, home relative
 * (`~`, `~/x`, expanded by that computer's shell) or relative to where its
 * commands start ("" is that folder itself). */
export function cdTo(folder: string): string {
  if (folder === "~") return "cd \"$HOME\"";
  if (folder.startsWith("~/")) return `cd "$HOME"/${q(folder.slice(2))}`;
  return `cd -- ${q(folder || ".")}`;
}

/** `sgx_git`: git with the overrides and no optional lock, for the scripts
 * that call git many times (one definition, a shorter command line). A name
 * no profile aliases (a login `sh` expands aliases in scripts). */
const GIT_FUNCTION = `sgx_git() { ${NO_OPTIONAL_LOCKS} git ${GIT_OVERRIDES.map(q).join(" ")} "$@"; }`;

function line(program: "git" | "gh", cwd: string, args: readonly string[], prefix = ""): string {
  const env = [program === "git" ? NO_OPTIONAL_LOCKS : "", prefix].filter(Boolean).join(" ");
  return `${cdTo(cwd)} && ${env ? `${env} ` : ""}${program} ${args.map(q).join(" ")}`;
}

/** The refusal for a computer the channel did not reach, worded for any
 * computer (the person's own cloud computer as much as a client's): offline,
 * there but busy with other work, or a command longer than its connection
 * carries (a commit says which part: commitTooLong). */
function unreached(result: { busy?: boolean; tooLong?: boolean }): BranchActionError {
  if (result.tooLong) return new BranchActionError("That is too long to send to that computer in one command, so nothing ran there. Ask the bot to do it.", "too_long", 413);
  if (result.busy) return new BranchActionError("The computer that holds this branch is busy with other work right now. Try again in a moment.", "busy", 503);
  return new BranchActionError("The computer that holds this branch cannot be reached, so nothing ran there.", "offline", 502);
}

/** Which of these folders on the bot's computer holds `branch` (the first
 * that does), else the first that is a git repository at all, as the real
 * path of its repository's top folder there (git status names paths from
 * the top: a commit run from a folder inside it would miss them); null when
 * none is. "" is where that computer's commands start. An offline computer
 * is refused (`offline`). One round trip. */
export async function locateBranchFolder(exec: RemoteExec, branch: string, folders: readonly string[]): Promise<{ folder: string; hasBranch: boolean } | null> {
  // a folder whose name ends with a line break cannot be named exactly there (q): never another one in its place
  const candidates = [...new Set(folders.filter((folder) => typeof folder === "string" && !folder.endsWith("\n")))].slice(0, 8);
  if (!candidates.length || !validBranchName(branch)) return null;
  const probe = (test: string, tag: string, folder: string) => `(${cdTo(folder)} 2>/dev/null && sgx_git ${test} >/dev/null 2>&1 && printf '%s ' ${tag} && { sgx_git rev-parse --show-toplevel 2>/dev/null || pwd -P; }) && exit 0`;
  const script = [
    GIT_FUNCTION,
    ...candidates.map((folder, index) => probe(`rev-parse --verify --quiet ${q(`refs/heads/${branch}^{commit}`)}`, `b${index}`, folder)),
    ...candidates.map((folder, index) => probe("rev-parse --git-dir", `r${index}`, folder)),
    "exit 3",
  ].join("; ");
  const result = await exec(script, 30_000);
  if ("error" in result) throw unreached(result);
  if (result.exitCode !== 0) return null;
  const found = /^([br])\d+ (\/.*)$/m.exec(result.stdout.trim());
  return found ? { folder: found[2]!.trim(), hasBranch: found[1] === "b" } : null;
}

/** The base candidates when origin has no HEAD, in order (base()). */
const BASE_CANDIDATES = ["origin/main", "origin/master", "main", "master"] as const;
const candidateRef = (name: string) => (name.startsWith("origin/") ? `refs/remotes/${name}` : `refs/heads/${name}`);
/** How much of each read comes back (a status of thousands of files). */
const READ_CAP = 256 * 1024;
/** How a commit's one command says it stopped before git committed: the
 * folder could not be opened, or nothing was staged (the add failed). */
const COMMIT_NO_FOLDER = 97;
const COMMIT_NOT_STAGED = 90;
/** The files a commit names, as literal pathspecs: `add`, the picked files
 * git does not know yet (git add, then git commit); `more`, the other picked
 * files and the old paths of the picked renames (git commit only: it takes
 * them from the folder as it is, and git add refuses by name a staged
 * rename's old path or a staged deletion, in neither the index nor the
 * folder). */
interface NamedFiles {
  add: string[];
  more: string[];
}
const literal = (path: string) => `:(literal)${path}`;

/** The values one branch read takes, from one script on the computer. A
 * line the channel cut short (no line end: the solo Local VM keeps 20,000
 * characters) is kept only as `cut`, never read as a whole value; so is the
 * last value line of an answer the channel says it cut (`truncated`: a
 * remote session's 64 KiB, the cloud computer's 1 MiB), wherever the cut
 * fell. */
export class BranchFacts {
  private readonly results = new Map<string, { code: number; out: string; cut: boolean }>();
  constructor(stdout: string, truncated = false) {
    const lines = stdout.split("\n");
    const matches = lines.map((text) => /^@(\w+) (\d+) ([A-Za-z0-9+/=]*)\r?$/.exec(text));
    let last = -1;
    matches.forEach((match, index) => { if (match) last = index; });
    matches.forEach((match, index) => {
      if (!match) return;
      const cut = index === lines.length - 1 || (truncated && index === last);
      // a cut line decodes its whole groups only
      const data = cut ? match[3]!.slice(0, match[3]!.length - (match[3]!.length % 4)) : match[3]!;
      this.results.set(match[1]!, { code: Number(match[2]), out: Buffer.from(data, "base64").toString("utf8"), cut });
    });
  }

  /** The read's trimmed output when it succeeded and came whole, else undefined. */
  ok(tag: string): string | undefined {
    const result = this.results.get(tag);
    return result && result.code === 0 && !result.cut ? result.out.trim() : undefined;
  }

  /** The read's output as it came, when it succeeded; `cut` when the
   * channel cut it short. */
  raw(tag: string): { out: string; cut: boolean } | undefined {
    const result = this.results.get(tag);
    return result && result.code === 0 ? { out: result.out, cut: result.cut } : undefined;
  }
}

/** The git calls for one branch of one repository on the bot's computer. */
export class RemoteBranchGit {
  private readonly exec: RemoteExec;
  private readonly cwd: string;
  private readonly branch: string;
  private readonly credentials: RemoteBranchCredentials;
  /** The last read of the branch (one round trip), for the values that do
   * not change while one request runs (origin, its HEAD, the base). */
  private facts: Promise<BranchFacts> | undefined;
  constructor(exec: RemoteExec, cwd: string, branch: string, credentials: RemoteBranchCredentials = { mode: "computer" }) {
    this.exec = exec;
    this.cwd = cwd;
    this.branch = branch;
    this.credentials = credentials;
    if (!cwd.trim()) throw new BranchActionError("The branch's working folder on the computer is not known.", "no_path", 409);
    if (!validBranchName(branch)) throw new BranchActionError("That branch name is not valid.", "invalid_branch", 400);
  }

  private get ref(): string {
    return `refs/heads/${this.branch}`;
  }

  /** One command on the computer. `{ error }` from the transport becomes an
   * offline refusal the UI words plainly; the address never leaks. `env`:
   * assignments in front of the program (quoted data). */
  private async run(program: "git" | "gh", args: readonly string[], options: { timeoutMs?: number; withToken?: boolean; env?: string } = {}): Promise<RemoteGitResult> {
    const token = options.withToken ? this.credentials.token : undefined;
    const prefix = [token ? (program === "git" ? TOKEN_GIT_ENV : TOKEN_GH_ENV) : "", options.env ?? ""].filter(Boolean).join(" ");
    const command = line(program, this.cwd, program === "git" ? [...GIT_OVERRIDES, ...args] : args, prefix);
    const result = await this.exec(command, options.timeoutMs, token ? { [TOKEN_VARIABLE]: token } : undefined);
    if ("error" in result) throw unreached(result);
    return result;
  }

  /** The person's own GitHub connection signs this push or pull request (on
   * their cloud computer, when they connected one). Otherwise the
   * computer's own sign-in does. */
  private signedByPerson(): boolean {
    return this.credentials.mode === "person" && Boolean(this.credentials.token);
  }

  /** On the person's cloud computer with no GitHub connection, that
   * environment's own sign-in was used: when GitHub refuses it, the fix is
   * the person's GitHub connection, so the answer says that. */
  private signInRefused(error: BranchActionError, action: string): BranchActionError {
    if (this.credentials.mode !== "person" || this.credentials.token || error.code !== "auth") return error;
    return new BranchActionError(`Connect your own GitHub account to ${action} from here (the GitHub plugin's page, Capabilities > Sources > GitHub connection). The server's credentials are never used for you.`, "github_not_connected", 403);
  }

  /** The command's trimmed stdout when it succeeded, else undefined. */
  private async ok(args: readonly string[]): Promise<string | undefined> {
    const result = await this.run("git", args);
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }

  /** Every value state() needs, in one round trip: the branch, the folder's
   * checked-out branch, origin's branch, origin's HEAD, the base
   * candidates, origin's URL, the last subject, the ahead and behind count
   * against what state() compares with (the remote branch, else the base as
   * base() picks it, `@against` says which), and the status when the branch
   * is checked out in this folder (last: a cut answer keeps the rest).
   * `fresh`: read again (after a change); else the last read is reused. */
  private snapshot(fresh = false): Promise<BranchFacts> {
    if (this.facts && !fresh) return this.facts;
    const ref = this.ref;
    const remoteRef = `refs/remotes/origin/${this.branch}`;
    const candidates = BASE_CANDIDATES.join(" ");
    const script = [
      `${cdTo(this.cwd)} || exit 97`,
      GIT_FUNCTION,
      "f=$(mktemp 2>/dev/null) || exit 98",
      `sgx_read() { t=$1; shift; "$@" </dev/null >"$f" 2>/dev/null; c=$?; printf '@%s %s ' "$t" "$c"; head -c ${READ_CAP} "$f" | base64 | tr -d '[:space:]'; echo; }`,
      `sgx_read sha sgx_git rev-parse --verify --quiet ${q(`${ref}^{commit}`)}`,
      "sgx_read head sgx_git symbolic-ref --quiet --short HEAD",
      `sgx_read remote sgx_git rev-parse --verify --quiet ${q(`${remoteRef}^{commit}`)}`,
      "sgx_read originHead sgx_git symbolic-ref --quiet refs/remotes/origin/HEAD",
      ...BASE_CANDIDATES.map((name, index) => `sgx_read c${index} sgx_git rev-parse --verify --quiet ${q(`${candidateRef(name)}^{commit}`)}`),
      "sgx_read origin sgx_git remote get-url origin",
      `sgx_read subject sgx_git log -1 --format=%s ${q(ref)}`,
      "a=''",
      `if sgx_git rev-parse --verify --quiet ${q(`${remoteRef}^{commit}`)} >/dev/null 2>&1; then a=${q(remoteRef)}; else h=$(sgx_git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null); if [ -n "$h" ]; then a="origin/\${h#refs/remotes/origin/}"; else for n in ${candidates}; do case "$n" in */${q(this.branch)}|${q(this.branch)}) continue;; esac; case "$n" in origin/*) p="refs/remotes/$n";; *) p="refs/heads/$n";; esac; if sgx_git rev-parse --verify --quiet "$p^{commit}" >/dev/null 2>&1; then a=$n; break; fi; done; fi; fi`,
      "printf '@against 0 '; printf %s \"$a\" | base64 | tr -d '[:space:]'; echo",
      `if [ -n "$a" ]; then sgx_read count sgx_git rev-list --left-right --count "$a"${q(`...${ref}`)}; fi`,
      `if [ "$(sgx_git symbolic-ref --quiet --short HEAD 2>/dev/null)" = ${q(this.branch)} ]; then sgx_read status sgx_git status --porcelain=v1 -z --untracked-files=all; fi`,
      "rm -f \"$f\"",
    ].join("; ");
    const read = (async () => {
      const result = await this.exec(script, 60_000);
      if ("error" in result) throw unreached(result);
      if (result.exitCode === 97) throw new BranchActionError("The branch's folder could not be opened on the computer.", "no_path", 409);
      return new BranchFacts(result.stdout, result.truncated === true);
    })();
    this.facts = read;
    read.catch(() => { if (this.facts === read) this.facts = undefined; });
    return read;
  }

  async originUrl(): Promise<string | undefined> {
    return (await this.snapshot()).ok("origin") || undefined;
  }

  async originRepo(): Promise<string | undefined> {
    return githubRepo(await this.originUrl());
  }

  /** origin's HEAD branch as the repository knows it (no network). */
  async originHead(): Promise<string | undefined> {
    const head = (await this.snapshot()).ok("originHead");
    const name = head?.replace(/^refs\/remotes\/origin\//, "");
    return name && validBranchName(name) ? name : undefined;
  }

  async isDefaultBranch(): Promise<boolean> {
    if (PROTECTED_BRANCHES.has(this.branch)) return true;
    return (await this.originHead()) === this.branch;
  }

  /** The base the branch would merge into: origin's HEAD, else main or master. */
  async base(): Promise<string | undefined> {
    const head = await this.originHead();
    if (head) return `origin/${head}`;
    const facts = await this.snapshot();
    for (const [index, name] of BASE_CANDIDATES.entries()) {
      if (name.endsWith(`/${this.branch}`) || name === this.branch) continue;
      if (facts.ok(`c${index}`)) return name;
    }
    return undefined;
  }

  /** The branch is checked out in the thread's folder when that folder's
   * HEAD is this branch; then that folder is its worktree and holds its
   * changes. The bot works one branch at a time in its folder. */
  private async checkedOutHere(): Promise<boolean> {
    return (await this.snapshot()).ok("head") === this.branch;
  }

  /** What is not committed in the folder (read with the branch). */
  private async changes(): Promise<BotBranchChange[]> {
    const status = (await this.snapshot()).raw("status");
    const text = status?.out ?? "";
    // a status cut short (by the read's cap or by the channel) keeps its whole entries only
    const cut = status?.cut === true || Buffer.byteLength(text) >= READ_CAP;
    const entries = parseStatus(cut ? text.slice(0, text.lastIndexOf("\0") + 1) : text);
    // a rename or copy is two fields (its new path, then its old one): one
    // whose old path the cut took is not whole either (picked, its new path
    // alone would be committed as a copy, the old file kept)
    const last = entries.at(-1);
    if (cut && last?.status === "renamed" && !last.from) entries.pop();
    return entries.slice(0, 500);
  }

  async state(): Promise<BotBranchState> {
    const facts = await this.snapshot(true);
    const sha = facts.ok("sha");
    if (!sha) return { exists: false, ahead: 0, behind: 0, pushed: false, changes: [] };
    const here = await this.checkedOutHere();
    const remoteSha = facts.ok("remote");
    const base = await this.base();
    const defaultBranch = base?.replace(/^origin\//, "");
    const isDefault = await this.isDefaultBranch();
    let ahead = 0;
    let behind = 0;
    const against = remoteSha ? `refs/remotes/origin/${this.branch}` : base;
    if (against) {
      // the script counted against what it picked; read again only when that differs
      const counts = facts.ok("against") === against ? facts.ok("count") : await this.ok(["rev-list", "--left-right", "--count", `${against}...${this.ref}`]);
      const [left, right] = (counts ?? "0 0").split(/\s+/).map(Number);
      behind = remoteSha ? left ?? 0 : 0;
      ahead = right ?? 0;
    }
    const changes = here ? await this.changes() : [];
    const subject = facts.ok("subject");
    return {
      exists: true,
      sha,
      ...(here ? { worktree: this.cwd } : {}),
      ...(defaultBranch ? { base: defaultBranch } : {}),
      isDefault,
      pushed: Boolean(remoteSha),
      ahead,
      behind,
      changes,
      ...(subject ? { lastCommit: subject.slice(0, 200) } : {}),
    };
  }

  /** Commit the branch's changes in the folder where it is checked out, in
   * one command there: `git add`, then `git commit` only when the add
   * worked, so a refusal before it runs (too long for that computer's
   * connection, busy, offline) leaves nothing staged. Without `paths` (the
   * panel's dialog with every file checked): every change of the
   * repository, unnamed (`git add --all`, then the whole index), also those
   * the panel does not list (past the 500 it lists, past a cut, made since
   * it read them), as the server path commits every change; the dialog
   * says so. With `paths`: exactly those files, each name to its last byte
   * (setWords), a rename with its old path (a move), a staged deletion too
   * (NamedFiles: git add only for the files git does not know yet). The
   * message is a quoted argument (data), never written to a file on the
   * computer. Too long for
   * that computer: the message alone (`message_too_long_for_computer`), or
   * those files with it (`commit_too_long`), never sent. `author`: the
   * person's name and email, who then authors and commits it (the cloud
   * computer); without it, that computer's own git identity, and none at
   * all is refused plainly: on the cloud computer their profile names them
   * (`no_author`), elsewhere that computer's own git settings do
   * (`no_git_identity`). */
  async commit(message: string, paths?: readonly string[], author?: { name: string; email: string }): Promise<{ sha: string }> {
    const text = message.trim();
    if (!text) throw new BranchActionError("Write a commit message first.", "empty_message", 400);
    if (text.length > 5_000) throw new BranchActionError("That commit message is too long.", "message_too_long", 400);
    if (!(await this.checkedOutHere())) throw new BranchActionError("This branch is not checked out in its folder, so it has no changes to commit.", "not_checked_out");
    const changes = await this.changes();
    if (!changes.length) throw new BranchActionError("Nothing to commit on this branch.", "nothing_to_commit");
    let named: NamedFiles | undefined;
    if (paths?.length) {
      const known = new Map(changes.map((change) => [change.path, change] as const));
      if (!paths.every((path) => known.has(path))) throw new BranchActionError("Some of those files have no changes any more. Refresh and try again.", "stale_files");
      const picked = [...new Set(paths)];
      const add = picked.filter((path) => known.get(path)!.status === "untracked");
      // a renamed file commits with its old path, or the old one stays behind
      const more = [...new Set([...picked, ...picked.flatMap((path) => known.get(path)!.from ?? [])])].filter((path) => !add.includes(path));
      named = { add: add.map(literal), more: more.map(literal) };
    }
    const name = author?.name.trim();
    const email = author?.email.trim();
    const identity = name && email ? `GIT_AUTHOR_NAME=${q(name)} GIT_AUTHOR_EMAIL=${q(email)} GIT_COMMITTER_NAME=${q(name)} GIT_COMMITTER_EMAIL=${q(email)}` : undefined;
    const done = await this.exec(this.commitCommand(text, named, identity));
    if ("error" in done) throw done.tooLong ? this.commitTooLong(text, named, identity) : unreached(done);
    if (done.exitCode === COMMIT_NO_FOLDER) throw new BranchActionError("The branch's folder could not be opened on the computer.", "no_path", 409);
    if (done.exitCode === COMMIT_NOT_STAGED) throw new BranchActionError(firstLine(done.stderr) || "git could not stage those files.", "add_failed", 500);
    if (done.exitCode !== 0) {
      if (IDENTITY_UNKNOWN.test(`${done.stderr}\n${done.stdout}`)) {
        if (this.credentials.mode === "person") throw new BranchActionError("Your name and email are needed to sign a commit here. Add them to your profile first.", "no_author", 403);
        throw new BranchActionError("Git has no name and email on that computer to sign the commit. Set them there (git config --global user.name and user.email), then try again, or ask the bot to commit.", "no_git_identity", 409);
      }
      throw new BranchActionError(firstLine(done.stderr) || firstLine(done.stdout) || "git could not commit.", "commit_failed", 500);
    }
    this.facts = undefined;
    const sha = await this.ok(["rev-parse", "HEAD"]);
    return { sha: sha ?? "" };
  }

  /** The commit as one command: `cd` to the folder, `git add` (every change,
   * or the picked files git does not know yet), then, only when the add
   * worked, `git commit` (the whole index, or every file named: the shell's
   * arguments, each set once). */
  private commitCommand(text: string, named: NamedFiles | undefined, identity: string | undefined): string {
    const git = (args: readonly string[]) => `${NO_OPTIONAL_LOCKS} git ${[...GIT_OVERRIDES, ...args].map(q).join(" ")}`;
    const lines = [`${cdTo(this.cwd)} || exit ${COMMIT_NO_FOLDER}`];
    if (!named) lines.push(`${git(["add", "--all"])} || exit ${COMMIT_NOT_STAGED}`);
    else {
      if (named.add.length) lines.push(setWords(named.add, COMMIT_NOT_STAGED), `${git(["add", "--all"])} -- "$@" || exit ${COMMIT_NOT_STAGED}`);
      if (named.more.length) lines.push(setWords(named.more, COMMIT_NOT_STAGED, named.add.length > 0));
    }
    lines.push(`${identity ? `${identity} ` : ""}${git(["commit", "--no-verify", "--no-gpg-sign", "-m", text])}${named ? " -- \"$@\"" : ""}`);
    return lines.join("; ");
  }

  /** A commit too long for that computer's connection: the message is what
   * does not fit when the command naming no file does not fit either, else
   * the files named with it do (that computer's channel measures both). */
  private commitTooLong(text: string, named: NamedFiles | undefined, identity: string | undefined): BranchActionError {
    const messageFits = named !== undefined && (this.exec.fits?.(this.commitCommand(text, undefined, identity)) ?? true);
    if (messageFits) return new BranchActionError("That commit is too long to send to that computer in one command. Pick fewer files or shorten the message, or ask the bot to commit.", "commit_too_long", 413);
    return new BranchActionError("That commit message is too long for that computer. Shorten it, or ask the bot to commit.", "message_too_long_for_computer", 413);
  }

  /** Push the branch under the same name, never forced, never the default
   * branch: to origin with the computer's own git sign-in, or, signed by the
   * person (their cloud computer, their GitHub connection), to
   * https://github.com/<repo>.git (a remote elsewhere than GitHub, or no
   * connection, takes that environment's own sign-in, which is theirs). */
  async push(): Promise<{ remote: string }> {
    const state = await this.state();
    const remote = await this.originUrl();
    const repo = githubRepo(remote ? stripCredentials(remote) : undefined);
    const signed = Boolean(repo) && this.signedByPerson();
    if (!state.exists) throw new BranchActionError("This branch no longer exists on the computer.", "gone", 404);
    if (state.isDefault || PROTECTED_BRANCHES.has(this.branch)) throw new BranchActionError("The default branch is not pushed from here.", "default_branch");
    if (!remote) throw new BranchActionError("This repository has no origin remote to push to.", "no_remote");
    const target = signed && repo ? `https://github.com/${repo}.git` : "origin";
    const remoteHead = await this.run("git", ["ls-remote", "--symref", "--", target, "HEAD"], { timeoutMs: 60_000, withToken: signed });
    if (remoteHead.exitCode !== 0) throw this.signInRefused(pushError(remoteHead.stderr || remoteHead.stdout), "push");
    const head = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(remoteHead.stdout)?.[1];
    if (head === this.branch) throw new BranchActionError("The default branch is not pushed from here.", "default_branch");
    const result = await this.run("git", ["push", "--porcelain", ...(signed ? [] : ["--set-upstream"]), "--", target, `${this.ref}:${this.ref}`], { timeoutMs: 120_000, withToken: signed });
    if (result.exitCode !== 0) throw this.signInRefused(pushError(result.stderr || result.stdout), "push");
    // Pushed by URL: origin's tracking ref says so, as a push to origin would.
    if (signed && state.sha) await this.run("git", ["update-ref", `refs/remotes/origin/${this.branch}`, state.sha]);
    this.facts = undefined;
    return { remote: stripCredentials(signed && repo ? `https://github.com/${repo}` : remote) };
  }

  /** The subjects of the branch's commits on top of its base, newest first. */
  async subjects(base: string | undefined, limit = 20): Promise<string[]> {
    const text = await this.ok(["log", "--no-merges", `--max-count=${limit}`, "--format=%s", ...(base ? [`${base}..${this.ref}`] : [this.ref])]);
    return (text ?? "").split("\n").map((entry) => entry.trim()).filter(Boolean);
  }

  /** The branch's changes against its base, plus what is not committed yet. */
  async diff(maxBytes = 2 * 1024 * 1024): Promise<BotBranchDiff> {
    const base = await this.base();
    const here = await this.checkedOutHere();
    const mergeBase = base ? await this.ok(["merge-base", base, this.ref]) : undefined;
    const args = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--find-renames"];
    const result = here
      ? await this.run("git", [...args, mergeBase ?? "HEAD"])
      : await this.run("git", [...args, mergeBase ? `${mergeBase}..${this.ref}` : `${this.ref}^..${this.ref}`]);
    if (result.exitCode !== 0 && !result.stdout) throw new BranchActionError(firstLine(result.stderr) || "git could not read the diff.", "diff_failed", 500);
    const truncated = result.stdout.length > maxBytes || result.truncated === true;
    // a cut answer keeps its whole files only
    const cut = result.stdout.lastIndexOf("\ndiff --git", Math.min(maxBytes, result.truncated ? result.stdout.length - 1 : maxBytes));
    const text = truncated ? result.stdout.slice(0, cut > 0 ? cut : maxBytes) : result.stdout;
    return { files: parseUnifiedDiff(text), truncated, ...(base ? { base: base.replace(/^origin\//, "") } : {}) };
  }

  /** Open a pull request from the branch with gh on the computer: its own
   * sign-in, or the person's GitHub connection on their cloud computer. When
   * gh is not installed there, the branch is pushed and GitHub's compare
   * page is returned to open the request by hand (never a push to an
   * upstream fork). */
  async openPr(fallbackTitle: string): Promise<{ pull?: BotBranchPull; compareUrl?: string }> {
    const state = await this.state();
    const repo = await this.originRepo();
    if (!repo) throw new BranchActionError("Pull requests are opened on GitHub only, and this repository's origin is not on GitHub.", "not_github");
    const signed = this.signedByPerson();
    if (state.isDefault) throw new BranchActionError("The default branch is not proposed from here.", "default_branch");
    if (!state.pushed) throw new BranchActionError("Push the branch first: GitHub has no commits for it yet.", "not_pushed");
    const base = (await this.originHead()) ?? state.base ?? "main";
    const compareUrl = `https://github.com/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(this.branch)}?expand=1`;
    const existing = await this.run("gh", ["pr", "list", `--head=${this.branch}`, "--state", "all", "--limit", "1", "--json", "number,url,state,title,isDraft", "--repo", repo], { withToken: signed });
    if (existing.exitCode === 127) return { compareUrl };
    if (existing.exitCode === 0) {
      try {
        const [found] = JSON.parse(existing.stdout) as Array<{ number: number; url: string; state: string; title?: string; isDraft?: boolean }>;
        if (found && found.state === "OPEN") return { pull: { number: found.number, url: found.url, state: "open", ...(found.title ? { title: found.title } : {}), ...(found.isDraft ? { draft: true } : {}) } };
      } catch { /* fall through to create */ }
    }
    const subjects = await this.subjects(base ? `origin/${base}` : undefined);
    // trimmed: a title is one line, and a word never ends with a line break (q)
    const title = (subjects.length === 1 ? subjects[0]! : fallbackTitle.trim() || subjects.at(-1) || this.branch).slice(0, 200).trim();
    const body = subjects.length > 1 ? subjects.map((subject) => `- ${subject}`).join("\n") : "";
    const result = await this.run("gh", ["pr", "create", `--head=${this.branch}`, `--base=${base}`, `--title=${title}`, `--body=${body}`, "--repo", repo], { timeoutMs: 60_000, withToken: signed });
    if (result.exitCode === 127) return { compareUrl };
    if (result.exitCode !== 0) throw this.signInRefused(ghError(result.stderr || result.stdout), "open a pull request");
    const url = /https:\/\/\S+\/pull\/(\d+)/.exec(result.stdout);
    if (!url) throw new BranchActionError("GitHub did not return the pull request's address.", "pr_failed", 502);
    return { pull: { number: Number(url[1]), url: url[0], state: "open" } };
  }

  /** Delete the local branch on the computer. Work not on origin needs
   * `unpushed` (confirmed twice); a checked-out branch is never deleted. */
  async deleteLocal(unpushed: boolean): Promise<void> {
    const state = await this.state();
    if (!state.exists) throw new BranchActionError("This branch no longer exists on the computer.", "gone", 404);
    if (state.isDefault || PROTECTED_BRANCHES.has(this.branch)) throw new BranchActionError("The default branch is never deleted from here.", "default_branch");
    if (state.worktree) throw new BranchActionError("This branch is checked out in its folder. Switch it away first; the panel never deletes a folder.", "checked_out");
    const unsaved = !state.pushed || state.ahead > 0;
    if (unsaved && !unpushed) throw new BranchActionError("This branch has commits that are not pushed. Confirm twice to delete it anyway.", "unpushed");
    const result = await this.run("git", ["branch", unsaved ? "-D" : "-d", "--", this.branch]);
    this.facts = undefined;
    if (result.exitCode !== 0) {
      if (/not fully merged/i.test(result.stderr)) {
        const forced = await this.run("git", ["branch", "-D", "--", this.branch]);
        if (forced.exitCode === 0) return;
      }
      throw new BranchActionError(firstLine(result.stderr) || "git could not delete the branch.", "delete_failed", 500);
    }
  }

  /** Ignore (#2148): the remote branch, the branch's worktree folder (not the
   * main checkout) and the local branch, forced, with no confirmation. */
  async deleteEverywhere(): Promise<{ remote: boolean; local: boolean; errors: string[] }> {
    const state = await this.state();
    if (!state.exists && !state.pushed) return { remote: false, local: false, errors: [] };
    if (state.isDefault || PROTECTED_BRANCHES.has(this.branch)) throw new BranchActionError("The default branch is never deleted from here.", "default_branch");
    const errors: string[] = [];
    let remote = false;
    let local = false;
    if (state.pushed) {
      const url = await this.originUrl();
      const repo = githubRepo(url ? stripCredentials(url) : undefined);
      const signed = Boolean(repo) && this.signedByPerson();
      const target = signed && repo ? `https://github.com/${repo}.git` : "origin";
      const result = await this.run("git", ["push", "--porcelain", "--", target, `:${this.ref}`], { timeoutMs: 120_000, withToken: signed });
      if (result.exitCode === 0 || /remote ref does not exist/i.test(result.stderr)) {
        remote = true;
        await this.run("git", ["update-ref", "-d", `refs/remotes/origin/${this.branch}`]);
      } else errors.push(firstLine(result.stderr || result.stdout) || "git could not delete the remote branch.");
    }
    if (state.exists) {
      if (state.worktree && state.worktree !== this.cwd) {
        const removed = await this.run("git", ["worktree", "remove", "--force", "--", state.worktree]);
        if (removed.exitCode !== 0) errors.push(firstLine(removed.stderr) || "git could not remove the branch's worktree.");
      }
      const result = await this.run("git", ["branch", "-D", "--", this.branch]);
      this.facts = undefined;
      if (result.exitCode === 0) local = true;
      else errors.push(firstLine(result.stderr) || "git could not delete the branch.");
    }
    return { remote, local, errors };
  }
}
