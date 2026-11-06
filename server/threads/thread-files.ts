// The files of one conversation, for the bot panel's Files tab: what the
// person attached, what the bot attached or linked, and what the bot's own
// tools wrote while the conversation ran.
//
// Nothing here widens file access. Every entry is derived from a stored
// message of this thread, and the routes that read bytes pair the entry with
// the same roots the message-scoped file route uses: the private attachment
// store for uploads and attach_file output, the conversation's working folder
// and the bot's workspace for links and written files. A written file is
// recorded on the tool's own activity message (`tool.files`), so it belongs
// to the thread that ran the tool and disappears with it.
import { createHash } from "node:crypto";

import type { Message } from "../store.ts";
import { isLocalFileHref, messageAttachmentTags, renderedMarkdownTargets } from "../messages/message-file.ts";

export type ThreadFileSource = "upload" | "attachment" | "link" | "written";

export interface ThreadFileRef {
  /** Opaque, stable per message and path. Never a host path. */
  id: string;
  messageId: string;
  source: ThreadFileSource;
  /** The reference exactly as the message carries it. */
  path: string;
  name: string;
  /** Known up front for stored attachments; otherwise filled by a stat. */
  mime?: string;
  at: number;
  /** The bot that authored a bot-side entry, for its workspace roots. */
  botId?: string;
}

export interface ThreadFile extends ThreadFileRef {
  size: number | null;
  /** Readable on this server right now. False for a path on a remote
   * computer, a deleted file, or one outside this conversation's roots. */
  available: boolean;
  /** The resolved absolute path on this server, for "Copy path". Present
   * only while the file is available here. */
  localPath?: string;
}

const MAX_PATH_BYTES = 4_096;
const MAX_FILES_PER_CALL = 20;
/** Bounds one listing: a very long thread still answers quickly. */
export const MAX_THREAD_FILES = 500;

const CLAUDE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const PATH_FIELDS = ["file_path", "notebook_path", "path", "filePath", "target_file", "abs_path", "absolute_path"] as const;

/** A tool name that writes a file. Claude's Write family, Codex's file
 * change ("edit"), pi's write/edit, ACP edit tools (titled "Edit x" or
 * "Write x"), and MCP or chat tools named like write_file or create_file.
 * attach_file is not here: it already stores its own message attachment. */
export function isWriteTool(title: string | undefined): boolean {
  const name = (title ?? "").trim();
  if (!name) return false;
  if (CLAUDE_WRITE_TOOLS.has(name)) return true;
  const bare = name.split("__").at(-1)!.toLowerCase();
  if (/^(?:write|edit|create|save)(?:[_-]?files?)?$/.test(bare)) return true;
  if (/^(?:write|create|save|edit)[_-](?:text[_-])?file$|^str[_-]replace/.test(bare)) return true;
  if (/^file[_-](?:write|edit|create)$/.test(bare)) return true;
  // ACP titles carry the target: "Edit src/app.ts", "Write notes.md".
  return /^(?:write|edit|create)\s+\S/i.test(name);
}

function cleanPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path || path.includes("\0") || Buffer.byteLength(path) > MAX_PATH_BYTES) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path) && !/^file:\/\//i.test(path)) return null;
  return path;
}

function pathsOf(input: unknown): string[] {
  if (Array.isArray(input)) {
    // Codex fileChange: [{ path, kind, diff }]; ACP locations: [{ path, line }].
    return input.flatMap((item) => {
      if (typeof item === "string") return [];
      const path = item && typeof item === "object" ? cleanPath((item as Record<string, unknown>).path) : null;
      return path ? [path] : [];
    });
  }
  if (!input || typeof input !== "object") return [];
  const fields = input as Record<string, unknown>;
  for (const field of PATH_FIELDS) {
    const path = cleanPath(fields[field]);
    if (path) return [path];
  }
  // Codex has also shipped changes as { "<path>": change }.
  if (fields.changes) return pathsOf(fields.changes);
  if (Array.isArray(fields.locations)) return pathsOf(fields.locations);
  return [];
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)].slice(0, MAX_FILES_PER_CALL);
}

/** A tool that runs a shell command: Claude's Bash, Codex's exec, pi's bash,
 * ACP "execute" tools and the usual terminal tool names. */
export function isShellTool(title: string | undefined, kind?: string): boolean {
  if (kind === "execute") return true;
  const bare = (title ?? "").trim().split("__").at(-1)!.toLowerCase();
  return /^(?:bash|shell|sh|zsh|powershell|pwsh|terminal|exec(?:_command)?|run_(?:terminal|shell)_(?:cmd|command)|local_shell)$/.test(bare);
}

function shellCommandOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";
  const fields = input as Record<string, unknown>;
  const command = fields.command ?? fields.cmd ?? fields.script;
  if (typeof command === "string") return command;
  // Codex: ["bash", "-lc", "<script>"].
  if (Array.isArray(command)) return command.filter((part): part is string => typeof part === "string").join(" ");
  return "";
}

function shellWord(token: string | undefined): string | null {
  if (!token) return null;
  const word = token.replace(/^(['"])(.*)\1$/, "$2");
  // Variables, substitutions, globs, descriptors and devices are not a file the bot made.
  if (!word || /[$`*?{}()<>|;&"']/.test(word) || word.startsWith("-") || word.startsWith("/dev/") || /^&?\d+$/.test(word)) return null;
  return cleanPath(word);
}

/** The files a shell command visibly writes: redirect targets (> and >>),
 * tee targets, and -o / --output. Best effort from the command text: a file
 * a script writes some other way stays unlinked, which only means no link. */
export function shellWrittenFiles(command: string): string[] {
  if (!command || command.length > 64_000) return [];
  const found: string[] = [];
  // A heredoc body is data, not commands: drop it before reading redirects.
  const script = command.replace(/<<-?[ \t]*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, (match) => match.slice(0, match.indexOf("\n")));
  const redirect = /(?:^|[^<>&\d])\d?>>?\|?[ \t]*("[^"\n]+"|'[^'\n]+'|[^\s;&|<>()]+)/g;
  for (const match of script.matchAll(redirect)) {
    const path = shellWord(match[1]);
    if (path) found.push(path);
  }
  const tokens = script.split(/\s+/);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (/(?:^|\/)tee$/.test(token)) {
      for (let j = i + 1; j < tokens.length && !/^[|;&]/.test(tokens[j]!); j += 1) {
        if (tokens[j]!.startsWith("-")) continue;
        const path = shellWord(tokens[j]!.replace(/[;&|]+$/, ""));
        if (path) found.push(path);
      }
    } else if (token === "-o" || token === "--output" || token === "--outfile") {
      const path = shellWord(tokens[i + 1]?.replace(/[;&|]+$/, ""));
      if (path) found.push(path);
    } else if (/^--(?:output|outfile)=/.test(token)) {
      const path = shellWord(token.slice(token.indexOf("=") + 1).replace(/[;&|]+$/, ""));
      if (path) found.push(path);
    }
  }
  return unique(found);
}

/** The files a tool call writes, read from its raw arguments at the driver.
 * `kind` is ACP's tool kind, where "edit" marks a write whatever the title. */
export function writtenFilesFromToolInput(title: string | undefined, input: unknown, kind?: string): string[] {
  if (isShellTool(title, kind)) return shellWrittenFiles(shellCommandOf(input));
  if (kind !== "edit" && !isWriteTool(title)) return [];
  if (title === "edit" && input && typeof input === "object" && !Array.isArray(input)) {
    // Codex's object form keys each change by its path.
    const fields = input as Record<string, unknown>;
    if (!PATH_FIELDS.some((field) => typeof fields[field] === "string")) {
      const keyed = Object.keys(fields).flatMap((key) => cleanPath(key) ?? []);
      if (keyed.length) return unique(keyed);
    }
  }
  return unique(pathsOf(input));
}

/** Backfill for activity messages stored before `tool.files` existed: read
 * the bounded display preview the message kept. A preview cut short is no
 * longer JSON, so the first path field is recovered from its text. */
export function writtenFilesFromPreview(title: string | undefined, preview: string | undefined): string[] {
  if (!preview) return [];
  if (isShellTool(title)) {
    try {
      return writtenFilesFromToolInput(title, JSON.parse(preview));
    } catch {
      return [];
    }
  }
  if (!isWriteTool(title)) return [];
  try {
    return writtenFilesFromToolInput(title, JSON.parse(preview));
  } catch {
    const match = /"(?:file_path|notebook_path|path|filePath|target_file)"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(preview);
    if (!match) return [];
    try {
      const path = cleanPath(JSON.parse(match[1]!));
      return path ? [path] : [];
    } catch {
      return [];
    }
  }
}

/** What one stored activity message says its tool wrote. Only a call that
 * finished successfully counts: a refused or failed write left nothing. */
export function writtenFilesForMessage(message: Pick<Message, "kind" | "tool">): string[] {
  if (message.kind !== "activity" || !message.tool || message.tool.ok !== true) return [];
  const recorded = (message.tool as { files?: unknown }).files;
  if (Array.isArray(recorded)) return unique(recorded.flatMap((path) => cleanPath(path) ?? []));
  return writtenFilesFromPreview(message.tool.name, message.tool.input);
}

export function threadFileId(messageId: string, path: string): string {
  return createHash("sha256").update(`${messageId}\0${path}`).digest("hex").slice(0, 24);
}

function basenameOf(path: string): string {
  let clean = path;
  if (/^file:\/\//i.test(clean)) {
    try { clean = decodeURIComponent(new URL(clean).pathname); } catch { /* keep the raw spelling */ }
  } else {
    clean = clean.split(/[?#]/, 1)[0]!;
    try { clean = decodeURIComponent(clean); } catch { /* keep the raw spelling */ }
  }
  return clean.split(/[\\/]/).filter(Boolean).at(-1) ?? clean;
}

/** The visible conversation: the parent chain from the active leaf. Files on
 * an abandoned branch are not part of what the person now reads. */
export function activePath<T extends { id: string; parentId?: string | null }>(messages: readonly T[], leafId: string | null | undefined): T[] {
  if (!leafId) return [...messages];
  const byId = new Map(messages.map((message) => [message.id, message]));
  if (!byId.has(leafId)) return [...messages];
  const path: T[] = [];
  const seen = new Set<string>();
  let current = byId.get(leafId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

/** Every file reference the messages carry, newest first, one entry per
 * message and path. `directBotId` is the thread's bot for a direct chat; a
 * channel names each bot message's author in `from`. */
export function threadFileRefs(messages: readonly Message[], directBotId?: string): ThreadFileRef[] {
  const refs: ThreadFileRef[] = [];
  const ids = new Set<string>();
  const push = (message: Message, ref: Omit<ThreadFileRef, "id" | "messageId" | "at">) => {
    const key = threadFileId(message.id, ref.path);
    if (ids.has(key)) return;
    ids.add(key);
    refs.push({ ...ref, id: key, messageId: message.id, at: message.at });
  };
  for (const message of messages) {
    const botId = message.role === "bot" ? directBotId ?? message.from?.botId : undefined;
    if (message.role === "user" && message.kind === "text" && message.text && !message.peerAsk) {
      for (const tag of messageAttachmentTags(message.text)) {
        push(message, { source: "upload", path: tag.path, name: tag.name });
      }
      continue;
    }
    if (message.role !== "bot") continue;
    if (message.kind === "text") {
      const stored = new Set<string>();
      for (const attachment of message.attachments ?? []) {
        stored.add(attachment.path);
        const name = attachment.kind === "file" ? attachment.name : basenameOf(attachment.path);
        push(message, { source: "attachment", path: attachment.path, name, mime: attachment.mime, botId });
      }
      if (message.text) {
        for (const href of renderedMarkdownTargets(message.text)) {
          if (stored.has(href) || !isLocalFileHref(href)) continue;
          push(message, { source: "link", path: href, name: basenameOf(href), botId });
        }
      }
    } else if (message.kind === "activity") {
      for (const path of writtenFilesForMessage(message)) {
        push(message, { source: "written", path, name: basenameOf(path), botId });
      }
    }
  }
  // The same file written three times shows once, at its latest write, and
  // not at all beside the message that then linked it.
  const latestWrite = new Map<string, number>();
  const linked = new Set<string>();
  refs.forEach((ref, index) => {
    if (ref.source === "written") latestWrite.set(ref.path, index);
    else if (ref.source === "link") linked.add(ref.path);
  });
  return refs
    .filter((ref, index) => ref.source !== "written" || (latestWrite.get(ref.path) === index && !linked.has(ref.path)))
    .reverse()
    .slice(0, MAX_THREAD_FILES);
}

/** Attach size and availability. `stat` is the root-contained lookup the
 * byte routes use, so "available" means the download will be served. */
export async function listThreadFiles(
  refs: readonly ThreadFileRef[],
  stat: (ref: ThreadFileRef) => Promise<{ bytes: number; mime: string; path?: string } | null>,
): Promise<ThreadFile[]> {
  return Promise.all(refs.map(async (ref) => {
    const found = await stat(ref).catch(() => null);
    return {
      ...ref,
      mime: ref.mime ?? found?.mime,
      size: found ? found.bytes : null,
      available: Boolean(found),
      ...(found?.path ? { localPath: found.path } : {}),
    };
  }));
}

/** Spread into an item.started event: the key only when there are files,
 * so every other tool event keeps its exact shape. */
export function filesField(files: string[]): { files?: string[] } {
  return files.length ? { files } : {};
}

/** An ACP edit names its target in rawInput or, failing that, locations. */
export function acpWrittenFiles(update: { title?: unknown; kind?: unknown; rawInput?: unknown; locations?: unknown }): string[] {
  const title = typeof update.title === "string" ? update.title : undefined;
  const kind = typeof update.kind === "string" ? update.kind : undefined;
  const fromInput = writtenFilesFromToolInput(title, update.rawInput, kind);
  return fromInput.length ? fromInput : writtenFilesFromToolInput(title, update.locations, kind);
}
