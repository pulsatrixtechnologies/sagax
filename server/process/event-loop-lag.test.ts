// Event loop lag in the server log (server/process/event-loop-lag.ts): a block over
// the threshold is reported once the loop is back, with what ran during it
// (#3629: the sampled window, else the stack after it), and the periodic
// summary carries p99/max.
import { describe, expect, it } from "vitest";

import { gcWithin, LONG_STALL_MS, ranDuring, STALL_MS, startEventLoopLagMonitor } from "./event-loop-lag.ts";

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
});

// Functions of their own for the #3524 test: code made hot under an earlier
// monitor (whose profiler is gone) is sampled as its caller once inlined. A
// server keeps one profiler up from its start, so this is the tests' own
// doing (#3629).
function thirdLongBlock(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* a block with the default thresholds */
  }
}

function fourthLongBlock(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* a second one, inside the cooldown of the first */
  }
}

describe("event loop lag monitor from one second (#3524)", () => {
  it("reads a stack for every block of one second or more, with the default thresholds", async () => {
    expect(STALL_MS).toBe(1_000);
    expect(LONG_STALL_MS).toBe(STALL_MS);
    const lines: { level: string; message: string }[] = [];
    // default stallMs and longStallMs; a cooldown that would hide the second stack
    const stop = startEventLoopLagMonitor(
      { info: (message) => lines.push({ level: "info", message }), warn: (message) => lines.push({ level: "warn", message }) },
      { reportMs: 60_000, stackCooldownMs: 60_000 },
    );
    try {
      await wait(500);
      thirdLongBlock(1_500);
      await wait(1_200);
      fourthLongBlock(1_500);
      await wait(1_200);
      const stalls = lines.filter((line) => line.level === "warn" && line.message.startsWith("[loop-lag] event loop blocked"));
      expect(stalls).toHaveLength(2);
      expect(stalls[0].message).toContain("thirdLongBlock");
      expect(stalls[1].message, "a block under two seconds inside the cooldown had no stack").toContain("fourthLongBlock");
    } finally {
      stop();
    }
  }, 20_000);

  it("counts the garbage collection time inside a block, the major share apart", () => {
    const spans = [
      { start: 100, duration: 50, kind: "minor" },
      { start: 1_000, duration: 1_200, kind: "major" },
      { start: 5_000, duration: 10, kind: "major" },
    ];
    expect(gcWithin(spans, 900, 2_500)).toEqual({ total: 1_200, major: 1_200 });
    expect(gcWithin(spans, 0, 1_100)).toEqual({ total: 150, major: 100 });
    expect(gcWithin(spans, 3_000, 4_000)).toEqual({ total: 0, major: 0 });
  });
});

function stopperOfTheLoop(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* the function that does the work of the stop */
  }
}

function enteredAfterTheStop(): number {
  // the first function entered once the loop is back: a pause landed here
  let n = 0;
  const end = Date.now() + 40;
  while (Date.now() < end) n += JSON.stringify({ n }).length;
  return n;
}

function firstHalfOfTheStop(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* one part of a stop */
  }
}

function secondHalfOfTheStop(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* the other part */
  }
}

const shareOf = (line: string, name: string): number => {
  const match = new RegExp(`${name} [^ ,;]+ (\\d+)%`).exec(line);
  return match ? Number(match[1]) : 0;
};

