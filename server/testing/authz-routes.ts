// The authorization matrix's route list (server/authz-matrix.e2e.test.ts),
// derived from the code, never typed by hand. Every route a member session
// may reach is a row of CLIENT_ALLOW (server/request-auth.ts); everything
// else is admin scope and refused at the gate. Each row's path pattern is
// expanded here into the concrete paths it accepts, and each id in them is
// named by what it points at (a bot, a thread, a routine...), so the e2e
// test can aim the same request at A's own things and at B's.
//
// A new row whose id this file cannot name fails
// server/testing/authz-routes.test.ts: name the segment in SLOT_KINDS (and,
// if it is a new kind of thing a person owns, give the e2e fixture B's).
import { CLIENT_ALLOW, type ClientFeature } from "../request-auth.ts";

/** What an id in a path points at. "fake" kinds are ids the fixture does not
 * create (a queue item, a card): the request is still aimed at B's bot or
 * thread, and the fake id only fills the slot. */
export type SlotKind =
  | "bot" | "thread" | "message" | "group" | "routine" | "run" | "task" | "person" | "team"
  | "credential" | "webhook" | "page" | "customRule" | "approvalRule" | "ruleSet" | "skill"
  | "project" | "artifact" | "toolGrant" | "worker" | "workerTurn" | "terminalSession" | "wizard"
  | "importStaging" | "attachment" | "threadFile" | "mcpServer" | "securityKey" | "desktopBridge"
  | "sharedComputer" | "vps" | "engine" | "section" | "plugin" | "marketplace" | "pageVersion"
  | "queueItem" | "parallelRun" | "card" | "resourceUsage" | "connectorSetup" | "phoneRequest"
  | "cardScan" | "purchase" | "phoneCall" | "invite" | "blocked" | "journalEntry" | "credentialGrant"
  | "draft" | "codeRun" | "cloudAgent" | "allowlistEntry" | "workflow" | "workflowRun" | "taskListItem" | "briefItem"
  | "calendarCall" | "proactiveProposal" | "providerAccount" | "meSkill" | "unattendedHost";

/** Kinds a person owns: the matrix aims A at B's. The rest only ride along. */
export const OWNED_KINDS: ReadonlySet<SlotKind> = new Set<SlotKind>([
  "bot", "thread", "message", "group", "routine", "run", "task", "person", "credential", "webhook",
  "page", "customRule", "approvalRule", "ruleSet", "skill", "project", "artifact", "toolGrant",
  "worker", "terminalSession", "wizard", "mcpServer", "securityKey", "desktopBridge", "codeRun",
  "cloudAgent", "attachment", "threadFile", "draft", "importStaging", "section", "calendarCall",
]);

/**
 * `<previous segment>/<literal prefix in the id's own segment>` -> kind.
 * The previous segment is the last whole literal segment before the id; the
 * prefix is any literal text between that slash and the id (`pr_`, `art_`).
 * A pattern listed with `*` matches any previous segment with that prefix.
 */
