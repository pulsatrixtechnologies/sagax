// Automatic capture spends as few background calls as it can (port de
// OpenMausBot #3017): one call reads a bot's threads that went quiet
// together, calls run one at a time across the server, and an exchange too
// short to hold a fact costs none. A confidential thread is never read, even
// grouped with others in one call.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR } from "./config.ts";
import { CaptureBuffer, captureItemLimit, capturePrompt, MAX_CANDIDATES, parseCandidates, TRIVIAL_BYTES, worthCapturing, type CaptureTurn } from "./memory-capture.ts";
import { flushMemoryJournal, readMemoryJournal } from "./memory-journal.ts";
import { ORGANIZE_MARKER } from "./memory-organize.ts";
import { CAPTURE_MAX_TURNS, createMemoryUpkeep, MODEL_TIMEOUT_MS, type UpkeepBot } from "./memory-upkeep.ts";
import { closeMessageDb } from "./message-db.ts";
import { readMemoryTopic, workspaceDir, WORKSPACES_DIR } from "./workspace.ts";

const TODAY = "2026-09-25";
const ACK = "Got it, I'll keep that in mind.";

describe("the capture prompt", () => {
  it("never keeps an instruction for one answer as a preference", () => {
    const prompt = capturePrompt({ botName: "Scout", turns: [{ person: "reply with just: ok", bot: "ok" }], notebook: "", today: TODAY });
    expect(prompt).toContain('- An instruction about how to answer one message ("reply with just X", "answer in one word", "say ok") is a request for that one task, never a preference.');
    expect(prompt).toContain('A preference counts only when the Person states it as lasting ("always", "from now on", "I prefer").');
    // the example sentence once read like the very note it should not keep
    expect(prompt).not.toContain("prefers short replies");
  });

  it("numbers several conversations and asks which one each item came from; one reads as before", () => {
    const prompt = capturePrompt({ botName: "Scout", conversations: [[{ person: "I'm vegetarian", bot: "Noted." }], [{ person: "The launch moved to Friday", bot: "Noted." }]], notebook: "", today: TODAY });
    expect(prompt).toContain("2 separate conversations, each oldest first. The Person in one may not be the Person in another");
    expect(prompt).toContain("Conversation 1:\nPerson: I'm vegetarian\nScout: Noted.\n\nConversation 2:\nPerson: The launch moved to Friday\nScout: Noted.");
    expect(prompt).toContain('Give every item "from": the number of the conversation it came from.');
    expect(prompt).toContain(`at most ${2 * MAX_CANDIDATES} items`);
    expect(prompt).toContain('[{"from": 1, "text"');

    const one = capturePrompt({ botName: "Scout", conversations: [[{ person: "I'm vegetarian", bot: "Noted." }]], notebook: "", today: TODAY });
    expect(one).toBe(capturePrompt({ botName: "Scout", turns: [{ person: "I'm vegetarian", bot: "Noted." }], notebook: "", today: TODAY }));
    expect(one).toContain("The conversation, oldest first:\nPerson: I'm vegetarian\nScout: Noted.");
    expect(one).not.toContain("Conversation 1");
    expect(one).not.toContain('"from"');
    expect(one).toContain(`at most ${MAX_CANDIDATES} items`);
  });

  it("reads which conversation an item came from, drops a number that is not one, and allows more items for several", () => {
    const answer = JSON.stringify([
      { text: "A", kind: "fact", from: 2 },
      { text: "B", kind: "fact", from: "3" },
      { text: "C", kind: "fact", from: 0 },
      { text: "D", kind: "fact", from: 1.5 },
      { text: "E", kind: "fact", from: "two" },
    ]);
    expect(parseCandidates(answer, TODAY).map((c) => [c.text, c.from])).toEqual([["A", 2], ["B", 3], ["C", undefined], ["D", undefined], ["E", undefined]]);
    const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ text: `Fact ${i}`, kind: "fact" })));
    expect(parseCandidates(many, TODAY)).toHaveLength(MAX_CANDIDATES);
    expect(parseCandidates(many, TODAY, captureItemLimit(3))).toHaveLength(2 * MAX_CANDIDATES);
  });
});

