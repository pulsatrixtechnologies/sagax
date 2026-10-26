import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deletePromptSplitReceipt,
  promptHalves,
  promptSplitFingerprints,
  readPromptSplitReceipt,
  sectionDelta,
  sectionFingerprints,
  splitSessionPrompt,
  VOLATILE_SECTIONS_NOTE_PREFIX,
  volatileContextNote,
  volatileSectionsUpdate,
  withContextNote,
  writePromptSplitReceipt,
} from "./prompt-split.ts";
import type { PromptSplitReceipt } from "./prompt-split.ts";

describe("promptHalves", () => {
  it("reads the split only when a turn carries both halves", () => {
    expect(promptHalves({ system: "all", systemStable: "keep", systemVolatile: "swap" })).toEqual({
      stable: "keep",
      volatile: "swap",
    });
    expect(promptHalves({ system: "all" })).toEqual({ stable: null, volatile: "" });
    expect(promptHalves({ system: "all", systemStable: "keep" })).toEqual({ stable: null, volatile: "" });
    expect(promptHalves({ system: "all", systemVolatile: "swap" })).toEqual({ stable: null, volatile: "" });
  });
});

describe("volatileContextNote", () => {
  it("labels the current copy, announces a clearing, and stays quiet for never-set halves", () => {
    expect(volatileContextNote("Memory: likes quiet hours.", false))
      .toBe("Context from Sagax updated since this conversation started; it replaces any earlier copy:\n\nMemory: likes quiet hours.");
    expect(volatileContextNote("  ", true)).toContain("have been cleared");
    expect(volatileContextNote("", false)).toBe("");
  });
});

describe("withContextNote", () => {
  it("prepends the note, keeps bare text bare, and passes through empty notes", () => {
    expect(withContextNote("note", "text")).toBe("note\n\ntext");
    expect(withContextNote("note", "")).toBe("note");
    expect(withContextNote("", "text")).toBe("text");
  });
});

describe("prompt-split receipts", () => {
  it("round-trips the halves a native session last carried", () => {
    const scope = "test-driver";
    const key = randomUUID();
    expect(readPromptSplitReceipt(scope, key)).toBeNull();
    const receipt = promptSplitFingerprints("stable rules", "memory");
    writePromptSplitReceipt(scope, key, receipt);
    expect(readPromptSplitReceipt(scope, key)).toEqual(receipt);
    expect(readPromptSplitReceipt(scope, randomUUID())).toBeNull();
  });

  it("round-trips the re-anchor turn counter and drops receipts on demand", () => {
    const scope = "test-driver";
    const key = randomUUID();
    const receipt = { ...promptSplitFingerprints("stable rules", "memory"), turnsSinceFull: 4 };
    writePromptSplitReceipt(scope, key, receipt);
    expect(readPromptSplitReceipt(scope, key)).toEqual(receipt);
    deletePromptSplitReceipt(scope, key);
    expect(readPromptSplitReceipt(scope, key)).toBeNull();
    // deleting an unknown receipt is a no-op, not an error
    deletePromptSplitReceipt(scope, key);
    deletePromptSplitReceipt(scope, randomUUID());
  });

  it("round-trips the last reported context size and drops invalid values", () => {
    const scope = "test-driver";
    const key = randomUUID();
    const receipt = { ...promptSplitFingerprints("stable rules", "memory"), lastUsed: 167218 };
    writePromptSplitReceipt(scope, key, receipt);
    expect(readPromptSplitReceipt(scope, key)).toEqual(receipt);
    // non-positive or non-numeric sizes read back as absent
    for (const invalid of [0, -4096, "167218", null, undefined]) {
      writePromptSplitReceipt(scope, key, { ...receipt, lastUsed: invalid } as unknown as PromptSplitReceipt);
      expect(readPromptSplitReceipt(scope, key)?.lastUsed).toBeUndefined();
    }
    deletePromptSplitReceipt(scope, key);
  });

  it("retains the context high-water mark separately from the final report", () => {
    const scope = "test-driver";
    const key = randomUUID();
    const receipt = { ...promptSplitFingerprints("stable rules", "memory"), lastUsed: 75000, peakUsed: 100000 };
    writePromptSplitReceipt(scope, key, receipt);
    expect(readPromptSplitReceipt(scope, key)).toEqual(receipt);
    for (const invalid of [0, -4096, "100000", null, undefined]) {
      writePromptSplitReceipt(scope, key, { ...receipt, peakUsed: invalid } as unknown as PromptSplitReceipt);
      expect(readPromptSplitReceipt(scope, key)?.peakUsed).toBeUndefined();
    }
    deletePromptSplitReceipt(scope, key);
  });
});

