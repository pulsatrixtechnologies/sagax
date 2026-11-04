// The coding chat (2026-11-03): a coding task of the bot panel's Coding list
// opened over the chat column, the way a routine run opens, but drawn for
// development. Pure: from the task's own thread (GET /api/threads/:id/messages
// and the live frames, src/lib/use-side-transcript.ts) and its activity entry
// (GET /api/bots/:id/activity/item) to the rows the sheet draws.
//
// - A shell call is a terminal block: its command, its output, its exit, and
//   a test run's counts read off the output (vitest, jest, pytest, cargo, go,
//   node:test, mocha).
// - A file edit is a diff per file: Claude's Edit / MultiEdit / Write, an
//   apply_patch body, Codex's file changes (their own unified diffs), and the
//   output of `git diff` / `git show` run in the shell.
// - Reads in a row are one line of file chips.
// - Anything else stays the transcript's own tool chip.
//
// Paths are never shown whole: under the task's folder they read relative to
// it, elsewhere as their last two segments (`.../src/app.ts`); the same holds
// for command lines and their output. Ids never reach a row's text.
import type { Message } from "@/state/store";
import type { BotActivityDetail, BotActivityItem, BotActivityStep, BotCodeWork } from "../../shared/bot-activity.ts";
import { parseUnifiedDiff, type DiffFile, type DiffLine } from "../../shared/code-runs.ts";
import { workingStepFor } from "../../shared/working-step.ts";

export type Tool = NonNullable<Message["tool"]>;

/** What opens the coding chat (AppState.codingChat). */
export interface CodingChatTarget {
  botId: string;
  /** `thread:<id>` or `cloud:<id>` */
  itemId: string;
  threadId?: string;
  /** The row that was clicked: the header draws at once from it. */
  seed?: BotActivityItem;
}

export interface TestSummary {
  passed: number;
  failed: number;
  skipped: number;
}

export type CodingStep =
  | { kind: "command"; id: string; command: string; output?: string; exitCode?: number; ok?: boolean; durationMs?: number; tests?: TestSummary; diff?: DiffFile[] }
  | { kind: "edit"; id: string; files: DiffFile[]; ok?: boolean; error?: string }
  | { kind: "read"; id: string; paths: string[] }
  | { kind: "tool"; id: string; tool: Tool };

export type CodingRow =
  | { kind: "line"; id: string; message: Message }
  | { kind: "step"; id: string; at: number; step: CodingStep }
  /** Reads in a row: one line of chips. */
  | { kind: "reads"; id: string; at: number; paths: string[]; running: boolean };

/** One file of the Changes summary: every edit of it in the task, summed. */
export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
  /** The row of its newest diff, to jump to. */
  rowId: string;
}

// --- paths ---------------------------------------------------------------

const norm = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

/** The folder's own name (`dispatch-das`), never its path. */
export function folderLabel(folder: string | undefined): string | undefined {
  if (!folder) return undefined;
  return norm(folder).split("/").filter(Boolean).at(-1);
}

/** A path as the sheet shows it: relative under the task's folder, else its
 * last two segments. A relative path stays as it is. */
