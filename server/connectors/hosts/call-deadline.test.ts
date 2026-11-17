import { afterEach, describe, expect, it, vi } from "vitest";
import { connectorCallDeadline } from "./call-deadline.ts";

afterEach(() => vi.useRealTimers());
describe("connector call budget", () => {
  it("gives reads 30 seconds and other calls 90 seconds", () => {
    expect(connectorCallDeadline("github.search_issues").timeoutMs).toBe(30_000);
    expect(connectorCallDeadline("mail.send_email").timeoutMs).toBe(90_000);
    expect(connectorCallDeadline("github.search_issues", 100).timeoutMs).toBe(100);
  });
  it("expires while queued and refuses a delayed start", async () => {
    vi.useFakeTimers();
    const deadline = connectorCallDeadline("search_issues", 100);
    let start!: () => void;
    const called = vi.fn();
    const result = deadline.run(() => new Promise<void>((resolve, reject) => {
      start = () => { try { deadline.remaining(); called(); resolve(); } catch (error) { reject(error); } };
    }));
    const rejected = expect(result).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    start();
    expect(called).not.toHaveBeenCalled();
  });
  it("subtracts queueing from the remaining upstream budget", async () => {
    vi.useFakeTimers();
    const deadline = connectorCallDeadline("search_issues", 100);
    await vi.advanceTimersByTimeAsync(40);
    expect(deadline.remaining()).toBe(60);
    await expect(deadline.run(async () => "ok")).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });
});
