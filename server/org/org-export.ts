// "Join a Perspicax server" (slice 8): the copy of the operator's own bots
// that a solo Sagax hands to an organization server. Built on the person's
// own machine, so their choices (threads, memory) are applied before
// anything leaves it, people are named only by opaque local ids, and
// secrets are scrubbed on the way out.
import { ORG_IMPORT_FORMAT, ORG_IMPORT_VERSION, isPersonRef, parseOrgImportDocument, type OrgImportDocument } from "../../shared/org-import.ts";
import { redactCutSecrets } from "../../shared/redact.ts";
import { redactSecretsInText } from "../redact.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { Routine } from "../routines/routines.ts";
import type { Store } from "../store.ts";
import { createTeamBackup } from "../backup/team-backup.ts";

export const MAX_ORG_EXPORT_BOTS = 200;

export interface OrgExportChoice { id: string; threads: boolean; memory: boolean }

export interface OrgExportSummary {
  bots: { id: string; name: string; threads: number; messages: number; memoryFiles: number }[];
  groups: { id: string; name: string }[];
  routines: { id: string; name: string }[];
  notCopied: { kind: "room" | "routine" | "grant"; name: string; reason: "other_people" | "bot_not_chosen" | "room_not_copied"; person?: string }[];
  redacted: number;
}

export type OrgExportResult =
  | { ok: true; document: OrgImportDocument; filename: string; summary: OrgExportSummary }
  | { ok: false; status: 403; code: "not_your_bot"; id: string }
  | { ok: false; status: 404; code: "unknown_bot"; id: string };

const MARKER = /«redacted \d+ chars»/g;
const markers = (text: string) => text.match(MARKER)?.length ?? 0;

/** The choices of a request body, or why they are not valid. */
export function parseOrgExportChoices(body: unknown): OrgExportChoice[] | string {
  const bots = (body as { bots?: unknown } | null)?.bots;
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(bots)) return "send { bots: [{ id, threads, memory }] }";
  if (bots.length < 1 || bots.length > MAX_ORG_EXPORT_BOTS) return `choose between 1 and ${MAX_ORG_EXPORT_BOTS} bots`;
  const seen = new Set<string>();
  const out: OrgExportChoice[] = [];
  for (const entry of bots) {
    const { id, threads, memory } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || !id || id.length > 200 || typeof threads !== "boolean" || typeof memory !== "boolean") return "each bot is { id, threads, memory }";
    if (seen.has(id)) return "a bot is chosen twice";
    seen.add(id);
    out.push({ id, threads, memory });
  }
  return out;
}

/** A person ref as the document carries it: the local principal id, or
 * "local-owner" (from before principals) read as the same person. */
function asRef(raw: string | undefined, self: string): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value === self || value.toLowerCase() === "local-owner") return self;
  return value;
}

export function createOrgImportDocument(store: Store, routines: Routine[], input: {
  localPrincipalId: string;
  choices: OrgExportChoice[];
  /** The local label (name or email) of a person, for the summary only. */
  describe(principalId: string): string | undefined;
  now?: () => number;
}): OrgExportResult {
  const self = input.localPrincipalId;
  const now = input.now ?? Date.now;
  for (const choice of input.choices) {
    const bot = store.bot(choice.id);
    if (!bot) return { ok: false, status: 404, code: "unknown_bot", id: choice.id };
    const owner = asRef(bot.ownerUserId, self);
    if (owner !== null && owner !== self) return { ok: false, status: 403, code: "not_your_bot", id: choice.id };
  }
  const chosen = new Map(input.choices.map((choice) => [choice.id, choice]));
  const label = (ref: string) => input.describe(ref) ?? "someone else";
  const notCopied: OrgExportSummary["notCopied"] = [];

  // Rooms travel only when every bot in them is chosen and their only
  // person is the operator.
  const liveBots = new Set(store.bots.map((bot) => bot.id));
  const groupIds = new Set<string>();
  for (const group of store.groups) {
    const members = group.memberIds.filter((id) => liveBots.has(id));
    if (!members.some((id) => chosen.has(id))) continue;
    const others = [...new Set((group.humanIds ?? []).map((id) => asRef(id, self)).filter((id): id is string => id !== null && id !== self))];
    if (others.length) {
      for (const other of others) notCopied.push({ kind: "room", name: group.name, reason: "other_people", person: label(other) });
      continue;
    }
    if (!members.every((id) => chosen.has(id))) {
      notCopied.push({ kind: "room", name: group.name, reason: "bot_not_chosen" });
      continue;
    }
    groupIds.add(group.id);
  }

  // Routines travel with their bot (and room), run by the operator.
  const travelling: Routine[] = [];
  for (const routine of routines) {
    if (!chosen.has(routine.botId) || !liveBots.has(routine.botId)) continue;
    if (routine.target === "room-goal" && !groupIds.has(routine.groupId ?? "")) {
      notCopied.push({ kind: "routine", name: routine.name, reason: "room_not_copied" });
      continue;
    }
    const runAs = asRef(routine.runAs, self);
    if (runAs !== null && runAs !== self) {
      notCopied.push({ kind: "routine", name: routine.name, reason: "other_people", person: label(runAs) });
      continue;
    }
    travelling.push(routine);
  }

  let redacted = 0;
  const scrub = (text: string) => {
    // A title cut before redaction can still hold the start of a key.
    const out = redactCutSecrets(redactSecretsInText(text));
    if (out !== text) redacted += Math.max(0, markers(out) - markers(text));
    return out;
  };
  const backup = createTeamBackup(store, travelling, "Sagax copy", {
    botIds: new Set(chosen.keys()),
    groupIds,
    scrub,
    threads: (id) => chosen.get(id)?.threads ?? false,
    memory: (id) => chosen.get(id)?.memory ?? false,
  });

  const people: OrgImportDocument["people"] = { bots: {}, groups: {}, routines: [] };
  for (const source of backup.bots) {
    const bot = store.bot(source.key)!;
    const refs = new Set<string>();
    for (const id of bot.directGrants ?? []) refs.add(id.trim().toLowerCase());
    for (const grant of bot.grants ?? []) if (grant.target.startsWith("user:")) refs.add(grant.target.slice(5));
    const grants = [...refs].filter((ref) => ref !== self && isPersonRef(ref));
    for (const ref of grants) notCopied.push({ kind: "grant", name: bot.name, reason: "other_people", person: label(ref) });
    people.bots[source.key] = { owner: asRef(bot.ownerUserId, self), grants };
  }
  for (const source of backup.groups) {
    const group = store.group(source.key)!;
    people.groups[source.key] = { humans: (group.humanIds ?? []).length ? [self] : [] };
  }
  for (const routine of travelling) people.routines.push({ runAs: asRef(routine.runAs, self) });

  const document = parseOrgImportDocument({
    format: ORG_IMPORT_FORMAT,
    version: ORG_IMPORT_VERSION,
    exportedAt: now(),
    self,
    choices: Object.fromEntries(backup.bots.map((bot) => {
      const choice = chosen.get(bot.key)!;
      return [bot.key, { threads: choice.threads, memory: choice.memory }];
    })),
    people,
    backup,
  });
  const summary: OrgExportSummary = {
    bots: backup.bots.map((bot) => ({
      id: bot.key,
      name: bot.name,
      threads: chosen.get(bot.key)!.threads ? bot.tasks.length : 0,
      messages: bot.tasks.reduce((sum, task) => sum + task.messages.length, 0),
      memoryFiles: bot.memory ? (bot.memory.file ? 1 : 0) + bot.memory.topics.length + bot.memory.logs.length : 0,
    })),
    groups: backup.groups.map((group) => ({ id: group.key, name: group.name })),
    routines: travelling.map((routine) => ({ id: routine.id, name: routine.name })),
    notCopied,
    redacted,
  };
  const day = new Date(now()).toISOString().slice(0, 10);
  return { ok: true, document, filename: `sagax-org-copy-${day}.json`, summary };
}

