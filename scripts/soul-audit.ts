// Read-only audit of bot souls (#5019): lists the souls that hold more than
// identity, persona and voice (rules, procedures, references, decision
// logs, fleet lists), with the passages that say so. It changes nothing:
// the server files what new writes add (server/bots/soul-sort.ts); a soul
// written before that is cleaned by hand, and this command checks it later.
//
//   pnpm soul-audit                      the bots of this machine's data folder
//   pnpm soul-audit --data-dir <dir>     another data folder (read only)
//   pnpm soul-audit --file souls.json    souls read elsewhere: [{ name, soul }]
//                                        or get_agent answers ({ agent, profile })
//   pnpm soul-audit --json               one JSON object per bot
//
// The check is deterministic (no model): a section whose heading names
// rules, decisions, procedures, references, tools or a fleet; a numbered
// procedure; a table; dated decision lines; ids and links; a long run of
// never/always lines outside a voice section. A voice or persona section is
// never flagged, so "Never open the way you opened the last reply" under
// Voice is not a finding. Exit code 1 when a soul is flagged.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { defaultDataDir } from "../electron/legacy-names.mjs";
import { soulUnits } from "../server/bots/soul-sort.ts";

export interface SoulFinding {
  kind: "rules" | "procedure" | "reference" | "decisions";
  why: string;
  excerpt: string;
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const PERSONA_HEADING = /persona|identit|voi[xc]e?|\btone?\b|style|ecriture|writing|who (?:you|i) (?:are|am)|qui (?:tu es|je suis)|personnalit|personality|caract/;
const SECTION_KINDS: Array<[SoulFinding["kind"], RegExp]> = [
  ["decisions", /decision|journal|historique|history|changelog|log\b/],
  ["procedure", /procedure|workflow|etapes?|steps?|how to|comment faire|marche a suivre|checklist|routine|playbook|process/],
  ["reference", /flotte|fleet|equipe|team|bots?\b|outils|tools|plugins?|references?|contacts?|clients?|annuaire|liens|links|ids?\b|comptes|accounts|mcp|connect/],
  ["rules", /regles?|rules?|guardrails?|garde[\s-]*fous?|consignes?|contraintes?|anti[\s_-]*jobs?|interdits?|never do|ne (?:fais|fait) (?:pas|jamais)|hors mandat|limits?|limites?/],
];
const IMPERATIVE = /^\s*(?:[-*+•]|\d{1,3}[.)])?\s*(?:never|always|must|do not|don't|jamais|toujours|ne\b.*\bjamais|ne\b.*\bpas|il faut|tu dois|doit|interdit)/i;
const DATED = /\b20\d{2}-\d{2}-\d{2}\b/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const URL = /https?:\/\/\S+/;
const excerpt = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139).trimEnd()}…` : flat;
};

/** What in one soul is not identity, persona or voice. Pure. */
export function auditSoul(soul: string): SoulFinding[] {
  const findings: SoulFinding[] = [];
  const { units } = soulUnits(soul ?? "");
  const stack: Array<{ level: number; title: string }> = [];
  type Section = { title: string; persona: boolean; kind: SoulFinding["kind"] | null; numbered: number; imperative: number; first: string };
  const sections = new Map<string, Section>();
  const sectionOf = (): Section => {
    const path = stack.map((entry) => entry.title).join(" > ");
    let section = sections.get(path);
    if (!section) {
      const titles = stack.map((entry) => fold(entry.title));
      const persona = titles.some((title) => PERSONA_HEADING.test(title));
      const kind = persona ? null : SECTION_KINDS.find(([, pattern]) => titles.some((title) => pattern.test(title)))?.[0] ?? null;
      section = { title: path, persona, kind, numbered: 0, imperative: 0, first: "" };
      sections.set(path, section);
    }
    return section;
  };
  for (const unit of units) {
    if (unit.kind === "heading") {
      while (stack.length && stack[stack.length - 1]!.level >= unit.level) stack.pop();
      stack.push({ level: unit.level, title: unit.text.replace(/^#{1,6}\s+/, "").trim() });
      continue;
    }
    if (unit.kind !== "text") continue;
    const section = sectionOf();
    if (!section.first) section.first = unit.text;
    if (section.persona) continue;
    if (/^\s*\d{1,3}[.)]\s/.test(unit.text)) section.numbered += 1;
    if (IMPERATIVE.test(unit.text)) section.imperative += 1;
    if (/^\s*\|.*\|\s*$/m.test(unit.text) && unit.text.split("\n").filter((line) => line.trim().startsWith("|")).length >= 2) {
      findings.push({ kind: "reference", why: "a table", excerpt: excerpt(unit.text) });
    }
    if (DATED.test(unit.text)) findings.push({ kind: "decisions", why: "a dated line", excerpt: excerpt(unit.text) });
    if (UUID.test(unit.text) || URL.test(unit.text)) findings.push({ kind: "reference", why: UUID.test(unit.text) ? "an id" : "a link", excerpt: excerpt(unit.text) });
  }
  for (const section of sections.values()) {
    if (section.persona) continue;
    if (section.kind) findings.push({ kind: section.kind, why: `a section "${section.title}"`, excerpt: excerpt(section.first) });
    else if (section.numbered >= 3) findings.push({ kind: "procedure", why: `${section.numbered} numbered steps`, excerpt: excerpt(section.first) });
    else if (section.imperative >= 4) findings.push({ kind: "rules", why: `${section.imperative} never/always lines`, excerpt: excerpt(section.first) });
  }
  // one finding per passage
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.kind}\u0000${finding.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface AuditedBot { name: string; id?: string; bytes: number; findings: SoulFinding[] }

function souls(args: string[]): Array<{ name: string; id?: string; soul: string }> {
  const at = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const file = at("--file");
  if (file) {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const rows = Array.isArray(raw) ? raw : [raw];
    return rows.map((row) => {
      const record = (row ?? {}) as Record<string, unknown>;
      const agent = (record.agent ?? {}) as Record<string, unknown>;
      const profile = (record.profile ?? {}) as Record<string, unknown>;
      const soul = typeof record.soul === "string" ? record.soul : typeof profile.instructions === "string" ? profile.instructions : "";
      const name = String(record.name ?? agent.name ?? "?");
      const id = typeof record.id === "string" ? record.id : typeof agent.id === "string" ? agent.id : undefined;
      return { name, ...(id ? { id } : {}), soul };
    });
  }
  const dir = at("--data-dir") ?? process.env.SAGAX_DATA_DIR ?? defaultDataDir({ home: homedir() });
  const path = join(dir, "bots.json");
  if (!existsSync(path)) throw new Error(`No bots.json in ${dir}. Pass --data-dir or --file.`);
  const bots = JSON.parse(readFileSync(path, "utf8")) as Array<{ id?: string; name?: string; soul?: string; hidden?: boolean }>;
  return bots.filter((bot) => !bot.hidden).map((bot) => ({ name: bot.name ?? "?", ...(bot.id ? { id: bot.id } : {}), soul: bot.soul ?? "" }));
}

function main(args: string[]): number {
  const audited: AuditedBot[] = souls(args).map((bot) => ({ name: bot.name, ...(bot.id ? { id: bot.id } : {}), bytes: Buffer.byteLength(bot.soul, "utf8"), findings: auditSoul(bot.soul) }));
  const flagged = audited.filter((bot) => bot.findings.length);
  if (args.includes("--json")) {
    for (const bot of audited) console.log(JSON.stringify(bot));
  } else {
    for (const bot of flagged) {
      console.log(`${bot.name} (${bot.bytes} bytes): ${bot.findings.length} passage${bot.findings.length === 1 ? "" : "s"} beyond identity, persona and voice`);
      for (const finding of bot.findings) console.log(`  - ${finding.kind}, ${finding.why}: ${finding.excerpt}`);
    }
    console.log(`${flagged.length} of ${audited.length} souls hold more than identity, persona and voice.`);
  }
  return flagged.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
