// Changing several bots at once from the sidebar's selection (Edit N bots).
// The rules are shared (shared/bulk-bot-edit.ts); this file holds the
// dialog's draft (what each section changed, never written until Apply), the
// scoped transport the bot editor's own sections write through, and the run:
// bot by bot, through the routes the bot's own editor uses, so every change
// is journaled as that bot's own edit and refused for that bot's reasons.
import {
  botLevelPatch,
  BULK_CONSENT_KEYS,
  commonListItems,
  commonValue,
  grantRevertSteps,
  grantSteps,
  mcpServersAfter,
  patchFields,
  patchForBot,
  revertPatch,
  stableValueKey,
  type BulkBotOutcome,
  type BulkGrant,
  type BulkListEdit,
  type BulkListMode,
  type CommonValue,
} from "../../shared/bulk-bot-edit";
import type { Bot } from "@/state/store";
import { readableError } from "./plain-error";

/** The bot editor's sections a bulk change offers, in the dialog's order. */
export const BULK_SECTIONS = ["model", "sharing", "worksOn", "access", "voice", "permissions"] as const;
export type BulkSectionId = typeof BULK_SECTIONS[number];

/** The bot fields each section shows (what "Mixed values" compares). Access
 * also has its MCP servers, a list; Shared with is a list. */
export const BULK_SECTION_FIELDS: Record<BulkSectionId, readonly string[]> = {
  model: ["modelSelection", "fallback"],
  sharing: [],
  worksOn: ["computer"],
  access: ["cloudBackend", "autoStartVps", "browser", "cwd", "toolScope", "mcpAccounts"],
  voice: ["voice", "speakReplies", "notifications"],
  permissions: ["approvalMode", "proactiveMode", "outbound", "chiefOfStaff", "managedSections", "approvePeerComms", "peers"],
};

const CONSENT = new Set<string>(BULK_CONSENT_KEYS);

/** A baseline marker for a field the selected bots do not share: any real
 * write differs from it, so picking the first bot's own value still counts. */
function mixedBaseline(field: string): { __bulkMixed: true; field: string } {
  return { __bulkMixed: true, field };
}

export type SectionFieldStates = Record<string, CommonValue<unknown>>;

/** Each section field's common value, or mixed with every bot's own. */
export function sectionFieldStates(
  bots: readonly Bot[],
  section: BulkSectionId,
  fieldValue: (bot: Bot, field: string) => unknown,
): SectionFieldStates {
  const out: SectionFieldStates = {};
  for (const field of BULK_SECTION_FIELDS[section]) {
    out[field] = commonValue(bots.map((bot) => ({ botId: bot.id, value: fieldValue(bot, field) })));
  }
  return out;
}

export function mixedFieldsOf(states: SectionFieldStates): Set<string> {
  return new Set(Object.entries(states).filter(([, state]) => state.mixed).map(([field]) => field));
}

/** Opening baseline for dirty detection: the shared value, or a mixed marker. */
export function sectionBaseline(states: SectionFieldStates): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, state] of Object.entries(states)) {
    out[field] = state.mixed ? mixedBaseline(field) : state.value;
  }
  return out;
}

/** Only fields the person changed from the opening baseline. Consent flags
 * ride along when a real field changed. A mixed field is always dirty once
 * written, even when the value matches one of the bots. */
export function dirtyPatch(
  baseline: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let changes = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (CONSENT.has(key)) { out[key] = value; continue; }
    if (stableValueKey(baseline[key]) === stableValueKey(value)) continue;
    out[key] = value;
    changes = true;
  }
  if (!changes) return {};
  return out;
}

/** mcpAccounts from the draft is often a single server the person touched;
 * fold it into each bot instead of replacing the whole map (#1701). */
export function mergeMcpAccounts(
  current: Record<string, string> | null | undefined,
  patch: Record<string, string> | null,
): Record<string, string> | null {
  if (patch === null) return null;
  const next = { ...current, ...patch };
  return Object.keys(next).length ? next : null;
}

type Request = <T = unknown>(path: string, init?: RequestInit) => Promise<T>;