export function shortPath(path: string, root?: string): string {
  const clean = norm(path.trim());
  if (!clean) return clean;
  if (root) {
    const base = norm(root);
    if (clean === base) return folderLabel(base) ?? clean;
    if (clean.startsWith(`${base}/`)) return clean.slice(base.length + 1);
  }
  const absolute = clean.startsWith("/") || /^[A-Za-z]:\//.test(clean) || clean.startsWith("~/");
  if (!absolute) return clean.replace(/^\.\//, "");
  const parts = clean.split("/").filter((part) => part && !UUID_ONLY.test(part));
  return parts.length <= 2 ? parts.join("/") : `…/${parts.slice(-2).join("/")}`;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ABSOLUTE_PATH = /(?<![\w.~-])(?:\/(?:workspace|workspaces|home|Users|root|srv|var|tmp|private|opt|data|mnt|app|repo|repos|code|src|builds?)(?:\/[^\s'"`:;,()<>[\]{}|]+)+)/g;

/** A command line or its output with every server path cut down: the task's
 * folder becomes its name (or nothing before a file under it), any other
 * absolute path its last two segments. */
export function redactPaths(text: string, root?: string): string {
  let out = text;
  if (root) {
    const base = norm(root);
    if (base.length > 1) {
      const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`${escaped}/`, "g"), "").replace(new RegExp(`${escaped}(?![\\w/-])`, "g"), folderLabel(base) ?? "");
    }
  }
  return out.replace(ABSOLUTE_PATH, (match) => shortPath(match)).replace(UUID, "…");
}

// --- tool input and output -----------------------------------------------

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** One string field out of a preview the server cut at its bound (the JSON
 * no longer parses): the field's text up to its closing quote, or to the cut. */
function looseField(text: string, key: string): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)("?)`, "s").exec(text);
  if (!match) return undefined;
  const body = match[1]!.replace(/\\$/, "");
  try {
    return JSON.parse(`"${body}"`) as string;
  } catch {
    return body.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
}

const LOOSE_KEYS = ["command", "cmd", "file_path", "path", "notebook_path", "old_string", "new_string", "content", "input", "patch", "output", "stdout", "stderr", "cwd"];

/** The call's arguments (or result) as the server previewed them: JSON when
 * it parses, else the known string fields read loosely, else the text. */
export function parseToolText(text: string | undefined): Json | unknown[] | string | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return text;
  try {
    return JSON.parse(trimmed) as Json | unknown[];
  } catch {
    // The server's cut marks the end (server/tools/tool-summary.ts).
    const body = trimmed.replace(/\n?\[… preview shortened\]$/, "");
    const loose: Json = {};
    for (const key of LOOSE_KEYS) {
      const value = looseField(body, key);
      if (value !== undefined) loose[key] = value;
    }
    const exit = /"(?:exitCode|exit_code)"\s*:\s*(-?\d+)/.exec(body);
    if (exit) loose.exitCode = Number(exit[1]);
    return Object.keys(loose).length ? loose : text;
  }
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/** `bash -lc '...'` (how Codex reports a command) reads as its script. */
function unwrapShell(command: string): string {
  const wrapped = /^(?:\/(?:usr\/)?bin\/)?(?:bash|zsh|sh)\s+-l?c\s+(['"])([\s\S]*)\1\s*$/.exec(command.trim());
  return wrapped ? wrapped[2]! : command.trim();
}

/** The shell command a call runs, whatever the engine. */
export function commandOf(tool: Tool): string | undefined {
  const input = parseToolText(tool.input);
  if (isRecord(input)) {
    const raw = input.command ?? input.cmd;
    if (Array.isArray(raw)) {
      const words = raw.filter((word): word is string => typeof word === "string");
      if (words.length >= 3 && /^(?:.*\/)?(?:bash|zsh|sh)$/.test(words[0]!) && /^-l?c$/.test(words[1]!)) return words.slice(2).join(" ");
      if (words.length) return words.join(" ");
    }
    if (str(raw)) return unwrapShell(raw as string);
  }
  if (tool.summary) return unwrapShell(tool.summary);
  // An engine that names the call by its command line (Codex, ACP).
  if (/\s/.test(tool.name)) return unwrapShell(tool.name);
  return undefined;
}

/** The folder a call ran in, when it says (Codex `cwd`, a leading `cd`). */
export function commandFolder(tool: Tool): string | undefined {
  const input = parseToolText(tool.input);
  if (isRecord(input) && str(input.cwd)) return input.cwd as string;
  const command = commandOf(tool);
  const cd = command ? /^\s*cd\s+(['"]?)(\/[^'"\s;&|]+)\1/.exec(command) : null;
  return cd?.[2];
}

/** A shell call's output and exit code. */
export function commandResult(tool: Tool): { output?: string; exitCode?: number } {
  const result = parseToolText(tool.output);
  if (result === undefined) return {};
  if (typeof result === "string") return { output: result };
  if (Array.isArray(result)) {
    const text = result.flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : typeof part === "string" ? [part] : [])).join("\n");
    return text ? { output: text } : { output: tool.output };
  }
  const output = [result.output, result.stdout, result.aggregatedOutput, result.stderr]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n");
  const exit = result.exitCode ?? result.exit_code ?? result.code;
  const exitCode = typeof exit === "number" ? exit : undefined;
  if (output || exitCode !== undefined) return { ...(output ? { output } : {}), ...(exitCode !== undefined ? { exitCode } : {}) };
  if (Array.isArray(result.content)) return commandResult({ ...tool, output: JSON.stringify(result.content) });
  return { output: tool.output };
}

// --- diffs -----------------------------------------------------------------

const LCS_MAX_CELLS = 250_000;

/** The lines two texts differ by, unchanged lines kept as context (a longest
 * common subsequence over lines). Past its bound it reads as all removed,
 * then all added. Line numbers count from 1 inside each text. */
export function lineDiff(before: string, after: string): DiffLine[] {
  // A text's closing newline ends its last line; it is no line of its own.
  const split = (text: string) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));
  const a = split(before);
  const b = split(after);
  const out: DiffLine[] = [];
  if (a.length * b.length > LCS_MAX_CELLS) {
    a.forEach((text, index) => out.push({ kind: "del", old: index + 1, text }));
    b.forEach((text, index) => out.push({ kind: "add", new: index + 1, text }));
    return out;
  }
  const m = a.length;
  const n = b.length;
  const table: number[][] = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ kind: "ctx", old: i + 1, new: j + 1, text: a[i]! }); i++; j++; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) { out.push({ kind: "del", old: i + 1, text: a[i]! }); i++; }
    else { out.push({ kind: "add", new: j + 1, text: b[j]! }); j++; }
  }
  while (i < m) { out.push({ kind: "del", old: i + 1, text: a[i]! }); i++; }
  while (j < n) { out.push({ kind: "add", new: j + 1, text: b[j]! }); j++; }
  return out;
}