describe("a stall line names what ran during the stop (#3629)", () => {
  const stallsOf = (lines: { level: string; message: string }[]) =>
    lines.filter((line) => line.level === "warn" && line.message.startsWith("[loop-lag] event loop blocked"));

  it("names the function that stopped the loop first, with its share, not the one entered after", async () => {
    const lines: { level: string; message: string }[] = [];
    const windows: string[] = [];
    const stop = startEventLoopLagMonitor(
      { info: (message) => lines.push({ level: "info", message }), warn: (message) => lines.push({ level: "warn", message }) },
      { reportMs: 60_000, onWindow: (event) => windows.push(event) },
    );
    try {
      await wait(600); // the watchdog starts the first window, the main thread takes the next ones
      stopperOfTheLoop(1_200);
      setTimeout(enteredAfterTheStop, 0);
      await wait(1_500);
      const stalls = stallsOf(lines);
      expect(stalls).toHaveLength(1);
      const line = stalls[0].message;
      expect(line).toContain("; ran during the block (");
      const named = /ran during the block \(\d+ samples every \d+ ms\): ([^;]+)/.exec(line)![1].split(", ");
      expect(named.length).toBeLessThanOrEqual(8);
      expect(named[0]).toMatch(/^stopperOfTheLoop event-loop-lag\.test\.ts:\d+ \d+%$/);
      expect(shareOf(line, "stopperOfTheLoop"), line).toBeGreaterThan(80);
      expect(line).not.toContain("enteredAfterTheStop");
      // the heaviest stack: innermost frame first, the file without its folder, no column
      expect(line).toMatch(/heaviest stack:\n {2}stopperOfTheLoop event-loop-lag\.test\.ts:\d+\n/);
      expect(line).not.toContain("/process/");
      expect(windows).toContain("read");
    } finally {
      stop();
    }
  }, 15_000);

  it("gives both functions of a stop made of two, each with its share", async () => {
    const lines: { level: string; message: string }[] = [];
    const stop = startEventLoopLagMonitor(
      { info: (message) => lines.push({ level: "info", message }), warn: (message) => lines.push({ level: "warn", message }) },
      { reportMs: 60_000 },
    );
    try {
      await wait(600);
      firstHalfOfTheStop(800);
      secondHalfOfTheStop(500);
      await wait(1_500);
      const stalls = stallsOf(lines);
      expect(stalls).toHaveLength(1);
      const first = shareOf(stalls[0].message, "firstHalfOfTheStop");
      const second = shareOf(stalls[0].message, "secondHalfOfTheStop");
      expect(first, stalls[0].message).toBeGreaterThan(45);
      expect(second).toBeGreaterThan(25);
      expect(first).toBeGreaterThan(second);
      expect(first + second, stalls[0].message).toBeGreaterThan(85);
    } finally {
      stop();
    }
  }, 15_000);

  it("drops quiet windows unread and logs nothing more than the summary", async () => {
    const lines: { level: string; message: string }[] = [];
    const windows: string[] = [];
    const stop = startEventLoopLagMonitor(
      { info: (message) => lines.push({ level: "info", message }), warn: (message) => lines.push({ level: "warn", message }) },
      { reportMs: 60_000, windowMs: 300, onWindow: (event) => windows.push(event) },
    );
    try {
      await wait(2_000);
      expect(windows.filter((event) => event === "dropped").length).toBeGreaterThanOrEqual(3);
      expect(windows).not.toContain("read");
      expect(lines).toEqual([]);
    } finally {
      stop();
    }
  }, 10_000);

  it("falls back to the stack after the block when the profiler does not start", async () => {
    const lines: { level: string; message: string }[] = [];
    const stop = startEventLoopLagMonitor(
      { info: (message) => lines.push({ level: "info", message }), warn: (message) => lines.push({ level: "warn", message }) },
      { reportMs: 60_000, stallMs: 400, stackCooldownMs: 0, sampling: false },
    );
    try {
      await wait(500);
      blockFor(1_200);
      await wait(1_200);
      const stall = stallsOf(lines)[0];
      expect(stall).toBeDefined();
      expect(stall.message).not.toContain("ran during the block");
      expect(stall.message).toMatch(/; stack after the block:\n {2}\S|\(no stack; .+\)/);
    } finally {
      stop();
    }
  }, 15_000);

  it("cuts a window to the stopped stretch, across two windows, with the clocks apart", () => {
    // the profile clock runs 5 s ahead of hrtime; samples every 10 ms
    const node = (id: number, functionName: string, children: number[] = [], url = "file:///srv/app/server/work.js", lineNumber = 9) =>
      ({ id, callFrame: { functionName, url, lineNumber }, children });
    const nodes = [node(1, "(root)", [2, 4, 5], ""), node(2, "outer", [3]), node(3, "inner"), node(4, "(idle)", [], ""), node(5, "(program)", [], "")];
    const window = (startHr: number, samples: number[]) => ({
      profile: { nodes, startTime: startHr + 5_000_000, endTime: startHr + 5_000_000 + samples.length * 10_000, samples, timeDeltas: samples.map(() => 10_000) },
      startHr,
      endHr: startHr + samples.length * 10_000,
    });
    const first = window(0, [4, 4, 3, 3, 3]); // idle until 20 ms, then inner
    const second = window(50_000, [3, 2, 4, 5]); // inner, outer, idle, then (program)
    const ran = ranDuring([first, second], 15_000, 75_000, 8, 25)!; // the idle sample at 20 ms is left out
    expect(ran.samples).toBe(5);
    expect(ran.top).toEqual(["inner work.js:10 80%", "outer work.js:10 20%"]);
    expect(ran.stack).toEqual(["inner work.js:10", "outer work.js:10"]);
    expect(ranDuring([first], 100_000, 200_000, 8, 25)).toBeNull();
  });
});
