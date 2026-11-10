// The runner of every tailcat call (#3430). `tailcat ssh` replaces itself
// with ssh, which keeps a tailcat ProxyCommand child; `tailcat cp` keeps scp
// as a child. A call stopped at its time limit, or because its session
// closed, must free its tunnel's queue even if it ignores SIGTERM, and leave
// no process behind. Real processes, POSIX only.
import { describe, expect, it } from "vitest";

import { createRunCommand } from "./remote-session-probe.ts";

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

// A parent and a child that both ignore SIGTERM; the parent prints the child's pid.
const STUBBORN = ["/bin/sh", "-c", "trap '' TERM; /bin/sh -c \"trap '' TERM; sleep 30\" & echo $!; wait"];

describe.skipIf(process.platform === "win32")("tailcat call runner", () => {
  it("stops a call that ignores SIGTERM at its time limit, frees the slot, and leaves no child behind", async () => {
    const run = createRunCommand({ killGraceMs: 150, releaseMs: 150 });
    const started = Date.now();
    const out = await run(STUBBORN, 200);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(out.timedOut).toBe(true);
    const child = Number(out.stdout.trim());
    expect(child).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(child)).toBe(false);
  });

  it("stops a call when its session closes and answers 255: it may have run", async () => {
    const run = createRunCommand({ killGraceMs: 150, releaseMs: 150 });
    const abort = new AbortController();
    const pending = run(STUBBORN, 30_000, { signal: abort.signal });
    await new Promise((resolve) => setTimeout(resolve, 150));
    abort.abort();
    const out = await pending;
    expect(out.code).toBe(255);
    expect(out.timedOut).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(Number(out.stdout.trim()))).toBe(false);
  });

  it("gives back the exit code and output of a call that ends by itself", async () => {
    const run = createRunCommand();
    expect(await run(["/bin/sh", "-c", "printf hi; printf oops >&2; exit 3"], 5_000)).toEqual({ code: 3, stdout: "hi", stderr: "oops" });
  });
});
