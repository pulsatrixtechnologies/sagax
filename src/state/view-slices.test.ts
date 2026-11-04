import { describe, expect, it } from "vitest";
import { initialState, type AppState, type Bot } from "./store/model";
import { botRoutineRuns, equalRows, peerBots, peerGroups } from "./view-slices";
const bot = { id: "osprey", name: "Osprey", threadId: "main", color: "blue", messages: [], ownerUserId: "owner-a", hidden: false, grants: [], tasks: [{ threadId: "main", title: "Conversation", createdAt: 1 }] } as unknown as Bot;
const state = { ...initialState, bots: [bot] };
describe("peer profile subscriptions", () => {
  it("ignores another thread's transcript while retaining navigation and profile changes", () => {
    const first = peerBots(state);
    expect(equalRows(first, peerBots({ ...state, bots: [{ ...bot, messages: [{ id: "m", role: "bot", kind: "text", text: "Streaming", at: 1 }] }] }))).toBe(true);
    expect(equalRows(first, peerBots({ ...state, bots: [{ ...bot, tasks: bot.tasks!.map((task) => ({ ...task, updatedAt: 99 })) }] }))).toBe(true);
    expect(equalRows(first, peerBots({ ...state, bots: [{ ...bot, name: "Wren" }] }))).toBe(false);
    expect(equalRows(first, peerBots({ ...state, bots: [{ ...bot, tasks: [] }] }))).toBe(false);
  });
  it("keeps the history of a routine moved to this bot and excludes unrelated runs", () => {
    const routines = [{ id: "owned", botId: bot.id }, { id: "other", botId: "wren" }] as AppState["routines"];
    const routineRuns = [
      { id: "history", routineId: "owned", botId: "wren" },
      { id: "here", routineId: "other", botId: bot.id },
      { id: "unrelated", routineId: "other", botId: "wren" },
    ] as AppState["routineRuns"];
    expect(botRoutineRuns({ ...state, routines, routineRuns }, bot.id).map((run) => run.id)).toEqual(["history", "here"]);
  });
  it("observes access changes and removal, even when a transcript is streaming", () => {
    const first = peerBots(state);
    for (const patch of [{ hidden: true }, { ownerUserId: "owner-b" }, { grants: [{ principalId: "owner-b" }] }]) {
      expect(equalRows(first, peerBots({ ...state, bots: [{ ...bot, ...patch } as Bot] }))).toBe(false);
    }
    expect(equalRows(first, peerBots({ ...state, bots: [] }))).toBe(false);
    expect(peerGroups(initialState)).toEqual([]);
  });
});