/** One section's pending change. */
export interface BulkSectionChange {
  /** Bot fields set in the section (consent flags included). */
  patch: Record<string, unknown>;
  /** Access: the MCP servers, by Add, Remove or Replace. */
  mcpServers?: BulkListEdit;
  /** Shared with: the people and teams with the level chosen for each. */
  grants?: { mode: BulkListMode; grants: BulkGrant[] };
}

export type BulkChanges = Partial<Record<BulkSectionId, BulkSectionChange>>;

/** A list edit does something: items to add or remove, or a Replace (an
 * empty Replace empties the list). */
export function listActive(edit: { mode: BulkListMode; items?: readonly unknown[]; grants?: readonly unknown[] } | undefined): boolean {
  if (!edit) return false;
  return edit.mode === "replace" || (edit.items ?? edit.grants ?? []).length > 0;
}

export function sectionTouched(change: BulkSectionChange | undefined): boolean {
  if (!change) return false;
  return patchFields(change.patch).length > 0 || listActive(change.mcpServers) || listActive(change.grants);
}

/** Every bot field the change sets (all sections together). */
export function mergedPatch(changes: BulkChanges): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of BULK_SECTIONS) Object.assign(out, changes[id]?.patch ?? {});
  return out;
}

/** The bot a section's real controls edit: shared values where the bots
 * agree, mixed section fields left unset (so the UI does not look like every
 * bot matches the first), an id of its own, the viewer as owner, never busy,
 * and the section's change on top. Lists show the edit's items: empty to
 * start with Add and Remove, what every bot has to start with Replace. */
export function bulkDraftBot(
  id: string,
  bots: readonly Bot[],
  viewerId: string | null,
  change: BulkSectionChange | undefined,
  opts?: {
    section?: BulkSectionId;
    fieldValue?: (bot: Bot, field: string) => unknown;
  },
): Bot {
  const first = bots[0]!;
  const draft: Record<string, unknown> = {
    ...first,
    id,
    threadId: id,
    messages: [],
    tasks: undefined,
    busy: false,
    activity: undefined,
    host: undefined,
    directGrants: undefined,
    ...(viewerId ? { ownerUserId: viewerId } : {}),
  };
  if (opts?.section && opts.fieldValue) {
    for (const field of BULK_SECTION_FIELDS[opts.section]) {
      const common = commonValue(bots.map((bot) => ({ botId: bot.id, value: opts.fieldValue!(bot, field) })));
      // Mixed: clear so controls start empty / indeterminate, not on the
      // first bot's value (#1701). Shared: seed the agreed value.
      draft[field] = common.mixed ? undefined : common.value;
    }
  }
  Object.assign(draft, change?.patch);
  draft.mcpServers = change?.mcpServers?.items ?? [];
  draft.grants = (change?.grants?.grants ?? []).map((grant) => ({ ...grant, by: viewerId ?? "", at: 0 }));
  return draft as unknown as Bot;
}

/** Where a list starts when its mode is picked: Replace begins from what
 * every bot has, Add and Remove from nothing. */
export function listStart(mode: BulkListMode, lists: ReadonlyArray<readonly string[]>): string[] {
  return mode === "replace" ? commonListItems(lists) : [];
}

/** The transport a section's own controls use inside the dialog
 * (BotEditorContext.request): a PATCH of the draft bot and its grants are
 * kept as the section's change; anything else answers that it needs one bot.
 * When `baseline` is set, only fields that differ from the opening values
 * enter the change (#1701 dirty-only). */
