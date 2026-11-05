// Visible roles, server side (2026-11-05). What Sagax keeps about the roles
// its Perspicax relay used, per person and bot:
// - the role of each engine tool step, waiting for that step's row
//   (`tool.role`), like the auto-approval note of tool-auto-approval.ts;
// - the refusals it logged (403), for a bot's "Permissions manquantes" and a
//   routine's coverage preview;
// - the transitions (one role to another) and their history, the local half
//   of the bot's Roles graph (counts come from Perspicax's own journal);
// - the bot owner's "Toujours ainsi" rules, and a thread's "Rester en …";
// - a role the person picked in the composer, for their next turn only.
//
// Isolation: every record carries the principal it was made for, and every
// read filters on the asking principal. Rules are the bot owner's; a bot
// delegated to someone else starts from the default (no rule applies).
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { writeFileAtomic } from "../atomic.ts";
import type { BotRoleRule, CwPermission, RoleReason, ToolRole } from "../../shared/perspicax-roles.ts";
import { matchingRoleRule } from "../../shared/perspicax-roles.ts";
import { toolNameKeys } from "../approvals/tool-auto-approval.ts";

export interface RoleRefusalEntry {
  id: string;
  at: number;
  principalId: string;
  botId: string;
  threadId: string;
  role: { slug: string; name: string };
  tool: string;
  kind: "read" | "write";
  permission: CwPermission;
  /** cw_member:<identifier> behind the role, when Perspicax said. */
  target?: string;
  /** set when the person sent it to an administrator */
  sentAt?: number;
}

export interface RoleTransitionEntry {
  id: string;
  at: number;
  principalId: string;
  botId: string;
  threadId: string;
  from: { slug: string; name: string };
  to: { slug: string; name: string };
  reason: RoleReason;
  refusedTool?: string;
}

interface Persisted {
  v: 1;
  refusals: RoleRefusalEntry[];
  transitions: RoleTransitionEntry[];
  rules: Record<string, BotRoleRule[]>;
}

const MAX_REFUSALS = 2_000;
const MAX_TRANSITIONS = 4_000;
const MAX_RULES_PER_BOT = 50;
const LOOK_BACK = 60;
const MAX_PENDING = 40;

type Row = { id: string; kind?: string; role?: string; turnId?: string; tool?: { name: string; role?: unknown } };

function sameTool(rowName: string, tool: string): boolean {
  const wanted = new Set(toolNameKeys(tool));
  return toolNameKeys(rowName).some((key) => wanted.has(key));
}

export class RoleJournal {
  private refusals: RoleRefusalEntry[] = [];
  private transitions: RoleTransitionEntry[] = [];
  private rules = new Map<string, BotRoleRule[]>();
  /** threadId → steps waiting for their row */
  private pending = new Map<string, Array<{ tool: string; role: ToolRole }>>();
  /** threadId → the role the thread said to stay in (no fallback from it) */
  private stays = new Map<string, string>();
  /** threadId → the role the person picked for their next turn */
  private picks = new Map<string, { slug: string; principalId: string; at: number }>();
  /** threadId → the last role a step ran under (transition detection) */
  private last = new Map<string, { slug: string; name: string }>();
  private saveTimer?: ReturnType<typeof setTimeout>;

  private readonly file: string | null;
  private readonly now: () => number;