export interface OrgExportRouteDeps {
  /** The operator: loopback with operator trust, or an admin session of
   * the local principal. */
  isOperator(auth: RequestAuth): boolean;
  localPrincipalId(): string;
  store(): Store;
  routines(): Routine[];
  describe(principalId: string): string | undefined;
  now?: () => number;
}

/** `POST /api/org/export` (solo only): the copy of the operator's own bots
 * for an organization server. */
export function createOrgExportRoute(deps: OrgExportRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/org/export") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    res.setHeader("cache-control", "no-store");
    if (!deps.isOperator(auth)) return json(res, 403, { error: "Only the person at this computer can copy its bots.", code: "operator_only" });
    const choices = parseOrgExportChoices(await readBody(req));
    if (typeof choices === "string") return json(res, 400, { error: choices, code: "bad_request" });
    let result: OrgExportResult;
    try {
      result = createOrgImportDocument(deps.store(), deps.routines(), { localPrincipalId: deps.localPrincipalId(), choices, describe: deps.describe, now: deps.now });
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : String(error), code: "export_failed" });
    }
    if (!result.ok) {
      return json(res, result.status, {
        error: result.code === "unknown_bot" ? "That bot does not exist on this computer." : "That bot belongs to someone else.",
        code: result.code,
        id: result.id,
      });
    }
    return json(res, 200, { document: result.document, filename: result.filename, summary: result.summary });
  };
}

export interface LinkedSubject { iss: string; sub: string; serverOrigin: string; linkedAt: number }

/** An http(s) origin, as the desktop records the organization server. */
function originOf(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** `GET`/`POST /api/identity/linked-subjects` (solo): the organization
 * accounts the operator copied bots into. Loopback with operator trust only
 * (the desktop's main process); every session is refused. */
export function createLinkedSubjectsRoute(deps: { list(): LinkedSubject[]; link(input: { iss: string; sub: string; serverOrigin: string }): LinkedSubject[] }): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/identity/linked-subjects") return PASS;
    res.setHeader("cache-control", "no-store");
    if (auth.kind !== "loopback" || auth.trust === "service") return json(res, 403, { error: "Only this computer can record where its bots were copied.", code: "operator_only" });
    if (method === "GET") return json(res, 200, { linkedSubjects: deps.list() });
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req) as Record<string, unknown> | null;
    const serverOrigin = originOf(body?.serverOrigin);
    const iss = typeof body?.iss === "string" ? body.iss.trim() : "";
    const sub = typeof body?.sub === "string" ? body.sub.trim() : "";
    if (!serverOrigin || !originOf(iss) || !sub || sub.length > 255) return json(res, 400, { error: "send { iss, sub, serverOrigin }", code: "bad_request" });
    return json(res, 200, { linkedSubjects: deps.link({ iss, sub, serverOrigin }) });
  };
}
