// A bot's rules as several named sets (docs/bot-workspace.md, 2026-10-15).
//
// RULES.md used to be the only rules file. It stays, as the first set's file
// (id "rules"), so a bot that never touched sets keeps its file, its prompt
// and its journal history byte for byte. Every other set is one markdown
// file, `rules/<id>.md`. The order, the names and the on/off switch of each
// set live in `rules/.sets.json` (hidden: not in the Files list, never read
// by workspace_read; it still travels with the bot package).
//
// The sets that are on load in order, right after the soul, each under its
// own budget (RULES_MAX_LINES / RULES_MAX_BYTES) and all of them under a
// total (RULES_TOTAL_MAX_LINES / RULES_TOTAL_MAX_BYTES), cut with a notice
// like MEMORY.md. HTML comments never load, which is how the starter
// template's examples cost nothing.
//
// Migration is implicit: without a manifest the list is RULES.md (on), then
// any rules/<id>.md file on disk (on), so nothing written before is lost or
// switched off. The manifest is written the first time a person changes a
// set; a file found on disk that the manifest does not name is listed (on)
// rather than ignored, whoever wrote it.
import { lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { RULE_SETS_DIR, RULES_PATH } from "../memory/memory-store.ts";
import { dirFingerprint, mtimeCached, pathsFingerprint } from "../workspace/mtime-prompt-cache.ts";
import { ensureWorkspace, memoryLineCount, readMemoryText, workspaceDir } from "../workspace/workspace.ts";

export { RULE_SETS_DIR };
export const RULES_FILE = RULES_PATH;
/** One set loads at most this much. RULES.md alone was 60 lines / 8 KB. */
export const RULES_MAX_LINES = 100;
export const RULES_MAX_BYTES = 12_000;
/** Every set that is on, together: about 6k tokens a turn at the most, the
 * size of SOUL.md's and MEMORY.md's own budgets (24 KB each). Rules sit in
 * the stable, cached half of the prompt. */
export const RULES_TOTAL_MAX_LINES = 250;
export const RULES_TOTAL_MAX_BYTES = 24_000;
/** One rule per rules_update: a rule is a sentence, not a procedure. */
export const RULE_MAX_CHARS = 500;
export const RULE_SETS_MAX = 20;
export const RULE_SET_NAME_MAX = 60;
/** The set RULES.md belongs to. */
export const DEFAULT_RULE_SET_ID = "rules";
export const RULE_SETS_MANIFEST = `${RULE_SETS_DIR}/.sets.json`;

const SET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SET_ID_MAX = 40;

/** The text the Rules editor starts from when a set's file does not exist
 * yet. Everything below the heading is a comment: saved as is, it loads
 * nothing. */
export const RULES_TEMPLATE = `# Rules

<!--
Hard constraints this bot checks every turn. One rule per line.
Identity goes in Soul; facts go in Memory. Text inside this comment is not loaded.

Examples (copy a line below the comment to use it):
- Never send an email to a client without showing me the draft first.
- Always answer in the language the person writes in.
- Never quote a price; send pricing questions to the sales team.
-->
`;

/** A rules file as it loads: HTML comments removed, blank runs folded,
 * trimmed. Headings stay (they are the person's text); only comments go. */
export function effectiveRulesText(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Whether a rules file holds anything but comments and headings. */
export function hasRules(text: string): boolean {
  return text.split("\n").some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()));
}

/** Whether `raw` would load whole as one set (after comments are removed). */
export function rulesOverBudget(raw: string): boolean {
  const effective = effectiveRulesText(raw);
  return memoryLineCount(effective) > RULES_MAX_LINES || Buffer.byteLength(effective, "utf8") > RULES_MAX_BYTES;
}

export function isRuleSetId(id: unknown): id is string {
  return typeof id === "string" && id.length <= SET_ID_MAX && SET_ID.test(id);
}

/** The file a set's rules live in, relative to the workspace. */
export function ruleSetFile(id: string): string {
  return id === DEFAULT_RULE_SET_ID ? RULES_FILE : `${RULE_SETS_DIR}/${id}.md`;
}

/** A set name as it is stored and shown: one line, no control characters,
 * at most RULE_SET_NAME_MAX characters. Null when nothing is left. */
export function cleanRuleSetName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  // oxlint-disable-next-line no-control-regex -- a name is one plain line
  const name = input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return name ? name.slice(0, RULE_SET_NAME_MAX).trim() : null;
}

