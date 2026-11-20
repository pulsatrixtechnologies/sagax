// #4100 lot "listening-session-store": the record, the one row patched in
// place, the frame to the person's devices, the idle end.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LISTENING_IDLE_END_MS, type ListeningFrame } from "../../shared/listening.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { ListeningSessions, listeningView, parseListeningBatch, type ListeningEndCause, type ListeningRow } from "./listening-sessions.ts";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await removeTempDir(dir); });

function harness(options: { dir?: string; chats?: string[] } = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "sagax-listening-"));
  if (!options.dir) dirs.push(dir);
  let clock = 1_000_000;
  let next = 0;
  const chats = new Set(options.chats ?? ["t-ada"]);
  const rows = new Map<string, Array<{ id: string } & ListeningRow>>();
  const frames: ListeningFrame[] = [];
  const ended: Array<[string, ListeningEndCause]> = [];
  const sessions = new ListeningSessions({
    dir,
    now: () => clock,
    newId: () => `ls_${String(next++).padStart(20, "0")}`,
    appendRow: (threadId, row) => {
      if (!chats.has(threadId)) return null;
      const list = rows.get(threadId) ?? [];
      const stored = { id: `m${list.length}`, ...row };
      list.push(stored);
      rows.set(threadId, list);
      return stored;
    },
    patchRow: (threadId, messageId, patch) => {
      const list = rows.get(threadId) ?? [];
      const at = list.findIndex((row) => row.id === messageId);
      if (at >= 0) list[at] = { ...list[at]!, ...patch };
    },
    broadcast: (frame) => frames.push(frame),
    onEnded: (record, cause) => ended.push([record.id, cause]),
  });
  return { dir, sessions, rows, frames, ended, tick: (ms: number) => { clock += ms; } };
}

