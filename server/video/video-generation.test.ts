import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoGenerations, type VideoGenerationDeps, type VideoScope } from "./video-generation.ts";
import { VideoProviderError, videoGenerationSchema } from "./video-provider.ts";

const scope: VideoScope = { botId: "bot", threadId: "thread", principalId: "alice" };
const input = videoGenerationSchema.parse({ prompt: "Synthetic rain", duration: 3 });
const dirs: string[] = []; const managers: VideoGenerations[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.close())); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup(overrides: Partial<VideoGenerationDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "video-jobs-")); dirs.push(dir);
  const deps: VideoGenerationDeps = {
    dir, provider: { submit: vi.fn(async () => "request-1"), poll: vi.fn(async () => ({ status: "done" as const, progress: 100, video: { url: "https://example.test/video.mp4", respect_moderation: true }, usage: { cost_in_usd_ticks: 123 } })) },
    credential: vi.fn(async () => ({ key: "synthetic-key", payer: "personal" as const })), valid: () => true,
    save: vi.fn(async (_url, job) => ({ path: `/synthetic/${job.id}.mp4`, name: "Generated video.mp4", mime: "video/mp4" as const, bytes: 120 })),
    publish: vi.fn(job => `/api/threads/thread/files/${job.id}`), pollMs: 2, timeoutMs: 5_000, ...overrides,
  };
  const manager = new VideoGenerations(deps); managers.push(manager); return { manager, deps, dir };
}
async function waitStatus(m: VideoGenerations, id: string, status: string) { await vi.waitFor(() => expect(m.status(scope, id).status).toBe(status), { timeout: 3_000, interval: 5 }); }
describe("durable video lifecycle", () => {
  it("deduplicates concurrent generation, exposes progress and publishes a durable file once", async () => {
    let done = false;
    const { manager, deps, dir } = setup({ provider: { submit: vi.fn(async () => "request-1"), poll: vi.fn(async () => done ? { status: "done" as const, video: { url: "https://example.test/private-signed-url", respect_moderation: true }, usage: { cost_in_usd_ticks: 123 } } : { status: "pending" as const, progress: 35 }) } });
    const [a, b] = await Promise.all([manager.generate(scope, input, "stable"), manager.generate(scope, input, "stable")]);
    expect(a.job_id).toBe(b.job_id); expect(deps.provider.submit).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(manager.status(scope, a.job_id).progress).toBe(35));
    done = true; await waitStatus(manager, a.job_id, "completed");
    expect(manager.status(scope, a.job_id)).toMatchObject({ attached: true, payer: "personal" as const, usage: { cost_in_usd_ticks: 123 }, attachment: { bytes: 120 } });
    expect(deps.publish).toHaveBeenCalledTimes(1); expect(deps.save).toHaveBeenCalledTimes(1);
    expect((deps.credential as ReturnType<typeof vi.fn>).mock.calls.some(call => call[1] === "personal")).toBe(true);
    const journal = readdirSync(dir).map(name => readFileSync(join(dir, name), "utf8")).join();
    for (const sensitive of ["Synthetic rain", "synthetic-key", "private-signed-url"]) expect(journal).not.toContain(sensitive);
    await expect(manager.generate(scope, { ...input, prompt: "different" }, "stable")).rejects.toThrow("different video");
  });
  it("keeps bot, conversation and person boundaries for status, cancel, retry and list", async () => {
    const { manager } = setup(); const started = await manager.generate(scope, input, "stable");
    for (const stranger of [{ ...scope, botId: "other" }, { ...scope, threadId: "other" }, { ...scope, principalId: "bob" }]) {
      expect(() => manager.status(stranger, started.job_id)).toThrow("No video job");
      expect(() => manager.cancel(stranger, started.job_id)).toThrow("No video job");
      await expect(manager.retry(stranger, started.job_id)).rejects.toThrow("No video job");
      expect(manager.list(stranger).jobs).toEqual([]);
    }
  });
  it("cancels an in-flight download, resumes the same request and does not generate twice", async () => {
    let first = true; let aborted = false;
    const fixture = setup({ save: vi.fn(async (_url, job, signal) => {
      if (first) { first = false; await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true })); }
      return { path: `/synthetic/${job.id}.mp4`, name: "Generated video.mp4", mime: "video/mp4" as const, bytes: 120 };
    }) });
    const result = await fixture.manager.generate(scope, input, "stable");
    await waitStatus(fixture.manager, result.job_id, "downloading");
    expect(fixture.manager.cancel(scope, result.job_id).note).toContain("may continue and be billed");
    await vi.waitFor(() => expect(aborted).toBe(true));
    await fixture.manager.retry(scope, result.job_id); await waitStatus(fixture.manager, result.job_id, "completed");
    expect(fixture.deps.provider.submit).toHaveBeenCalledTimes(1); expect(fixture.deps.publish).toHaveBeenCalledTimes(1);
  });
  it("recovers acknowledged jobs after restart and reuses the already persisted attachment", async () => {
    const fixture = setup({ provider: { submit: vi.fn(async () => "request-1"), poll: vi.fn(async () => ({ status: "pending" as const, progress: 20 })) } });
    const started = await fixture.manager.generate(scope, input, "stable");
    await waitStatus(fixture.manager, started.job_id, "pending"); await fixture.manager.close();
    const next = setup({ ...fixture.deps, provider: { ...fixture.deps.provider, poll: vi.fn(async () => ({ status: "done" as const, video: { url: "https://example.test/video.mp4", respect_moderation: true } })) } });
    next.manager.recover(); await waitStatus(next.manager, started.job_id, "completed");
    expect(fixture.deps.provider.submit).toHaveBeenCalledTimes(1);
    await next.manager.close();
    const third = setup({ ...next.deps }); third.manager.recover();
    expect(third.manager.status(scope, started.job_id).attached).toBe(true);
    expect(next.deps.save).toHaveBeenCalledTimes(1); expect(next.deps.publish).toHaveBeenCalledTimes(1);
  });
  it("never resubmits a lost acknowledgement or a crash during POST", async () => {
    const fixture = setup({ provider: { submit: vi.fn(async () => { throw new VideoProviderError("Acknowledgement lost; request may be billed.", "submission_unknown"); }), poll: vi.fn() } });
    const started = await fixture.manager.generate(scope, input, "stable"); expect(started.status).toBe("unknown");
    await expect(fixture.manager.retry(scope, started.job_id)).rejects.toThrow("cannot be retried safely");
    await fixture.manager.generate(scope, input, "stable"); expect(fixture.deps.provider.submit).toHaveBeenCalledTimes(1);
    const path = join(fixture.dir, `${started.job_id}.json`); const journal = JSON.parse(readFileSync(path, "utf8")); journal.status = "submitting"; writeFileSync(path, JSON.stringify(journal));
    const next = setup({ ...fixture.deps }); next.manager.recover(); expect(next.manager.status(scope, started.job_id).status).toBe("unknown");
    expect(fixture.deps.provider.poll).not.toHaveBeenCalled();
  });
  it("reports moderation/failure and timeout without publishing fictional success", async () => {
    const fixture = setup({ provider: { submit: vi.fn(async () => "request-1"), poll: vi.fn(async () => ({ status: "done" as const, video: { respect_moderation: false } })) } });
    const started = await fixture.manager.generate(scope, input, "stable"); await waitStatus(fixture.manager, started.job_id, "failed");
    expect(fixture.manager.status(scope, started.job_id).code).toBe("moderation"); expect(fixture.deps.save).not.toHaveBeenCalled();
    await expect(fixture.manager.retry(scope, started.job_id)).rejects.toThrow("separate");
    const timeout = setup({ timeoutMs: 15, provider: { submit: vi.fn(async () => "request-2"), poll: vi.fn(async () => ({ status: "pending" as const })) } });
    const waiting = await timeout.manager.generate(scope, input, "stable"); await waitStatus(timeout.manager, waiting.job_id, "paused");
    expect(timeout.manager.status(scope, waiting.job_id).code).toBe("timeout"); expect(timeout.deps.publish).not.toHaveBeenCalled();
  });
  it("rechecks a stopped turn after credential resolution, before any billable POST", async () => {
    const fixture = setup();
    await expect(fixture.manager.generate(scope, input, "stable", undefined, () => false)).rejects.toThrow("turn ended");
    expect(fixture.deps.provider.submit).not.toHaveBeenCalled();
  });
  it("the authorized Stop flow cancels only its bot and thread", async () => {
    const fixture = setup({ provider: { submit: vi.fn(async () => "request-1"), poll: vi.fn(async () => ({ status: "pending" as const })) } });
    const mine = await fixture.manager.generate(scope, input, "mine");
    const otherScope = { ...scope, botId: "peer" };
    const other = await fixture.manager.generate(otherScope, input, "peer");
    expect(fixture.manager.cancelThread(scope.threadId, scope.botId)).toBe(1);
    expect(fixture.manager.status(scope, mine.job_id).status).toBe("cancelled");
    expect(fixture.manager.status(otherScope, other.job_id).status).toBe("pending");
    expect(fixture.manager.cancelThread(scope.threadId)).toBe(1);
  });
  it("a newer Stop wins over retry waiting for a personal credential", async () => {
    const fixture = setup({ provider: { submit: vi.fn(async () => "request-1"), poll: vi.fn(async () => ({ status: "pending" as const })) } });
    const started = await fixture.manager.generate(scope, input, "stable");
    fixture.manager.cancel(scope, started.job_id);
    let release!: () => void;
    fixture.deps.credential = async () => { await new Promise<void>(resolve => { release = resolve; }); return { key: "synthetic", payer: "personal" }; };
    const retry = fixture.manager.retry(scope, started.job_id);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    fixture.manager.cancelThread(scope.threadId, scope.botId);
    release(); expect((await retry).status).toBe("cancelled");
    expect(fixture.deps.provider.submit).toHaveBeenCalledTimes(1);
  });
  it("shows one status row per job: progress steps, then a failure receipt with the provider's code", async () => {
    let state: "pending" | "failed" = "pending"; let progress = 10;
    const rows: Array<{ status: string; progress?: number; code?: string; messageId?: string }> = [];
    const fixture = setup({
      show: vi.fn(job => { rows.push({ status: job.status, progress: job.progress, code: job.code, messageId: job.messageId }); return "row-1"; }),
      provider: { submit: vi.fn(async () => "request-1"), poll: vi.fn(async () => state === "failed"
        ? { status: "failed" as const, error: { code: "invalid_argument", message: "Prompt rejected, see https://x.ai/private" } }
        : { status: "pending" as const, progress: progress++ }) },
    });
    const started = await fixture.manager.generate(scope, input, "stable");
    await vi.waitFor(() => expect(fixture.manager.status(scope, started.job_id).progress).toBeGreaterThanOrEqual(30));
    // One row update per 5 % step (plus the acknowledgement), never one per poll.
    const pending = rows.filter(row => row.status === "pending").length;
    expect(pending).toBeLessThanOrEqual(Math.floor(fixture.manager.status(scope, started.job_id).progress! / 5));
    expect(pending).toBeLessThan(progress - 10);
    expect(rows.some(row => row.status === "submitting")).toBe(false);
    state = "failed"; await waitStatus(fixture.manager, started.job_id, "failed");
    const receipt = fixture.manager.status(scope, started.job_id);
    expect(receipt.code).toBe("invalid_argument"); expect(receipt.error).toContain("refused"); expect(receipt.error).not.toContain("x.ai/private");
    expect(rows.at(-1)).toMatchObject({ status: "failed", code: "invalid_argument", messageId: "row-1" });
    expect(JSON.parse(readFileSync(join(fixture.dir, `${started.job_id}.json`), "utf8")).messageId).toBe("row-1");
    expect(fixture.deps.save).not.toHaveBeenCalled();
  });
  it("an expired request fails with its own receipt, and a paused job waits for retry after a restart", async () => {
    const expired = setup({ provider: { submit: vi.fn(async () => "request-1"), poll: vi.fn(async () => ({ status: "expired" as const })) } });
    const gone = await expired.manager.generate(scope, input, "stable"); await waitStatus(expired.manager, gone.job_id, "failed");
    expect(expired.manager.status(scope, gone.job_id).code).toBe("expired");
    const paused = setup({ save: vi.fn(async () => { throw new Error("network"); }) });
    const waiting = await paused.manager.generate(scope, input, "stable"); await waitStatus(paused.manager, waiting.job_id, "paused");
    await paused.manager.close();
    const poll = vi.fn(async () => ({ status: "done" as const, video: { url: "https://example.test/video.mp4", respect_moderation: true } }));
    const next = setup({ ...paused.deps, provider: { submit: paused.deps.provider.submit, poll } });
    next.manager.recover(); await new Promise(resolve => setTimeout(resolve, 30));
    expect(poll).not.toHaveBeenCalled(); expect(next.manager.status(scope, waiting.job_id).status).toBe("paused");
  });
  it("lists older jobs with bounded pages and ignores genuinely erased journals on restart", async () => {
    const fixture = setup({ provider: { submit: vi.fn(async () => "request-1"), poll: vi.fn(async () => ({ status: "pending" as const })) } });
    const ids = new Set<string>();
    for (let i = 0; i < 23; i++) ids.add((await fixture.manager.generate(scope, input, `request-${i}`)).job_id);
    const page = fixture.manager.list(scope); const next = fixture.manager.list(scope, page.next_offset);
    expect(page.jobs).toHaveLength(20); expect(next.jobs).toHaveLength(3); expect(next.next_offset).toBeUndefined();
    expect(new Set([...page.jobs, ...next.jobs].map(job => job.job_id))).toEqual(ids);
    await fixture.manager.close();
    const erased = setup({ ...fixture.deps, read: () => { throw Object.assign(new Error("This content was erased."), { code: "ENOENT" }); } });
    expect(erased.manager.list(scope).jobs).toEqual([]);
  });
});
