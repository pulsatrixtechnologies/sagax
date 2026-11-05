// An Obsidian vault read into Sagax memory (Tools > Memory > Import,
// 2026-11-03). Pure: the page plans the import with it (the dry run the
// window previews) and the server checks every write with it again
// (server/routes/bot-memory.ts, POST /api/bots/<id>/memory/import).
//
// Rules, none optional:
//   - a path is relative to the vault, with no `..`, `.`, empty, absolute,
//     drive-letter, backslash or control-character segment;
//   - `.obsidian/` and `.trash/` are left out when asked, every other hidden
//     folder or file always;
//   - a file that looks like a secret is never read into a note: a key
//     store or env file by its name, a note whose text holds a credential by
//     the shared secret filter (shared/redact.ts) plus the shapes Perspicax
//     1.9.18's gate refuses (its tokens, connection strings, a URL with a
//     password). Each one is reported, never its value;
//   - sizes are capped: files in a vault, bytes of one note, of one
//     attachment, of the whole vault;
//   - Perspicax tiers follow scripts/memory/import-local.py and the
//     gateway's entry rules: a topic folder of lowercase words (48 at most,
//     never `inbox` or `directory`), a title of 110 characters, a body cut
//     under 3,800 bytes at its paragraphs, 16 tags of `[a-z0-9:._/-]`;
//   - a bot's memory is flat (memory/<name>.md): the folders become the
//     start of the file name, attachments go to memory-attachments/ in its
//     workspace.
import { holdsCredential, redactSecretsInText } from "./redact.ts";

export const VAULT_LIMITS = {
  /** Files read from one vault (notes, attachments and the rest). */
  files: 5_000,
  /** One note's text. */
  noteBytes: 1_000_000,
  /** One image or PDF. */
  attachmentBytes: 10 * 1024 * 1024,
  /** Everything read from the vault. */
  totalBytes: 200 * 1024 * 1024,
} as const;

/** Perspicax entry rules (gateway memory/entry.rs, import-local.py). */
export const PX_TOPIC_MAX = 48;
export const PX_TITLE_MAX = 110;
export const PX_BODY_MAX = 3_800;
export const PX_TAGS_MAX = 16;
export const PX_TAG_MAX = 64;
const PX_RESERVED_TOPICS = new Set(["inbox", "directory"]);

/** A bot memory file (server/workspace/workspace.ts MEMORY_FILE_MAX_BYTES). */
export const BOT_NOTE_MAX_BYTES = 256 * 1024;
export const BOT_ATTACHMENTS_DIR = "memory-attachments";
const BOT_NAME_MAX = 120;

export const ATTACHMENT_EXT = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|pdf)$/i;
const NOTE_EXT = /\.md$/i;

export type VaultConflict = "skip" | "rename" | "overwrite";
export type VaultDestination = "bot" | "perspicax";

export interface VaultImportOptions {
  /** Keep the vault's folders (as Perspicax topics, as a bot file's prefix). */
  keepStructure: boolean;
  /** [[wikilinks]] point at the imported notes' titles. */
  wikilinks: boolean;
  /** #tags and the front matter's tags become tags. */
  tags: boolean;
  /** The front matter stays at the top of the note. */
  properties: boolean;
  /** Images and PDFs embedded with ![[...]] are copied. */
  attachments: boolean;
  /** .obsidian/ and .trash/ are left out. */
  skipSystem: boolean;
  conflict: VaultConflict;
}

export const DEFAULT_VAULT_OPTIONS: VaultImportOptions = {
  keepStructure: true,
  wikilinks: true,
  tags: true,
  properties: true,
  attachments: true,
  skipSystem: true,
  conflict: "skip",
};

export interface VaultFile {
  /** Relative to the vault's root, `/` separated. */
  path: string;
  size: number;
  /** A note's text (attachments and other files carry none). */
  text?: string;
}