describe("splitSessionPrompt", () => {
  const fullSystem = "stable rules.\n\nmemory";

  it("delivers the full prompt to an untracked session, then sends later turns bare", () => {
    const first = splitSessionPrompt("stable rules.", "memory", null, fullSystem, "first");
    expect(first.text).toBe(fullSystem + "\n\nfirst");
    const second = splitSessionPrompt("stable rules.", "memory", first.receipt, fullSystem, "second");
    expect(second.text).toBe("second");
  });

  it("rides a changed volatile half as a labelled note", () => {
    const first = splitSessionPrompt("stable rules.", "memory", null, fullSystem, "first");
    const second = splitSessionPrompt("stable rules.", "moved to Toronto", first.receipt, fullSystem, "second");
    expect(second.text).toBe(
      "Context from Sagax updated since this conversation started; it replaces any earlier copy:\n\nmoved to Toronto\n\nsecond",
    );
  });

  it("announces a cleared volatile half once", () => {
    const first = splitSessionPrompt("stable rules.", "memory", null, fullSystem, "first");
    const cleared = splitSessionPrompt("stable rules.", "", first.receipt, fullSystem, "cleared");
    expect(cleared.text).toContain("have been cleared");
    const still = splitSessionPrompt("stable rules.", "", cleared.receipt, fullSystem, "still");
    expect(still.text).toBe("still");
  });

  it("redelivers an unchanged volatile half on a turn that carries its own mention context", () => {
    const first = splitSessionPrompt("stable rules.", "Tagged: @Testy", null, fullSystem, "first");
    const untagged = splitSessionPrompt("stable rules.", "Tagged: @Testy", first.receipt, fullSystem, "untagged");
    expect(untagged.text).toBe("untagged");
    const tagged = splitSessionPrompt("stable rules.", "Tagged: @Testy", first.receipt, fullSystem, "tagged", true);
    expect(tagged.text).toContain("replaces any earlier copy");
    expect(tagged.text).toContain("Tagged: @Testy");
    expect(tagged.text.endsWith("tagged")).toBe(true);
  });

  it("re-delivers the full prompt when the stable half changes", () => {
    const first = splitSessionPrompt("old rules.", "memory", null, fullSystem, "first");
    const second = splitSessionPrompt("new rules.", "memory", first.receipt, "new rules.\n\nmemory", "second");
    expect(second.text).toBe("new rules.\n\nmemory\n\nsecond");
  });

  it("re-anchors the full prompt after the requested run of bare turns", () => {
    let state = splitSessionPrompt("stable rules.", "memory", null, fullSystem, "first", false, 3);
    expect(state.text).toBe(fullSystem + "\n\nfirst");
    expect(state.receipt.turnsSinceFull).toBe(0);
    state = splitSessionPrompt("stable rules.", "memory", state.receipt, fullSystem, "second", false, 3);
    expect(state.text).toBe("second");
    state = splitSessionPrompt("stable rules.", "memory", state.receipt, fullSystem, "third", false, 3);
    expect(state.text).toBe("third");
    state = splitSessionPrompt("stable rules.", "memory", state.receipt, fullSystem, "fourth", false, 3);
    expect(state.text).toBe("fourth");
    // three bare turns have passed: the next delivery re-anchors
    state = splitSessionPrompt("stable rules.", "memory", state.receipt, fullSystem, "fifth", false, 3);
    expect(state.text).toBe(fullSystem + "\n\nfifth");
    expect(state.receipt.turnsSinceFull).toBe(0);
    state = splitSessionPrompt("stable rules.", "memory", state.receipt, fullSystem, "sixth", false, 3);
    expect(state.text).toBe("sixth");
  });

  it("never re-anchors unless the caller opts in", () => {
    let state = splitSessionPrompt("stable rules.", "memory", null, fullSystem, "first");
    for (let turn = 2; turn <= 20; turn++) {
      state = splitSessionPrompt("stable rules.", "memory", state.receipt, fullSystem, "turn " + turn);
      expect(state.text).toBe("turn " + turn);
    }
  });

  it("counts a legacy receipt without a turn counter from zero", () => {
    const legacy = promptSplitFingerprints("stable rules.", "memory");
    let state = splitSessionPrompt("stable rules.", "memory", legacy, fullSystem, "first", false, 1);
    expect(state.text).toBe("first");
    state = splitSessionPrompt("stable rules.", "memory", state.receipt, fullSystem, "second", false, 1);
    expect(state.text).toBe(fullSystem + "\n\nsecond");
  });
});

