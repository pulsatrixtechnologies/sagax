// The launch snapshot (src/lib/ui-snapshot.ts) is a read-only drawing: the
// server's own snapshot replaces it wholesale, nothing of it is merged, and
// it is never applied over the server's state.
import { describe, expect, it } from "vitest";
import { buildUiSnapshot, parseUiSnapshot, allowUiSnapshot, UI_SNAPSHOT_MESSAGES, type UiSnapshot } from "@/lib/ui-snapshot";
import { initialState, reducer, withLaunchSnapshot, type AppState, type Bot, type Message } from "./store";

const message = (id: string, text = `message ${id}`): Message => ({ id, role: "bot", kind: "text", text, at: 1 } as unknown as Message);
const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [], ...extra,
});
const hydrate = (state: AppState, bots: Bot[], resumeId?: string) =>
  reducer(state, { type: "hydrate", bots, groups: [], sections: ["My team"], computerControl: {}, ...(resumeId ? { resumeId } : {}) });
const origin = "http://127.0.0.1:8799";
const snapshotOf = (bots: Bot[], selectedId: string): UiSnapshot => ({
  version: 1, savedAt: Date.now(), origin, brand: { brand: { name: "Sagax" }, source: "default", file: "" } as UiSnapshot["brand"],
  selectedId, sections: ["Old team"], bots, groups: [],
});

describe("launch snapshot: the drawing before the server answers", () => {
  it("draws the stored sidebar and conversation as provisional, not hydrated", () => {
    const stored = snapshotOf([bot("alpha-bot", { unread: true, messages: [message("m1")] })], "alpha-bot");
    const state = withLaunchSnapshot(initialState, stored);
    expect(state.provisional).toBe(true);
    expect(state.hydrated).toBeUndefined();
    expect(state.selectedId).toBe("alpha-bot");
    expect(state.bots[0]?.messages.map((m) => m.id)).toEqual(["m1"]);
  });

  it("is replaced wholesale by the server's snapshot: no stamp, row or selection of it survives", () => {
    const stored = snapshotOf([
      bot("alpha-bot", { unread: true, tasks: [{ threadId: "t-alpha-bot", title: "Stale title", createdAt: 1, unread: true, lastReadMessageId: "old" }] }),
      bot("deleted-since"),
    ], "deleted-since");
    const drawn = withLaunchSnapshot(initialState, stored);
    const live = hydrate(drawn, [bot("alpha-bot", { unread: false, tasks: [{ threadId: "t-alpha-bot", title: "Fresh title", createdAt: 1 }] })], "alpha-bot");
    expect(live.provisional).toBeUndefined();
    expect(live.hydrated).toBe(true);
    expect(live.bots.map((b) => b.id)).toEqual(["alpha-bot"]);
    expect(live.bots[0]?.unread).toBe(false);
    expect(live.bots[0]?.tasks?.[0]).toEqual({ threadId: "t-alpha-bot", title: "Fresh title", createdAt: 1 });
    expect(live.sections).toEqual(["My team"]);
    // the drawn selection is not kept: the remembered one, as without a snapshot
    expect(live.selectedId).toBe("alpha-bot");
  });

  it("chooses the same conversation the server's snapshot alone would", () => {
    const bots = [bot("alpha-bot"), bot("beta-bot")];
    const stored = snapshotOf(bots, "beta-bot");
    const withDrawing = hydrate(withLaunchSnapshot(initialState, stored), bots, "alpha-bot");
    const without = hydrate(initialState, bots, "alpha-bot");
    expect(withDrawing.selectedId).toBe(without.selectedId);
    expect(withDrawing.bots).toEqual(without.bots);
  });

  it("is never applied over the server's state", () => {
    const live = hydrate(initialState, [bot("alpha-bot")]);
    const again = withLaunchSnapshot(live, snapshotOf([bot("stale")], "stale"));
    expect(again).toBe(live);
  });

  it("is dropped when the server never answers", () => {
    const drawn = withLaunchSnapshot(initialState, snapshotOf([bot("alpha-bot")], "alpha-bot"));
    const dropped = reducer(drawn, { type: "provisionalExpired" });
    expect(dropped.provisional).toBeUndefined();
    expect(dropped.bots).toEqual([]);
    expect(dropped.selectedId).toBe("");
    // and a late expiry does nothing to live state
    const live = hydrate(initialState, [bot("alpha-bot")]);
    expect(reducer(live, { type: "provisionalExpired" })).toBe(live);
  });
});

describe("launch snapshot: what is kept", () => {
  const live = hydrate(initialState, [
    bot("alpha-bot", {
      soul: "secret standing instructions", cwd: "/Users/someone/project", alwaysAllow: ["Bash"], description: "long profile",
      messages: Array.from({ length: 120 }, (_, i) => message(`m${i}`)),
      tasks: [{ threadId: "t-alpha-bot", title: "Open", createdAt: 1, cwd: "/private", usage: { costUsd: 3 } } as never],
    }),
    bot("beta-bot", { messages: [message("k1")] }),
  ], "alpha-bot");

  it("keeps only what the sidebar and the open conversation show", () => {
    allowUiSnapshot(true);
    const snapshot = buildUiSnapshot(live, origin)!;
    const alphaBot = snapshot.bots.find((b) => b.id === "alpha-bot")!;
    expect(alphaBot).not.toHaveProperty("soul");
    expect(alphaBot).not.toHaveProperty("cwd");
    expect(alphaBot).not.toHaveProperty("alwaysAllow");
    expect(alphaBot.description).toBe("");
    expect(alphaBot.tasks?.[0]).toEqual({ threadId: "t-alpha-bot", title: "Open", createdAt: 1 });
    expect(alphaBot.messages).toHaveLength(UI_SNAPSHOT_MESSAGES);
    expect(alphaBot.messages.at(-1)?.id).toBe("m119");
    // another bot's conversation is not kept, only its row
    expect(snapshot.bots.find((b) => b.id === "beta-bot")!.messages).toEqual([]);
  });

  it("keeps nothing unless the owner here is looking, or while drawing", () => {
    allowUiSnapshot(false);
    expect(buildUiSnapshot(live, origin)).toBeNull();
    allowUiSnapshot(true);
    expect(buildUiSnapshot(withLaunchSnapshot(initialState, snapshotOf([bot("x")], "x")), origin)).toBeNull();
  });

  it("draws only its own page's, recent, well-formed snapshot", () => {
    allowUiSnapshot(true);
    const text = JSON.stringify(buildUiSnapshot(live, origin));
    expect(parseUiSnapshot(text, origin)?.selectedId).toBe("alpha-bot");
    expect(parseUiSnapshot(text, "http://127.0.0.1:18799")).toBeNull();
    expect(parseUiSnapshot(text, origin, Date.now() + 31 * 24 * 60 * 60 * 1000)).toBeNull();
    expect(parseUiSnapshot("{not json", origin)).toBeNull();
    expect(parseUiSnapshot(JSON.stringify({ ...JSON.parse(text), bots: [{ id: "x" }] }), origin)).toBeNull();
    expect(parseUiSnapshot(null, origin)).toBeNull();
  });
});