/** A note already in the destination: what a conflict is decided against. */
export interface ExistingNote {
  folder: string;
  title: string;
  body?: string;
  /** Perspicax entry id, for an overwrite. */
  id?: string;
}

export type VaultSkipReason =
  | "unsafe_path"
  | "system"
  | "hidden"
  | "secret"
  | "too_large"
  | "empty"
  | "unsupported"
  | "limit"
  | "attachment_unsupported";

export interface VaultSkipped {
  path: string;
  reason: VaultSkipReason;
}

export type PlannedAction = "create" | "overwrite" | "rename" | "skip" | "unchanged";

export interface PlannedNote {
  /** The vault file it comes from (several pieces may share one). */
  source: string;
  /** Perspicax topic, or "" for a bot (flat). */
  folder: string;
  title: string;
  body: string;
  tags: string[];
  action: PlannedAction;
  /** A note of that name was already there. */
  conflict: boolean;
  /** Perspicax: the entry an overwrite replaces. */
  existingId?: string;
  /** Bot: memory/<title>.md. */
  path?: string;
  links: number;
}

export interface PlannedAttachment {
  source: string;
  /** Workspace path (bot): memory-attachments/<folder>/<path>. */
  target: string;
  size: number;
}

export interface VaultPlan {
  vaultName: string;
  destination: VaultDestination;
  folder: string;
  notes: PlannedNote[];
  attachments: PlannedAttachment[];
  skipped: VaultSkipped[];
  counts: {
    notes: number;
    folders: number;
    links: number;
    tags: number;
    attachments: number;
    conflicts: number;
    skipped: number;
    secrets: number;
    unchanged: number;
  };
}

export interface VaultPlanInput {
  vaultName: string;
  files: VaultFile[];
  options: VaultImportOptions;
  destination: VaultDestination;
  /** The folder the vault lands in (a topic, or a bot file prefix); "" keeps none. */
  folder: string;
  existing: ExistingNote[];
}

// ---- paths -------------------------------------------------------------------

/** A vault-relative path, or null when it could leave the vault. */
export function safeVaultPath(raw: string): string | null {
  if (typeof raw !== "string" || !raw) return null;
  if (raw.includes("\\")) return null;
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  const path = raw.replace(/^(?:\.\/)+/, "");
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return parts.join("/");
}

/** The picked folder's or the zip's single top folder: the vault's name. */
export function stripVaultRoot(paths: string[]): { root: string; paths: string[] } {
  const firsts = new Set(paths.map((path) => (path.includes("/") ? path.slice(0, path.indexOf("/")) : "")));
  if (firsts.size !== 1) return { root: "", paths };
  const [root] = [...firsts];
  if (!root) return { root: "", paths };
  return { root, paths: paths.map((path) => path.slice(root.length + 1)) };
}

const SYSTEM_FOLDER = /^(?:\.obsidian|\.trash)$/;

function hiddenSegment(path: string): string | null {
  for (const part of path.split("/")) if (part.startsWith(".")) return part;
  return null;
}

/** Key stores and env files by name: never opened. */
const SECRET_FILE = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.envrc|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.git-credentials|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|authorized_keys|known_hosts|kubeconfig|credentials?(?:\.(?:json|jsonc|ya?ml|toml|txt|ini))?|secrets?(?:\.(?:json|jsonc|ya?ml|toml|txt|ini))?|tokens?(?:\.(?:json|ya?ml|txt))?|[^/]*\.(?:pem|key|p8|p12|pfx|keystore|jks|kdbx|keychain|ovpn|ppk|asc|gpg))$/i;

export function vaultSecretFile(path: string): boolean {
  return SECRET_FILE.test(path);
}

/** Perspicax 1.9.18's gate (memory/filter rules) beyond the shared shapes. */
const PX_GATE_SHAPES: RegExp[] = [
  /\bpxat1\.[A-Za-z0-9_-]{16,}/,
  /\bpxr_[A-Za-z0-9_-]{30,}/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/,
  /(?:^|[;\s])(?:Password|Pwd|AccountKey|SharedAccessKey)\s*=\s*[^;\s]{4,}/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
];