describe("splitSessionPrompt by section", () => {
  const memory = { id: "memory", text: "\n\nMemory: likes tea. ".repeat(50) };
  const recent = (line: string) => ({ id: "recent", text: `\n\nRecent work:\n- ${line}` });
  const volatileOf = (sections: Array<{ id: string; text: string }>) => sections.map((section) => section.text).join("");
  const compose = (sections: Array<{ id: string; text: string }>, previous: Parameters<typeof splitSessionPrompt>[2], text: string, perTurn = false) =>
    splitSessionPrompt("stable rules.", volatileOf(sections), previous, "stable rules." + volatileOf(sections), text, perTurn, 0, sections);

  it("re-sends only the section that changed, not the whole memory notebook", () => {
    const first = compose([memory, recent("today 16:40 said hi")], null, "first");
    expect(first.receipt.sections).toEqual({ memory: expect.any(String), recent: expect.any(String) });
    const second = compose([memory, recent("today 17:02 said pong")], first.receipt, "second");
    expect(second.text.startsWith(VOLATILE_SECTIONS_NOTE_PREFIX)).toBe(true);
    expect(second.text).toContain("today 17:02 said pong");
    expect(second.text).not.toContain("likes tea");
    expect(second.text.endsWith("second")).toBe(true);
    const third = compose([memory, recent("today 17:02 said pong")], second.receipt, "third");
    expect(third.text).toBe("third");
  });

  it("says when a section went away", () => {
    const first = compose([memory, recent("x")], null, "first");
    const second = compose([memory], first.receipt, "second");
    expect(second.text).toContain('The earlier "recent" context section no longer applies.');
    expect(second.text).not.toContain("likes tea");
  });

  it("falls back to the whole volatile half on a receipt without section prints", () => {
    const legacy = splitSessionPrompt("stable rules.", volatileOf([memory, recent("x")]), null, "s", "first");
    expect(legacy.receipt.sections).toBeUndefined();
    const next = compose([memory, recent("y")], legacy.receipt, "next");
    expect(next.text).toContain("replaces any earlier copy");
    expect(next.text).toContain("likes tea");
  });

  it("keeps the whole half on a mention turn", () => {
    const first = compose([memory, recent("x")], null, "first");
    const tagged = compose([memory, recent("x")], first.receipt, "tagged", true);
    expect(tagged.text).toContain("likes tea");
  });

  it("survives a receipt round trip", () => {
    const key = randomUUID();
    const first = compose([memory, recent("x")], null, "first");
    writePromptSplitReceipt("test-sections", key, first.receipt);
    expect(readPromptSplitReceipt("test-sections", key)?.sections).toEqual(first.receipt.sections);
    deletePromptSplitReceipt("test-sections", key);
  });
});

describe("volatileSectionsUpdate (only what changed)", () => {
  const memory = { id: "memory", text: "\n\nYour memory:\nlikes tea" };
  const recent = { id: "recent", text: "\n\nRecent work: report (2h ago)" };
  const mentions = { id: "mentions", text: "\n\nThe user tagged @Beta." };
  const held = sectionFingerprints([memory, recent]);

  it("sends only the added or changed sections, and nothing when nothing changed", () => {
    const moved = { id: "recent", text: "\n\nRecent work: report (3h ago)" };
    const note = volatileSectionsUpdate([memory, moved], held)!;
    expect(note.startsWith(VOLATILE_SECTIONS_NOTE_PREFIX)).toBe(true);
    expect(note).toContain("3h ago");
    expect(note).not.toContain("likes tea");
    expect(volatileSectionsUpdate([memory, recent], held)).toBe("");
  });

  it("names a section that went away instead of leaving the old copy standing", () => {
    const note = volatileSectionsUpdate([recent], held)!;
    expect(note).toContain('"memory"');
    expect(note).not.toContain("Recent work");
  });

  it("re-sends the mentions section on a mention turn even when unchanged", () => {
    const withMention = sectionFingerprints([memory, mentions]);
    expect(volatileSectionsUpdate([memory, mentions], withMention)).toBe("");
    const note = volatileSectionsUpdate([memory, mentions], withMention, true)!;
    expect(note).toContain("tagged @Beta");
    expect(note).not.toContain("likes tea");
    // an interrupted call turn re-sends its phone-call section the same way
    const call = { id: "voice-call", text: "\n\nPhone call: interrupted." };
    expect(volatileSectionsUpdate([memory, call], sectionFingerprints([memory, call]), true)).toContain("interrupted");
  });

  it("asks for the whole half when the session's copy is unknown (new process, compaction)", () => {
    expect(volatileSectionsUpdate([memory], undefined)).toBeNull();
    expect(volatileSectionsUpdate(undefined, held)).toBeNull();
  });

  it("describes the same change as a fingerprint delta", () => {
    const now = sectionFingerprints([{ id: "recent", text: "\n\nRecent work: other" }, mentions]);
    expect(sectionDelta(now, held)).toEqual({ recent: now.recent, mentions: now.mentions, memory: null });
    expect(sectionDelta(held, held)).toEqual({});
    const tagged = sectionFingerprints([mentions]);
    expect(sectionDelta(tagged, tagged, true)).toEqual({ mentions: tagged.mentions });
  });
});
