// Skill history (#2610): every change to a bot's skill, by the bot (skill_manage,
// automatic review, a card the person accepted, Undo) or by the person (Save,
// Restore), is kept as a version with the text before and after. The Skills
// page shows it as a diff, and any earlier version can be put back. The log
// lives beside the skill's control record (DATA_DIR/skill-state/<bot>/history),
// one JSON line per change, the newest MAX_SKILL_HISTORY kept.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { isSkillName } from "../../shared/skill-md.ts";

/** Versions kept per skill. */
export const MAX_SKILL_HISTORY = 30;
/** One side of a version is cut at this size (a SKILL.md is capped well below). */
const MAX_SIDE_CHARS = 200_000;

export type SkillChangeAuthor = "bot" | "person" | "restore";

export interface SkillVersion {
  id: string;
  at: number;
  by: SkillChangeAuthor;
  /** One line: what changed and why (the bot's gist, or the person's action). */
  gist: string;
  /** SKILL.md before the change; null when the change created the skill. */
  before: string | null;
  after: string;
}

const historyFile = (dir: string, name: string) => join(dir, `${name}.jsonl`);

function parseLine(line: string): SkillVersion | null {
  try {
    const raw = JSON.parse(line) as Partial<SkillVersion>;
    if (typeof raw.id !== "string" || typeof raw.at !== "number" || typeof raw.after !== "string") return null;
    if (raw.by !== "bot" && raw.by !== "person" && raw.by !== "restore") return null;
    return {
      id: raw.id,
      at: raw.at,
      by: raw.by,
      gist: typeof raw.gist === "string" ? raw.gist : "",
      before: typeof raw.before === "string" ? raw.before : null,
      after: raw.after,
    };
  } catch {
    return null;
  }
}

/** Versions of one skill, newest first. */
export function readSkillHistory(dir: string, name: string): SkillVersion[] {
  if (!isSkillName(name)) return [];
  let text: string;
  try {
    text = readFileSync(historyFile(dir, name), "utf8");
  } catch {
    return [];
  }
  return text.split("\n").filter(Boolean).map(parseLine).filter((entry): entry is SkillVersion => entry !== null).reverse();
}

/** Keep one change. Nothing is kept when the text did not change. */
export function recordSkillVersion(
  dir: string,
  name: string,
  change: { by: SkillChangeAuthor; gist?: string; before: string | null; after: string; at?: number },
): SkillVersion | null {
  if (!isSkillName(name) || change.before === change.after) return null;
  const entry: SkillVersion = {
    id: randomUUID(),
    at: change.at ?? Date.now(),
    by: change.by,
    gist: (change.gist ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
    before: change.before === null ? null : change.before.slice(0, MAX_SIDE_CHARS),
    after: change.after.slice(0, MAX_SIDE_CHARS),
  };
  const kept = readSkillHistory(dir, name).reverse().slice(-(MAX_SKILL_HISTORY - 1));
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(historyFile(dir, name), `${[...kept, entry].map((item) => JSON.stringify(item)).join("\n")}\n`, { mode: 0o600 });
  } catch {
    // losing a history line never blocks the change itself
    return null;
  }
  return entry;
}
