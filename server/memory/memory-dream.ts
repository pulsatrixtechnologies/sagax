// The dream pass. It re-reads a bot's topic files and memory journal and
// leaves notes in files: repeated facts move up into MEMORY.md, topic
// files that carry the same facts become one file, and a contradicted or
// expired fact moves to memory/archive.md. Nothing is removed without a
// copy in the archive. A line marked `readers person` is private and never
// enters memory/company.md. A line with no readers mark is left where it
// was and still loads. No model is trained from any of this.
import { factIdentity, isExpired, parseMemoryEntries, type MemoryEntryLine } from "./memory-entries.ts";

export const COMPANY_TOPIC = "company.md";
export const PROCEDURES_TOPIC = "procedures.md";
const SKIP_TOPIC = new Set(["archive.md", COMPANY_TOPIC, PROCEDURES_TOPIC]);
const READER = /(?:^| · )readers (person|company|group:[A-Za-z0-9_-]{1,64}|room:[A-Za-z0-9_-]{1,64})(?= · |$)/g;
const LEADING_READER = /^(?:readers (?:person|company|group:[A-Za-z0-9_-]{1,64}|room:[A-Za-z0-9_-]{1,64}) · )+/;
const TRAILING_READER = / · readers (?:person|company|group:[A-Za-z0-9_-]{1,64}|room:[A-Za-z0-9_-]{1,64})(?= · |$)/g;

export interface DreamTopic {
  name: string;
  text: string;
}

export interface DreamJournalRow {
  diff: string;
}

export interface DreamMerge {
  from: string;
  into: string;
}

export interface DreamPlan {
  memory: string;
  /** Topic files to write, or null to delete once the archive has a copy. */
  topics: Array<{ name: string; text: string | null }>;
  archiveLines: string[];
  /** Full company.md text when it changes, else null. */
  company: string | null;
  /** memory/dreams/<date>.md body when the pass changed something. */
  account: string | null;
  promoted: string[];
  merged: DreamMerge[];
  archived: string[];
}

/** `person` wins: a private stamp never shares a fact with company memory.
 * No stamp returns null, and the line stays visible as it was. */
export function memoryAudience(line: string): "person" | "company" | null {
  const found = [...line.matchAll(READER)].map((match) => match[1]);
  if (found.includes("person")) return "person";
  if (found.includes("company")) return "company";
  return null;
}

function factKey(entry: Pick<MemoryEntryLine, "body">): string {
  return factIdentity(entry.body.replace(LEADING_READER, "").replace(TRAILING_READER, ""));
}

function liveEntries(text: string, today: string): MemoryEntryLine[] {
  return parseMemoryEntries(text).filter((entry) => !entry.struck && !isExpired(entry, today) && factKey(entry));
}

function signature(text: string, today: string): string {
  return [...new Set(liveEntries(text, today).map(factKey))].sort().join("\n");
}

/** A contradicted line struck on an earlier day, or an expired one.
 * A line struck today stays: the tidy-up just wrote it and still shows it. */
function staleReason(entry: MemoryEntryLine, today: string): "expired" | "contradicted" | null {
  if (isExpired(entry, today)) return "expired";
  if (!entry.struck) return null;
  const superseded = / · superseded (\d{4}-\d{2}-\d{2})/.exec(entry.raw)?.[1];
  if (superseded && superseded >= today) return null;
  return "contradicted";
}

function withoutEntries(text: string, entries: readonly MemoryEntryLine[]): string {
  if (!entries.length) return text;
  const drop = new Set<number>();
  for (const entry of entries) for (let line = entry.line; line < entry.end; line += 1) drop.add(line);
  return text.split("\n").filter((_, index) => !drop.has(index)).join("\n");
}

function finish(text: string): string {
  if (!text) return "";
  return text.endsWith("\n") ? text : `${text}\n`;
}

const COMPANY_HEADER = `# Company

Stable facts about how this person's organization works. Not private memory.
A line marked readers person is never copied here. Bots of the same person
read this file. Another member does not.

`;

