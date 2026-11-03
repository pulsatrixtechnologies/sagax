// Whose Data database a turn or a panel request reaches (2026-10-16).
//
// A bot's Data tools used to keep one DuckDB database and one sheet per bot.
// On an organization server a bot can be shared with several people, so
// person B could read the tables person A loaded. The scope key fixes that:
//
//   - solo server, or the bot's owner: the bot id itself (the database and
//     sheet that already exist, no migration);
//   - another person on an organization server: `<botId>~p-<16 hex>`, a
//     database of that person's own on that bot;
//   - a confidential thread (the resolver below says so): `<botId>~t-<16 hex>`,
//     a database of that thread only, never mixed with the bot's shared one.
//
// The hex is the start of a SHA-256 of the principal (or thread id), so a key
// names no person and holds no slash (engine.forBot refuses one). A derived
// key's files live OUTSIDE the bot folder, in `<data>/data-scopes/<botId>/
// <suffix>` (2026-10-17 security review of #689): a confined database may
// read its own folder, so the bot scope (whose folder is the bot folder)
// must not find another person's or a confidential thread's data.duckdb or
// sheet.json below it. They are deleted with the bot. Pure apart from the
// small in-memory map of who a derived key belongs to, which the live
// frames and the confinement use to pick their audience.
import { createHash } from "node:crypto";
import { join } from "node:path";

import { botFolder as defaultBotFolder } from "../bots/bot-folder.ts";
import { DATA_DIR } from "../config.ts";

/** Separates the bot id from the scope suffix. Bot ids never contain it. */
export const DATA_SCOPE_SEPARATOR = "~";
/** The folder, in the data directory (never inside a bot folder), that
 * holds the derived scopes: `<DATA_DIR>/data-scopes/<botId>/<suffix>`. */
export const DATA_SCOPES_DIR = "data-scopes";
/** The server's derived-scopes root. */
export const DATA_SCOPES_ROOT = join(DATA_DIR, DATA_SCOPES_DIR);

export type DataScopeKind = "bot" | "person" | "thread";

/** A confidential thread's owner, or null for an ordinary thread. */
export type ConfidentialThreadResolver = (threadId: string) => { ownerPrincipalId: string } | null;

let confidentialResolver: ConfidentialThreadResolver = () => null;

/** The hook confidential threads plug into: once set, a confidential thread
 * gets a Data database of its own. Null restores the default (no thread is
 * confidential). */
export function setConfidentialThreadResolver(resolver: ConfidentialThreadResolver | null): void {
  confidentialResolver = resolver ?? (() => null);
}

/** The thread's confidential owner, or null. A resolver that throws counts
 * as confidential with no owner anyone matches (fail closed). */
export function confidentialThreadOwner(threadId: string): { ownerPrincipalId: string } | null {
  try {
    return confidentialResolver(threadId);
  } catch {
    return { ownerPrincipalId: "" };
  }
}

const normalize = (principal: string) => principal.trim().toLowerCase();
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);

interface ScopeMember {
  /** The one principal whose live frames carry this scope's sheet. */
  audience: string;
  /** For a thread scope: the thread, so its folder can be found. */
  threadId?: string;
}

/** Who each derived key belongs to, learned when the key is computed. */
const members = new Map<string, ScopeMember>();

export interface DataScopeRequest {
  botId: string;
  /** True on an organization server. */
  organization: boolean;
  /** The bot's owner. */
  ownerPrincipalId: string;
  /** The person speaking (a turn) or viewing (the panel). Undefined means
   * the owner side: the operator at this computer, a routine, a solo server. */
  principalId?: string;
  /** The turn's thread, or the thread the panel asks about. */
  threadId?: string;
}

/**
 * The Data scope key for a request, or null when it must be refused (a
 * confidential thread reached by someone other than its owner).
 */
export function dataScopeKey(request: DataScopeRequest): string | null {
  const { botId } = request;
  const principal = request.principalId === undefined ? undefined : normalize(request.principalId);
  if (request.threadId) {
    const confidential = confidentialThreadOwner(request.threadId);
    if (confidential) {
      const owner = normalize(confidential.ownerPrincipalId);
      if (principal !== undefined && (!owner || principal !== owner)) return null;
      const key = threadScopeKeyFor(botId, request.threadId);
      members.set(key, { audience: owner, threadId: request.threadId });
      return key;
    }
  }
  if (!request.organization) return botId;
  if (principal === undefined || principal === normalize(request.ownerPrincipalId)) return botId;
  // An unknown speaker ("") gets a scope of its own too: never the owner's.
  const key = personScopeKeyFor(botId, principal);
  members.set(key, { audience: principal });
  return key;
}

/** The scope key of a person's own Data on a bot (`<botId>~p-<hash>`), as
 * dataScopeKey computes it for that person on an organization server. */
export function personScopeKeyFor(botId: string, principalId: string): string {
  return `${botId}${DATA_SCOPE_SEPARATOR}p-${digest(normalize(principalId))}`;
}