function fileOf(path: string, lines: DiffLine[], status: DiffFile["status"] = "modified"): DiffFile {
  return {
    path,
    status,
    added: lines.filter((line) => line.kind === "add").length,
    removed: lines.filter((line) => line.kind === "del").length,
    hunks: lines.length ? [{ header: "", lines }] : [],
  };
}

/** An apply_patch body (`*** Begin Patch` / `*** Update File: x` / `@@` /
 * `-old` `+new`) into its files. */
export function parseApplyPatch(text: string): DiffFile[] {
  if (!/\*\*\* (?:Begin Patch|Update File:|Add File:|Delete File:)/.test(text)) return [];
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let lines: DiffLine[] = [];
  const close = () => {
    if (current) {
      current.hunks = lines.length ? [{ header: "", lines }] : [];
      current.added = lines.filter((line) => line.kind === "add").length;
      current.removed = lines.filter((line) => line.kind === "del").length;
    }
    lines = [];
  };
  for (const line of text.split("\n")) {
    const head = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (head) {
      close();
      current = { path: head[2]!.trim(), status: head[1] === "Add" ? "added" : head[1] === "Delete" ? "deleted" : "modified", added: 0, removed: 0, hunks: [] };
      files.push(current);
      continue;
    }
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (move && current) { current.path = move[1]!.trim(); current.status = "renamed"; continue; }
    if (!current || line.startsWith("***") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) lines.push({ kind: "add", text: line.slice(1) });
    else if (line.startsWith("-")) lines.push({ kind: "del", text: line.slice(1) });
    else if (line.startsWith(" ")) lines.push({ kind: "ctx", text: line.slice(1) });
  }
  close();
  return files;
}

/** A Codex file change: `{ path, kind: { type }, diff }` (a unified diff, or a
 * new file's whole text). */
function codexChange(change: Json): DiffFile | null {
  const path = str(change.path);
  if (!path) return null;
  const kind = isRecord(change.kind) ? str(change.kind.type) : str(change.kind);
  const diff = str(change.diff) ?? str(change.unified_diff) ?? "";
  const status: DiffFile["status"] = kind === "add" ? "added" : kind === "delete" ? "deleted" : "modified";
  if (/^(?:diff --git|---|@@)/m.test(diff)) {
    const text = diff.startsWith("diff --git") ? diff : `diff --git a/${path} b/${path}\n${diff}`;
    const parsed = parseUnifiedDiff(text)[0];
    if (parsed) return { ...parsed, path, status: parsed.status === "modified" ? status : parsed.status };
  }
  if (status === "added") return fileOf(path, lineDiff("", diff), "added");
  if (status === "deleted") return fileOf(path, lineDiff(diff, ""), "deleted");
  return fileOf(path, [], status);
}

/** The files a file-editing call changed, as diffs. Empty when the call
 * carries nothing to diff. */
