import { describe, expect, it } from "vitest";

import { splitSessionPrompt } from "../drivers/prompt-split.ts";
import { CALL_MARK, ENDED_MARK, INTERRUPTED_MARK, voiceCallTurn } from "../testing/voice-call-turns.ts";
import {
  parseVoiceCallMeta,
  VOICE_CALL_INTERRUPTED_NOTE,
  voiceCallInstruction,
  voiceCallSection,
  voiceCallSteerPrompt,
  voiceCallTurnPrompt,
  VOICE_CALL_CONTINUES_NOTE,
  VOICE_CALL_DELEGATE_LINE,
  VOICE_CALL_TURN_MARK,
} from "./voice-call-prompt.ts";

describe("parseVoiceCallMeta", () => {
  it("accepts a call mark and drops what it does not know", () => {
    expect(parseVoiceCallMeta(undefined)).toBeUndefined();
    expect(parseVoiceCallMeta({ callId: "call-0123456789" })).toEqual({ callId: "call-0123456789" });
    expect(parseVoiceCallMeta({ callId: "call-0123456789", interrupted: true, language: "fr", extra: 1 }))
      .toEqual({ callId: "call-0123456789", interrupted: true, language: "fr" });
    expect(parseVoiceCallMeta({ callId: "call-0123456789", interrupted: false })).toEqual({ callId: "call-0123456789" });
  });

  it("keeps an utterance id, and what was heard only on an interruption", () => {
    expect(parseVoiceCallMeta({ callId: "call-0123456789", utteranceId: "utt-00000001", heard: "  It is  sunny ", unheard: "and warm", continues: true }))
      .toEqual({ callId: "call-0123456789", utteranceId: "utt-00000001", continues: true });
    expect(parseVoiceCallMeta({ callId: "call-0123456789", interrupted: true, heard: "  It is  sunny ", unheard: "and warm" }))
      .toEqual({ callId: "call-0123456789", interrupted: true, heard: "It is sunny", unheard: "and warm" });
    const long = parseVoiceCallMeta({ callId: "call-0123456789", interrupted: true, unheard: "x".repeat(5_000) }) as { unheard: string };
    expect(long.unheard.length).toBeLessThanOrEqual(1_200);
  });

  it("refuses a malformed mark", () => {
    for (const bad of ["call", [], { callId: "no" }, { callId: "call-0123456789", interrupted: "yes" }, { callId: "call-0123456789", language: "auto" }, { callId: "call-0123456789", language: "xx" }, { callId: "call-0123456789", utteranceId: "x" }, { callId: "call-0123456789", heard: 3 }, { callId: "call-0123456789", continues: "yes" }, { callId: "call-0123456789", duplex: "yes" }, { callId: "call-0123456789", speculative: "yes" }]) {
      expect(parseVoiceCallMeta(bad)).toHaveProperty("error");
    }
  });

  it("keeps duplex: true and drops duplex: false", () => {
    expect(parseVoiceCallMeta({ callId: "call-0123456789", duplex: true })).toEqual({ callId: "call-0123456789", duplex: true });
    expect(parseVoiceCallMeta({ callId: "call-0123456789", duplex: false })).toEqual({ callId: "call-0123456789" });
  });

  it("keeps speculative: true and drops speculative: false", () => {
    expect(parseVoiceCallMeta({ callId: "call-0123456789", speculative: true })).toEqual({ callId: "call-0123456789", speculative: true });
    expect(parseVoiceCallMeta({ callId: "call-0123456789", speculative: false })).toEqual({ callId: "call-0123456789" });
  });
});