describe("an exchange too short to hold a fact", () => {
  it("is a test or a pleasantry on both sides, never a short fact the bot answered in words", () => {
    expect(worthCapturing([{ person: "reply with just: ok", bot: "ok" }])).toBe(false);
    expect(worthCapturing([{ person: "hi", bot: "Hi! What's up?" }])).toBe(false);
    expect(worthCapturing([{ person: "x".repeat(TRIVIAL_BYTES - 1), bot: "y".repeat(TRIVIAL_BYTES - 1) }])).toBe(false);
    expect(worthCapturing([{ person: "x".repeat(TRIVIAL_BYTES), bot: "ok" }])).toBe(true);
    expect(worthCapturing([{ person: "I'm vegetarian", bot: "Got it, I'll remember that you're vegetarian." }])).toBe(true);
    expect(worthCapturing([{ person: "I play the cello every Sunday morning.", bot: "Nice." }])).toBe(true);
    // measured in bytes, so a script that packs a fact into few characters still counts
    expect(worthCapturing([{ person: "我是素食者，对花生过敏。", bot: "好的。" }])).toBe(true);
    expect(worthCapturing([{ person: "मैं शाकाहारी हूँ", bot: "ठीक है" }])).toBe(true);
    expect(worthCapturing([{ person: "Je suis végé", bot: "Noté." }])).toBe(false);
    // a stretch of short turns counts together
    expect(worthCapturing([{ person: "My name", bot: "ok" }, { person: "is Asha Rao", bot: "ok" }, { person: "from Pune", bot: "ok" }])).toBe(true);
  });
});

describe("the capture buffer", () => {
  afterEach(() => vi.useRealTimers());

  it("flushes a bot's other threads that would go quiet within the gather window with the one that did", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const flushed: string[] = [];
    const buffer = new CaptureBuffer({ quietMs: () => 60_000, maxTurns: 6, gatherMs: 15_000, onFlush: (batch) => flushed.push(`${batch.botId}/${batch.threadId}`) });
    buffer.add("a", "t1", { person: "x", bot: "y" });
    vi.advanceTimersByTime(10_000);
    buffer.add("a", "t2", { person: "x", bot: "y" });
    buffer.add("b", "t3", { person: "x", bot: "y" });
    vi.advanceTimersByTime(10_000);
    buffer.add("a", "t4", { person: "x", bot: "y" });
    vi.advanceTimersByTime(40_000);
    // t2 would go quiet 10 s after t1, so it goes now; t4 20 s after, so it waits; t3 is another bot's
    expect(flushed).toEqual(["a/t1", "a/t2"]);
    vi.advanceTimersByTime(10_000);
    expect(flushed).toEqual(["a/t1", "a/t2", "b/t3"]);
    vi.advanceTimersByTime(10_000);
    expect(flushed).toEqual(["a/t1", "a/t2", "b/t3", "a/t4"]);
  });
});