export function editFiles(tool: Tool, root?: string): DiffFile[] {
  const input = parseToolText(tool.input);
  const short = (path: string) => shortPath(path, root);
  if (Array.isArray(input)) {
    return input.flatMap((change) => (isRecord(change) ? [codexChange(change)].filter((file): file is DiffFile => file !== null) : []))
      .map((file) => ({ ...file, path: short(file.path) }));
  }
  if (typeof input === "string") return parseApplyPatch(input).map((file) => ({ ...file, path: short(file.path) }));
  if (!input) return [];
  if (Array.isArray(input.changes)) return editFiles({ ...tool, input: JSON.stringify(input.changes) }, root);
  if (isRecord(input.changes)) {
    // Codex app-server: { "<path>": { add | delete | update } }
    return Object.entries(input.changes).flatMap(([path, value]) => {
      if (!isRecord(value)) return [];
      const kindName = Object.keys(value)[0];
      const body = isRecord(value[kindName!]) ? value[kindName!] as Json : {};
      const change = codexChange({ path, kind: kindName, diff: str(body.unified_diff) ?? str(body.content) ?? "" });
      return change ? [{ ...change, path: short(change.path) }] : [];
    });
  }
  const patch = str(input.patch) ?? str(input.input);
  if (patch && /\*\*\* Begin Patch/.test(patch)) return parseApplyPatch(patch).map((file) => ({ ...file, path: short(file.path) }));
  if (patch && /^(?:diff --git|@@)/m.test(patch)) return parseUnifiedDiff(patch).map((file) => ({ ...file, path: short(file.path) }));
  const path = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path) ?? str(input.target_file);
  if (!path) return [];
  if (Array.isArray(input.edits)) {
    const lines = input.edits.flatMap((edit) => (isRecord(edit) ? lineDiff(str(edit.old_string) ?? "", str(edit.new_string) ?? "") : []));
    return [fileOf(short(path), lines)];
  }
  if (typeof input.old_string === "string" || typeof input.new_string === "string") {
    return [fileOf(short(path), lineDiff(str(input.old_string) ?? "", str(input.new_string) ?? ""))];
  }
  const content = typeof input.content === "string" ? input.content : typeof input.file_text === "string" ? input.file_text : undefined;
  if (content !== undefined) return [fileOf(short(path), lineDiff("", content), "added")];
  return [];
}

// --- tests -----------------------------------------------------------------

const num = (value: string | undefined) => (value ? Number(value) : 0);

