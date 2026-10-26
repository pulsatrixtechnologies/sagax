// The desktop's « Code » section (2026-10-18, lot P1.7,
// docs/superpowers/specs/2026-10-18-code-section-design.md): what the Sagax
// server answers on `/api/code/*`, on top of the Perspicax contract in
// shared/cloud-agents.ts. The artifacts (diff, commits, files) follow the
// DiffView contract of the Perspicax spec, section 8.0.
import type { PerspicaxEnvironment, PerspicaxRun, RunEvent } from "./cloud-agents.ts";

/** Why the section cannot reach Perspicax for this person. */
export type CodeUnavailableReason =
  /** A solo server: Code needs Sagax Business (an organization server). */
  | "solo"
  /** An organization server, but no live sign-in to borrow a token from. */
  | "no_session"
  /** Perspicax did not answer or refused. */
  | "unreachable"
  /** This Perspicax does not serve the cloud agents API yet (404 on
   * `/api/v1/agents/environments`): Code stays hidden. */
  | "not_available";

export interface CodeStatus {
  available: boolean;
  reason?: CodeUnavailableReason;
  /** The Perspicax console's cloud agents page (settings live there). */
  consoleUrl?: string;
  /** Where to learn about Sagax Business (solo servers). */
  businessUrl?: string;
  /** The server talks to the built-in fake Perspicax (verification only). */
  fixture?: boolean;
}

export const SAGAX_BUSINESS_URL = "https://pulsatrix.ca";

/** A run as the section lists it: the Perspicax run, plus the Sagax bot and
 * thread that launched it when it came from a conversation here. */
export interface CodeRun extends PerspicaxRun {
  botId?: string;
  threadId?: string;
  /** A personal run: whether this server handed Perspicax the person's
   * engine subscription token (server/cloud-agents/subscription-depositor.ts). */
  subscription?: CodeSubscription;
}

export type CodeSubscriptionState = "ok" | "missing" | "expired" | "refused";

export interface CodeSubscription {
  state: CodeSubscriptionState;
  engine: "claude-code" | "codex";
  /** ISO time the handed-over token is valid until (state ok). */
  until?: string;
  message?: string;
}

export interface CodeEnvironment extends PerspicaxEnvironment {}

export type CodeEvent = RunEvent;

export type DiffLineKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  old?: number;
  new?: number;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export type DiffFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffFile {
  path: string;
  status: DiffFileStatus;
  added: number;
  removed: number;
  hunks: DiffHunk[];
  binary?: boolean;
  previewable?: boolean;
}

export interface CodeCommit {
  sha: string;
  title: string;
  author?: string;
  at?: string;
}

export interface CodeFileEntry {
  path: string;
  kind: "file" | "dir";
  size?: number;
}

/** An artifact answer: `available: false` while Perspicax does not serve
 * that route yet (a later lot), so the panel says so instead of erroring. */
export interface CodeArtifact<T> {
  available: boolean;
  items: T[];
}

export const FOLLOW_UP_MODES = ["queue", "steer", "interrupt"] as const;
export type FollowUpMode = (typeof FOLLOW_UP_MODES)[number];

const PREVIEWABLE = /\.(?:md|markdown|mdx)$/i;