  constructor(file: string | null, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    if (!file || !existsSync(file)) return;
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as Partial<Persisted>;
      if (Array.isArray(data.refusals)) this.refusals = data.refusals.slice(-MAX_REFUSALS);
      if (Array.isArray(data.transitions)) this.transitions = data.transitions.slice(-MAX_TRANSITIONS);
      if (data.rules && typeof data.rules === "object") for (const [botId, list] of Object.entries(data.rules)) if (Array.isArray(list)) this.rules.set(botId, list.slice(0, MAX_RULES_PER_BOT));
    } catch { /* a damaged file starts empty */ }
  }

  private save(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      const data: Persisted = { v: 1, refusals: this.refusals, transitions: this.transitions, rules: Object.fromEntries(this.rules) };
      try { writeFileAtomic(this.file!, JSON.stringify(data)); } catch { /* next change retries */ }
    }, 250);
    this.saveTimer.unref?.();
  }

  flush(): void {
    if (!this.saveTimer || !this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const data: Persisted = { v: 1, refusals: this.refusals, transitions: this.transitions, rules: Object.fromEntries(this.rules) };
    try { writeFileAtomic(this.file, JSON.stringify(data)); } catch { /* best effort */ }
  }

  // --- steps and rows -----------------------------------------------------

  /** The oldest row of this tool in the turn that has no role yet. */
  rowFor<T extends Row>(rows: readonly T[], tool: string): T | undefined {
    let found: T | undefined;
    for (let index = rows.length - 1, seen = 0; index >= 0 && seen < LOOK_BACK; index -= 1, seen += 1) {
      const row = rows[index]!;
      if (row.role === "user") break;
      if (row.kind !== "activity" || !row.tool || row.tool.role) continue;
      if (sameTool(row.tool.name, tool)) found = row;
    }
    return found;
  }

  remember(threadId: string, tool: string, role: ToolRole): void {
    const list = this.pending.get(threadId) ?? [];
    list.push({ tool, role });
    while (list.length > MAX_PENDING) list.shift();
    this.pending.set(threadId, list);
  }

  takePending(threadId: string, rowName: string): ToolRole | undefined {
    const list = this.pending.get(threadId);
    if (!list?.length) return undefined;
    const index = list.findIndex((entry) => sameTool(rowName, entry.tool));
    if (index < 0) return undefined;
    const [entry] = list.splice(index, 1);
    if (!list.length) this.pending.delete(threadId);
    return entry?.role;
  }

  /** The turn ended: steps no row took are dropped. */
  endTurn(threadId: string): void {
    this.pending.delete(threadId);
  }

  /** The step's role became the thread's current one; the role before it
   * when it changed (a transition), else undefined. */
  advance(threadId: string, role: { slug: string; name: string }): { slug: string; name: string } | undefined {
    const before = this.last.get(threadId);
    this.last.set(threadId, { slug: role.slug, name: role.name });
    if (this.last.size > 5_000) this.last.delete(this.last.keys().next().value!);
    return before && before.slug !== role.slug ? before : undefined;
  }

  // --- refusals -----------------------------------------------------------

  logRefusal(entry: Omit<RoleRefusalEntry, "id" | "at">): RoleRefusalEntry {
    const record: RoleRefusalEntry = { ...entry, id: randomUUID(), at: this.now() };
    this.refusals.push(record);
    if (this.refusals.length > MAX_REFUSALS) this.refusals.splice(0, this.refusals.length - MAX_REFUSALS);
    this.save();
    return record;
  }

  /** This person's refusals for this bot, newest first. */
  refusalsFor(principalId: string, botId?: string, sinceMs?: number): RoleRefusalEntry[] {
    const since = sinceMs === undefined ? 0 : this.now() - sinceMs;
    return this.refusals.filter((r) => r.principalId === principalId && (!botId || r.botId === botId) && r.at >= since).sort((a, b) => b.at - a.at);
  }

  markSent(principalId: string, id: string): RoleRefusalEntry | undefined {
    const record = this.refusals.find((r) => r.id === id && r.principalId === principalId);
    if (!record) return undefined;
    record.sentAt = this.now();
    // the same permission logged again counts as sent too
    for (const other of this.refusals) {
      if (other.principalId === principalId && other.role.slug === record.role.slug && other.permission.path === record.permission.path && other.permission.operation === record.permission.operation) other.sentAt = record.sentAt;
    }
    this.save();
    return record;
  }

  // --- transitions --------------------------------------------------------

  logTransition(entry: Omit<RoleTransitionEntry, "id" | "at">): RoleTransitionEntry {
    const record: RoleTransitionEntry = { ...entry, id: randomUUID(), at: this.now() };
    this.transitions.push(record);
    if (this.transitions.length > MAX_TRANSITIONS) this.transitions.splice(0, this.transitions.length - MAX_TRANSITIONS);
    this.save();
    return record;
  }

  transitionsFor(principalId: string, botId: string, sinceMs: number): RoleTransitionEntry[] {
    const since = this.now() - sinceMs;
    return this.transitions.filter((t) => t.principalId === principalId && t.botId === botId && t.at >= since).sort((a, b) => b.at - a.at);
  }

  // --- rules (bot owner) --------------------------------------------------

  rulesFor(botId: string, ownerId: string): BotRoleRule[] {
    return (this.rules.get(botId) ?? []).filter((rule) => rule.ownerId === ownerId);
  }

  addRule(botId: string, rule: Omit<BotRoleRule, "id" | "createdAt">): BotRoleRule {
    const list = this.rules.get(botId) ?? [];
    const same = list.find((r) => r.ownerId === rule.ownerId && r.from.slug === rule.from.slug && r.path === rule.path);
    if (same) { same.to = rule.to; this.save(); return same; }
    const record: BotRoleRule = { ...rule, id: randomUUID(), createdAt: this.now() };
    list.push(record);
    while (list.length > MAX_RULES_PER_BOT) list.shift();
    this.rules.set(botId, list);
    this.save();
    return record;
  }

  removeRule(botId: string, ownerId: string, id: string): boolean {
    const list = this.rules.get(botId) ?? [];
    const index = list.findIndex((rule) => rule.id === id && rule.ownerId === ownerId);
    if (index < 0) return false;
    list.splice(index, 1);
    this.save();
    return true;
  }

  /** A bot was deleted: its rules go with it. */
  forgetBot(botId: string): void {
    if (this.rules.delete(botId)) this.save();
  }

  /** What a read refused under `from` does in this thread: fall back (with
   * a card), fall back by the owner's rule (no card), or stay. Rules apply
   * only when the speaker is the bot's owner. */
  fallbackFor(input: { threadId: string; botId: string; principalId: string; ownerId?: string; from: string; path: string }): "fallback" | "rule" | "stay" {
    if (this.stays.get(input.threadId) === input.from) return "stay";
    if (input.ownerId && input.ownerId === input.principalId && matchingRoleRule(this.rules.get(input.botId), input.ownerId, input.from, input.path)) return "rule";
    return "fallback";
  }

  stay(threadId: string, slug: string): void {
    this.stays.set(threadId, slug);
    if (this.stays.size > 5_000) this.stays.delete(this.stays.keys().next().value!);
  }

  clearStay(threadId: string): void {
    this.stays.delete(threadId);
  }

  stayOf(threadId: string): string | undefined {
    return this.stays.get(threadId);
  }

  // --- the person's pick for the next turn ---------------------------------

  pick(threadId: string, principalId: string, slug: string): void {
    this.picks.set(threadId, { slug, principalId, at: this.now() });
    if (this.picks.size > 5_000) this.picks.delete(this.picks.keys().next().value!);
  }

  /** The pick for this thread's turn, only for the person who made it and
   * only within ten minutes. Taken once. */
  takePick(threadId: string, principalId: string): string | undefined {
    const pick = this.picks.get(threadId);
    if (!pick) return undefined;
    this.picks.delete(threadId);
    if (pick.principalId !== principalId || this.now() - pick.at > 10 * 60_000) return undefined;
    return pick.slug;
  }
}