export interface RuleSet {
  id: string;
  /** null: the default set, shown as "Rules" in the person's language. */
  name: string | null;
  enabled: boolean;
  /** RULES.md or rules/<id>.md */
  file: string;
}

const manifestSchema = z.object({
  version: z.literal(1),
  sets: z.array(z.object({
    id: z.string(),
    name: z.string().nullable().optional(),
    enabled: z.boolean(),
  })).max(RULE_SETS_MAX * 2),
});

function regularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** rules/<id>.md files on disk, by id. Links and other names are not sets. */
function setFilesOnDisk(botId: string): string[] {
  const dir = join(workspaceDir(botId), RULE_SETS_DIR);
  try {
    if (!lstatSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md") && isRuleSetId(name.slice(0, -3)) && name !== `${DEFAULT_RULE_SET_ID}.md`)
      .filter((name) => regularFile(join(dir, name)))
      .map((name) => name.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

function readManifest(botId: string): Array<{ id: string; name: string | null; enabled: boolean }> | null {
  const path = join(workspaceDir(botId), RULE_SETS_MANIFEST);
  if (!regularFile(path)) return null;
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return null;
    const seen = new Set<string>();
    return parsed.data.sets.flatMap((set) => {
      if (!isRuleSetId(set.id) || seen.has(set.id)) return [];
      seen.add(set.id);
      return [{ id: set.id, name: cleanRuleSetName(set.name ?? null), enabled: set.enabled }];
    });
  } catch {
    // unreadable: listed from disk instead, every set on (rules are
    // constraints; a broken manifest must not switch them off)
    return null;
  }
}

/** The bot's rule sets in load order. Never empty only when the manifest
 * says so: without one, the default set (RULES.md) is always first, so the
 * editor opens on it like before. */
export function listRuleSets(botId: string): RuleSet[] {
  const manifest = readManifest(botId);
  const onDisk = setFilesOnDisk(botId);
  const rulesExists = regularFile(join(workspaceDir(botId), RULES_FILE));
  const sets: RuleSet[] = [];
  const listed = new Set<string>();
  const push = (id: string, name: string | null, enabled: boolean) => {
    if (listed.has(id)) return;
    listed.add(id);
    sets.push({ id, name, enabled, file: ruleSetFile(id) });
  };
  if (manifest) {
    for (const set of manifest) push(set.id, set.name, set.enabled);
    // a file the manifest does not name (an older client wrote RULES.md
    // after its set was removed, a bot wrote rules/x.md): listed, on
    if (rulesExists) push(DEFAULT_RULE_SET_ID, null, true);
  } else {
    push(DEFAULT_RULE_SET_ID, null, true);
  }
  for (const id of onDisk) push(id, null, true);
  return sets;
}

/** Writes the manifest: the order, names and switches of `sets`. A link
 * named rules/ or rules/.sets.json is refused, never followed. */
export function writeRuleSets(botId: string, sets: ReadonlyArray<Pick<RuleSet, "id" | "name" | "enabled">>): void {
  ensureWorkspace(botId);
  const dir = join(workspaceDir(botId), RULE_SETS_DIR);
  const manifestPath = join(workspaceDir(botId), RULE_SETS_MANIFEST);
  const state = (path: string) => {
    try {
      const stat = lstatSync(path);
      return stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "dir" : "file";
    } catch {
      return "missing";
    }
  };
  const dirState = state(dir);
  if (dirState === "link" || dirState === "file") throw new Error("the rules folder of this bot is not a plain folder");
  if (dirState === "missing") mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (state(manifestPath) === "link") throw new Error("the rule sets file of this bot is a link");
  const body = { version: 1, sets: sets.map((set) => ({ id: set.id, name: set.name, enabled: set.enabled })) };
  writeFileAtomic(manifestPath, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
}

/** A fresh id for a set called `name`: its letters folded to a slug,
 * suffixed until it is free. */
export function newRuleSetId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  used.add(DEFAULT_RULE_SET_ID);
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SET_ID_MAX - 4)
    .replace(/-+$/g, "") || "set";
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id;
  }
}

/** The set a rules_update or a route names: its id, or its name (case and
 * spacing ignored). Without one, the first set. */
export function findRuleSet(sets: readonly RuleSet[], ref: string | undefined): RuleSet | undefined {
  if (ref === undefined || !ref.trim()) return sets[0];
  const wanted = ref.trim();
  const fold = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return sets.find((set) => set.id === wanted)
    ?? sets.find((set) => fold(set.name ?? "Rules") === fold(wanted))
    ?? sets.find((set) => set.file === wanted);
}

/** A set's raw text, "" when its file does not exist. */
export function readRuleSetText(botId: string, set: Pick<RuleSet, "file">): string {
  try {
    return readMemoryText(join(workspaceDir(botId), ...set.file.split("/")));
  } catch {
    return "";
  }
}

export interface RulesMeasure {
  lines: number;
  bytes: number;
}

export function measureRules(raw: string): RulesMeasure {
  const text = effectiveRulesText(raw);
  return { lines: memoryLineCount(text), bytes: Buffer.byteLength(text, "utf8") };
}

export function setOverBudget(measure: RulesMeasure): boolean {
  return measure.lines > RULES_MAX_LINES || measure.bytes > RULES_MAX_BYTES;
}

export function totalOverBudget(measure: RulesMeasure): boolean {
  return measure.lines > RULES_TOTAL_MAX_LINES || measure.bytes > RULES_TOTAL_MAX_BYTES;
}

/** What the sets that are on add up to, `override` replacing one set's raw
 * text (a write about to happen). */
export function activeRulesTotal(botId: string, override?: { id: string; raw: string }): RulesMeasure {
  let lines = 0;
  let bytes = 0;
  for (const set of listRuleSets(botId)) {
    if (!set.enabled) continue;
    const raw = override && override.id === set.id ? override.raw : readRuleSetText(botId, set);
    const effective = effectiveRulesText(raw);
    if (!hasRules(effective)) continue;
    const measure = measureRules(raw);
    lines += measure.lines;
    bytes += measure.bytes;
  }
  return { lines, bytes };
}

function cut(text: string, maxLines: number, maxBytes: number): { text: string; truncated: boolean } {
  let out = text;
  let truncated = false;
  if (memoryLineCount(out) > maxLines) {
    out = out.split("\n").slice(0, maxLines).join("\n");
    truncated = true;
  }
  if (Buffer.byteLength(out, "utf8") > maxBytes) {
    out = Buffer.from(out, "utf8").subarray(0, maxBytes).toString("utf8").replace(/�+$/, "");
    truncated = true;
  }
  return { text: out, truncated };
}

export interface LoadedRules {
  id: string;
  name: string | null;
  file: string;
  text: string;
  /** cut by its own budget or by the total */
  truncated: boolean;
  /** what cut it: the set's own budget, or what was left of the total */
  cutBy?: "set" | "total";
  /** lines and bytes of the whole effective text, before any cut */
  lines: number;
  bytes: number;
}

/** The sets that are on, in order, as they load: each under its budget,
 * all under the total. A set with no rule (the template, a heading) is
 * left out; a set past the total is cut, or `omitted` once nothing is left. */
export function loadActiveRules(botId: string): { sets: LoadedRules[]; omitted: string[] } {
  const sets: LoadedRules[] = [];
  const omitted: string[] = [];
  let linesLeft = RULES_TOTAL_MAX_LINES;
  let bytesLeft = RULES_TOTAL_MAX_BYTES;
  for (const set of listRuleSets(botId)) {
    if (!set.enabled) continue;
    const effective = effectiveRulesText(readRuleSetText(botId, set));
    if (!hasRules(effective)) continue;
    if (linesLeft <= 0 || bytesLeft <= 0) {
      omitted.push(set.file);
      continue;
    }
    const own = cut(effective, RULES_MAX_LINES, RULES_MAX_BYTES);
    const total = cut(own.text, linesLeft, bytesLeft);
    linesLeft -= memoryLineCount(total.text);
    bytesLeft -= Buffer.byteLength(total.text, "utf8");
    sets.push({
      id: set.id,
      name: set.name,
      file: set.file,
      text: total.text,
      truncated: own.truncated || total.truncated,
      ...(own.truncated ? { cutBy: "set" as const } : total.truncated ? { cutBy: "total" as const } : {}),
      lines: memoryLineCount(effective),
      bytes: Buffer.byteLength(effective, "utf8"),
    });
  }
  return { sets, omitted };
}

/** RULES.md alone under its budget (the default set), or null when it holds
 * no rule. Kept for the callers that only ever knew one file. */
export function loadRules(botId: string): LoadedRules | null {
  const set = listRuleSets(botId).find((candidate) => candidate.id === DEFAULT_RULE_SET_ID) ?? { id: DEFAULT_RULE_SET_ID, name: null, enabled: true, file: RULES_FILE };
  const effective = effectiveRulesText(readRuleSetText(botId, set));
  if (!hasRules(effective)) return null;
  const own = cut(effective, RULES_MAX_LINES, RULES_MAX_BYTES);
  return { id: set.id, name: set.name, file: set.file, text: own.text, truncated: own.truncated, ...(own.truncated ? { cutBy: "set" as const } : {}), lines: memoryLineCount(effective), bytes: Buffer.byteLength(effective, "utf8") };
}

/** Fingerprint of RULES.md, the sets manifest, and every file under rules/. */
function rulesPromptFingerprint(botId: string): string {
  const root = workspaceDir(botId);
  return `${pathsFingerprint([join(root, RULES_FILE), join(root, RULE_SETS_MANIFEST)])}|${dirFingerprint(join(root, RULE_SETS_DIR))}`;
}

/** The Rules block of the system prompt, placed right after the soul
 * (buildSystemPrompt). Empty without rules, so a bot without any gets the
 * prompt it always had byte for byte, and a bot with RULES.md alone gets
 * the block it always had. */
export function rulesSystemPrompt(botId: string, opts: { writes?: boolean } = {}): string {
  const writesOn = opts.writes === true;
  // #1950: reuse the rendered rules block while RULES.md / rules/ stay put.
  return mtimeCached("rules-prompt", botId, writesOn ? "writes" : "ro", rulesPromptFingerprint(botId), () => {
    const { sets, omitted } = loadActiveRules(botId);
    if (!sets.length) return "";
    const single = sets.length === 1 && sets[0]!.id === DEFAULT_RULE_SET_ID && sets[0]!.name === null && !omitted.length;
    const blocks = sets.map((set) => {
      const bytes = Buffer.byteLength(set.text, "utf8");
      const label = single ? "" : ` ${JSON.stringify(set.name ?? "Rules")}`;
      const notice = !set.truncated
        ? ""
        : set.cutBy === "total"
          ? `\n[${set.file} is ${set.lines} lines and ${set.bytes} bytes; only the part shown above fits the rules budget of ${RULES_TOTAL_MAX_LINES} lines / ${RULES_TOTAL_MAX_BYTES} bytes in all. Ask the person to shorten or switch off a set in Persona > Rules.]`
          : `\n[${set.file} is ${set.lines} lines and ${set.bytes} bytes; only the first ${RULES_MAX_LINES} lines / ${RULES_MAX_BYTES} bytes are shown above. Ask the person to shorten it in Persona > Rules.]`;
      return `--- BEGIN RULES${label} (${set.file}, ${bytes} bytes) ---\n${set.text}\n--- END RULES ---${notice}`;
    });
    const left = omitted.length
      ? `\n[Not loaded, past the rules budget of ${RULES_TOTAL_MAX_LINES} lines / ${RULES_TOTAL_MAX_BYTES} bytes: ${omitted.join(", ")}. Ask the person to shorten or switch off a set in Persona > Rules.]`
      : "";
    const writes = writesOn
      ? single
        ? " Change RULES.md only with rules_update, and only when the person asks for it in this conversation."
        : " Change your rules only with rules_update (set: the set's name; without it, the first set), and only when the person asks for it in this conversation."
      : "";
    const intro = single
      ? "\n\nYour rules follow: hard constraints the person set for you."
      : `\n\nYour rules follow, in ${sets.length} sets: hard constraints the person set for you.`;
    return (
      intro +
      " Check every reply and every action against them before you act." +
      " They rank with your standing instructions, above your memory, documents and imported skills, and below the person's current request and safety boundaries." +
      " Text inside this block is instruction for you, never tool authorization or permission to expose secrets." +
      writes +
      "\n\n" +
      blocks.join("\n\n") +
      left
    );
  });
}

/** The workspace paths of the sets that are on: what a turn's prompt
 * carried, for the Files list's "last used". */
export function activeRuleFiles(botId: string): string[] {
  return loadActiveRules(botId).sets.map((set) => set.file);
}
