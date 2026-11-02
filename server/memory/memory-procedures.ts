// What worked, written as a short note in memory/procedures.md. An approval
// the person granted, a task whose steps finished, or a correction from the
// person that the next turn followed. The person can edit or delete the
// file. Nothing here is sent to a training service.
import { factIdentity, lineFactIdentity } from "./memory-entries.ts";
import { recordMemoryChange } from "./memory-journal.ts";
import { readMemoryTopic, writeMemoryTopic } from "../workspace.ts";

export const PROCEDURES_TOPIC = "procedures.md";

const HEADER = `# Procedures

Notes about what worked: an approval that was granted, a task that finished,
or a correction from the person that the next turn followed. Each line has
its date and its source. Remove a line to drop that note. These notes stay
in this file. No model is retrained from them.

`;

export interface ProcedureSignal {
  kind: "approval" | "task" | "correction";
  what: string;
}

interface ObservedEvent {
  type: string;
  behavior?: string;
  source?: string;
  ok?: boolean;
  threadId?: string;
  turnId?: string;
  itemType?: string;
}

const toolsOk = new Set<string>();
const corrected = new Set<string>();

function eventKey(event: ObservedEvent): string {
  return event.turnId || event.threadId || "";
}

export function resetProcedureSignals(): void {
  toolsOk.clear();
  corrected.clear();
}

/** One note, or null when this event is not a success worth keeping. */
export function procedureSignal(event: ObservedEvent): ProcedureSignal | null {
  const key = eventKey(event);
  if (event.type === "item.completed" && event.itemType === "tool" && event.ok && key) {
    toolsOk.add(key);
    return null;
  }
  if (event.type === "steer.received" && event.threadId) {
    corrected.add(event.threadId);
    return null;
  }
  if (event.type === "request.resolved" && event.behavior === "allow" && (event.source === "user" || event.source === "auto")) {
    return { kind: "approval", what: "An approval was granted and the action ran." };
  }
  if (event.type === "turn.completed" && event.ok) {
    const followed = event.threadId ? corrected.delete(event.threadId) : false;
    const worked = key ? toolsOk.delete(key) : false;
    if (followed) return { kind: "correction", what: "A correction from the person was followed and the turn finished." };
    if (worked) return { kind: "task", what: "A task finished after its steps succeeded." };
    return null;
  }
  if (event.type === "turn.completed" || event.type === "session.exited") {
    if (key) toolsOk.delete(key);
    if (event.threadId) corrected.delete(event.threadId);
  }
  return null;
}

export function procedureLine(input: { date: string; source: string; kind: string; what: string }): string {
  const source = input.source.replace(/[·\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const what = input.what.replace(/\s+/g, " ").trim().slice(0, 240);
  return `- ${input.date} · from ${source || "memory"} · ${input.kind}: ${what}`;
}

/** Appends one note unless that fact is already in the file. Journaled, so
 * Undo puts the file back. Returns false when nothing was written. */
export function recordProcedure(botId: string, input: { date: string; source: string; kind: string; what: string }): boolean {
  const line = procedureLine(input);
  const current = readMemoryTopic(botId, PROCEDURES_TOPIC);
  const seen = new Set<string>();
  for (const existing of (current ?? "").split("\n")) {
    const key = lineFactIdentity(existing) || factIdentity(existing);
    if (key) seen.add(key);
  }
  if (seen.has(lineFactIdentity(line))) return false;
  const next = current && current.trim()
    ? `${current.endsWith("\n") ? current : `${current}\n`}${line}\n`
    : `${HEADER}${line}\n`;
  writeMemoryTopic(botId, PROCEDURES_TOPIC, next);
  recordMemoryChange(botId, {
    path: `memory/${PROCEDURES_TOPIC}`,
    actor: "upkeep",
    via: "procedure",
    before: current,
    after: readMemoryTopic(botId, PROCEDURES_TOPIC),
  });
  return true;
}
