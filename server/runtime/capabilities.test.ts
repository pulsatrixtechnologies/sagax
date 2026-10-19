// Every engine the server registers must have a capability row, and the
// row must say what the driver really does: the level rule and the
// continuation rule read these flags, never driver names. The expected
// table is written out in full so a change in shared/approval-mode.ts or
// in a driver's resume path is a visible diff here, not a silent shift.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BUILT_IN_DRIVERS } from "../drivers/builtIn.ts";
import { ENGINE_KINDS, engineCapabilities, type EngineCapabilities } from "./capabilities.ts";

const chat: EngineCapabilities = { resume: false, nativeReviewer: false, full: true, edits: false, stepCap: 64, subagents: false };
const bare: EngineCapabilities = { resume: true, nativeReviewer: false, full: false, edits: false, subagents: false };

const EXPECTED: Record<string, EngineCapabilities> = {
  claudeAgent: { resume: true, nativeReviewer: true, full: true, edits: true, subagents: false },
  codex: { resume: true, nativeReviewer: true, full: true, edits: false, subagents: false },
  piAgent: bare,
  antigravityAgent: { resume: true, nativeReviewer: false, full: true, edits: true, subagents: false },
  grokAgent: { resume: true, nativeReviewer: true, full: true, edits: true, subagents: false },
  geminiAgent: { resume: true, nativeReviewer: false, full: true, edits: true, subagents: false },
  kimiAgent: bare,
  droidAgent: bare,
  cursorAgent: { resume: true, nativeReviewer: true, full: true, edits: false, subagents: false },
  museCode: { resume: true, nativeReviewer: false, full: true, edits: false, subagents: false },
  opencodeGo: { resume: true, nativeReviewer: false, full: true, edits: false, subagents: false },
  qwenAgent: { resume: true, nativeReviewer: true, full: true, edits: true, subagents: false },
  hermesAgent: bare,
  clineAgent: { resume: true, nativeReviewer: false, full: true, edits: false, subagents: false },
  customAcp: bare,
  "openai-compat": chat,
  grok: chat,
  minimax: chat,
  mistral: chat,
  cerebras: chat,
  groq: chat,
  meta: chat,
};

describe("engineCapabilities", () => {
  it("has a row for every registered driver, and no row without a driver", () => {
    const registered = BUILT_IN_DRIVERS.map((driver) => driver.driverKind);
    expect(registered.length).toBeGreaterThan(0);
    for (const kind of registered) {
      expect(ENGINE_KINDS, `${kind} is registered in server/drivers/builtIn.ts but has no row in server/runtime/capabilities.ts`).toContain(kind);
      expect(Object.hasOwn(EXPECTED, kind), `${kind} is registered but this test has no expected row for it`).toBe(true);
    }
    for (const kind of ENGINE_KINDS) expect(registered, `${kind} has a capability row but no registered driver`).toContain(kind);
  });

  it.each(Object.entries(EXPECTED))("%s", (kind, expected) => {
    expect(engineCapabilities(kind)).toEqual(expected);
  });

  it("answers conservatively for an unknown or absent engine", () => {
    const none: EngineCapabilities = { resume: false, nativeReviewer: false, full: false, edits: false, subagents: false };
    expect(engineCapabilities(undefined)).toEqual(none);
    expect(engineCapabilities("someFutureEngine")).toEqual(none);
    // a prototype name is not an engine
    expect(engineCapabilities("constructor")).toEqual(none);
    expect(engineCapabilities("__proto__")).toEqual(none);
  });

  it("gives no engine subagents today", () => {
    for (const kind of ENGINE_KINDS) expect(engineCapabilities(kind).subagents).toBe(false);
  });

  it("leaves stepCap off engines that bound their own turns", () => {
    for (const kind of ENGINE_KINDS) {
      const caps = engineCapabilities(kind);
      if (caps.resume) expect("stepCap" in caps, `${kind} keeps a native session and needs no step cap`).toBe(false);
      else expect(caps.stepCap, `${kind} replays the transcript and needs the chat family's cap`).toBe(64);
    }
  });

  it("keeps the chat family's step cap equal to MAX_CHAT_ROUNDS in openai-chat.ts", () => {
    const source = readFileSync(new URL("../drivers/openai-chat.ts", import.meta.url), "utf8");
    const found = /^const MAX_CHAT_ROUNDS = (\d+);/m.exec(source);
    expect(found, "MAX_CHAT_ROUNDS moved or was renamed; update server/runtime/capabilities.ts").not.toBeNull();
    expect(engineCapabilities("openai-compat").stepCap).toBe(Number(found![1]));
  });
});