/** The bot a scope key belongs to. */
export function dataScopeBotId(key: string): string {
  const at = key.indexOf(DATA_SCOPE_SEPARATOR);
  return at === -1 ? key : key.slice(0, at);
}

export function dataScopeKind(key: string): DataScopeKind {
  const at = key.indexOf(DATA_SCOPE_SEPARATOR);
  if (at === -1) return "bot";
  return key.startsWith("t-", at + 1) ? "thread" : "person";
}

/** The principal a derived scope's frames go to; undefined for the bot
 * scope or a key this process never computed (callers fail closed). */
export function dataScopeAudience(key: string): string | undefined {
  return members.get(key)?.audience;
}

/** The thread of a thread scope, when this process computed its key. */
export function dataScopeThread(key: string): string | undefined {
  return members.get(key)?.threadId;
}

/** Where a scope's database and sheet live: the bot folder for the bot
 * scope, `<scopesRoot>/<botId>/<suffix>` for a derived one (never below the
 * bot folder, which the bot scope's confined database reaches). */
export function dataScopeFolder(key: string, botFolder: (botId: string) => string = defaultBotFolder, scopesRoot: string = DATA_SCOPES_ROOT): string {
  const botId = dataScopeBotId(key);
  if (key === botId) return botFolder(botId);
  return join(dataScopesFolderOf(botId, scopesRoot), key.slice(botId.length + DATA_SCOPE_SEPARATOR.length));
}

/** The folder holding every derived scope of a bot (deleted with the bot). */
export function dataScopesFolderOf(botId: string, scopesRoot: string = DATA_SCOPES_ROOT): string {
  return join(scopesRoot, botId);
}

/** The scope key of a confidential thread's own Data (`<botId>~t-<hash>`). */
export function threadScopeKeyFor(botId: string, threadId: string): string {
  return `${botId}${DATA_SCOPE_SEPARATOR}t-${digest(threadId)}`;
}

/** The folder, in a person's own scope folder, their exports land in. */
export const DATA_EXPORTS_DIR = "data-exports";

/** Where an export may land on an organization server, most preferred
 * first:
 *   - the bot scope (its owner): the bot's workspace;
 *   - a person's scope: `data-exports` in their own scope folder only
 *     (2026-10-17, follow-up of #696). Never the bot's workspace, which
 *     every person on a shared bot reaches, and never their thread folders
 *     either: those sit in `task-workspaces/<bot>`, which the admin
 *     console's file browser lists for the whole bot. The scope folder is
 *     reached by that person's own Data database alone, as their tables,
 *     sheet and downloads are (thread-privacy.ts: only the thread's owner);
 *   - a confidential thread: that thread's folder only. */
export function organizationExportRoots(input: {
  kind: DataScopeKind;
  workspace: string;
  scopeFolder: string;
  /** A confidential thread's folder (thread scope). */
  threadFolder?: string | null;
}): string[] {
  if (input.kind === "thread") return input.threadFolder ? [input.threadFolder] : [];
  if (input.kind === "bot") return [input.workspace];
  return [join(input.scopeFolder, DATA_EXPORTS_DIR)];
}

/** Where an export may land on any server, most preferred first. An
 * organization server: organizationExportRoots. A solo server: the
 * person's Downloads when it exists, the bot's working folder, its
 * workspace; except a confidential thread, solo too, whose exports go to
 * its own folder only (2026-10-18, follow-up of #689): the bot's workspace
 * is in every workspace backup, the thread's folder never is. */
export function dataExportRootsFor(input: {
  organization: boolean;
  kind: DataScopeKind;
  workspace: string;
  scopeFolder: string;
  threadFolder?: string | null;
  downloads?: string | null;
  cwd?: string;
}): string[] {
  if (input.organization || input.kind === "thread") return organizationExportRoots(input);
  return [...(input.downloads ? [input.downloads] : []), ...(input.cwd ? [input.cwd] : []), input.workspace];
}

/** Forgets one derived key (its scope was erased). */
export function forgetDataScope(key: string): void {
  members.delete(key);
}

/** Forgets every derived key of a deleted bot. */
export function forgetDataScopes(botId: string): void {
  for (const key of members.keys()) if (dataScopeBotId(key) === botId) members.delete(key);
}

/** Whether a "data" live frame reaches a client: frames without an audience
 * (a solo server) reach everyone as before; otherwise only that person's
 * streams, and the loopback stream (no viewer) only for the bot scope or
 * when the local operator is the audience. */
export function dataFrameAllowed(
  payload: { kind?: unknown; audience?: unknown; dataScope?: unknown },
  viewerId: string | undefined,
  localPrincipalId: string,
): boolean {
  if (payload.kind !== "data") return true;
  if (typeof payload.audience !== "string") return payload.audience === undefined;
  if (!viewerId) return payload.dataScope === "bot" || (Boolean(payload.audience) && normalize(payload.audience) === normalize(localPrincipalId));
  return Boolean(payload.audience) && normalize(viewerId) === normalize(payload.audience);
}
