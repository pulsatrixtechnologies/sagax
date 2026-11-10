// #3461: what the person wrote to a team bot leaves one quiet row in their
// conversation with the bot that opened that thread, and nothing else.
import { describe, expect, it } from "vitest";

import { TEAM_NOTE_BURST_MS, TEAM_NOTE_CHARS, type TeamNote } from "../../shared/team-work.ts";
import { createPersonNote, noteWords, teamNoteContext, type PersonNoteDeps, type PersonNoteRow, type PersonNoteThread } from "./person-note.ts";

function rig() {
  const threads = new Map<string, PersonNoteThread>();
  const rows = new Map<string, PersonNoteRow[]>();
  const owners = new Map([["orc", "ana"], ["dev", "ana"], ["other", "ben"]]);
  let next = 0;
  const told: string[] = [];
  /** ids the orchestrator's session was handed, and whether a turn runs */
  const handed = new Set<string>();
  const running = { now: false };
  const deps: PersonNoteDeps = {
    thread: (botId, threadId) => threads.get(`${botId}:${threadId}`),
    bot: (botId) => (owners.has(botId) ? { id: botId, name: botId === "dev" ? "Dev" : botId === "orc" ? "Orc" : "Other" } : undefined),
    samePerson: (a, b, person) => owners.get(a) === owners.get(b) && (!person || owners.get(a) === person),
    conversation: (botId, person) => (botId === "orc" && (!person || person === "ana") ? "orc-ana" : botId === "other" ? "other-ben" : undefined),
    messages: (threadId) => rows.get(threadId) ?? [],
    append: (threadId, row) => {
      const list = rows.get(threadId) ?? [];
      list.push({ id: `m${next++}`, at: row.teamNote.at, kind: row.kind, teamNote: row.teamNote });
      rows.set(threadId, list);
    },
    patch: (threadId, id, patch) => {
      const row = rows.get(threadId)?.find((entry) => entry.id === id);
      if (row) row.teamNote = patch.teamNote;
    },
    handed: (_botId, _threadId, id) => running.now || handed.has(id),
    redact: (text) => text.replace(/sk-[a-z0-9]+/g, "[redacted]"),
    externallyUpdated: (botId, threadId) => { told.push(`${botId}:${threadId}`); },
  };
  const note = createPersonNote(deps);
  const opened = (extra: Partial<PersonNoteThread> = {}) =>
    threads.set("dev:dev-work", { title: "Fix the login", ownerPrincipalId: "ana", openedBy: { botId: "orc", name: "Orc", kind: "work" }, ...extra });
  const notes = (threadId = "orc-ana") => (rows.get(threadId) ?? []).filter((row) => row.teamNote).map((row) => row.teamNote as TeamNote);
  /** another row in the orchestrator's conversation (its reply, a result) */
  const say = (threadId = "orc-ana") => {
    const list = rows.get(threadId) ?? [];
    list.push({ id: `m${next++}`, at: 0, kind: "text" });
    rows.set(threadId, list);
  };
  const ids = (threadId = "orc-ana") => (rows.get(threadId) ?? []).filter((row) => row.teamNote).map((row) => row.id);
  return { note, opened, threads, notes, told, handed, running, say, ids };
}

