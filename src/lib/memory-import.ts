// Tools > Memory > Import (2026-11-03): an Obsidian vault read in the page
// (a picked folder or a .zip), planned with shared/obsidian-import.ts, then
// written where the person chose:
//   - a bot's memory: POST /api/bots/<id>/memory/import in batches (the
//     server checks every file again, journals each one, skips what is
//     already there word for word);
//   - a Perspicax tier: one note at a time through the person's own
//     Perspicax proxy (/api/me/memory/entry), whose gate refuses a secret.
// The import can be cancelled between two writes; run again, it skips what
// the first run wrote (a note there word for word is "unchanged").
import {
  ATTACHMENT_EXT,
  VAULT_LIMITS,
  safeVaultPath,
  stripVaultRoot,
  vaultSecretFile,
  type PlannedNote,
  type VaultConflict,
  type VaultFile,
  type VaultPlan,
} from "../../shared/obsidian-import";
import { readZipEntries } from "./zip-read";

export interface VaultSource {
  name: string;
  files: VaultFile[];
  /** An attachment's bytes, read when it is written. */
  bytes(path: string): Promise<Uint8Array>;
}

export interface PickedVaultFile {
  /** webkitRelativePath: "<picked folder>/<path inside it>". */
  webkitRelativePath: string;
  name: string;
  size: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Whether the reader opens this file's text: a note, never a secret-looking or hidden file (.obsidian and .trash aside). */
function readsText(path: string): boolean {
  if (!path.toLowerCase().endsWith(".md") || vaultSecretFile(path)) return false;
  return !path.split("/").some((part, i) => part.startsWith(".") && !(i === 0 && (part === ".obsidian" || part === ".trash")));
}

async function sourceFrom(name: string, entries: Array<{ path: string; size: number; text(): Promise<string>; bytes(): Promise<Uint8Array> }>): Promise<VaultSource> {
  const { root, paths } = stripVaultRoot(entries.map((entry) => entry.path));
  const files: VaultFile[] = [];
  const byPath = new Map<string, (typeof entries)[number]>();
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const path = paths[i]!;
    byPath.set(path, entry);
    const safe = safeVaultPath(path);
    const text = safe && readsText(safe) && entry.size <= VAULT_LIMITS.noteBytes ? await entry.text() : undefined;
    files.push({ path, size: entry.size, ...(text !== undefined ? { text } : {}) });
  }
  return {
    name: root || name,
    files,
    bytes: async (path) => {
      const entry = byPath.get(path);
      if (!entry || !ATTACHMENT_EXT.test(path)) throw new Error(`${path} is not in the vault.`);
      return entry.bytes();
    },
  };
}

export function readPickedFolder(list: ArrayLike<PickedVaultFile>): Promise<VaultSource> {
  const picked = Array.from(list);
  return sourceFrom(picked[0]?.webkitRelativePath.split("/")[0] ?? "vault", picked.map((file) => ({
    path: file.webkitRelativePath || file.name,
    size: file.size,
    text: () => file.text(),
    bytes: async () => new Uint8Array(await file.arrayBuffer()),
  })));
}

