import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { WireMessage } from "../shared/wire.ts";
import {
  recordRoutineChange,
  recordRoutineToggle,
  routineChangeText,
  routineToggleForViewer,
  routineToggleText,
  routineToggleTurnKey,
  type RoutineToggleStore,
} from "./routine-chat-events.ts";
import { RoutineRequestService, type RoutineRequestOptionCard } from "./routine-requests.ts";
import { RoutineManager, type RoutineChangeNote, type RoutineEnabledChange, type Routine } from "./routines.ts";

/** A thread store that keeps rows in order, like the real active path. */
class Thread implements RoutineToggleStore {
  readonly rows = new Map<string, WireMessage[]>();
  private sequence = 0;
  activePath(threadId: string): WireMessage[] {
    return this.rows.get(threadId) ?? [];
  }
  messagesFor(threadId: string): WireMessage[] {
    return this.activePath(threadId);
  }
  appendMessage(threadId: string, message: Omit<WireMessage, "id" | "at"> & { at?: number }): WireMessage {
    const full = { id: `m${++this.sequence}`, at: this.sequence, ...message } as WireMessage;
    this.rows.set(threadId, [...this.activePath(threadId), full]);
    return full;
  }
  patchMessage(threadId: string, messageId: string, patch: Partial<WireMessage>): WireMessage | null {
    const rows = this.activePath(threadId);
    const index = rows.findIndex((row) => row.id === messageId);
    if (index === -1) return null;
    rows[index] = { ...rows[index], ...patch };
    return rows[index];
  }
  say(threadId: string, text: string): WireMessage {
    return this.appendMessage(threadId, { role: "user", kind: "text", text });
  }
  lines(threadId: string): WireMessage[] {
    return this.activePath(threadId).filter((row) => row.kind === "routines");
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A real RoutineManager whose enabled changes go into `thread`, as
 * server/index.ts wires it. */
function wired(thread: Thread) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-routine-lines-"));
  dirs.push(dir);
  const changes: Array<{ routine: Routine; change: RoutineEnabledChange }> = [];
  const edits: Array<{ routine: Routine; change: RoutineChangeNote }> = [];
  const routines = new RoutineManager({
    file: join(dir, "routines.json"),
    now: () => Date.parse("2026-10-15T14:00:00Z"),
    botState: () => "busy",
    goalState: () => "busy",
    createTask: () => null,
    startTurn: async () => {},
    onEnabledChanged: (routine, change) => {
      changes.push({ routine, change });
      recordRoutineToggle(thread, {
        threadId: change.threadId,
        action: change.enabled ? "enabled" : "disabled",
        atMessageId: change.messageId,
        routine: { id: routine.id, name: routine.name, botId: routine.botId },
      });
    },
    onRoutineChanged: (routine, change) => {
      edits.push({ routine, change });
      recordRoutineChange(thread, {
        threadId: change.threadId,
        action: change.action,
        atMessageId: change.messageId,
        routine: { id: routine.id, name: routine.name, botId: routine.botId },
      });
    },
  });
  const make = (name: string, botId = "bot-a") => routines.create({
    name, prompt: "Check the queue", botId, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] },
  });
  return { routines, changes, edits, make };
}

