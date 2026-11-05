import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});

import { voiceAccessCardText } from "./VoiceModeBar";

describe("voice access card", () => {
  it("speaks to the person it is about; the organization's key only for an admin", () => {
    expect(voiceAccessCardText({ cause: "no_credentials", admin: false })).toEqual(["Voice mode needs an xAI key. Add one in Settings > Models."]);
    expect(voiceAccessCardText({ cause: "no_credentials", admin: true })).toEqual([
      "Voice mode needs an xAI key. Add one in Settings > Models.",
      "As an admin, you can also set the organization's key in Settings > Connections.",
    ]);
    expect(voiceAccessCardText({ cause: "payer_disabled", admin: true })).toEqual(["Your account is disabled: voice mode can't run."]);
  });
});

import { formatCallTime, phaseLabel } from "./VoiceModeBar";

describe("the call's states, as on a phone", () => {
  it("names every state; hold wins over mute, mute over the rest", () => {
    expect(phaseLabel("connecting", false)).toBe("Connecting");
    expect(phaseLabel("listening", false)).toBe("Listening");
    expect(phaseLabel("hearing", false)).toBe("Listening to you");
    expect(phaseLabel("thinking", false)).toBe("Thinking");
    expect(phaseLabel("speaking", false)).toBe("Speaking");
    expect(phaseLabel("interrupted", false)).toBe("Interrupted");
    expect(phaseLabel("held", true)).toBe("On hold");
    expect(phaseLabel("speaking", true)).toBe("Muted");
  });

  it("shows the call's running time like a phone", () => {
    expect(formatCallTime(0)).toBe("0:00");
    expect(formatCallTime(-5)).toBe("0:00");
    expect(formatCallTime(9_999)).toBe("0:09");
    expect(formatCallTime(83_000)).toBe("1:23");
    expect(formatCallTime(3_723_000)).toBe("1:02:03");
  });
});

describe("the bar's transcript and its card motion", () => {
  const live = [
    readFileSync(new URL("./LiveCall.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("./useLiveCallEngineTurns.ts", import.meta.url), "utf8"),
    readFileSync(new URL("./useLiveCallEngineSession.ts", import.meta.url), "utf8"),
  ].join("\n");
  const bar = readFileSync(new URL("./VoiceModeBar.tsx", import.meta.url), "utf8");

  it("draws the call's lines by the card's rule: a turn sent again whole replaces its early fragment (no duplicate bubble)", () => {
    expect(live).toContain("const lines = callBarLines(messages);");
    expect(live).not.toMatch(/messages\.filter\(\(m\) => m\.kind === "text" && m\.text\?\.trim\(\)\)\.slice\(-8\)/);
  });

  it("speaks no canned filler and no tool chip while the bot works: only a progress line built from the turn's tool events", () => {
    expect(live).not.toContain("prefetchFiller");
    expect(live).not.toContain("toolFillerText");
    expect(live).not.toContain("shouldNarrateToolChip");
    expect(live).not.toContain("tool.spoken");
    expect(live).toContain("No canned filler");
    // the one filler the call says is the planner's line, from turnTools
    expect(live.match(/sayFiller\(/g)).toHaveLength(1);
    expect(live).toContain("if (text) void call.sayFiller(text);");
    expect(live).toContain("tools: turnTools(messagesRef.current),");
    expect(live).toContain("const text = progressText(line, (key, params) => tIn(locale, key, params));");
  });

  it("closing keeps drawing the panel it had while the card folds, out of reach; a card that closes under reduced motion goes at once", () => {
    expect(bar).toMatch(/if \(cardKey !== null\) heldPanel\.current = panel;/);
    expect(bar).toContain("{...cardMotion.exitProps}");
    // the leaving picture of a cross-fade is never drawn when motion is reduced
    expect(bar).toContain("!reducedMotion() ? lastPanel : null");
  });

  it("the card's content keeps its width while its row animates: the scroller is inside the card, the card the reveal shell's one row", () => {
    expect(bar).toMatch(/<div className=\{cn\("relative overflow-hidden", REVEAL_SHELL_CLASS\)\} data-voice-card-motion[^>]*>\s*<div id=\{cardId\} className="overflow-hidden[^"]*" data-voice-card>\s*<div ref=\{scroller\}/);
  });
});