describe("person note (#3461)", () => {
  it("leaves one row for a write in a thread another bot of the same person opened", () => {
    const r = rig();
    r.opened();
    const out = r.note({ botId: "dev", threadId: "dev-work", text: "Use the other branch, key sk-abc123", at: 1_000, person: "ana" });
    expect(out).toMatchObject({ noted: true, threadId: "orc-ana", folded: false });
    expect(r.notes()).toEqual([{ botId: "dev", botName: "Dev", threadId: "dev-work", title: "Fix the login",
      text: "Use the other branch, key [redacted]", at: 1_000, lastAt: 1_000, count: 1 }]);
    // the orchestrator's next turn is sent the row
    expect(r.told).toEqual(["orc:orc-ana"]);
  });

  it("folds a burst to the same thread into the same row", () => {
    const r = rig();
    r.opened();
    r.note({ botId: "dev", threadId: "dev-work", text: "First", at: 1_000 });
    r.note({ botId: "dev", threadId: "dev-work", text: "Second", at: 1_000 + TEAM_NOTE_BURST_MS });
    expect(r.notes()).toEqual([expect.objectContaining({ text: "First Second", at: 1_000, lastAt: 1_000 + TEAM_NOTE_BURST_MS, count: 2 })]);
    // past the burst: a new row
    r.note({ botId: "dev", threadId: "dev-work", text: "Later", at: 2_000 + 2 * TEAM_NOTE_BURST_MS });
    expect(r.notes()).toHaveLength(2);
  });

  it("never folds into a row the orchestrator's session was handed: the words are a new row it is sent", () => {
    const r = rig();
    r.opened();
    // the person writes A; the step ends and resumes the orchestrator, which reads the row
    r.note({ botId: "dev", threadId: "dev-work", text: "A", at: 1_000 });
    const [first] = r.ids();
    r.handed.add(first!);
    // B, 90 s later, inside the burst
    const out = r.note({ botId: "dev", threadId: "dev-work", text: "B", at: 91_000 });
    expect(out).toMatchObject({ noted: true, folded: false });
    expect(r.notes()).toEqual([expect.objectContaining({ text: "A", count: 1 }), expect.objectContaining({ text: "B", count: 1 })]);
    expect(r.told).toEqual(["orc:orc-ana", "orc:orc-ana"]);
  });

  it("never folds while a turn of the orchestrator's conversation runs, or once a newer row follows the note", () => {
    const r = rig();
    r.opened();
    r.note({ botId: "dev", threadId: "dev-work", text: "A", at: 1_000 });
    r.running.now = true;
    r.note({ botId: "dev", threadId: "dev-work", text: "B", at: 2_000 });
    r.running.now = false;
    expect(r.notes().map((n) => n.text)).toEqual(["A", "B"]);
    // the orchestrator answered after B: C is a new row too
    r.say();
    r.note({ botId: "dev", threadId: "dev-work", text: "C", at: 3_000 });
    expect(r.notes().map((n) => n.text)).toEqual(["A", "B", "C"]);
    // and D, right after C with nothing between, still folds into C
    r.note({ botId: "dev", threadId: "dev-work", text: "D", at: 4_000 });
    expect(r.notes().map((n) => n.text)).toEqual(["A", "B", "C D"]);
  });

  it("leaves nothing for the bot's own thread, an AI client's, a confidential one or another person", () => {
    const r = rig();
    r.threads.set("dev:own", { title: "Mine", ownerPrincipalId: "ana" });
    expect(r.note({ botId: "dev", threadId: "own", text: "hi", at: 1 })).toMatchObject({ noted: false, reason: "not-opened-by-a-bot" });
    r.threads.set("dev:self", { title: "Self", openedBy: { botId: "dev", kind: "work" } });
    expect(r.note({ botId: "dev", threadId: "self", text: "hi", at: 1 })).toMatchObject({ noted: false, reason: "own" });
    r.threads.set("dev:client", { title: "Client", openedBy: { botId: "agent:client", kind: "agent" } });
    expect(r.note({ botId: "dev", threadId: "client", text: "hi", at: 1 })).toMatchObject({ noted: false, reason: "agent" });
    r.opened({ confidential: true });
    expect(r.note({ botId: "dev", threadId: "dev-work", text: "hi", at: 1 })).toMatchObject({ noted: false, reason: "confidential" });
    // a thread another person's bot opened
    r.threads.set("dev:cross", { title: "Cross", ownerPrincipalId: "ana", openedBy: { botId: "other", kind: "work" } });
    expect(r.note({ botId: "dev", threadId: "cross", text: "hi", at: 1 })).toMatchObject({ noted: false, reason: "other-person" });
    // another person writing in the person's thread
    r.opened();
    expect(r.note({ botId: "dev", threadId: "dev-work", text: "hi", at: 1, person: "ben" })).toMatchObject({ noted: false, reason: "other-person" });
    expect(r.notes()).toEqual([]);
    expect(r.notes("other-ben")).toEqual([]);
    expect(r.told).toEqual([]);
  });

  it("keeps the newest words, at most the note's size, and words the context as a note from the app", () => {
    const long = `${"a".repeat(400)} end`;
    expect(noteWords(long).length).toBe(TEAM_NOTE_CHARS);
    expect(noteWords(long).endsWith(" end")).toBe(true);
    const context = teamNoteContext({ botId: "dev", botName: "Dev", threadId: "t", title: "Fix", text: "Use main", at: 1, lastAt: 1, count: 1 });
    expect(context).toContain("[Note from the app]");
    expect(context).toContain("\"Use main\"");
    expect(context).not.toContain("dev-");
  });
});