export function planDream(input: {
  today: string;
  memory: string;
  topics: readonly DreamTopic[];
  journal?: readonly DreamJournalRow[];
}): DreamPlan {
  const today = input.today;
  const topics = input.topics.filter((topic) => topic.name.endsWith(".md"));
  const workable = topics.filter((topic) => !SKIP_TOPIC.has(topic.name));
  const deleted = new Set<string>();
  const merged: DreamMerge[] = [];
  const archiveLines: string[] = [];
  const archived: string[] = [];

  const groups = new Map<string, DreamTopic[]>();
  for (const topic of workable) {
    const sig = signature(topic.text, today);
    if (!sig) continue;
    groups.set(sig, [...(groups.get(sig) ?? []), topic]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.name.localeCompare(b.name));
    const into = ordered[0]!;
    for (const from of ordered.slice(1)) {
      deleted.add(from.name);
      merged.push({ from: from.name, into: into.name });
      for (const line of from.text.split("\n")) if (line.trim()) archiveLines.push(`${line} · merged ${today}`);
      archived.push(`memory/${from.name} merged into memory/${into.name}`);
    }
  }

  const where = new Map<string, { count: number; raw: string; date: string }>();
  const note = (entry: MemoryEntryLine) => {
    const key = factKey(entry);
    if (!key) return;
    const prev = where.get(key);
    const newer = !prev || entry.date > prev.date;
    where.set(key, { count: (prev?.count ?? 0) + 1, raw: newer ? entry.raw : prev!.raw, date: newer ? entry.date : prev!.date });
  };
  for (const topic of workable) {
    const seen = new Set<string>();
    for (const entry of liveEntries(topic.text, today)) {
      const key = factKey(entry);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      note(entry);
    }
  }
  // A journal row that records the write already counted above is not a
  // second occurrence. A fact is repeated when it is in two files, or when
  // the journal added it on two different passes.
  const journalCounts = new Map<string, number>();
  for (const row of input.journal ?? []) {
    const seen = new Set<string>();
    for (const line of row.diff.split("\n")) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const entry = parseMemoryEntries(line.slice(1))[0];
      if (!entry) continue;
      const key = factKey(entry);
      if (!key || !where.has(key) || seen.has(key)) continue;
      seen.add(key);
      journalCounts.set(key, (journalCounts.get(key) ?? 0) + 1);
    }
  }

  const inMemory = new Set(liveEntries(input.memory, today).map(factKey));
  const promoted: string[] = [];
  const promotedLines: string[] = [];
  for (const [key, fact] of where) {
    const count = Math.max(fact.count, journalCounts.get(key) ?? 0);
    if (count < 2 || inMemory.has(key)) continue;
    promoted.push(key);
    promotedLines.push(fact.raw);
    archived.push(`promoted ${key}`);
  }

  const memoryStale = parseMemoryEntries(input.memory).filter((entry) => staleReason(entry, today));
  for (const entry of memoryStale) {
    const reason = staleReason(entry, today)!;
    archiveLines.push(`${entry.raw} · ${reason} ${today}`);
    archived.push(`${reason}: ${factKey(entry) || entry.body}`);
  }

  const topicWrites: DreamPlan["topics"] = [];
  for (const topic of workable) {
    if (deleted.has(topic.name)) {
      topicWrites.push({ name: topic.name, text: null });
      continue;
    }
    const stale = parseMemoryEntries(topic.text).filter((entry) => staleReason(entry, today));
    if (!stale.length) continue;
    for (const entry of stale) {
      const reason = staleReason(entry, today)!;
      archiveLines.push(`${entry.raw} · ${reason} ${today}`);
      archived.push(`${reason}: ${factKey(entry) || entry.body}`);
    }
    topicWrites.push({ name: topic.name, text: finish(withoutEntries(topic.text, stale)) });
  }

  let memory = finish(withoutEntries(input.memory, memoryStale));
  const memoryKeys = new Set(parseMemoryEntries(memory).map(factKey));
  for (const line of promotedLines) {
    const entry = parseMemoryEntries(line)[0];
    const key = entry ? factKey(entry) : "";
    if (key && memoryKeys.has(key)) continue;
    if (memory.includes(line)) continue;
    memory += `${line}\n`;
    if (key) memoryKeys.add(key);
  }

  const personKeys = new Set<string>();
  const companyLines: string[] = [];
  const seenCompany = new Set<string>();
  const consider = (text: string) => {
    for (const entry of parseMemoryEntries(text)) {
      if (entry.struck || isExpired(entry, today)) continue;
      const key = factKey(entry);
      if (!key) continue;
      const audience = memoryAudience(entry.raw);
      if (audience === "person") personKeys.add(key);
      if (audience !== "company" || seenCompany.has(key)) continue;
      seenCompany.add(key);
      companyLines.push(entry.raw);
    }
  };
  consider(memory);
  for (const topic of topics) if (!deleted.has(topic.name)) consider(topic.text);

  const originalCompany = topics.find((topic) => topic.name === COMPANY_TOPIC)?.text ?? "";
  const companyStale = parseMemoryEntries(originalCompany).filter((entry) => staleReason(entry, today));
  for (const entry of companyStale) {
    const reason = staleReason(entry, today)!;
    archiveLines.push(`${entry.raw} · ${reason} ${today}`);
    archived.push(`${reason}: ${factKey(entry) || entry.body}`);
  }
  let companyBody = withoutEntries(originalCompany, companyStale);
  const already = new Set(parseMemoryEntries(companyBody).map(factKey));
  const added: string[] = [];
  for (const line of companyLines) {
    const entry = parseMemoryEntries(line)[0];
    const key = entry ? factKey(entry) : "";
    if (!key || personKeys.has(key) || already.has(key)) continue;
    added.push(line);
    already.add(key);
  }
  let company: string | null = null;
  if (added.length || companyStale.length) {
    if (!companyBody.trim()) companyBody = COMPANY_HEADER;
    company = finish(companyBody) + (added.length ? `${added.join("\n")}\n` : "");
  }

  const changed = promoted.length + merged.length + archiveLines.length + added.length > 0;
  const accountLines = [`# Dream ${today}`, ""];
  for (const fact of promoted) accountLines.push(`- Promoted: ${fact}`);
  for (const merge of merged) accountLines.push(`- Merged: memory/${merge.from} into memory/${merge.into}`);
  for (const item of archived) if (!item.startsWith("promoted ")) accountLines.push(`- Archived: ${item}`);
  for (const line of added) {
    const entry = parseMemoryEntries(line)[0];
    accountLines.push(`- Company: ${entry ? factKey(entry) : line}`);
  }

  return {
    memory,
    topics: topicWrites,
    archiveLines,
    company,
    account: changed ? `${accountLines.join("\n")}\n` : null,
    promoted,
    merged,
    archived,
  };
}

export function dreamTouched(plan: DreamPlan): boolean {
  return plan.account !== null;
}
