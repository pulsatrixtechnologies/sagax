// The tunnel's queue (#3430) and the short wait of a tunnel probe (#3505).
import { describe, expect, it } from "vitest";

import type { CommandResult, RunCommand } from "./remote-session-probe.ts";
import { createTunnelQueue, TUNNEL_PROBE_WAIT_MAX_MS, TUNNEL_QUEUE_WAIT_MAX_MS } from "./tunnel-queue.ts";

const KEY = "/keys/session-1";

function held() {
  const spawned: string[] = [];
  const releases: Array<() => void> = [];
  const run: RunCommand = (argv) => new Promise<CommandResult>((resolve) => {
    spawned.push(argv.join(" "));
    releases.push(() => resolve({ code: 0, stdout: "", stderr: "" }));
  });
  return { run, spawned, release: () => releases.shift()?.() };
}

describe("tunnel queue", () => {
  it("a call with its own short wait is refused busy after that wait, never sent, while the others keep the long one (#3505)", async () => {
    const { run, spawned, release } = held();
    const queue = createTunnelQueue({ run, waitMaxMs: 5_000 });
    const build = queue.submit(KEY, ["make", "build"], 1_000);
    const next = queue.submit(KEY, ["make", "test"], 1_000);
    const started = Date.now();
    const ping = await queue.submit(KEY, ["ping"], 1_000, () => true, 30);
    expect(ping).toEqual({ notSent: "busy" });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(spawned).toEqual(["make build"]);
    // the command that waited before the ping still gets its turn
    release();
    await build;
    await expect.poll(() => spawned).toEqual(["make build", "make test"]);
    release();
    expect(await next).toMatchObject({ code: 0 });
    expect(spawned).not.toContain("ping");
  });

  it("a call's own wait never passes the queue's", async () => {
    const { run, release } = held();
    const queue = createTunnelQueue({ run, waitMaxMs: 30 });
    const build = queue.submit(KEY, ["make", "build"], 1_000);
    const started = Date.now();
    expect(await queue.submit(KEY, ["ping"], 1_000, () => true, 60_000)).toEqual({ notSent: "busy" });
    expect(Date.now() - started).toBeLessThan(2_000);
    release();
    await build;
  });

  it("a free tunnel runs the short-wait call at once", async () => {
    const { run, spawned, release } = held();
    const queue = createTunnelQueue({ run });
    const ping = queue.submit(KEY, ["ping"], 1_000, () => true, 30);
    await expect.poll(() => spawned).toEqual(["ping"]);
    release();
    expect(await ping).toMatchObject({ code: 0 });
  });

  it("the probe's wait is a few seconds, far under a command's", () => {
    expect(TUNNEL_PROBE_WAIT_MAX_MS).toBeLessThanOrEqual(10_000);
    expect(TUNNEL_PROBE_WAIT_MAX_MS).toBeLessThan(TUNNEL_QUEUE_WAIT_MAX_MS / 10);
  });
});
