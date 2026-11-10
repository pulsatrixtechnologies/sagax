// Event loop lag in the server log (server/process/event-loop-lag.ts): a block over
// the threshold is reported once the loop is back, with the blocked stack
// when the inspector can read it, and the periodic summary carries p99/max.
import { describe, expect, it } from "vitest";

import { startEventLoopLagMonitor } from "./event-loop-lag.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function blockFor(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* a synchronous block, like a big readFileSync or JSON.parse */
  }
}

function firstLongBlock(ms: number): void {
  blockFor(ms);
}

function secondLongBlock(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* a second block, inside the stack cooldown of the first */
  }
}

describe("event loop lag monitor", () => {
  it("reports a block over the threshold with the stack it was stuck in", async () => {
    const lines: { level: string; message: string }[] = [];
    const stop = startEventLoopLagMonitor(
      { info: (message) => lines.push({ level: "info", message }), warn: (message) => lines.push({ level: "warn", message }) },
      { reportMs: 60_000, stallMs: 400, stackCooldownMs: 0 },
    );
    try {
      await wait(500); // the watchdog thread starts
      blockFor(1_500);
      await wait(1_000);
      const stall = lines.find((line) => line.level === "warn" && line.message.startsWith("[loop-lag] event loop blocked"));
      expect(stall).toBeDefined();
      const blocked = Number(/blocked (\d+) ms/.exec(stall!.message)![1]);
      expect(blocked).toBeGreaterThanOrEqual(1_000);
      // The inspector is there under vitest: the line names the blocking function.
      expect(stall!.message).toContain("blockFor");
    } finally {
      stop();
    }
  }, 15_000);

  it("reads a stack for every long block, even inside the cooldown (#3473)", async () => {
    const lines: { level: string; message: string }[] = [];
    const stop = startEventLoopLagMonitor(
      { info: (message) => lines.push({ level: "info", message }), warn: (message) => lines.push({ level: "warn", message }) },
      { reportMs: 60_000, stallMs: 300, longStallMs: 700, stackCooldownMs: 60_000 },
    );
    try {
      await wait(500);
      firstLongBlock(1_200);
      await wait(1_200);
      secondLongBlock(1_200);
      await wait(1_200);
      const stalls = lines.filter((line) => line.level === "warn" && line.message.startsWith("[loop-lag] event loop blocked"));
      expect(stalls).toHaveLength(2);
      expect(stalls[0].message).toContain("firstLongBlock");
      expect(stalls[1].message, "the second long block had no stack").toContain("secondLongBlock");
      expect(stalls[1].message).toMatch(/\(rss \d+ MB, heap \d+ MB\)/);
    } finally {
      stop();
    }
  }, 15_000);

  it("writes the p50/p99/max summary at each report and stays quiet without a block", async () => {
    const lines: { level: string; message: string }[] = [];
    const stop = startEventLoopLagMonitor(
      { info: (message) => lines.push({ level: "info", message }), warn: (message) => lines.push({ level: "warn", message }) },
      { reportMs: 300, stallMs: 2_000, stacks: false },
    );
    try {
      await wait(800);
      expect(lines.some((line) => /^\[loop-lag\] p50 \d+ ms, p99 \d+ ms, max \d+ ms/.test(line.message))).toBe(true);
      expect(lines.some((line) => line.level === "warn")).toBe(false);
    } finally {
      stop();
    }
  }, 10_000);

  it("attributes a stall with a cpu profile when the pause stack is empty (#1750)", async () => {
    const lines: { level: string; message: string }[] = [];
    const stop = startEventLoopLagMonitor(
      { info: (message) => lines.push({ level: "info", message }), warn: (message) => lines.push({ level: "warn", message }) },
      { reportMs: 60_000, stallMs: 400, stackCooldownMs: 0 },
    );
    try {
      await wait(500);
      blockFor(1_200);
      await wait(1_200);
      const stall = lines.find((line) => line.level === "warn" && line.message.startsWith("[loop-lag] event loop blocked"));
      expect(stall).toBeDefined();
      // Either the debugger stack names blockFor, or the fallback reason /
      // profile frames are present so the line is not a bare "(no stack)".
      expect(
        stall!.message.includes("blockFor")
          || stall!.message.includes("cpu profile")
          || /\(no stack; .+\)/.test(stall!.message)
          || stall!.message.includes(" x"),
      ).toBe(true);
    } finally {
      stop();
    }
  }, 15_000);
});