describe("the phone-call instruction", () => {
  it("tells the bot it is on a call and how to talk", () => {
    const text = voiceCallInstruction("Ada", { callId: "call-0123456789", language: "fr" });
    expect(text).toContain("You are on a live phone call with Ada.");
    expect(text).toContain("transcription errors");
    expect(text).toContain("never mention a transcript, dictation or voice mode");
    expect(text).toContain("put the answer or the verdict in your first sentence");
    expect(text).toContain("one to four in all");
    expect(text).toContain("No markdown, lists, tables, code blocks, emojis, URLs or file paths");
    expect(text).toContain("Never read an identifier aloud");
    expect(text).toContain("in the language of their last message");
    expect(text).toContain("Ask at most one question per turn, and only when you need a real decision");
    expect(text).toContain("say one short sentence in your own words about what you are checking");
    expect(text).toContain("say so in one clear sentence with what they can do next, then stop");
    expect(text).toContain("Québec French or English");
    expect(text).not.toContain("Je regarde");
    expect(text).toContain("Never a stock phrase");
    expect(text).toContain("(their call is set to French)");
    expect(text).toContain("Keep your own persona and instructions");
    // no duplex opener on this call: nothing to "not repeat"
    expect(text).not.toContain("Do not repeat that acknowledgement");
    expect(text).toContain("call end_call");
    expect(text).toContain("Do not start new work after it");
    expect(text).not.toContain(VOICE_CALL_INTERRUPTED_NOTE);
    expect(text).not.toMatch(/[–—]/);
  });

  it("carries the interrupted marker only on an interrupted turn", () => {
    expect(voiceCallInstruction("Ada", { callId: "call-0123456789", interrupted: true })).toContain(VOICE_CALL_INTERRUPTED_NOTE);
  });

  it("names a person signed in by email by the name part", () => {
    expect(voiceCallInstruction("ada@example.com", { callId: "call-0123456789" })).toContain("phone call with ada.");
    expect(voiceCallInstruction(undefined, { callId: "call-0123456789" })).toContain("phone call with the person.");
  });

  it("is a call section on call turns, an ended note once after, nothing otherwise", () => {
    const call = { voiceCall: { callId: "call-0123456789" } };
    expect(voiceCallSection(call, undefined, "Ada")).toContain(CALL_MARK);
    expect(voiceCallSection({}, call, "Ada")).toContain(ENDED_MARK);
    expect(voiceCallSection({}, {}, "Ada")).toBe("");
    expect(voiceCallSection(undefined, undefined, "Ada")).toBe("");
  });

  it("never lists open topics: an ordinary follow-up is not work running in the background", () => {
    const call = { voiceCall: { callId: "call-0123456789" } };
    const text = voiceCallSection(call, undefined, "Ada", [
      { id: "a", label: "weather in Montreal", status: "background" },
      { id: "b", label: "time in Tokyo", status: "active" },
    ]);
    expect(text).not.toContain("Open topics on this call");
    expect(text).not.toContain("still running in the background");
  });

  it("mentions an opener spoken by another model only on a duplex call", () => {
    expect(voiceCallSection({ voiceCall: { callId: "call-0123456789" } }, undefined, "Ada")).not.toContain("A short first sentence");
    expect(voiceCallSection({ voiceCall: { callId: "call-0123456789", duplex: true } }, undefined, "Ada")).toContain("A short first sentence");
  });

  it("marks every call turn's own words, since a live session gets the section only once", () => {
    expect(voiceCallTurnPrompt("hi", undefined)).toBe("hi");
    const marked = voiceCallTurnPrompt("hi", { callId: "call-0123456789" });
    expect(marked.startsWith(VOICE_CALL_TURN_MARK)).toBe(true);
    expect(marked.endsWith("\n\nhi")).toBe(true);
    // an engine command stays a command
    expect(voiceCallTurnPrompt("/compact", { callId: "call-0123456789" })).toBe("/compact");
    expect(voiceCallTurnPrompt("x", { callId: "call-0123456789", continues: true })).toContain(VOICE_CALL_CONTINUES_NOTE);
  });

  it("tells the bot how much of a cut answer the person heard", () => {
    const text = voiceCallTurnPrompt("wait", { callId: "call-0123456789", interrupted: true, heard: "It is sunny in Montreal", unheard: "and it will rain tonight." });
    expect(text).toContain(VOICE_CALL_INTERRUPTED_NOTE);
    expect(text).toContain('They heard up to: "It is sunny in Montreal".');
    expect(text).toContain('They did not hear: "and it will rain tonight."');
    expect(voiceCallInstruction("Ada", { callId: "call-0123456789", interrupted: true, heard: "" , unheard: "all of it" })).toContain("They heard none of it.");
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it("marks words steered into a running turn without storing anything", () => {
    expect(voiceCallSteerPrompt("hi", undefined)).toBe("hi");
    const steered = voiceCallSteerPrompt("hi", { callId: "call-0123456789", interrupted: true });
    expect(steered).toMatch(/^\[Said on the live phone call/);
    expect(steered).toContain(VOICE_CALL_INTERRUPTED_NOTE);
    expect(steered.endsWith("\n\nhi")).toBe(true);
  });
});

describe("voice call turns in the system prompt halves", () => {
  it("rides the volatile half, so the stable prefix and the CLI session stay put", () => {
    const written = voiceCallTurn("written");
    const call = voiceCallTurn("call");
    expect(call.systemStable).toBe(written.systemStable);
    expect(call.systemVolatile).toContain(CALL_MARK);
    expect(call.system).toContain(CALL_MARK);
    expect(written.system).not.toContain(CALL_MARK);
    expect(voiceCallTurn("after").systemVolatile).toContain(ENDED_MARK);
    expect(voiceCallTurn("interrupted")).toMatchObject({ mentionTurn: true });
  });

  // ACP agents and pi share splitSessionPrompt
  it("reaches a session-keeping engine (ACP, pi) only on call turns", () => {
    const turns = (["written", "call", "call", "interrupted", "interrupted", "after", "written"] as const).map(voiceCallTurn);
    let receipt = null;
    const sent: string[] = [];
    for (const [index, turn] of turns.entries()) {
      const next = splitSessionPrompt(turn.systemStable!, turn.systemVolatile!, receipt, turn.system, `words ${index}`, Boolean(turn.mentionTurn));
      receipt = next.receipt;
      sent.push(next.text);
    }
    expect(sent[0]).not.toContain(CALL_MARK);
    expect(sent[1]).toContain(CALL_MARK);
    // unchanged: the session already holds it
    expect(sent[2]).toBe("words 2");
    // an interrupted turn always carries its marker, even twice in a row
    expect(sent[3]).toContain(INTERRUPTED_MARK);
    expect(sent[4]).toContain(INTERRUPTED_MARK);
    expect(sent[5]).toContain(ENDED_MARK);
    expect(sent[5]).not.toContain(CALL_MARK);
    expect(sent[6]).not.toContain(CALL_MARK);
    expect(sent[6]).not.toContain(ENDED_MARK);
    for (const [index, text] of sent.entries()) expect(text.endsWith(`words ${index}`)).toBe(true);
  });
});

describe("handing real work off from a call", () => {
  it("tells the call turn to say it is on it and hand the work to a parallel task", () => {
    const text = voiceCallInstruction("Ada", { callId: "call-12345678" });
    expect(text).toContain(VOICE_CALL_DELEGATE_LINE);
    expect(VOICE_CALL_DELEGATE_LINE).toContain("start_thread with report_back true");
  });
});