export function bulkSectionRequest(draftId: string, read: () => BulkSectionChange, write: (next: BulkSectionChange) => void, draftBot: () => Bot,
  /** A person's or team's name (the directory), never an id on screen. */
  label: (target: string) => string = (target) => target,
  baseline: () => Record<string, unknown> = () => ({}),
): Request {
  const base = `/api/bots/${draftId}`;
  const take = (fields: Record<string, unknown>) => {
    const next = dirtyPatch(baseline(), { ...read().patch, ...fields });
    // Consent flags that rode with a cleared field must drop too.
    return next;
  };
  return (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    const change = read();
    if (path === base && method === "PATCH") {
      const { stepUp: _stepUp, ...fields } = body;
      if (Array.isArray(fields.mcpServers)) {
        const { mcpServers, ...rest } = fields;
        write({ ...change, patch: take(rest), mcpServers: { mode: change.mcpServers?.mode ?? "add", items: mcpServers as string[] } });
      } else write({ ...change, patch: take(fields) });
      return { bot: draftBot() };
    }
    const grants = change.grants ?? { mode: "add" as BulkListMode, grants: [] };
    const answer = (list: BulkGrant[]) => ({
      grants: list.map((grant) => ({ ...grant, by: "", at: 0, kind: grant.target.startsWith("team:") ? "team" : "user", label: label(grant.target) })),
      administer: { any: true, teamIds: [], maxLevel: "manage", canAdd: true },
    });
    if (path === `${base}/grants` && method === "GET") return answer(grants.grants);
    if (path === `${base}/grants` && method === "PUT") {
      const target = String(body.target ?? "");
      const level = body.level as BulkGrant["level"];
      const next = [...grants.grants.filter((grant) => grant.target !== target), { target, level }];
      write({ ...change, grants: { ...grants, grants: next } });
      return answer(next);
    }
    if (path.startsWith(`${base}/grants/`) && method === "DELETE") {
      const target = decodeURIComponent(path.slice(`${base}/grants/`.length));
      const next = grants.grants.filter((grant) => grant.target !== target);
      write({ ...change, grants: { ...grants, grants: next } });
      return answer(next);
    }
    throw new Error("Not available when changing several bots");
  }) as Request;
}

/** What one bot had before the change: enough to put it back. */
export interface BulkBefore {
  botId: string;
  patch?: Record<string, unknown>;
  grants?: { before: BulkGrant[]; after: BulkGrant[] };
}

export interface BulkRun {
  outcomes: BulkBotOutcome[];
  before: BulkBefore[];
}

export interface BulkDeps {
  request: Request;
  /** The bot's own save (persistBotUpdate: Full and Custom take the same
   * trusted path as the editor); answers the saved bot. */
  saveBot: (bot: Bot, patch: Record<string, unknown>) => Promise<unknown>;
  /** Waits for the bot's pending edits (the editor's queue) first. */
  flush?: (botId: string) => Promise<unknown>;
  /** A reason this bot cannot take a section's change, or null. */
  locked?: (bot: Bot, section: BulkSectionId) => string | null;
  /** Every enabled MCP server (a bot with no list of its own mounts them). */
  enabledServers?: readonly string[];
}

const reasonOf = (error: unknown) => (readableError(error)) || "Refused";

/** Apply the change to each bot in turn. A bot that refuses one part keeps
 * the parts it took; its outcome lists why. */