describe("listening sessions (#4100)", () => {
  it("starts with one row in the person's conversation and a frame to that person only", () => {
    const h = harness();
    const session = h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "PR_Ada" })!;
    expect(session.state).toBe("listening");
    expect(session.principalId).toBe("PR_Ada");
    expect(session.sources).toEqual({ microphone: true, computer: false });
    expect(h.rows.get("t-ada")).toEqual([{ id: "m0", role: "bot", kind: "text", text: "Listening to a conversation", listening: { sessionId: session.id, state: "listening", startedAt: 1_000_000, lineCount: 0, speakers: [] } }]);
    expect(h.frames).toEqual([{ kind: "listening", audience: "pr_ada", botId: "bot-a", threadId: "t-ada", sessionId: session.id, state: "listening", lineCount: 0 }]);
    // starting again in the same conversation answers the live session
    expect(h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada" })!.id).toBe(session.id);
    expect(h.rows.get("t-ada")).toHaveLength(1);
    expect(h.sessions.liveFor("t-ada")?.id).toBe(session.id);
  });

  it("writes nothing when the conversation is gone", () => {
    const h = harness();
    expect(h.sessions.start({ botId: "bot-a", threadId: "t-gone", principalId: "pr_ada" })).toBeNull();
    expect(h.frames).toEqual([]);
  });

  it("keeps final lines idempotent by seq and patches the same row, never a row per line", () => {
    const h = harness();
    const { id } = h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada" })!;
    const batch = { lines: [{ seq: 1, at: 10, speaker: "me", text: "Hello there" }, { seq: 2, at: 20, speaker: "s1", text: " We ship Friday. " }], speakers: [{ key: "me", label: "Ada" }, { key: "s1", label: "Speaker 1" }] };
    h.sessions.addLines(id, "pr_ada", batch);
    // the same batch again after a reconnect, and one line out of order
    h.sessions.addLines(id, "pr_ada", batch);
    const after = h.sessions.addLines(id, "pr_ada", { lines: [{ seq: 0, at: 5, speaker: "me", text: "Okay" }, { seq: 3, at: 30, speaker: "s1", text: "   " }] })!;
    expect(after.lines.map((line) => [line.seq, line.text])).toEqual([[0, "Okay"], [1, "Hello there"], [2, "We ship Friday."]]);
    const rows = h.rows.get("t-ada")!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.listening).toMatchObject({ lineCount: 3, speakers: [{ key: "me", label: "Ada" }, { key: "s1", label: "Speaker 1" }], last: { speaker: "Speaker 1", text: "We ship Friday." } });
    expect(h.frames.at(-1)).toMatchObject({ sessionId: id, lineCount: 3, last: { speaker: "Speaker 1", text: "We ship Friday." } });
    // a duplicate batch sends no frame
    const framesBefore = h.frames.length;
    h.sessions.addLines(id, "pr_ada", batch);
    expect(h.frames).toHaveLength(framesBefore);
    expect(h.sessions.linesAfter(after, 0).map((line) => line.seq)).toEqual([1, 2]);
  });

  it("tells a device that joins the highest seq it kept, which an empty line it skipped can put above the line count", () => {
    const h = harness();
    const { id } = h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada" })!;
    const record = h.sessions.addLines(id, "pr_ada", { lines: [{ seq: 1, at: 10, speaker: "me", text: "Hello" }, { seq: 2, at: 20, speaker: "me", text: " " }, { seq: 3, at: 30, speaker: "s1", text: "We ship Friday." }] })!;
    expect(listeningView(record)).toMatchObject({ lineCount: 2, lastSeq: 3 });
    // joining the live session answers the same
    expect(h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada" })).toBe(record);
    expect(listeningView(h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada" })!).lastSeq).toBe(3);
    expect(listeningView(h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada" })!)).not.toHaveProperty("principalId");
  });

  it("answers only the person who started it", () => {
    const h = harness();
    const { id } = h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada" })!;
    expect(h.sessions.get(id, "pr_bob")).toBeNull();
    expect(h.sessions.addLines(id, "pr_bob", { lines: [{ seq: 1, at: 1, speaker: "x", text: "planted" }] })).toBeNull();
    expect(h.sessions.stop(id, "pr_bob")).toBeNull();
    expect(h.sessions.get(id, "PR_ADA")?.lines).toEqual([]);
    expect(h.sessions.get("ls_nothing", "pr_ada")).toBeNull();
  });

  it("stop settles the row into one line and ends once", () => {
    const h = harness();
    const { id } = h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada" })!;
    h.sessions.addLines(id, "pr_ada", { lines: [{ seq: 1, at: 1, speaker: "a", text: "one" }, { seq: 2, at: 2, speaker: "b", text: "two" }, { seq: 3, at: 3, speaker: "c", text: "three" }] });
    h.tick(24 * 60_000);
    const stopped = h.sessions.stop(id, "pr_ada")!;
    expect(stopped.state).toBe("ended");
    expect(stopped.endedAt).toBe(1_000_000 + 24 * 60_000);
    expect(h.rows.get("t-ada")![0]!.text).toBe("Listened 24 min, 3 speakers");
    expect(h.rows.get("t-ada")![0]!.listening).toMatchObject({ state: "ended", endedAt: stopped.endedAt, lineCount: 3 });
    expect(h.frames.at(-1)).toMatchObject({ state: "ended", lineCount: 3 });
    expect(h.sessions.stop(id, "pr_ada")!.state).toBe("ended");
    expect(h.ended).toEqual([[id, "stop"]]);
    expect(h.sessions.liveFor("t-ada")).toBeNull();
    // a late line from a device that reconnects still joins the transcript
    expect(h.sessions.addLines(id, "pr_ada", { lines: [{ seq: 4, at: 4, speaker: "a", text: "late" }] })!.lines).toHaveLength(4);
  });

  it("ends a session whose device went quiet, without a turn, and a heartbeat keeps it on", () => {
    const h = harness();
    const { id } = h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada" })!;
    h.tick(LISTENING_IDLE_END_MS - 1_000);
    expect(h.sessions.addLines(id, "pr_ada", parseListeningBatch({ lines: [] }) as never)!.state).toBe("listening");
    h.tick(LISTENING_IDLE_END_MS - 1_000);
    expect(h.sessions.sweep()).toEqual([]);
    h.tick(2_000);
    expect(h.sessions.sweep().map((record) => record.id)).toEqual([id]);
    expect(h.ended).toEqual([[id, "idle"]]);
    expect(h.rows.get("t-ada")![0]!.listening?.state).toBe("ended");
  });

  it("keeps the record on disk, reads it back after a restart and gives a live one a full idle span", () => {
    const h = harness();
    const { id } = h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada" })!;
    h.sessions.addLines(id, "pr_ada", { lines: [{ seq: 1, at: 1, speaker: "me", text: "kept" }] });
    expect(readdirSync(join(h.dir, "t-ada"))).toEqual([`${id}.json`]);
    const again = harness({ dir: h.dir });
    const record = again.sessions.get(id, "pr_ada")!;
    expect(record.lines.map((line) => line.text)).toEqual(["kept"]);
    expect(again.sessions.liveFor("t-ada")?.id).toBe(id);
    expect(again.sessions.files()).toEqual([{ path: join(h.dir, "t-ada", `${id}.json`), scope: { thread: "t-ada" } }]);
    again.tick(LISTENING_IDLE_END_MS - 1);
    expect(again.sessions.sweep()).toEqual([]);
  });

  it("reads a batch and says what is wrong with a bad one", () => {
    expect(parseListeningBatch({ lines: [{ seq: 1, speaker: "me", text: "hi" }] })).toEqual({ lines: [{ seq: 1, at: 0, speaker: "me", text: "hi" }], speakers: [] });
    expect(parseListeningBatch(null)).toEqual({ error: "a JSON body is required" });
    expect(parseListeningBatch({ lines: [{ seq: -1, speaker: "me", text: "hi" }] })).toEqual({ error: "seq must be a whole number" });
    expect(parseListeningBatch({ lines: [{ seq: 1, speaker: "", text: "hi" }] })).toEqual({ error: "speaker must be a speaker key" });
    expect(parseListeningBatch({ lines: [], speakers: [{ key: "me" }] })).toEqual({ error: "each speaker has a key and a label" });
  });
});

// #5130: a session's purpose (the watch's in-person meeting) and how it
// ended are kept with it, across a restart.
describe("a meeting's purpose (#5130)", () => {
  it("keeps the purpose, says it in the view, and a meeting start makes a live session a meeting", () => {
    const h = harness();
    const talk = h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada" })!;
    expect(listeningView(talk).purpose).toBe("conversation");
    expect(h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada", purpose: "meeting" })!.id).toBe(talk.id);
    expect(listeningView(h.sessions.get(talk.id, "pr_ada")!).purpose).toBe("meeting");
    // a conversation start never turns a meeting back
    h.sessions.start({ botId: "bot-a", threadId: "t-ada", principalId: "pr_ada", purpose: "conversation" });
    expect(h.sessions.get(talk.id, "pr_ada")!.purpose).toBe("meeting");

    h.tick(LISTENING_IDLE_END_MS + 1);
    h.sessions.sweep();
    const reopened = harness({ dir: h.dir });
    const record = reopened.sessions.get(talk.id, "pr_ada")!;
    expect(record).toMatchObject({ purpose: "meeting", state: "ended", endCause: "idle" });
  });
});