export async function readVaultZip(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<VaultSource> {
  const entries = readZipEntries(await file.arrayBuffer(), { maxEntries: VAULT_LIMITS.files * 2, maxEntryBytes: VAULT_LIMITS.attachmentBytes });
  const decoder = new TextDecoder();
  return sourceFrom(file.name.replace(/\.zip$/i, ""), entries.map((entry) => ({
    path: entry.path,
    size: entry.size,
    text: async () => decoder.decode(await entry.read()),
    bytes: () => entry.read(),
  })));
}

export type ImportTarget = { kind: "bot"; botId: string } | { kind: "perspicax"; scope: string };

export interface ImportOutcome {
  title: string;
  status: "written" | "unchanged" | "skipped" | "refused";
  reason?: string;
}

export interface ImportProgress {
  done: number;
  total: number;
  outcomes: ImportOutcome[];
  cancelled: boolean;
}

export interface ImportWriters {
  bot(botId: string, body: { notes: Array<{ path: string; text: string }>; attachments: Array<{ path: string; data: string }>; conflict: VaultConflict }): Promise<{ results: Array<{ path: string; status: ImportOutcome["status"]; reason?: string }> }>;
  pxCreate(note: { scope: string; topic: string; title: string; body: string; tags: string[] }): Promise<unknown>;
  pxUpdate(note: { scope: string; id: string; title: string; body: string; tags: string[] }): Promise<unknown>;
}

const BATCH_NOTES = 40;
const BATCH_BYTES = 6 * 1024 * 1024;

function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Writes the plan; `signal` stops it between two writes. */
export async function runVaultImport(plan: VaultPlan, source: VaultSource, target: ImportTarget, conflict: VaultConflict, writers: ImportWriters, opts: { signal?: AbortSignal; onProgress?: (progress: ImportProgress) => void } = {}): Promise<ImportProgress> {
  const todo = plan.notes.filter((note) => note.action !== "skip" && note.action !== "unchanged");
  const attachments = target.kind === "bot" ? plan.attachments : [];
  const progress: ImportProgress = { done: 0, total: todo.length + attachments.length, outcomes: [], cancelled: false };
  for (const note of plan.notes) {
    if (note.action === "skip") progress.outcomes.push({ title: note.title, status: "skipped", reason: "exists" });
    if (note.action === "unchanged") progress.outcomes.push({ title: note.title, status: "unchanged" });
  }
  const tick = () => opts.onProgress?.({ ...progress, outcomes: [...progress.outcomes] });
  tick();
  const stopped = () => {
    if (opts.signal?.aborted) progress.cancelled = true;
    return progress.cancelled;
  };

  if (target.kind === "bot") {
    const titleOf = new Map(todo.map((note) => [note.path!, note.title]));
    // a rename was decided by the plan (a new name): written like a new note
    const serverConflict: VaultConflict = conflict === "overwrite" ? "overwrite" : "skip";
    let batch: PlannedNote[] = [];
    let bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const sent = batch;
      batch = [];
      bytes = 0;
      try {
        const { results } = await writers.bot(target.botId, { notes: sent.map((note) => ({ path: note.path!, text: note.body })), attachments: [], conflict: serverConflict });
        for (const row of results) progress.outcomes.push({ title: titleOf.get(row.path) ?? row.path, status: row.status, reason: row.reason });
      } catch (cause) {
        for (const note of sent) progress.outcomes.push({ title: note.title, status: "refused", reason: reasonOf(cause) });
      }
      progress.done += sent.length;
      tick();
    };
    for (const note of todo) {
      if (stopped()) break;
      const size = new TextEncoder().encode(note.body).length;
      if (batch.length >= BATCH_NOTES || bytes + size > BATCH_BYTES) await flush();
      batch.push(note);
      bytes += size;
    }
    if (!stopped()) await flush();
    for (const attachment of attachments) {
      if (stopped()) break;
      try {
        const data = base64(await source.bytes(attachment.source));
        const { results } = await writers.bot(target.botId, { notes: [], attachments: [{ path: attachment.target, data }], conflict: serverConflict });
        for (const row of results) progress.outcomes.push({ title: attachment.source, status: row.status, reason: row.reason });
      } catch (cause) {
        progress.outcomes.push({ title: attachment.source, status: "refused", reason: reasonOf(cause) });
      }
      progress.done += 1;
      tick();
    }
    return progress;
  }

  for (const note of todo) {
    if (stopped()) break;
    try {
      if (note.action === "overwrite" && note.existingId) await writers.pxUpdate({ scope: target.scope, id: note.existingId, title: note.title, body: note.body, tags: note.tags });
      else await writers.pxCreate({ scope: target.scope, topic: note.folder, title: note.title, body: note.body, tags: note.tags });
      progress.outcomes.push({ title: note.title, status: "written" });
    } catch (cause) {
      progress.outcomes.push({ title: note.title, status: "refused", reason: reasonOf(cause) });
    }
    progress.done += 1;
    tick();
  }
  return progress;
}
