// The people's custom auto-review rules (shared/custom-rules.ts), on disk:
// custom-approval-rules.json, mode 0600.
//
// A rule is a person's own: every read and write names the person, and one
// person's rule is never returned to or changed by another. A file this
// process could not read is never overwritten: rules are ignored (no rule
// allows anything) until it is repaired.
//
// 2026-10-21 (Grok Bot parity lot 1A, server/custom-rules-org.ts): the
// organization's rules (ask or deny, by an admin, for everyone) and its
// "Toujours permettre" switch live in the same file under `org`. `rulesOf`
// is what the reviewer applies: the person's own rules (their allow rules
// only while the organization keeps Always allow on) and the organization's.

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { setOrgApprovalPolicySource, type OrgApprovalPolicy } from "./custom-rules-org.ts";
import {
  CUSTOM_RULE_BEHAVIORS,
  MAX_RULE_TEXT,
  RISK_CLASSES,
  type CustomRule,
  type CustomRuleBehavior,
  type CustomRuleBinding,
  type RiskClass,
} from "../shared/custom-rules.ts";

export const MAX_CUSTOM_RULES_PER_OWNER = 200;
export const MAX_ORG_RULES = 100;
/** The owner an organization rule carries (never a person's id). */
export const ORG_RULE_OWNER = "organization";