/** Whether a note's text holds a credential (never says which). */
export function vaultTextHoldsSecret(text: string): boolean {
  if (holdsCredential(text)) return true;
  if (PX_GATE_SHAPES.some((re) => re.test(text))) return true;
  // the shared redaction pass also masks key=value credentials and bearer headers
  return redactSecretsInText(text) !== text;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

// ---- markdown ----------------------------------------------------------------

export interface FrontMatter {
  data: Record<string, string | string[]>;
  /** The block's lines, without the --- fences; null when the note has none. */
  raw: string | null;
  body: string;
}

const FRONT = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) return v.slice(1, -1);
  return v;
}

/** The YAML front matter a vault uses: `key: value`, `key: [a, b]`, `key:` then `- item` lines. */
export function parseFrontMatter(text: string): FrontMatter {
  const match = FRONT.exec(text);
  if (!match) return { data: {}, raw: null, body: text.replace(/^﻿/, "") };
  const raw = match[1] ?? "";
  const data: Record<string, string | string[]> = {};
  let current: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && current) {
      const previous = data[current];
      const list = Array.isArray(previous) ? previous : previous ? [previous] : [];
      list.push(unquote(item[1] ?? ""));
      data[current] = list;
      continue;
    }
    const pair = /^([A-Za-z0-9_][\w .-]*?)\s*:\s*(.*)$/.exec(line);
    if (pair && !/^\s/.test(line)) {
      current = pair[1]!;
      const value = (pair[2] ?? "").trim();
      if (value.startsWith("[") && value.endsWith("]")) {
        data[current] = value.slice(1, -1).split(",").map(unquote).filter(Boolean);
      } else {
        data[current] = unquote(value);
      }
      continue;
    }
    // a folded or indented continuation: kept on the key it follows
    if (current && typeof data[current] === "string") data[current] = `${data[current]} ${line.trim()}`.trim();
  }
  return { data, raw, body: text.slice(match[0].length) };
}

/** Code fences and inline code are left as they are; `transform` sees the rest. */
export function outsideCode(text: string, transform: (prose: string) => string): string {
  const out: string[] = [];
  const fence = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;
  let last = 0;
  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    out.push(inlineOutside(text.slice(last, match.index), transform), match[0]);
    last = match.index + match[0].length;
  }
  out.push(inlineOutside(text.slice(last), transform));
  return out.join("");
}