/** A test run's counts, read off its output; undefined when it is not one. */
export function testSummary(output: string | undefined): TestSummary | undefined {
  if (!output) return undefined;
  // eslint-disable-next-line no-control-regex
  const text = output.replace(/\u001b\[[0-9;]*m/g, "");
  // vitest: "Tests  2 failed | 40 passed | 1 skipped (43)"
  const vitest = /^\s*Tests\s+(.+?)\s*\(\d+\)\s*$/m.exec(text);
  if (vitest) {
    const part = vitest[1]!;
    return { passed: num(/(\d+) passed/.exec(part)?.[1]), failed: num(/(\d+) failed/.exec(part)?.[1]), skipped: num(/(\d+) (?:skipped|todo)/.exec(part)?.[1]) };
  }
  // jest: "Tests:       1 failed, 11 passed, 12 total"
  const jest = /^\s*Tests:\s+(.+?total)\s*$/m.exec(text);
  if (jest) {
    const part = jest[1]!;
    return { passed: num(/(\d+) passed/.exec(part)?.[1]), failed: num(/(\d+) failed/.exec(part)?.[1]), skipped: num(/(\d+) skipped/.exec(part)?.[1]) };
  }
  // pytest: "==== 3 passed, 1 failed, 2 skipped in 0.12s ===="
  const pytest = /^=+ (.*\b(?:passed|failed|error)\b.*) in [\d.]+s(?: \([^)]*\))? =+$/m.exec(text);
  if (pytest) {
    const part = pytest[1]!;
    return { passed: num(/(\d+) passed/.exec(part)?.[1]), failed: num(/(\d+) failed/.exec(part)?.[1]) + num(/(\d+) errors?/.exec(part)?.[1]), skipped: num(/(\d+) skipped/.exec(part)?.[1]) };
  }
  // cargo: "test result: ok. 12 passed; 0 failed; 1 ignored" (one per crate)
  const cargo = [...text.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];
  if (cargo.length) {
    return cargo.reduce<TestSummary>((sum, match) => ({ passed: sum.passed + num(match[1]), failed: sum.failed + num(match[2]), skipped: sum.skipped + num(match[3]) }), { passed: 0, failed: 0, skipped: 0 });
  }
  // node:test / TAP: "# pass 5" "# fail 0" "# skipped 1"
  const tapPass = /^# pass (\d+)$/m.exec(text);
  if (tapPass) return { passed: num(tapPass[1]), failed: num(/^# fail (\d+)$/m.exec(text)?.[1]), skipped: num(/^# skip(?:ped)? (\d+)$/m.exec(text)?.[1]) };
  // mocha: "12 passing" "1 failing" "2 pending"
  const mocha = /^\s*(\d+) passing\b/m.exec(text);
  if (mocha) return { passed: num(mocha[1]), failed: num(/^\s*(\d+) failing\b/m.exec(text)?.[1]), skipped: num(/^\s*(\d+) pending\b/m.exec(text)?.[1]) };
  // go test: "ok  	pkg	0.01s" / "FAIL	pkg	0.02s" / "--- FAIL: TestX"
  const goOk = [...text.matchAll(/^ok\s+\S+\s+[\d.]+s/gm)].length;
  const goFail = [...text.matchAll(/^--- FAIL: /gm)].length || [...text.matchAll(/^FAIL\s+\S+\s+[\d.]+s/gm)].length;
  if (goOk || goFail) return { passed: goOk, failed: goFail, skipped: 0 };
  return undefined;
}

// --- rows ------------------------------------------------------------------

type StepKind = "command" | "edit" | "read" | "tool";

export function stepKindOf(tool: Tool): StepKind {
  const step = workingStepFor({ name: tool.name, summary: tool.summary, input: tool.input } as Parameters<typeof workingStepFor>[0]);
  const bare = tool.name.replace(/^mcp__.+?__/, "").toLowerCase();
  if (/^(apply_patch|filechange|file_change)$/.test(bare)) return "edit";
  if (step?.key === "run" && commandOf(tool)) return "command";
  if (step?.key === "editFile" || step?.key === "writeFile") return "edit";
  if (step?.key === "readFile") return "read";
  return "tool";
}

function readPaths(tool: Tool, root?: string): string[] {
  const input = parseToolText(tool.input);
  if (isRecord(input)) {
    const path = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path) ?? str(input.absolute_path) ?? str(input.filename);
    if (path) return [shortPath(path, root)];
    if (Array.isArray(input.paths)) return input.paths.filter((path): path is string => typeof path === "string").map((path) => shortPath(path, root));
  }
  if (tool.files?.length) return tool.files.map((path) => shortPath(path, root));
  // An ACP title "Read src/app.ts".
  const titled = /^\S+\s+(\S+)$/.exec(tool.name);
  return titled ? [shortPath(titled[1]!, root)] : [];
}

/** One tool call as a coding step. */
export function codingStep(id: string, tool: Tool, root?: string): CodingStep {
  const kind = stepKindOf(tool);
  if (kind === "command") {
    const command = redactPaths(commandOf(tool)!, root);
    const { output, exitCode } = commandResult(tool);
    const shown = output !== undefined ? redactPaths(output, root) : undefined;
    const raw = commandOf(tool)!;
    const diff = /^\s*(?:cd\s+\S+\s*&&\s*)?git\s+(?:diff|show)\b/.test(raw) && output && /^diff --git /m.test(output)
      ? parseUnifiedDiff(output).map((file) => ({ ...file, path: shortPath(file.path, root) }))
      : undefined;
    return {
      kind: "command",
      id,
      command,
      ...(shown !== undefined ? { output: shown } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...(tool.ok !== undefined ? { ok: tool.ok && (exitCode === undefined || exitCode === 0) } : {}),
      ...(tool.durationMs !== undefined ? { durationMs: tool.durationMs } : {}),
      ...(testSummary(output) ? { tests: testSummary(output)! } : {}),
      ...(diff?.length ? { diff } : {}),
    };
  }
  if (kind === "edit") {
    const files = editFiles(tool, root);
    if (files.length === 0 && tool.files?.length) {
      files.push(...tool.files.map((path) => fileOf(shortPath(path, root), [])));
    }
    if (files.length > 0) {
      const error = tool.ok === false && tool.output ? redactPaths(commandResult(tool).output ?? tool.output, root) : undefined;
      return { kind: "edit", id, files, ...(tool.ok !== undefined ? { ok: tool.ok } : {}), ...(error ? { error } : {}) };
    }
  }
  if (kind === "read") {
    const paths = readPaths(tool, root);
    if (paths.length) return { kind: "read", id, paths };
  }
  return { kind: "tool", id, tool: { ...tool, ...(tool.summary ? { summary: redactPaths(tool.summary, root) } : {}) } };
}

/** The task's folder: the activity entry's repository folder, else the first
 * folder a call named. */
export function codingRoot(messages: readonly Message[], code?: BotCodeWork): string | undefined {
  if (code?.folder) return code.folder;
  for (const message of messages) {
    if (!message.tool) continue;
    const folder = commandFolder(message.tool);
    if (folder) return folder;
  }
  return undefined;
}

/** A message the sheet draws as a bubble: a person's or a bot's words. */
function isLine(message: Message): boolean {
  if (message.kind === "activity" || message.kind === "digest" || message.kind === "compaction") return false;
  return Boolean(message.text?.trim());
}

/** The transcript as the coding chat draws it: words as bubbles, tool calls
 * as coding steps, reads in a row folded into one line of chips. */
export function codingRows(messages: readonly Message[], root?: string): CodingRow[] {
  const rows: CodingRow[] = [];
  for (const message of messages) {
    if (message.tool && message.kind === "activity") {
      const step = codingStep(message.id, message.tool, root);
      const previous = rows.at(-1);
      if (step.kind === "read") {
        if (previous?.kind === "reads") {
          for (const path of step.paths) if (!previous.paths.includes(path)) previous.paths.push(path);
          previous.running = message.tool.ok === undefined;
        } else {
          rows.push({ kind: "reads", id: message.id, at: message.at, paths: [...step.paths], running: message.tool.ok === undefined });
        }
        continue;
      }
      rows.push({ kind: "step", id: message.id, at: message.at, step });
      continue;
    }
    if (isLine(message)) rows.push({ kind: "line", id: message.id, message });
  }
  return rows;
}

/** A task the viewer may not read the thread of: its steps alone. */
export function stepMessages(steps: readonly BotActivityStep[], botId: string, botName: string): Message[] {
  return steps.map((step, index) => ({
    id: `step-${index}`,
    role: "bot",
    kind: "activity",
    text: "",
    at: step.at,
    from: { botId, name: botName },
    tool: {
      name: step.name,
      ...(step.summary ? { summary: step.summary } : {}),
      ...(step.input ? { input: step.input } : {}),
      ...(step.ok !== undefined ? { ok: step.ok } : {}),
      ...(step.error ? { output: step.error } : {}),
      ...(step.files ? { files: step.files } : {}),
    },
  }) as Message);
}

/** Every file the task changed, edits of one file summed, in the order they
 * were first touched. */
export function changedFiles(rows: readonly CodingRow[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const row of rows) {
    if (row.kind !== "step") continue;
    const files = row.step.kind === "edit" && row.step.ok !== false ? row.step.files : [];
    for (const file of files) {
      const known = byPath.get(file.path);
      if (known) {
        known.added += file.added;
        known.removed += file.removed;
        known.rowId = row.id;
      } else {
        byPath.set(file.path, { path: file.path, added: file.added, removed: file.removed, rowId: row.id });
      }
    }
  }
  return [...byPath.values()];
}

/** The newest test run of the task. */
export function latestTests(rows: readonly CodingRow[]): TestSummary | undefined {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!;
    if (row.kind === "step" && row.step.kind === "command" && row.step.tests) return row.step.tests;
  }
  return undefined;
}

/** What the header and the Changes band say of the task's code: its folder's
 * name, branch, the newest commit and pull request its own calls made. */
export function codingPlace(detail: Pick<BotActivityDetail, "code"> | null | undefined, root?: string) {
  const code = detail?.code;
  const folder = folderLabel(code?.folder ?? root);
  const pull = code?.pullRequests.at(0);
  const commit = code?.commits.at(0);
  return {
    folder,
    repo: code?.repo,
    branch: code?.branch ?? commit?.branch ?? code?.branches.at(0)?.name,
    commit,
    pull,
  };
}

/** The extension's grammar for the syntax colours (ChatMarkdown's ids). */
export function languageOf(path: string): string {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  const ext = name.includes(".") ? name.split(".").at(-1)! : "";
  const map: Record<string, string> = {
    mjs: "javascript", cjs: "javascript", mts: "typescript", cts: "typescript",
    h: "c", hpp: "cpp", hh: "cpp", jsonl: "json", yml: "yaml", zsh: "bash", env: "bash",
  };
  return map[ext] ?? ext;
}