const ruleSchema = z.object({
  id: z.string().min(1).max(64),
  ownerId: z.string().min(1).max(200),
  botId: z.string().min(1).max(200).nullable(),
  when: z.string().min(1).max(MAX_RULE_TEXT),
  behavior: z.enum(CUSTOM_RULE_BEHAVIORS),
  riskScope: z.array(z.enum(RISK_CLASSES)).max(RISK_CLASSES.length),
  enabled: z.boolean(),
  binding: z.object({
    tool: z.string().min(1).max(300),
    botId: z.string().min(1).max(200).optional(),
    command: z.string().min(1).max(4000),
    cwd: z.string().max(4000).optional(),
    providerInstanceId: z.string().max(200).optional(),
  }).optional(),
  org: z.literal(true).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const orgSchema = z.object({
  rules: z.array(ruleSchema),
  alwaysAllow: z.boolean(),
  updatedAt: z.number().optional(),
});

const fileSchema = z.object({ version: z.literal(1), rules: z.array(ruleSchema), org: orgSchema.optional() });
type FileShape = z.infer<typeof fileSchema>;

export interface NewCustomRule {
  ownerId: string;
  botId: string | null;
  when: string;
  behavior: CustomRuleBehavior;
  riskScope?: RiskClass[];
  binding?: CustomRuleBinding;
}

export interface CustomRulePatch {
  when?: string;
  behavior?: CustomRuleBehavior;
  botId?: string | null;
  riskScope?: RiskClass[];
  enabled?: boolean;
}

export interface OrgRulePatch {
  when?: string;
  behavior?: OrgRuleBehavior;
  enabled?: boolean;
}

/** An organization rule only restricts. */
export type OrgRuleBehavior = Exclude<CustomRuleBehavior, "allow">;

export function isOrgRuleBehavior(value: unknown): value is OrgRuleBehavior {
  return value === "ask" || value === "deny";
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const copy = (rule: CustomRule): CustomRule => ({ ...rule, riskScope: [...rule.riskScope], ...(rule.binding ? { binding: { ...rule.binding } } : {}) });

function cleanText(text: string): string {
  // control characters become spaces: a rule is one line of words
  const printable = [...text].map((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? " " : char;
  }).join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, MAX_RULE_TEXT);
}

function cleanScope(scope: readonly RiskClass[] | undefined): RiskClass[] {
  return RISK_CLASSES.filter((risk) => scope?.includes(risk));
}

const registry: { store: CustomRuleStore | null } = { store: null };

/** The server's store (the last one made: one per server), for the
 * organization console routes (server/org-admin-ops.ts). */
export function registeredCustomRuleStore(): CustomRuleStore | null {
  return registry.store;
}

export class CustomRuleStore {
  private data: FileShape = { version: 1, rules: [] };
  private unreadable = false;

  private readonly file: string;
  private readonly now: () => number;

  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    this.load();
    // the live policy the deciders read (autoVerdict, matchOwnerRule, the
    // step-up gate): one store per server
    setOrgApprovalPolicySource(() => this.orgPolicy());
    registry.store = this;
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      return;
    }
    try {
      this.data = fileSchema.parse(JSON.parse(raw));
    } catch {
      this.unreadable = true;
      console.error("[custom-rules] custom-approval-rules.json could not be read; custom rules are ignored until it is repaired.");
    }
  }

  private save(): void {
    if (this.unreadable) throw Object.assign(new Error("Saved custom rules could not be read. Repair custom-approval-rules.json first."), { status: 503 });
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  /** The rules the reviewer applies for one person (and, with `botId`,
   * one bot): their own, without their allow rules while the organization
   * turned Always allow off, then the organization's enabled rules. */
  rulesOf(ownerId: string, botId?: string): CustomRule[] {
    if (this.unreadable) return [];
    const alwaysAllow = this.orgPolicy().alwaysAllow;
    return [
      ...this.ownRulesOf(ownerId, botId).filter((rule) => alwaysAllow || rule.behavior !== "allow"),
      ...this.orgRules().filter((rule) => rule.enabled),
    ];
  }

  /** One person's own rules, as saved; with `botId`, only those that can
   * apply to it. */
  ownRulesOf(ownerId: string, botId?: string): CustomRule[] {
    if (this.unreadable) return [];
    return this.data.rules
      .filter((rule) => same(rule.ownerId, ownerId) && (botId === undefined || rule.botId === null || rule.botId === botId))
      .map(copy);
  }

  // ── the organization's ─────────────────────────────────────────────────

  /** The organization's policy. A file that could not be read refuses
   * standing grants (fail closed) until it is repaired. */
  orgPolicy(): OrgApprovalPolicy {
    if (this.unreadable) return { alwaysAllow: false };
    return { alwaysAllow: this.data.org?.alwaysAllow ?? true };
  }

  /** The organization's rules, enabled or not. */
  orgRules(): CustomRule[] {
    if (this.unreadable) return [];
    return (this.data.org?.rules ?? []).map(copy);
  }

  isOrgRule(id: string): boolean {
    return (this.data.org?.rules ?? []).some((rule) => rule.id === id);
  }

  private org(): NonNullable<FileShape["org"]> {
    this.data.org ??= { rules: [], alwaysAllow: true };
    return this.data.org;
  }

  setOrgAlwaysAllow(allowed: boolean): OrgApprovalPolicy {
    if (this.unreadable) this.save();
    const org = this.org();
    org.alwaysAllow = allowed;
    org.updatedAt = this.now();
    this.save();
    return this.orgPolicy();
  }

  addOrgRule(input: { when: string; behavior: OrgRuleBehavior }): CustomRule {
    if (this.unreadable) this.save();
    const when = cleanText(input.when);
    if (!when) throw Object.assign(new Error("A rule needs words."), { status: 400 });
    if (!isOrgRuleBehavior(input.behavior)) throw Object.assign(new Error("An organization rule asks first or refuses."), { status: 400 });
    const org = this.org();
    const at = this.now();
    const existing = org.rules.find((rule) => rule.when.toLowerCase() === when.toLowerCase());
    if (existing) {
      existing.behavior = input.behavior;
      existing.enabled = true;
      existing.updatedAt = at;
      this.save();
      return copy(existing);
    }
    if (org.rules.length >= MAX_ORG_RULES) throw Object.assign(new Error(`At most ${MAX_ORG_RULES} organization rules.`), { status: 409 });
    const rule: CustomRule = {
      id: `orule_${randomUUID()}`,
      ownerId: ORG_RULE_OWNER,
      botId: null,
      when,
      behavior: input.behavior,
      riskScope: [],
      enabled: true,
      org: true,
      createdAt: at,
      updatedAt: at,
    };
    org.rules.push(rule);
    this.save();
    return copy(rule);
  }

  updateOrgRule(id: string, patch: OrgRulePatch): CustomRule | null {
    const rule = this.data.org?.rules.find((candidate) => candidate.id === id);
    if (!rule) return null;
    if (patch.when !== undefined) {
      const when = cleanText(patch.when);
      if (!when) throw Object.assign(new Error("A rule needs words."), { status: 400 });
      rule.when = when;
    }
    if (patch.behavior !== undefined) {
      if (!isOrgRuleBehavior(patch.behavior)) throw Object.assign(new Error("An organization rule asks first or refuses."), { status: 400 });
      rule.behavior = patch.behavior;
    }
    if (patch.enabled !== undefined) rule.enabled = patch.enabled;
    rule.updatedAt = this.now();
    this.save();
    return copy(rule);
  }

  removeOrgRule(id: string): CustomRule | null {
    const rules = this.data.org?.rules;
    const index = rules ? rules.findIndex((rule) => rule.id === id) : -1;
    if (!rules || index < 0) return null;
    const [removed] = rules.splice(index, 1);
    this.save();
    return copy(removed!);
  }

  get(ownerId: string, id: string): CustomRule | undefined {
    const rule = this.data.rules.find((candidate) => candidate.id === id && same(candidate.ownerId, ownerId));
    return rule ? copy(rule) : undefined;
  }

  add(input: NewCustomRule): CustomRule {
    const when = cleanText(input.when);
    if (!when) throw Object.assign(new Error("A rule needs words."), { status: 400 });
    const riskScope = input.behavior === "allow" ? cleanScope(input.riskScope) : [];
    const existing = this.data.rules.find((rule) => same(rule.ownerId, input.ownerId) && rule.botId === input.botId && rule.when.toLowerCase() === when.toLowerCase()
      && JSON.stringify(rule.binding ?? null) === JSON.stringify(input.binding ?? null));
    const at = this.now();
    if (existing) {
      existing.behavior = input.behavior;
      existing.riskScope = riskScope;
      existing.enabled = true;
      existing.updatedAt = at;
      this.save();
      return { ...existing, riskScope: [...existing.riskScope] };
    }
    if (this.ownRulesOf(input.ownerId).length >= MAX_CUSTOM_RULES_PER_OWNER) {
      throw Object.assign(new Error(`At most ${MAX_CUSTOM_RULES_PER_OWNER} custom rules per person.`), { status: 409 });
    }
    const rule: CustomRule = {
      id: `crule_${randomUUID()}`,
      ownerId: input.ownerId,
      botId: input.botId,
      when,
      behavior: input.behavior,
      riskScope,
      enabled: true,
      ...(input.binding ? { binding: { ...input.binding } } : {}),
      createdAt: at,
      updatedAt: at,
    };
    this.data.rules.push(rule);
    this.save();
    return { ...rule, riskScope: [...rule.riskScope] };
  }

  update(ownerId: string, id: string, patch: CustomRulePatch): CustomRule | null {
    const rule = this.data.rules.find((candidate) => candidate.id === id && same(candidate.ownerId, ownerId));
    if (!rule) return null;
    if (patch.when !== undefined) {
      const when = cleanText(patch.when);
      if (!when) throw Object.assign(new Error("A rule needs words."), { status: 400 });
      rule.when = when;
    }
    if (patch.behavior !== undefined) rule.behavior = patch.behavior;
    if (patch.botId !== undefined) rule.botId = patch.botId;
    if (patch.enabled !== undefined) rule.enabled = patch.enabled;
    if (patch.riskScope !== undefined) rule.riskScope = cleanScope(patch.riskScope);
    // only an allow can carry a risk scope
    if (rule.behavior !== "allow") rule.riskScope = [];
    rule.updatedAt = this.now();
    this.save();
    return { ...rule, riskScope: [...rule.riskScope] };
  }

  remove(ownerId: string, id: string): boolean {
    const index = this.data.rules.findIndex((rule) => rule.id === id && same(rule.ownerId, ownerId));
    if (index < 0) return false;
    this.data.rules.splice(index, 1);
    this.save();
    return true;
  }
}