function inlineOutside(text: string, transform: (prose: string) => string): string {
  return text.split(/(`[^`\n]+`)/).map((part, i) => (i % 2 === 1 ? part : transform(part))).join("");
}

const INLINE_TAG = /(^|[\s(,;])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

/** The #tags of a note's text, outside code, in order, without the `#`. */
export function inlineTags(text: string): string[] {
  const found: string[] = [];
  outsideCode(text, (prose) => {
    for (const match of prose.matchAll(INLINE_TAG)) found.push(match[2]!);
    return prose;
  });
  return [...new Set(found)];
}

function frontTags(data: Record<string, string | string[]>): string[] {
  const value = data.tags ?? data.tag ?? data.Tags;
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  return list.map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean);
}

function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Lowercase ASCII words joined by hyphens (a Perspicax topic). */
export function topicSlug(text: string, limit = PX_TOPIC_MAX): string {
  const slug = fold(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const cut = slug.slice(0, limit).replace(/-+$/g, "");
  const out = cut || "notes";
  return PX_RESERVED_TOPICS.has(out) ? `${out}-notes` : out;
}

/** A Perspicax tag: `[a-z0-9:._/-]`, starting with a letter or digit, at most 64. */
export function pxTag(tag: string): string | null {
  const cleaned = fold(tag).toLowerCase().replace(/[^a-z0-9:._/-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, PX_TAG_MAX).replace(/[-/:.]+$/, "");
  return cleaned || null;
}

/** A bot topic file's name: letters, digits, spaces, `_`, `.` and `-` (workspace.ts TOPIC_NAME). */
export function botFileName(text: string): string {
  const cleaned = text.replace(/[^\p{L}\p{N}_ .-]+/gu, "-").replace(/\s+/g, " ").replace(/-{2,}/g, "-").trim()
    .replace(/^[^\p{L}\p{N}_]+/u, "").slice(0, BOT_NAME_MAX).replace(/[ .-]+$/, "");
  return cleaned || "note";
}

/** A body cut at its paragraphs, then lines, each piece at most `max` bytes. */
export function pieces(body: string, max = PX_BODY_MAX): string[] {
  if (byteLength(body) <= max) return [body];
  const out: string[] = [];
  let current = "";
  const push = (chunk: string) => {
    const joined = current ? `${current}\n\n${chunk}` : chunk;
    if (byteLength(joined) <= max) { current = joined; return; }
    if (current) out.push(current);
    current = chunk;
  };
  for (const para of body.split(/\n\s*\n/)) {
    if (byteLength(para) <= max) { push(para); continue; }
    for (const line of para.split("\n")) {
      let rest = line;
      while (byteLength(rest) > max) {
        let cut = Math.min(rest.length, max);
        while (cut > 0 && byteLength(rest.slice(0, cut)) > max) cut -= 1;
        push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      if (rest) push(rest);
    }
  }
  if (current) out.push(current);
  return out;
}

// ---- the plan ----------------------------------------------------------------

interface Candidate {
  path: string;
  dir: string;
  base: string;
  title: string;
  folder: string;
  front: FrontMatter;
  tags: string[];
  /** Final title of its first piece, once conflicts are decided. */
  finalTitle?: string;
}

const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;

function dirOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function key(folder: string, title: string): string {
  return `${folder}\u0000${title.trim().toLowerCase()}`;
}

function frontBlock(raw: string | null, tags: string[] | null): string {
  const lines: string[] = [];
  if (raw !== null) {
    for (const line of raw.split(/\r?\n/)) lines.push(line);
  }
  if (tags && tags.length) {
    // the merged tags replace the block's own
    const kept: string[] = [];
    let skipping = false;
    for (const line of lines) {
      if (/^(?:tags|tag|Tags)\s*:/.test(line)) { skipping = true; continue; }
      if (skipping && /^\s+-\s/.test(line)) continue;
      skipping = false;
      kept.push(line);
    }
    kept.push(`tags: [${tags.join(", ")}]`);
    return `---\n${kept.join("\n")}\n---\n\n`;
  }
  return raw === null ? "" : `---\n${lines.join("\n")}\n---\n\n`;
}

/** The dry run: every note, attachment and skipped file, with the counts the window shows. */
export function planVaultImport(input: VaultPlanInput): VaultPlan {
  const { options, destination } = input;
  const skipped: VaultSkipped[] = [];
  const notes: Candidate[] = [];
  const attachments = new Map<string, VaultFile>();
  let total = 0;
  let read = 0;
  const baseFolder = destination === "perspicax" ? (input.folder ? topicSlug(input.folder) : "") : input.folder.trim();

  for (const file of input.files) {
    const path = safeVaultPath(file.path);
    if (!path) { skipped.push({ path: String(file.path ?? ""), reason: "unsafe_path" }); continue; }
    const top = path.split("/")[0]!;
    if (vaultSecretFile(path)) { skipped.push({ path, reason: "secret" }); continue; }
    if (SYSTEM_FOLDER.test(top) && options.skipSystem) { skipped.push({ path, reason: "system" }); continue; }
    if (!SYSTEM_FOLDER.test(top) && hiddenSegment(path)) { skipped.push({ path, reason: "hidden" }); continue; }
    if (read >= VAULT_LIMITS.files) { skipped.push({ path, reason: "limit" }); continue; }
    read += 1;
    const isNote = NOTE_EXT.test(path);
    const isAttachment = ATTACHMENT_EXT.test(path);
    if (!isNote && !isAttachment) { skipped.push({ path, reason: "unsupported" }); continue; }
    const cap = isNote ? VAULT_LIMITS.noteBytes : VAULT_LIMITS.attachmentBytes;
    if (file.size > cap) { skipped.push({ path, reason: "too_large" }); continue; }
    if (total + file.size > VAULT_LIMITS.totalBytes) { skipped.push({ path, reason: "limit" }); continue; }
    total += file.size;
    if (isAttachment) { attachments.set(path, file); continue; }
    const text = file.text ?? "";
    if (!text.trim()) { skipped.push({ path, reason: "empty" }); continue; }
    if (vaultTextHoldsSecret(text)) { skipped.push({ path, reason: "secret" }); continue; }
    const front = parseFrontMatter(text);
    const dir = dirOf(path);
    const base = baseOf(path).replace(NOTE_EXT, "");
    const frontTitle = typeof front.data.title === "string" ? front.data.title.trim() : "";
    const title = (frontTitle || base).replace(/[\r\n]+/g, " ").trim() || base;
    const tags = options.tags ? [...new Set([...frontTags(front.data), ...inlineTags(front.body)])] : [];
    let folder = "";
    if (destination === "perspicax") {
      const parts = [baseFolder, ...(options.keepStructure && dir ? dir.split("/") : [])].filter(Boolean);
      folder = parts.length ? topicSlug(parts.join("-")) : "notes";
    }
    notes.push({ path, dir, base, title, folder, front, tags });
  }

  // Obsidian resolves [[name]] by file name, or by its path in the vault.
  const byName = new Map<string, Candidate>();
  const byPath = new Map<string, Candidate>();
  for (const note of notes) {
    const name = note.base.toLowerCase();
    if (!byName.has(name)) byName.set(name, note);
    byPath.set(note.path.replace(NOTE_EXT, "").toLowerCase(), note);
    if (note.title.toLowerCase() !== name && !byName.has(note.title.toLowerCase())) byName.set(note.title.toLowerCase(), note);
  }
  const attachmentByName = new Map<string, string>();
  for (const path of attachments.keys()) {
    const name = baseOf(path).toLowerCase();
    if (!attachmentByName.has(name)) attachmentByName.set(name, path);
  }
  const resolveNote = (target: string): Candidate | undefined => {
    const clean = target.trim().replace(NOTE_EXT, "").replace(/^\/+/, "").toLowerCase();
    return byPath.get(clean) ?? byName.get(clean.slice(clean.lastIndexOf("/") + 1));
  };
  const resolveAttachment = (target: string): string | undefined => {
    const clean = target.trim().replace(/^\/+/, "");
    if (attachments.has(clean)) return clean;
    return attachmentByName.get(baseOf(clean).toLowerCase());
  };

  // Titles first (conflicts), then bodies (links need the final titles).
  const existing = new Map<string, ExistingNote>();
  for (const note of input.existing) existing.set(key(note.folder, note.title), note);
  const taken = new Set<string>(existing.keys());
  const botPrefix = (note: Candidate) => {
    const parts = [baseFolder, ...(options.keepStructure && note.dir ? note.dir.split("/") : [])].filter(Boolean);
    return parts.join(" - ");
  };
  const wantedTitle = (note: Candidate) => {
    if (destination === "bot") {
      const prefix = botPrefix(note);
      return botFileName(prefix ? `${prefix} - ${note.title}` : note.title);
    }
    return note.title.slice(0, PX_TITLE_MAX).trim() || note.base;
  };
  const freeTitle = (folder: string, title: string) => {
    for (let n = 2; n < 1000; n += 1) {
      const suffix = ` (${n})`;
      const max = destination === "bot" ? BOT_NAME_MAX : PX_TITLE_MAX;
      const candidate = `${title.slice(0, max - suffix.length).trimEnd()}${suffix}`;
      const next = destination === "bot" ? botFileName(candidate.replace(/[()]/g, "")) : candidate;
      if (!taken.has(key(folder, next))) return next;
    }
    return `${title} ${Date.now()}`;
  };

  type Decision = { action: PlannedAction; conflict: boolean; existingId?: string };
  const decisions = new Map<Candidate, Decision>();
  const plannedAttachments = new Map<string, PlannedAttachment>();
  const attachmentTarget = (source: string) => `${BOT_ATTACHMENTS_DIR}/${botFileName(baseFolder || input.vaultName || "vault").replace(/\s+/g, "-")}/${source}`;
  const unsupportedSeen = new Set<string>();

  /** A note's text and tags with the titles decided so far. */
  const render = (note: Candidate) => {
    let links = 0;
    const body = outsideCode(note.front.body.replace(/^\s*\n/, ""), (prose) => prose.replace(WIKILINK, (whole, bang: string, inner: string) => {
      const [targetPart, alias] = inner.split("|", 2) as [string, string | undefined];
      const [target, heading] = targetPart.split("#", 2) as [string, string | undefined];
      if (bang && ATTACHMENT_EXT.test(target.trim())) {
        if (!options.attachments) return whole;
        const source = resolveAttachment(target);
        if (!source) return whole;
        if (destination !== "bot") { unsupportedSeen.add(source); return whole; }
        const targetPath = attachmentTarget(source);
        plannedAttachments.set(source, { source, target: targetPath, size: attachments.get(source)!.size });
        const label = alias && !/^\d+(?:x\d+)?$/.test(alias) ? alias : baseOf(source);
        return `![${label.replace(/[[\]]/g, "")}](${targetPath.replace(/ /g, "%20")})`;
      }
      if (!options.wikilinks) return whole;
      const hit = resolveNote(target);
      if (!hit?.finalTitle || decisions.get(hit)?.action === "skip") return whole;
      links += 1;
      const anchor = heading ? `#${heading}` : "";
      const shown = alias ? `|${alias}` : hit.finalTitle !== target.trim() && !heading ? `|${target.trim()}` : "";
      return `[[${hit.finalTitle}${anchor}${shown}]]`;
    }));
    const tags = destination === "perspicax"
      ? [...new Set(note.tags.map(pxTag).filter((tag): tag is string => Boolean(tag)))].slice(0, PX_TAGS_MAX)
      : note.tags;
    const header = options.properties
      ? frontBlock(note.front.raw, destination === "bot" && options.tags ? tags : null)
      : destination === "bot" && options.tags && tags.length ? `---\ntags: [${tags.join(", ")}]\n---\n\n` : "";
    const full = `${header}${body}`.trim() ? `${header}${body}`.replace(/\s+$/, "\n") : "";
    return { full, tags, links, parts: destination === "bot" ? [full] : pieces(full) };
  };
  const pieceTitle = (title: string, index: number, count: number) =>
    count > 1 && index > 0 ? `${title.slice(0, PX_TITLE_MAX - 8).trimEnd()} (${index + 1}/${count})` : title;
  const same = (folder: string, title: string, text: string) => {
    const there = existing.get(key(folder, title));
    return there?.body !== undefined && there.body.trim() === text.trim();
  };

  // 1. Every note on the name it wants (two notes of the vault on one name,
  // a flattened folder: the second is renamed), to see which are already
  // there word for word: a second run writes none of them again.
  const seen = new Set<string>();
  for (const note of notes) {
    let title = wantedTitle(note);
    if (seen.has(key(note.folder, title))) title = freeTitle(note.folder, title);
    seen.add(key(note.folder, title));
    note.finalTitle = title;
  }
  const unchanged = new Set<Candidate>();
  for (const note of notes) {
    const { parts } = render(note);
    if (parts.every((piece, index) => same(note.folder, pieceTitle(note.finalTitle!, index, parts.length), piece))) unchanged.add(note);
  }
  // 2. The conflict rule for the others.
  for (const note of notes) taken.add(key(note.folder, note.finalTitle!));
  for (const note of notes) {
    if (unchanged.has(note)) { decisions.set(note, { action: "unchanged", conflict: false }); continue; }
    const conflictWith = existing.get(key(note.folder, note.finalTitle!));
    if (!conflictWith) { decisions.set(note, { action: "create", conflict: false }); continue; }
    if (options.conflict === "skip") decisions.set(note, { action: "skip", conflict: true });
    else if (options.conflict === "overwrite") decisions.set(note, { action: "overwrite", conflict: true, existingId: conflictWith.id });
    else {
      note.finalTitle = freeTitle(note.folder, note.finalTitle!);
      taken.add(key(note.folder, note.finalTitle));
      decisions.set(note, { action: "rename", conflict: true });
    }
  }
  // 3. The bodies, with the final titles in their links.
  plannedAttachments.clear();
  unsupportedSeen.clear();
  const planned: PlannedNote[] = [];
  const allTags = new Set<string>();
  let linkTotal = 0;
  for (const note of notes) {
    const { full, tags, links, parts } = render(note);
    const decision = decisions.get(note)!;
    const title = note.finalTitle!;
    if (destination === "bot" && byteLength(full) > BOT_NOTE_MAX_BYTES) { skipped.push({ path: note.path, reason: "too_large" }); continue; }
    for (const tag of tags) allTags.add(tag);
    linkTotal += links;
    if (destination === "bot") {
      planned.push({ source: note.path, folder: "", title, body: full, tags, action: decision.action, conflict: decision.conflict, path: `memory/${title}.md`, links });
      continue;
    }
    parts.forEach((piece, index) => {
      const titleOf = pieceTitle(title, index, parts.length);
      const there = existing.get(key(note.folder, titleOf));
      let action: PlannedAction;
      if (index === 0 || decision.action === "skip" || decision.action === "unchanged") action = decision.action;
      else if (same(note.folder, titleOf, piece)) action = "unchanged";
      // a later piece follows its note: replaced on an overwrite, written beside it otherwise
      else action = there && decision.action === "overwrite" ? "overwrite" : "create";
      planned.push({ source: note.path, folder: note.folder, title: titleOf, body: piece, tags, action, conflict: index === 0 ? decision.conflict : Boolean(there), existingId: index === 0 ? decision.existingId : there?.id, links: index === 0 ? links : 0 });
    });
  }
  for (const source of unsupportedSeen) skipped.push({ path: source, reason: "attachment_unsupported" });

  const writing = planned.filter((note) => note.action !== "skip" && note.action !== "unchanged");
  return {
    vaultName: input.vaultName,
    destination,
    folder: baseFolder,
    notes: planned,
    attachments: [...plannedAttachments.values()],
    skipped,
    counts: {
      notes: writing.length,
      folders: new Set(planned.map((note) => (destination === "bot" ? note.title.split(" - ").slice(0, -1).join(" - ") : note.folder))).size,
      links: linkTotal,
      tags: allTags.size,
      attachments: plannedAttachments.size,
      conflicts: planned.filter((note) => note.conflict).length,
      skipped: skipped.length,
      secrets: skipped.filter((entry) => entry.reason === "secret").length,
      unchanged: planned.filter((note) => note.action === "unchanged").length,
    },
  };
}

/** A bot memory path the import may write (memory/<name>.md, a safe name). */
export function botImportNotePath(path: string): boolean {
  return /^memory\/[\p{L}\p{N}_][\p{L}\p{N}_ .-]{0,199}\.md$/u.test(path);
}

/** A workspace path an imported attachment may land at. */
export function botImportAttachmentPath(path: string): boolean {
  const safe = safeVaultPath(path);
  return Boolean(safe) && safe === path && path.startsWith(`${BOT_ATTACHMENTS_DIR}/`) && ATTACHMENT_EXT.test(path) && !hiddenSegment(path);
}