describe("routine lines in the conversation", () => {
  it("writes one line per action and per turn, and a new line on the next turn", () => {
    const thread = new Thread();
    const { routines, make } = wired(thread);
    const a = make("[Daily] Sagax and Perspicax daily dev");
    const b = make("[Fleet] Weekly review of routines");
    const c = make("Morning brief");
    const ask = thread.say("t1", "Turn off my routines");
    const meta = { conversation: { threadId: "t1" } };
    routines.update(a.id, { enabled: false }, undefined, meta);
    routines.update(b.id, { enabled: false }, undefined, meta);
    routines.update(c.id, { enabled: false }, undefined, meta);
    let lines = thread.lines("t1");
    expect(lines).toHaveLength(1);
    expect(lines[0].routineToggle).toMatchObject({ action: "disabled", turnKey: ask.id });
    expect(lines[0].routineToggle!.routines.map((routine) => routine.name)).toEqual([a.name, b.name, c.name]);
    expect(lines[0].text).toBe("Disabled 3 routines");

    // the same turn turning one back on: its own line, and it leaves the first
    routines.update(c.id, { enabled: true }, undefined, meta);
    lines = thread.lines("t1");
    expect(lines.map((line) => line.routineToggle!.action)).toEqual(["disabled", "enabled"]);
    expect(lines[0].routineToggle!.routines).toHaveLength(2);
    expect(lines[1].text).toBe("Enabled 1 routine");

    // the next turn starts a line of its own
    const next = thread.say("t1", "And the morning brief too");
    routines.update(c.id, { enabled: false }, undefined, meta);
    lines = thread.lines("t1");
    expect(lines).toHaveLength(3);
    expect(lines[2].routineToggle).toMatchObject({ action: "disabled", turnKey: next.id, routines: [{ id: c.id }] });
  });

  it("writes nothing for a change made outside a conversation or one that leaves the switch as it was", () => {
    const thread = new Thread();
    const { routines, changes, edits, make } = wired(thread);
    const routine = make("Morning brief");
    thread.say("t1", "hello");
    routines.update(routine.id, { enabled: false });
    routines.update(routine.id, { name: "Renamed" });
    routines.update(routine.id, { enabled: false }, undefined, { conversation: { threadId: "t1" } });
    expect(changes).toHaveLength(0);
    expect(edits).toHaveLength(0);
    expect(thread.lines("t1")).toHaveLength(0);
  });

  it("puts the line of a confirmed routine card in the card's conversation and turn", async () => {
    const thread = new Thread();
    const { routines, changes, make } = wired(thread);
    const routine = make("Morning brief");
    const store = {
      messagesFor: (threadId: string) => thread.activePath(threadId) as never,
      appendMessage: (threadId: string, message: { role: "bot"; kind: "options"; card: RoutineRequestOptionCard }) =>
        thread.appendMessage(threadId, message as never) as never,
      patchMessage: (threadId: string, messageId: string, patch: { card: RoutineRequestOptionCard }) =>
        thread.patchMessage(threadId, messageId, patch as never) as never,
    };
    const service = new RoutineRequestService({ store, routines, now: () => Date.parse("2026-10-15T14:00:00Z"), timeZone: () => "UTC" });
    const ask = thread.say("t1", "Pause the morning brief");
    const proposal = await service.propose({ botId: "bot-a", threadId: "t1", proposal: { action: "pause", routineId: routine.id } });
    // the person answers later, after another line
    thread.say("t1", "ok go");
    expect(service.resolve({ botId: "bot-a", threadId: "t1", requestId: proposal.requestId, behavior: "allow" })).toMatchObject({ state: "applied" });
    expect(changes[0].change).toMatchObject({ enabled: false, threadId: "t1", messageId: proposal.messageId });
    const [line] = thread.lines("t1");
    expect(line.routineToggle).toMatchObject({ action: "disabled", turnKey: ask.id, routines: [{ id: routine.id, name: "Morning brief" }] });
  });

  it("writes a named line for a routine a bot creates, updates or deletes from a conversation", () => {
    const thread = new Thread();
    const { routines } = wired(thread);
    const card = <A extends "create" | "update" | "delete">(threadId: string, messageId: string, action: A) => ({
      requestId: `req-${messageId}`, messageId, botId: "bot-a", threadId, action,
      fingerprintVersion: 1 as const, fingerprint: `fp-${messageId}`,
    });

    const askCreate = thread.say("t1", "Crée une routine de revue des billets");
    const created = routines.create(
      { name: "Revue des billets GECKO", prompt: "Revois les billets", botId: "bot-a", schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } },
      card("t1", askCreate.id, "create"),
    );
    let lines = thread.lines("t1");
    expect(lines).toHaveLength(1);
    expect(lines[0].routineToggle).toMatchObject({ action: "created", turnKey: askCreate.id, routines: [{ id: created.id, name: "Revue des billets GECKO" }] });
    expect(lines[0].text).toBe("Created a routine");

    const askRename = thread.say("t1", "Renomme-la");
    routines.update(created.id, { name: "Revue quotidienne des billets" }, card("t1", askRename.id, "update"));
    lines = thread.lines("t1");
    expect(lines).toHaveLength(2);
    expect(lines[1].routineToggle).toMatchObject({ action: "updated", turnKey: askRename.id, routines: [{ id: created.id, name: "Revue quotidienne des billets" }] });

    const askDelete = thread.say("t1", "Supprime-la");
    routines.remove(created.id, card("t1", askDelete.id, "delete"));
    lines = thread.lines("t1");
    expect(lines).toHaveLength(3);
    expect(lines[2].routineToggle).toMatchObject({ action: "deleted", turnKey: askDelete.id, routines: [{ id: created.id, name: "Revue quotidienne des billets" }] });
  });

  it("does not write an 'updated' line for a bare pause or resume (the toggle line carries those)", () => {
    const thread = new Thread();
    const { routines, edits, make } = wired(thread);
    const routine = make("Résumé du matin");
    thread.say("t1", "Mets la routine en pause");
    const meta = { conversation: { threadId: "t1" } };
    routines.update(routine.id, { enabled: false }, undefined, meta);
    routines.update(routine.id, { enabled: true }, undefined, meta);
    expect(edits).toHaveLength(0);
    expect(thread.lines("t1").every((line) => line.routineToggle!.action === "disabled" || line.routineToggle!.action === "enabled")).toBe(true);
  });

  it("names a change line without a routine in its fallback text", () => {
    expect(routineChangeText("created")).toBe("Created a routine");
    expect(routineChangeText("updated")).toBe("Updated a routine");
    expect(routineChangeText("deleted")).toBe("Deleted a routine");
  });

  it("finds the turn from the person's line, never a peer's", () => {
    const thread = new Thread();
    const mine = thread.say("t1", "please");
    thread.appendMessage("t1", { role: "user", kind: "text", text: "peer", peerAsk: { botId: "b", name: "B" } });
    expect(routineToggleTurnKey(thread.activePath("t1"))).toBe(mine.id);
    expect(routineToggleTurnKey([])).toBe("");
  });
});