/** Whether the Preview switch applies (Markdown; text only, never HTML). */
export function previewablePath(path: string): boolean {
  return PREVIEWABLE.test(path);
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Parse a unified diff (`git diff base...HEAD`) into DiffView's files.
 * Pure and total: unknown lines are skipped, never thrown on. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  const start = (path: string) => {
    file = { path, status: "modified", added: 0, removed: 0, hunks: [] };
    files.push(file);
    hunk = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("diff --git ")) {
      const match = / b\/(.+)$/.exec(line);
      start(match ? match[1]! : line.slice("diff --git ".length));
      continue;
    }
    const current = file as DiffFile | null;
    if (!current) continue;
    if (!hunk) {
      if (line.startsWith("new file mode")) current.status = "added";
      else if (line.startsWith("deleted file mode")) current.status = "deleted";
      else if (line.startsWith("rename to ")) { current.status = "renamed"; current.path = line.slice("rename to ".length); }
      else if (line.startsWith("Binary files ")) current.binary = true;
      else if (line.startsWith("+++ ") && line !== "+++ /dev/null") current.path = line.slice(4).replace(/^b\//, "");
    }
    const header = HUNK.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    const open = hunk as DiffHunk | null;
    if (!open) continue;
    if (line.startsWith("+")) {
      open.lines.push({ kind: "add", new: newLine++, text: line.slice(1) });
      current.added += 1;
    } else if (line.startsWith("-")) {
      open.lines.push({ kind: "del", old: oldLine++, text: line.slice(1) });
      current.removed += 1;
    } else if (line.startsWith(" ") || line === "") {
      // a blank line at the very end of the text is the split's tail
      if (line === "" && raw === "") continue;
      open.lines.push({ kind: "ctx", old: oldLine++, new: newLine++, text: line.slice(1) });
    }
  }
  for (const entry of files) entry.previewable = !entry.binary && entry.status !== "deleted" && previewablePath(entry.path);
  return files;
}

/** Lenient read of a `{ files }` answer (or a raw diff text) into DiffFiles. */
export function diffFilesFrom(value: unknown): DiffFile[] {
  if (typeof value === "string") return parseUnifiedDiff(value);
  const files = value && typeof value === "object" ? (value as { files?: unknown }).files : undefined;
  if (typeof files === "string") return parseUnifiedDiff(files);
  if (!Array.isArray(files)) return [];
  const out: DiffFile[] = [];
  for (const row of files) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    if (typeof entry.path !== "string") continue;
    const hunks: DiffHunk[] = Array.isArray(entry.hunks) ? entry.hunks.flatMap((h) => {
      if (!h || typeof h !== "object") return [];
      const hunk = h as Record<string, unknown>;
      const lines: DiffLine[] = Array.isArray(hunk.lines) ? hunk.lines.flatMap((l) => {
        if (!l || typeof l !== "object") return [];
        const item = l as Record<string, unknown>;
        if (item.kind !== "ctx" && item.kind !== "add" && item.kind !== "del") return [];
        return [{
          kind: item.kind,
          text: typeof item.text === "string" ? item.text : "",
          ...(typeof item.old === "number" ? { old: item.old } : {}),
          ...(typeof item.new === "number" ? { new: item.new } : {}),
        }];
      }) : [];
      return [{ header: typeof hunk.header === "string" ? hunk.header : "", lines }];
    }) : [];
    const status = entry.status === "added" || entry.status === "deleted" || entry.status === "renamed" ? entry.status : "modified";
    out.push({
      path: entry.path,
      status,
      added: typeof entry.added === "number" ? entry.added : hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "add").length, 0),
      removed: typeof entry.removed === "number" ? entry.removed : hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "del").length, 0),
      hunks,
      ...(entry.binary === true ? { binary: true } : {}),
      previewable: entry.previewable === true || (entry.binary !== true && status !== "deleted" && previewablePath(entry.path)),
    });
  }
  return out;
}

/** Commits from a `/commits` answer (a list, `{items}`) or a `commits` event (`{commits}`). */
export function commitsFrom(answer: unknown): CodeCommit[] {
  const box = answer && typeof answer === "object" ? answer as { items?: unknown; commits?: unknown } : {};
  const rows = Array.isArray(answer) ? answer : Array.isArray(box.items) ? box.items : Array.isArray(box.commits) ? box.commits : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const c = row as Record<string, unknown>;
    if (typeof c.sha !== "string") return [];
    return [{
      sha: c.sha,
      title: typeof c.title === "string" ? c.title : typeof c.message === "string" ? c.message.split("\n")[0]! : "",
      ...(typeof c.author === "string" ? { author: c.author } : {}),
      ...(typeof c.at === "string" ? { at: c.at } : {}),
    }];
  });
}