describe("capture calls", () => {
  const LEAD: UpkeepBot = { id: "bot-calls-lead", name: "Scout" };
  const HELPER: UpkeepBot = { id: "bot-calls-helper", name: "Pixel" };
  let bots: UpkeepBot[];
  let captures: { botId: string; prompt: string }[];
  let organizes: number;
  let running: number;
  let most: number;
  let answer: (prompt: string, botId: string) => Promise<string> | string;
  let aboutMe: string[];
  let confidential: Set<string>;
  let transcript: Map<string, CaptureTurn>;

  const loop = () => createMemoryUpkeep({
    bots: () => bots,
    bot: (id) => bots.find((bot) => bot.id === id),
    engine: (botId) => ({
      generateText: async (prompt) => {
        if (prompt.includes(ORGANIZE_MARKER)) {
          organizes += 1;
          return '{"moves": []}';
        }
        captures.push({ botId, prompt });
        running += 1;
        most = Math.max(most, running);
        try {
          return await answer(prompt, botId);
        } finally {
          running -= 1;
        }
      },
    }),
    busy: () => false,
    addToAboutMe: (_from, texts) => {
      aboutMe.push(...texts);
      return texts.length;
    },
    sourceLabel: (_botId, threadId) => `chat "${threadId}"`,
    capturable: (threadId) => !confidential.has(threadId),
    restoreTurn: (_botId, _threadId, turnId) => transcript.get(turnId) ?? null,
    quietMs: () => 60_000,
    tidyHour: () => 3,
    now: () => new Date(2026, 8, 25, 10, 0),
  });

  const memory = (botId: string) => {
    try {
      return readFileSync(join(workspaceDir(botId), "MEMORY.md"), "utf8");
    } catch {
      return "";
    }
  };
  const note = (n: number) => `Note ${n}: the person keeps bees on the roof.`;
  const gate = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { open, opened };
  };

  beforeEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    rmSync(WORKSPACES_DIR, { recursive: true, force: true });
    bots = [LEAD, HELPER];
    captures = [];
    organizes = 0;
    running = 0;
    most = 0;
    answer = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "[]";
    };
    aboutMe = [];
    confidential = new Set();
    transcript = new Map();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads six threads of one bot that go quiet together in one call, where each used to cost its own", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    answer = () => JSON.stringify([{ from: 3, text: "The person keeps bees on the roof", kind: "fact" }]);
    const upkeep = loop();
    for (let i = 1; i <= 6; i += 1) {
      upkeep.noteTurn(LEAD.id, `t${i}`, { person: note(i), bot: ACK });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    await upkeep.idle();
    expect(captures).toHaveLength(1);
    expect(organizes).toBe(1);
    expect(captures[0]!.prompt).toContain("6 separate conversations");
    for (let i = 1; i <= 6; i += 1) expect(captures[0]!.prompt).toContain(`Conversation ${i}:\nPerson: ${note(i)}\nScout: ${ACK}`);
    expect(memory(LEAD.id)).toContain('from chat "t3" (noticed) · The person keeps bees on the roof');
  });

  it("gives two bots a call each, one after the other, never two at once", async () => {
    const upkeep = loop();
    upkeep.noteTurn(LEAD.id, "t1", { person: note(1), bot: ACK });
    upkeep.noteTurn(HELPER.id, "t2", { person: note(2), bot: ACK });
    upkeep.noteTurn(LEAD.id, "t3", { person: note(3), bot: ACK });
    upkeep.flushThread("t1");
    upkeep.flushThread("t2");
    upkeep.flushThread("t3");
    await upkeep.idle();
    expect(captures.map((call) => call.botId)).toEqual([LEAD.id, HELPER.id]);
    expect(captures[0]!.prompt).toContain(note(3));
    expect(captures[1]!.prompt).not.toContain(note(1));
    expect(most).toBe(1);
  });

  it("never sends a confidential thread to the model, even grouped with a normal one in the same call", async () => {
    const held = gate();
    answer = async (prompt) => {
      if (prompt.includes("first")) await held.opened;
      // the model can only repeat what the prompt showed it
      return JSON.stringify([{ from: 1, text: "The person keeps bees", kind: "fact" }, ...(prompt.includes("Kestrel") ? [{ from: 2, text: "The merger target is Kestrel", kind: "fact" }] : [])]);
    };
    const upkeep = loop();
    // a first call holds the worker, so the next two threads wait in the queue together
    upkeep.noteTurn(HELPER.id, "busy", { person: "first: I collect stamps from Peru.", bot: ACK });
    upkeep.flushThread("busy");
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    upkeep.noteTurn(LEAD.id, "normal", { person: note(1), bot: ACK });
    upkeep.noteTurn(LEAD.id, "secret", { person: "The merger target is Kestrel, keep it quiet.", bot: ACK });
    upkeep.flushThread("normal");
    upkeep.flushThread("secret");
    // it becomes confidential while it waits for its call
    confidential.add("secret");
    held.open();
    await upkeep.idle();
    expect(captures).toHaveLength(2);
    expect(captures[1]!.botId).toBe(LEAD.id);
    expect(captures[1]!.prompt).toContain(note(1));
    expect(captures[1]!.prompt).not.toContain("Kestrel");
    expect(captures[1]!.prompt).not.toContain("Conversation 2");
    expect(memory(LEAD.id)).toContain("The person keeps bees");
    expect(memory(LEAD.id)).not.toContain("Kestrel");
  });

  it("splits a backlog too big for one call: at most twelve turns, and a byte budget", async () => {
    const upkeep = loop();
    // the sixth turn flushes a thread at once, so all three wait together
    for (const thread of ["t1", "t2", "t3"]) for (let i = 0; i < CAPTURE_MAX_TURNS; i += 1) upkeep.noteTurn(LEAD.id, thread, { person: `${thread}: ${note(i)}`, bot: ACK });
    await upkeep.idle();
    expect(captures).toHaveLength(2);
    expect(captures[0]!.prompt).toContain("t2: ");
    expect(captures[0]!.prompt).not.toContain("t3: ");
    expect(captures[1]!.prompt).toContain("t3: ");

    captures = [];
    // each line is clipped to 1,500 characters: five turns of two full lines are 15 KB a thread
    const long = "a long pasted note ".repeat(100);
    for (const thread of ["t4", "t5"]) for (let i = 0; i < 5; i += 1) upkeep.noteTurn(LEAD.id, thread, { person: `${thread}: ${long}`, bot: long });
    upkeep.flushThread("t4");
    upkeep.flushThread("t5");
    await upkeep.idle();
    expect(captures).toHaveLength(2);
    expect(captures[0]!.prompt).not.toContain("t5: ");
  });

  it("files each item under the conversation it came from: its source line and its journal rows", async () => {
    answer = () => JSON.stringify([
      { from: 2, text: "The launch moved to Friday", kind: "decision", confidence: 0.9 },
      { from: 1, text: "The person is vegetarian", kind: "preference", aboutUser: true, confidence: 0.9 },
      { from: 2, text: "Asha owns the press kit", kind: "fact", topic: "launch", topicAliases: ["release"], confidence: 0.9 },
    ]);
    const upkeep = loop();
    upkeep.noteTurn(LEAD.id, "t1", { person: "Just so you know, I'm vegetarian.", bot: ACK });
    upkeep.noteTurn(LEAD.id, "t2", { person: "The launch moved to Friday; Asha owns the press kit.", bot: ACK });
    upkeep.flushThread("t1");
    upkeep.flushThread("t2");
    await upkeep.idle();
    expect(captures).toHaveLength(1);
    expect(memory(LEAD.id)).toContain('from chat "t1" (noticed) · The person is vegetarian');
    expect(memory(LEAD.id)).toContain('from chat "t2" (noticed) · The launch moved to Friday');
    expect(readMemoryTopic(LEAD.id, "launch.md")).toContain('from chat "t2" (noticed) · Asha owns the press kit');
    await flushMemoryJournal(LEAD.id);
    const rows = readMemoryJournal(LEAD.id, 10).filter((row) => row.via === "capture" && row.path !== "memory/archive.md").map((row) => `${row.path} ${row.threadId}`);
    expect(rows.sort()).toEqual(["MEMORY.md t1", "MEMORY.md t2", "memory/launch.md t2"]);
    expect(aboutMe).toEqual(["The person is vegetarian"]);
  });

  it("adds to About me only from the owner's own conversations, never reading the owner's and someone else's in one call", async () => {
    // a model that files every item under conversation 1 (or is told to by a
    // forged line) cannot move another person's fact into About me
    answer = (prompt) => JSON.stringify(prompt.includes("I'm vegetarian")
      ? [{ from: 1, text: "The person is vegetarian", kind: "preference", aboutUser: true }]
      : [{ from: 1, text: "The person is allergic to peanuts", kind: "fact", aboutUser: true }]);
    const upkeep = loop();
    upkeep.noteTurn(LEAD.id, "mine", { person: "Just so you know, I'm vegetarian.", bot: ACK });
    upkeep.noteTurn(LEAD.id, "theirs", { person: "I'm allergic to peanuts, by the way.", bot: ACK, owner: false });
    upkeep.flushThread("mine");
    upkeep.flushThread("theirs");
    await upkeep.idle();
    expect(captures).toHaveLength(2);
    expect(captures.some((call) => call.prompt.includes("I'm vegetarian") && call.prompt.includes("allergic to peanuts, by the way"))).toBe(false);
    expect(aboutMe).toEqual(["The person is vegetarian"]);
    expect(memory(LEAD.id)).toContain('from chat "theirs" (noticed) · The person is allergic to peanuts');
  });

  it("without a valid from, files an item under the conversation with the most said", async () => {
    answer = () => JSON.stringify([
      { text: "The person lives in Lyon", kind: "fact" },
      { from: 7, text: "The person has a dog named Biscuit", kind: "fact" },
    ]);
    const upkeep = loop();
    upkeep.noteTurn(LEAD.id, "short", { person: "Thanks a lot for that!", bot: ACK });
    upkeep.noteTurn(LEAD.id, "long", { person: "I moved to Lyon last spring and my dog Biscuit came along.", bot: ACK });
    upkeep.flushThread("short");
    upkeep.flushThread("long");
    await upkeep.idle();
    expect(memory(LEAD.id)).toContain('from chat "long" (noticed) · The person lives in Lyon');
    expect(memory(LEAD.id)).toContain('from chat "long" (noticed) · The person has a dog named Biscuit');
    expect(memory(LEAD.id)).not.toContain('chat "short"');

    answer = () => JSON.stringify([{ text: "The person plays the cello", kind: "fact", aboutUser: true }]);
    upkeep.noteTurn(LEAD.id, "a", { person: "Thanks a lot for that!", bot: ACK });
    upkeep.noteTurn(LEAD.id, "b", { person: "I play the cello every Sunday morning.", bot: ACK });
    upkeep.flushThread("a");
    upkeep.flushThread("b");
    await upkeep.idle();
    expect(memory(LEAD.id)).toContain('from chat "b" (noticed) · The person plays the cello');
    expect(aboutMe).toEqual(["The person plays the cello"]);
  });

  it("drops what a thread turned confidential during the call gave, and a guess that might be its", async () => {
    answer = (prompt) => {
      confidential.add("secret");
      return JSON.stringify(prompt.includes("Kestrel, keep it quiet") ? [
        { from: 1, text: "The person keeps bees", kind: "fact" },
        { from: 2, text: "The merger target is Kestrel", kind: "decision" },
        { text: "The person has an unsure origin", kind: "fact" },
      ] : [{ from: 1, text: "The person keeps bees", kind: "fact" }]);
    };
    const upkeep = loop();
    upkeep.noteTurn(LEAD.id, "chat", { person: note(1), bot: ACK });
    upkeep.noteTurn(LEAD.id, "secret", { person: "The merger target is Kestrel, keep it quiet.", bot: ACK });
    upkeep.flushThread("chat");
    upkeep.flushThread("secret");
    await upkeep.idle();
    // the whole answer goes; "chat" is read again on its own
    expect(captures).toHaveLength(2);
    expect(captures[1]!.prompt).not.toContain("Kestrel");
    expect(memory(LEAD.id)).toContain('from chat "chat" (noticed) · The person keeps bees');
    expect(memory(LEAD.id)).not.toContain("Kestrel");
    expect(memory(LEAD.id)).not.toContain("unsure");
  });

  it("spends no call on a test exchange, so its 'minimal replies' note is never made, and still reads a short fact", async () => {
    answer = () => JSON.stringify([{ text: "The person prefers replies to be minimal", kind: "preference", aboutUser: true }]);
    const upkeep = loop();
    upkeep.noteTurn(LEAD.id, "t1", { person: "reply with just: ok", bot: "ok" });
    upkeep.noteTurn(LEAD.id, "t2", { person: "say ok", bot: "ok" });
    upkeep.flushThread("t1");
    upkeep.flushThread("t2");
    await upkeep.idle();
    expect(captures).toEqual([]);
    expect(memory(LEAD.id)).not.toContain("minimal");
    expect(aboutMe).toEqual([]);

    answer = () => "[]";
    upkeep.noteTurn(LEAD.id, "t3", { person: "我对花生过敏", bot: "好的，我记住了，你对花生过敏。" });
    upkeep.noteTurn(LEAD.id, "t4", { person: "I'm vegetarian", bot: "Got it, I'll remember that you're vegetarian." });
    upkeep.flushThread("t3");
    upkeep.flushThread("t4");
    await upkeep.idle();
    expect(captures).toHaveLength(1);
    expect(captures[0]!.prompt).toContain("Person: 我对花生过敏");
    expect(captures[0]!.prompt).toContain("Person: I'm vegetarian");
  });

  it("holds every thread through a backup and reads them in one call after it", async () => {
    answer = () => JSON.stringify([{ from: 1, text: "The person likes jazz", kind: "preference" }, { from: 2, text: "The person keeps bees", kind: "fact" }]);
    const upkeep = loop();
    upkeep.pause();
    upkeep.noteTurn(LEAD.id, "t1", { person: "I like jazz, mostly Coltrane.", bot: ACK });
    upkeep.noteTurn(LEAD.id, "t2", { person: note(2), bot: ACK });
    upkeep.flushThread("t1");
    upkeep.flushThread("t2");
    await upkeep.idle();
    expect(captures).toEqual([]);
    upkeep.resume();
    await upkeep.idle();
    expect(captures).toHaveLength(1);
    expect(memory(LEAD.id)).toContain('from chat "t1" (noticed) · The person likes jazz');
    expect(memory(LEAD.id)).toContain('from chat "t2" (noticed) · The person keeps bees');
  });

  it("puts a call that answers during a backup back in the queue and asks again after it", async () => {
    const held = gate();
    answer = async () => {
      await held.opened;
      return JSON.stringify([{ text: "The person likes jazz", kind: "preference" }]);
    };
    const upkeep = loop();
    upkeep.noteTurn(LEAD.id, "t1", { person: "I like jazz, mostly Coltrane.", bot: ACK });
    upkeep.flushThread("t1");
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    upkeep.pause();
    held.open();
    await upkeep.idle();
    expect(memory(LEAD.id)).not.toContain("jazz");
    upkeep.resume();
    await upkeep.idle();
    expect(captures).toHaveLength(2);
    expect(memory(LEAD.id)).toContain("The person likes jazz");
  });

  it("keeps the call out and the threads queued behind it at shutdown as ids, and reads them together after the next start", async () => {
    const pending = join(DATA_DIR, "memory-capture-pending.json");
    const held = gate();
    answer = async () => {
      await held.opened;
      return "[]";
    };
    const first = loop();
    first.noteTurn(HELPER.id, "t1", { person: note(1), bot: ACK, turnId: "turn-1" });
    first.flushThread("t1");
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    const two = { person: note(2), bot: ACK, turnId: "turn-2" };
    const three = { person: note(3), bot: ACK, turnId: "turn-3" };
    transcript.set("turn-2", two);
    transcript.set("turn-3", three);
    first.noteTurn(LEAD.id, "t2", two);
    first.noteTurn(LEAD.id, "t3", three);
    first.flushThread("t2");
    first.flushThread("t3");
    first.stop();
    held.open();
    await first.idle();
    expect(captures).toHaveLength(1);
    // the call still out at the stop is kept too: it may never answer before exit
    expect(JSON.parse(readFileSync(pending, "utf8"))).toEqual({ batches: [
      { botId: HELPER.id, threadId: "t1", turnIds: ["turn-1"] },
      { botId: LEAD.id, threadId: "t2", turnIds: ["turn-2"] },
      { botId: LEAD.id, threadId: "t3", turnIds: ["turn-3"] },
    ] });

    answer = () => JSON.stringify([{ from: 1, text: "Fact two", kind: "fact" }, { from: 2, text: "Fact three", kind: "fact" }]);
    const second = loop();
    second.start();
    expect(existsSync(pending)).toBe(false);
    second.flushThread("t2");
    second.flushThread("t3");
    await second.idle();
    expect(captures).toHaveLength(2);
    expect(memory(LEAD.id)).toContain('from chat "t2" (noticed) · Fact two');
    expect(memory(LEAD.id)).toContain('from chat "t3" (noticed) · Fact three');
    second.stop();
    expect(existsSync(pending)).toBe(false);
  });

  it("leaves nothing of a bot deleted while its call runs and another of its threads waits", async () => {
    const pending = join(DATA_DIR, "memory-capture-pending.json");
    const held = gate();
    answer = async () => {
      await held.opened;
      return JSON.stringify([{ text: "The person keeps bees", kind: "fact" }]);
    };
    const upkeep = loop();
    upkeep.noteTurn(LEAD.id, "t1", { person: note(1), bot: ACK, turnId: "turn-1" });
    upkeep.flushThread("t1");
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    const helperTurn = { person: note(3), bot: ACK, turnId: "turn-3" };
    transcript.set("turn-3", helperTurn);
    upkeep.noteTurn(LEAD.id, "t2", { person: note(2), bot: ACK, turnId: "turn-2" });
    upkeep.noteTurn(HELPER.id, "t3", helperTurn);
    upkeep.flushThread("t2");
    upkeep.flushThread("t3");
    bots = [HELPER];
    upkeep.forgetBot(LEAD.id);
    // shut down with the deleted bot's call still out: only the other bot's waiting thread is kept
    upkeep.stop();
    expect(JSON.parse(readFileSync(pending, "utf8"))).toEqual({ batches: [{ botId: HELPER.id, threadId: "t3", turnIds: ["turn-3"] }] });
    held.open();
    await upkeep.idle();
    expect(captures.map((call) => call.botId)).toEqual([LEAD.id]);
    expect(memory(LEAD.id)).not.toContain("bees");
    expect(upkeep.status(LEAD.id).lastCapture).toBeUndefined();

    const next = loop();
    next.start();
    next.flushThread("t3");
    await next.idle();
    expect(captures.map((call) => call.botId)).toEqual([LEAD.id, HELPER.id]);
    expect(memory(HELPER.id)).toContain("The person keeps bees");
    next.stop();
    expect(existsSync(pending)).toBe(false);
  });

  it("goes on to the next call when one never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // askModel's own expiry (AbortSignal.timeout) runs on a timer the fake clock does not drive
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const expiry = new AbortController();
      setTimeout(() => expiry.abort(new DOMException("timed out", "TimeoutError")), ms);
      return expiry.signal;
    });
    answer = (_prompt, botId) => (botId === LEAD.id ? new Promise<string>(() => undefined) : JSON.stringify([{ text: "The person keeps bees", kind: "fact" }]));
    const upkeep = loop();
    const stuck = upkeep.capture({ botId: LEAD.id, threadId: "t1", turns: [{ person: note(1), bot: ACK }] });
    const next = upkeep.capture({ botId: HELPER.id, threadId: "t2", turns: [{ person: note(2), bot: ACK }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(captures.map((call) => call.botId)).toEqual([LEAD.id]);
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS);
    expect((await stuck).note).toBe("The capture call did not answer in time.");
    expect(await next).toMatchObject({ added: 1 });
    expect(captures.map((call) => call.botId)).toEqual([LEAD.id, HELPER.id]);
    expect(memory(HELPER.id)).toContain("The person keeps bees");
  });
});