export const SLOT_KINDS: Readonly<Record<string, SlotKind>> = {
  "bots/": "bot",
  "threads/": "thread",
  "messages/": "message",
  "groups/": "group",
  "routines/": "routine",
  "routine-runs/": "run",
  "tasks/": "task",
  "queue/": "queueItem",
  "parallel/": "parallelRun",
  "people/pr_": "person",
  "people/": "person",
  "direct-grants/pr_": "person",
  "grants/user%3Apr_": "person",
  "grants/user:pr_": "person",
  "grants/team%3A": "team",
  "grants/team:": "team",
  "tool-grants/tg_": "toolGrant",
  "credentials/": "credential",
  "grants/": "credentialGrant",
  "purchases/pay_": "purchase",
  "phone-calls/call_": "phoneCall",
  "webhooks/": "webhook",
  "pages/": "page",
  "versions/": "pageVersion",
  "custom-rules/": "customRule",
  "approval-rules/": "approvalRule",
  "sets/": "ruleSet",
  "skills/": "skill",
  "projects/": "project",
  "artifacts/art_": "artifact",
  "workers/": "worker",
  "turns/": "workerTurn",
  "sessions/": "terminalSession",
  "bot-wizard/": "wizard",
  "import/": "importStaging",
  "attachments/": "attachment",
  "files/": "threadFile",
  "servers/": "mcpServer",
  "security-keys/": "securityKey",
  "desktop-bridge/": "desktopBridge",
  "shared-computers/": "sharedComputer",
  "remote-hosts/h_": "unattendedHost",
  "vps/": "vps",
  "engines/": "engine",
  "sections/sec_": "section",
  "plugins/": "plugin",
  // the marketplace half of `name@marketplace`
  "plugins/{plugin}@": "marketplace",
  "plugins/{plugin}%40": "marketplace",
  "marketplaces/": "marketplace",
  "cards/": "card",
  "secret-cards/": "card",
  "connector-cards/": "card",
  "vault-cards/": "card",
  "resource-usage/ru_": "resourceUsage",
  "connector-setup/cs_": "connectorSetup",
  "requests/": "phoneRequest",
  "card-scan/": "cardScan",
  "invites/": "invite",
  "blocks/": "blocked",
  "journal/": "journalEntry",
  "email-drafts/": "draft",
  "runs/": "codeRun",
  "cloud-agents/": "cloudAgent",
  "command-allowlist/": "allowlistEntry",
  "bot-catalog/": "bot",
  "bot-overrides/": "bot",
  // under /api/me: a name or run id resolves in the caller's own workflows only
  "workflows/": "workflow",
  "runs/wf_": "workflowRun",
  // an item of a bot's task list: the request is aimed at the bot
  "task-list/task_": "taskListItem",
  // an item of a bot's background brief: the request is aimed at the bot
  "background-brief/": "briefItem",
  // a scheduled call (#1482): reached when the caller may run every bot in it
  "calendar-calls/": "calendarCall",
  // a proactive proposal of a bot (#1764): the request is aimed at the bot
  "proactive/": "proactiveProposal",
  // a provider id under /api/me/providers/keys (#1806): the caller's own account only
  "keys/": "providerAccount",
  // a skill of the caller's own Me library: resolved for the session's person only
  "skills-library/": "meSkill",
  // an engine instance's personal API key: the instance id names an engine
  "instances/": "engine",
};

type Atom = { lit: string } | { cls: string };
type Seq = Atom[];

/** The concrete shapes a CLIENT_ALLOW path pattern accepts: literal text and
 * id slots. Optional groups give both shapes, alternations each branch. */
export function expandPattern(source: string): Seq[] {
  let i = 0;
  const MAX = 64;
  const cross = (a: Seq[], b: Seq[]): Seq[] => {
    const out: Seq[] = [];
    for (const x of a) for (const y of b) { out.push([...x, ...y]); if (out.length > MAX) throw new Error(`pattern expands to more than ${MAX} shapes: ${source}`); }
    return out;
  };
  const parseAlt = (): Seq[] => {
    const branches: Seq[] = [];
    let current: Seq[] = [[]];
    while (i < source.length) {
      const c = source[i]!;
      if (c === ")") break;
      if (c === "|") { branches.push(...current); current = [[]]; i++; continue; }
      let atom: Seq[];
      let isClass = false;
      if (c === "^" || c === "$") { i++; continue; }
      if (c === "\\") {
        const next = source[i + 1]!;
        i += 2;
        if (next === "d" || next === "w") { atom = [[{ cls: `\\${next}` }]]; isClass = true; }
        else atom = [[{ lit: next }]];
      } else if (c === "[") {
        const end = source.indexOf("]", i + 1);
        if (end < 0) throw new Error(`unclosed class in ${source}`);
        atom = [[{ cls: source.slice(i, end + 1) }]];
        isClass = true;
        i = end + 1;
      } else if (c === "(") {
        if (source.startsWith("(?:", i)) i += 3;
        else i += 1;
        atom = parseAlt();
        if (source[i] !== ")") throw new Error(`unclosed group in ${source}`);
        i++;
      } else {
        atom = [[{ lit: c }]];
        i++;
      }
      // quantifier
      const q = source[i];
      if (q === "+" || q === "*" || q === "?" || q === "{") {
        let min = 1;
        const from = i;
        if (q === "{") {
          const end = source.indexOf("}", i);
          const body = source.slice(i + 1, end);
          min = Number(body.split(",")[0]);
          i = end + 1;
        } else {
          min = q === "+" ? 1 : 0;
          i++;
        }
        // a class with any quantifier stays one id slot, quantifier kept
        if (isClass) atom = [[{ cls: (atom[0]![0] as { cls: string }).cls + source.slice(from, i) }]];
        else if (min === 0) atom = [[], ...atom];
      }
      current = cross(current, atom);
    }
    branches.push(...current);
    return branches;
  };
  const shapes = parseAlt();
  if (i !== source.length) throw new Error(`unbalanced pattern ${source}`);
  return shapes.map(merge);
}

