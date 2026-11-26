import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mascotColorsIn } from "../../shared/mascot-colors";
import { describe, expect, it } from "vitest";

import { AGENT_STATES, agentStateForBot, MAUS_COLORS, MAUS_COLOR_NAMES, mausInk, stateForBot, swatchStyle } from "./mascot";

describe("stateForBot", () => {
  it("still alerts on a failed tool call when a digest receipt follows it", () => {
    // Phase 0 writes a digest row after every turn, so the failed chip is
    // no longer the last row; the mood must read past the receipt.
    expect(stateForBot({
      name: "Atlas",
      messages: [
        { kind: "activity", tool: { ok: false } },
        { kind: "digest" },
      ],
    })).toBe("alerting");
  });

  it("keeps reading a pending card as curious behind a receipt", () => {
    expect(stateForBot({ name: "Atlas", messages: [{ kind: "options" }, { kind: "digest" }] })).toBe("curious");
  });

  it("still alerts on a failed tool call when a live call's record follows it", () => {
    // hanging up leaves the call's record as the chat's last row, often right
    // after a turn that failed; the mood reads past it like past a receipt
    expect(stateForBot({
      name: "Atlas",
      messages: [
        { kind: "activity", tool: { ok: false } },
        { kind: "call" },
      ],
    })).toBe("alerting");
    expect(stateForBot({
      name: "Atlas",
      messages: [
        { kind: "activity", tool: { ok: false } },
        { kind: "digest" },
        { kind: "call" },
      ],
    })).toBe("alerting");
  });

  it("keeps reading a pending card as curious behind a live call's record", () => {
    expect(stateForBot({ name: "Atlas", messages: [{ kind: "options" }, { kind: "call" }] })).toBe("curious");
  });
});

describe("black bot color", () => {
  it("is a palette color with its own value, distinct from the others", () => {
    expect(MAUS_COLOR_NAMES).toContain("black");
    const values = MAUS_COLOR_NAMES.map((name) => MAUS_COLORS[name].toLowerCase());
    expect(new Set(values).size).toBe(values.length);
  });

  it("reads as a slate when used as text or a tint, so it never vanishes on a dark theme", () => {
    expect(mausInk("black")).not.toBe(MAUS_COLORS.black);
    expect(mausInk("green")).toBe(MAUS_COLORS.green);
    expect(mausInk("chartreuse")).toBeUndefined();
    expect(mausInk(undefined)).toBeUndefined();
  });

  it("outlines only the black swatch", () => {
    expect(swatchStyle("black").boxShadow).toContain("inset");
    expect(swatchStyle("green")).toEqual({ backgroundColor: MAUS_COLORS.green });
  });
});

describe("iOS MausPalette", () => {
  // The phone's colour table (`MausColors.hex` in
  // ios/Sources/CompanionCore/MascotLook.swift), checked against MAUS_COLORS.
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "../../ios/Sources/CompanionCore/MascotLook.swift"), "utf8");
  const swift = source.slice(source.indexOf("public enum MausColors"), source.indexOf("public static let ink"));
  const table = Object.fromEntries(
    [...swift.matchAll(/^\s*"([a-z]+)": "(#[0-9A-Fa-f]{6})",$/gm)].map((m) => [m[1], m[2]]),
  );

  it("carries brown, amber and grey with the desktop values", () => {
    expect(table.brown).toBe(MAUS_COLORS.brown);
    expect(table.amber).toBe(MAUS_COLORS.amber);
    expect(table.grey).toBe(MAUS_COLORS.grey);
  });

  it("carries every desktop colour (the Shapes-only Clay palette waits for the phone's Shapes port)", () => {
    const clay = new Set<string>(mascotColorsIn("clay"));
    for (const name of Object.keys(MAUS_COLORS)) if (!clay.has(name)) expect(table[name], name).toBeDefined();
  });

  it("has no colour that drifts from the desktop, apart from the phone's own black", () => {
    for (const [name, hex] of Object.entries(table)) {
      if (name === "black") continue;
      expect(hex, name).toBe(MAUS_COLORS[name as keyof typeof MAUS_COLORS]);
    }
  });
});

// The engine's six agent states from what the bot really does (#5349, #5276).
describe("agentStateForBot", () => {
  const bot = { name: "Atlas" };

  it("rests when nothing is happening, whatever the bot is about", () => {
    expect(agentStateForBot(bot)).toBe("idle");
    // a bot about code rests on its working face (stateForBot), but it is not working
    expect(stateForBot({ name: "Atlas", title: "Developer" })).toBe("working");
    expect(agentStateForBot({ name: "Atlas", title: "Developer" })).toBe("idle");
  });

  it("never takes a state from a face the person pinned", () => {
    for (const pinned of ["working", "thinking", "happy", "curious"]) expect(agentStateForBot({ ...bot, mascotExpression: pinned })).toBe("idle");
    expect(agentStateForBot({ ...bot, mascotExpression: "sleeping", busy: true })).toBe("thinking");
  });

  it("thinks while a turn runs and nothing has come out, works once a step is on screen", () => {
    expect(agentStateForBot({ ...bot, busy: true })).toBe("thinking");
    expect(agentStateForBot({ ...bot, busy: true, messages: [{ kind: "text" }] })).toBe("thinking");
    expect(agentStateForBot({ ...bot, busy: true, messages: [{ kind: "text" }, { kind: "activity", tool: { ok: true } }] })).toBe("working");
    expect(agentStateForBot({ ...bot, busy: true, messages: [{ kind: "activity" }, { kind: "digest" }] })).toBe("working");
    expect(agentStateForBot({ ...bot, activity: "working" })).toBe("thinking");
  });

  it("waits while a card waits for the person, before anything else", () => {
    expect(agentStateForBot({ ...bot, activity: "waiting-on-you", busy: true })).toBe("waiting");
    expect(agentStateForBot({ ...bot, busy: true, tasks: [{ activity: "waiting-on-you" }] })).toBe("waiting");
    expect(agentStateForBot({ ...bot, messages: [{ kind: "options" }, { kind: "digest" }] })).toBe("waiting");
    expect(agentStateForBot({ ...bot, activity: "waiting-on-you", messages: [{ kind: "activity", tool: { ok: false } }] })).toBe("waiting");
  });

  it("is blocked on a failed step, as the owl alerts", () => {
    const failed = { ...bot, messages: [{ kind: "activity", tool: { ok: false } }, { kind: "digest" }] };
    expect(stateForBot(failed)).toBe("alerting");
    expect(agentStateForBot(failed)).toBe("blocked");
    expect(agentStateForBot({ ...failed, busy: true })).toBe("blocked");
  });

  it("is done when a finished turn waits to be read", () => {
    expect(stateForBot({ ...bot, unread: true })).toBe("notifying");
    expect(agentStateForBot({ ...bot, unread: true })).toBe("done");
    expect(agentStateForBot({ ...bot, unread: true, busy: true })).toBe("thinking");
  });

  it("covers the engine's six states and no other", () => {
    expect([...AGENT_STATES]).toEqual(["idle", "thinking", "working", "waiting", "blocked", "done"]);
  });
});