describe("routine lines per viewer", () => {
  const line = (): WireMessage => ({
    id: "m1", at: 1, role: "bot", kind: "routines", text: routineToggleText("disabled", 3),
    routineToggle: {
      action: "disabled", turnKey: "u1",
      routines: [{ id: "r1", name: "Mine", botId: "a" }, { id: "r2", name: "Theirs", botId: "b" }, { id: "r3", name: "Also mine", botId: "a" }],
    },
  });

  it("keeps only the routines the viewer can see and recounts the fallback text", () => {
    const shown = routineToggleForViewer(line(), (routine) => routine.botId === "a")!;
    expect(shown.routineToggle!.routines.map((routine) => routine.id)).toEqual(["r1", "r3"]);
    expect(shown.text).toBe("Disabled 2 routines");
    expect(shown.text).not.toContain("Theirs");
  });

  it("sends nothing when none is the viewer's, and leaves a fully visible line untouched", () => {
    expect(routineToggleForViewer(line(), () => false)).toBeNull();
    expect(routineToggleForViewer(line(), () => { throw new Error("no"); })).toBeNull();
    const whole = line();
    expect(routineToggleForViewer(whole, () => true)).toBe(whole);
    const other: WireMessage = { id: "x", at: 1, role: "bot", kind: "text", text: "hi" };
    expect(routineToggleForViewer(other, () => false)).toBe(other);
  });

  it("says one routine in the singular", () => {
    expect(routineToggleText("enabled", 1)).toBe("Enabled 1 routine");
    expect(routineToggleText("disabled", 5)).toBe("Disabled 5 routines");
  });
});
