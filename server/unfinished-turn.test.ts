// 2026-11-02: a person's turn that ends on "I'll do X" with no tool call
// after it, or on tool calls with nothing said, is continued once.
import { describe, expect, it } from "vitest";

import { createUnfinishedTurnGuard, decideUnfinishedTurn, endsWithAnnouncement, unfinishedTurnKind, unfinishedTurnPrompt, type UnfinishedTurnContext } from "./unfinished-turn.ts";

type Row = Parameters<typeof unfinishedTurnKind>[0][number];
const text = (value: string): Row => ({ role: "bot", kind: "text", text: value });
const tool = (name: string, ok = true): Row => ({ role: "bot", kind: "activity", tool: { name, ok } } as Row);
const person: UnfinishedTurnContext = { ok: true, stopped: false, automated: false, voiceCall: false, relaunches: false, wasContinuation: false };

describe("unfinishedTurnKind", () => {
  it("the 2026-11-01 press: an announcement, tools, then nothing", () => {
    expect(unfinishedTurnKind([
      text("You pressed Open the routine board. I'll find the draft from earlier tonight and open that page."),
      tool("session_search"), tool("workspace_read"), tool("sagax_help"), tool("use_tool", false), tool("session_read"),
    ])).toBe("after_tools");
  });

  it("an announcement with no tool call after it", () => {
    expect(unfinishedTurnKind([text("Je vais regarder le brouillon et ouvrir la page.")])).toBe("announced");
    expect(unfinishedTurnKind([tool("session_search"), text("Got it. Let me check the run log.")])).toBe("announced");
  });

  it("never fires on a question to the person, an answer, a card, or after a closing message", () => {
    expect(unfinishedTurnKind([text("I'll open it. Do you want the draft or the published one?")])).toBeNull();
    expect(unfinishedTurnKind([text("Done: 18 of 30 routines are on. Let me know if you want changes.")])).toBeNull();
    expect(unfinishedTurnKind([text("I'll be here if you need anything.")])).toBeNull();
    expect(unfinishedTurnKind([text("Je vais rester disponible.")])).toBeNull();
    expect(unfinishedTurnKind([text("I'll check."), tool("session_search"), text("The draft is in Routines, under Fleet.")])).toBeNull();
    expect(unfinishedTurnKind([text("Which one should I open?"), tool("session_search")])).toBeNull();
    expect(unfinishedTurnKind([text("I'll show you the options."), tool("show_widget"), { role: "bot", kind: "widget", text: "pick" } as Row])).toBeNull();
    expect(unfinishedTurnKind([text("Here is the summary.")])).toBeNull();
    expect(unfinishedTurnKind([])).toBeNull();
  });

  it("leaves a failure streak to the loop guard", () => {
    expect(unfinishedTurnKind([text("Let me run it."), tool("run_command", false), tool("run_command", false), tool("run_command", false)])).toBeNull();
  });
});

describe("decideUnfinishedTurn", () => {
  const rows = [text("I'll open the routine board.")];
  it("continues a person's finished turn, and nothing else", () => {
    expect(decideUnfinishedTurn(rows, person)).toBe("announced");
    for (const patch of [{ ok: false }, { stopped: true }, { automated: true }, { voiceCall: true }, { relaunches: true }, { wasContinuation: true }]) {
      expect(decideUnfinishedTurn(rows, { ...person, ...patch })).toBeNull();
    }
  });

  it("once per person's message: the continued turn is never continued again", () => {
    const guard = createUnfinishedTurnGuard();
    expect(guard.continued("t1", "u1")).toBe(false);
    guard.mark("t1", "u1");
    expect(guard.continued("t1", "u1")).toBe(true);
    expect(decideUnfinishedTurn(rows, { ...person, wasContinuation: guard.continued("t1", "u1") })).toBeNull();
    // the person writes again: a new message may be continued once more
    expect(guard.continued("t1", "u2")).toBe(false);
  });

  it("the note asks to act now or say plainly it cannot, without announcing again", () => {
    expect(unfinishedTurnPrompt("announced")).toMatch(/Do it now.*say so plainly.*Do not announce it again/s);
    expect(unfinishedTurnPrompt("after_tools")).toContain("without a word to the person");
  });
});

describe("endsWithAnnouncement", () => {
  it("reads the last sentence only", () => {
    expect(endsWithAnnouncement("Here is the list.\n\n**I'll open the board now.**")).toBe(true);
    expect(endsWithAnnouncement("I'll open the board. Done, it is open.")).toBe(false);
    expect(endsWithAnnouncement("Laisse-moi vérifier.")).toBe(true);
  });
});