export async function runBulkEdit(bots: readonly Bot[], changes: BulkChanges, deps: BulkDeps): Promise<BulkRun> {
  const outcomes: BulkBotOutcome[] = [];
  const before: BulkBefore[] = [];
  for (const bot of bots) {
    const reasons: string[] = [];
    const kept: BulkBefore = { botId: bot.id };
    let changed = false;
    const allowed = (section: BulkSectionId) => {
      const lock = deps.locked?.(bot, section) ?? null;
      if (lock) reasons.push(lock);
      return lock === null;
    };
    try { await deps.flush?.(bot.id); } catch { /* the save below says what failed */ }

    // the bot's fields, one request (the editor's own save)
    const patch: Record<string, unknown> = {};
    for (const id of BULK_SECTIONS) {
      const change = changes[id];
      const mcp = listActive(change?.mcpServers);
      if (!change || (patchFields(change.patch).length === 0 && !mcp)) continue;
      if (!allowed(id)) continue;
      Object.assign(patch, change.patch);
      if (mcp && change.mcpServers) {
        const next = mcpServersAfter(bot.mcpServers, deps.enabledServers ?? [], change.mcpServers);
        patch.mcpServers = next;
      }
    }
    const own = patchForBot(bot as unknown as Record<string, unknown>, patch);
    if (own.mcpAccounts !== undefined) {
      own.mcpAccounts = mergeMcpAccounts(
        bot.mcpAccounts,
        own.mcpAccounts as Record<string, string> | null,
      );
    }
    if (patchFields(own).length > 0) {
      try {
        await deps.saveBot(bot, botLevelPatch(own, bot.threadId));
        kept.patch = revertPatch(bot as unknown as Record<string, unknown>, own);
        changed = true;
      } catch (error) {
        reasons.push(reasonOf(error));
      }
    }

    // Shared with: the grants route, person by person
    const grantEdit = changes.sharing?.grants;
    if (grantEdit && listActive(grantEdit) && allowed("sharing")) {
      try {
        const current = (await deps.request<{ grants?: BulkGrant[] }>(`/api/bots/${bot.id}/grants`)).grants ?? [];
        const now = current.map(({ target, level }) => ({ target, level }));
        const steps = grantSteps(now, grantEdit.mode, grantEdit.grants);
        let after = now;
        for (const grant of steps.put) {
          try {
            const answer = await deps.request<{ grants?: BulkGrant[] }>(`/api/bots/${bot.id}/grants`, { method: "PUT", body: JSON.stringify(grant) });
            after = (answer.grants ?? []).map(({ target, level }) => ({ target, level }));
            changed = true;
          } catch (error) { reasons.push(reasonOf(error)); }
        }
        for (const target of steps.remove) {
          try {
            const answer = await deps.request<{ grants?: BulkGrant[] }>(`/api/bots/${bot.id}/grants/${encodeURIComponent(target)}`, { method: "DELETE" });
            after = (answer.grants ?? []).map(({ target: id, level }) => ({ target: id, level }));
            changed = true;
          } catch (error) { reasons.push(reasonOf(error)); }
        }
        if (steps.put.length + steps.remove.length > 0) kept.grants = { before: now, after };
      } catch (error) {
        reasons.push(reasonOf(error));
      }
    }

    const unique = [...new Set(reasons)];
    outcomes.push({ botId: bot.id, ok: unique.length === 0, ...(changed || unique.length ? {} : { skipped: true }), ...(unique.length ? { reasons: unique } : {}) });
    if (kept.patch || kept.grants) before.push(kept);
  }
  return { outcomes, before };
}

/** Put each bot back as it was before the last bulk change (each step is
 * again that bot's own edit, journaled the same way). */
export async function undoBulkEdit(bots: readonly Bot[], before: readonly BulkBefore[], deps: Pick<BulkDeps, "request" | "saveBot" | "flush">): Promise<BulkBotOutcome[]> {
  const outcomes: BulkBotOutcome[] = [];
  for (const kept of before) {
    const bot = bots.find((candidate) => candidate.id === kept.botId);
    if (!bot) { outcomes.push({ botId: kept.botId, ok: false, reasons: ["Not found"] }); continue; }
    const reasons: string[] = [];
    try { await deps.flush?.(bot.id); } catch { /* the save says */ }
    if (kept.patch && patchFields(kept.patch).length > 0) {
      const back = { ...kept.patch, ...(kept.patch.approvalMode === "full" ? { confirmFullAccess: true } : {}) };
      try { await deps.saveBot(bot, botLevelPatch(back, bot.threadId)); } catch (error) { reasons.push(reasonOf(error)); }
    }
    if (kept.grants) {
      const steps = grantRevertSteps(kept.grants.before, kept.grants.after);
      for (const grant of steps.put) {
        try { await deps.request(`/api/bots/${bot.id}/grants`, { method: "PUT", body: JSON.stringify(grant) }); } catch (error) { reasons.push(reasonOf(error)); }
      }
      for (const target of steps.remove) {
        try { await deps.request(`/api/bots/${bot.id}/grants/${encodeURIComponent(target)}`, { method: "DELETE" }); } catch (error) { reasons.push(reasonOf(error)); }
      }
    }
    const unique = [...new Set(reasons)];
    outcomes.push({ botId: bot.id, ok: unique.length === 0, ...(unique.length ? { reasons: unique } : {}) });
  }
  return outcomes;
}

/** The last bulk change of this window, for Undo after the dialog closed. */
let lastRun: { at: number; botIds: string[]; before: BulkBefore[] } | null = null;
export function rememberBulkRun(botIds: string[], before: BulkBefore[]) {
  lastRun = before.length ? { at: Date.now(), botIds, before } : null;
}
export function lastBulkRun() { return lastRun; }
export function forgetBulkRun() { lastRun = null; }