/** Adjacent class atoms are one id (`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`), and
 * adjacent literals are one string. */
function merge(seq: Seq): Seq {
  const out: Seq = [];
  for (const atom of seq) {
    const last = out.at(-1);
    if (last && "lit" in last && "lit" in atom) out[out.length - 1] = { lit: last.lit + atom.lit };
    else if (last && "cls" in last && "cls" in atom) out[out.length - 1] = { cls: last.cls + atom.cls };
    else out.push(atom);
  }
  return out;
}

export interface Slot {
  kind: SlotKind;
  /** The literal text between the last slash and the id (`pr_`, `art_`). */
  prefix: string;
  /** The class source, to make a fake id that the pattern accepts. */
  cls: string;
}

export type Piece = { lit: string } | { slot: Slot };

export interface RouteShape {
  /** `METHOD pattern-source`, the CLIENT_ALLOW row this came from. */
  rule: string;
  method: string;
  pattern: RegExp;
  feature?: ClientFeature;
  pieces: Piece[];
  /** Human-readable, ids as `{kind}`. */
  template: string;
}

/** Names each id slot of a shape; throws on one it cannot name. */
export function nameSlots(seq: Seq, source: string): Piece[] {
  const pieces: Piece[] = [];
  let text = "";
  for (const atom of seq) {
    if ("lit" in atom) { text += atom.lit; pieces.push({ lit: atom.lit }); continue; }
    const slash = text.lastIndexOf("/");
    const prefix = text.slice(slash + 1);
    const before = text.slice(0, slash);
    const segment = before.slice(before.lastIndexOf("/") + 1);
    const kind = SLOT_KINDS[`${segment}/${prefix}`];
    if (!kind) throw new Error(`unclassified id after "${segment}/${prefix}" in ${source}: name it in SLOT_KINDS (server/testing/authz-routes.ts)`);
    // a slot's prefix is already in the literal before it
    pieces.push({ slot: { kind, prefix, cls: atom.cls } });
    text += `{${kind}}`;
  }
  return pieces;
}

const template = (pieces: Piece[]) => pieces.map((p) => ("lit" in p ? p.lit : `{${p.slot.kind}}`)).join("");

/** Every (method, concrete shape) a member session may reach. */
export function memberRouteShapes(features: Partial<Record<ClientFeature, boolean>>): RouteShape[] {
  const out: RouteShape[] = [];
  for (const rule of CLIENT_ALLOW) {
    if (rule.feature && features[rule.feature] !== true) continue;
    for (const seq of expandPattern(rule.path.source)) {
      const pieces = nameSlots(seq, rule.path.source);
      for (const method of rule.methods) {
        out.push({ rule: `${rule.methods.join(",")} ${rule.path.source}`, method, pattern: rule.path, ...(rule.feature ? { feature: rule.feature } : {}), pieces, template: template(pieces) });
      }
    }
  }
  return out;
}

/** CLIENT_ALLOW rows a feature switch leaves out (listed, never silently dropped). */
export function rowsBehindFeatures(features: Partial<Record<ClientFeature, boolean>>): string[] {
  return CLIENT_ALLOW.filter((r) => r.feature && features[r.feature] !== true).map((r) => `${r.methods.join(",")} ${r.path.source} (${r.feature})`);
}

/** A fake id the slot's class accepts. */
export function fakeId(slot: Slot): string {
  const c = slot.cls;
  if (c.includes("0-9a-f-]{36}")) return "00000000-0000-4000-8000-000000000000";
  if (c.includes("a-f0-9]{32}") || c.includes("0-9a-f]{32}")) return "a".repeat(32);
  if (c.includes("a-f0-9]{24}")) return "a".repeat(24);
  if (c.includes("a-f0-9]{18}")) return "a".repeat(18);
  if (c.includes("a-f0-9]{16}")) return "a".repeat(16);
  if (c.includes("[a-z0-9]{8,40}")) return "zzfake0000";
  if (c.startsWith("\\d")) return "1";
  if (c.startsWith("[a-z]")) return "zzfake";
  if (c.includes("A-Za-z0-9]{1,64}") || c.startsWith("[0-9A-Za-z]")) return "ZZFAKE";
  return "zz-fake-id";
}

/** The path for a shape, each slot filled by `fill` (or a fake id). */
export function fillShape(shape: RouteShape, fill: (slot: Slot) => string | undefined): string {
  return shape.pieces.map((p) => ("lit" in p ? p.lit : (fill(p.slot) ?? fakeId(p.slot)))).join("");
}
