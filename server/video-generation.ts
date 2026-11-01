import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";
import { VIDEO_MODEL, VideoProviderError, type VideoGenerationInput, type VideoProvider, type VideoProviderResult } from "./video-provider.ts";

const scopeSchema = z.object({ botId: z.string(), threadId: z.string(), principalId: z.string() });
export type VideoScope = z.infer<typeof scopeSchema>;
export type VideoPayer = "personal" | "organization" | "solo";
const savedSchema = z.object({ path: z.string(), name: z.string(), mime: z.literal("video/mp4"), bytes: z.number().nonnegative() });
export type SavedVideo = z.infer<typeof savedSchema>;
const jobSchema = z.object({
  id: z.string().uuid(), scope: scopeSchema, identity: z.string(), inputHash: z.string(),
  payer: z.enum(["personal", "organization", "solo"]),
  status: z.enum(["submitting", "pending", "downloading", "completed", "paused", "cancelled", "failed", "unknown"]),
  createdAt: z.number(), updatedAt: z.number(), requestId: z.string().regex(/^[\w-]{1,200}$/).optional(),
  progress: z.number().min(0).max(100).optional(), error: z.string().optional(), code: z.string().optional(),
  saved: savedSchema.optional(), published: z.boolean().optional(), deliveryUrl: z.string().optional(), costInUsdTicks: z.number().optional(),
  /** The conversation row that shows this job's progress, receipt and MP4. */
  messageId: z.string().max(200).optional(),
});
export type VideoJob = z.infer<typeof jobSchema>;
export interface VideoCredential { key: string; payer: VideoPayer }
export interface VideoGenerationDeps {
  dir: string;
  provider: VideoProvider;
  /** Resolve only this person, and after dispatch only the original payer. */
  credential(scope: VideoScope, payer?: VideoPayer): Promise<VideoCredential>;
  valid(scope: VideoScope): boolean;
  save(url: string, job: VideoJob, signal: AbortSignal): Promise<SavedVideo>;
  /** Synchronous and idempotent by saved path, including after a restart.
   * Replaces the job's status row (job.messageId) with the MP4 when it exists. */
  publish(job: VideoJob & { saved: SavedVideo }): string;
  /** Writes or updates the job's status row in its conversation (progress,
   * stop, failure receipt) and returns its id. Never throws into the job. */
  show?(job: VideoJob): string | undefined;
  read?(path: string): string;
  written?(path: string, job: VideoJob): void;
  pollMs?: number;
  timeoutMs?: number;
}
export class VideoJobError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
/** xAI's documented error codes, in words the person and the bot can act on.
 * The provider's own message is one bounded line, never a URL. */
function providerFailure(result: VideoProviderResult): { code: string; error: string } {
  if (result.video?.respect_moderation === false) return { code: "moderation", error: "xAI did not release this video after moderation. No playable attachment was saved." };
  if (result.status === "expired") return { code: "expired", error: "xAI expired this request before the video could be saved. A new generate request is a separate, potentially billable attempt." };
  const code = result.error?.code?.replace(/[^\w.-]/g, "").slice(0, 60) || "provider_failed";
  const detail = result.error?.message?.replace(/https?:\/\/\S+/g, "[link]").replace(/\s+/g, " ").trim().slice(0, 200);
  const advice: Record<string, string> = {
    invalid_argument: "xAI refused the parameters, the image or the content (moderation included). Change them and generate again.",
    permission_denied: "This xAI API key's team cannot generate videos. Check the account in Settings > Providers.",
    failed_precondition: "xAI cannot make this video with this model, mode or resolution. Change them and generate again.",
    service_unavailable: "xAI video generation is unavailable right now. Generate again later.",
    internal_error: "xAI failed while generating. Generate again; if it persists, give xAI the request_id.",
  };
  const words = advice[code] ?? "xAI video generation failed.";
  return { code, error: `${words}${detail ? ` xAI: ${detail}` : ""} No playable attachment was saved.` };
}
const hash = (input: string) => createHash("sha256").update(input).digest("hex");
const sameScope = (a: VideoScope, b: VideoScope) => a.botId === b.botId && a.threadId === b.threadId && a.principalId === b.principalId;

/** Durable metadata only: no prompts, images, keys or signed download URLs.
 * One server owns the data directory, like the attachment UUID locks. */
export class VideoGenerations {
  private readonly jobs = new Map<string, VideoJob>();
  private readonly running = new Map<string, { abort: AbortController; task: Promise<void> }>();
  private readonly cancellations = new Map<string, number>();
  private readonly shown = new Map<string, string>();
  private closing = false;
  private readonly deps: VideoGenerationDeps;
  constructor(deps: VideoGenerationDeps) {
    this.deps = deps;
    mkdirSync(deps.dir, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(deps.dir)) {
      if (!/^[\w-]+\.json$/.test(name)) continue;
      const path = join(deps.dir, name);
      // A corrupt/locked journal must fail startup, never silently erase the
      // deduplication record of a potentially billable generation.
      let text: string;
      try { text = deps.read?.(path) ?? readFileSync(path, "utf8"); }
      catch (error) {
        // Erasing a person destroys their content key. That is absence,
        // not a damaged billable journal and must not prevent startup.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const job = jobSchema.parse(JSON.parse(text));
      if (name !== `${job.id}.json`) throw new Error("Invalid video journal identity");
      if (job.status === "submitting") {
        job.status = "unknown";
        job.error = "The server stopped before xAI acknowledged this request. It may be running and billable. No second generation was submitted.";
        job.code = "submission_unknown";
        this.persist(job);
      }
      this.jobs.set(job.id, job);
    }
  }
  private persist(job: VideoJob): void {
    job.updatedAt = Date.now();
    this.showStatus(job);
    const path = join(this.deps.dir, `${job.id}.json`);
    writeFileAtomic(path, JSON.stringify(job), { mode: 0o600 });
    this.deps.written?.(path, job);
  }
  /** The person sees the job without asking the bot: one row per job, updated
   * on a state change or a 5 % progress step. The completed MP4 replaces it. */
  private showStatus(job: VideoJob): void {
    if (!this.deps.show || job.status === "submitting" || (job.status === "completed" && !job.published) || job.published) return;
    const signature = [job.status, Math.floor((job.progress ?? 0) / 5), job.code ?? ""].join("|");
    if (this.shown.get(job.id) === signature && job.messageId) return;
    try {
      const id = this.deps.show(job);
      if (id) job.messageId = id;
      this.shown.set(job.id, signature);
    } catch { /* The receipt stays readable through status; the job continues. */ }
  }
  private owned(scope: VideoScope, id: string): VideoJob {
    const job = this.jobs.get(id);
    if (!job || !sameScope(scope, job.scope) || !this.deps.valid(scope)) throw new VideoJobError("No video job in this conversation has that id.", 404);
    return job;
  }
  receipt(job: VideoJob) {
    return {
      job_id: job.id, status: job.status, provider: "xai", model: VIDEO_MODEL,
      payer: job.payer, ...(job.requestId ? { request_id: job.requestId } : {}),
      ...(job.progress !== undefined ? { progress: job.progress } : {}),
      ...(job.error ? { error: job.error, code: job.code } : {}),
      ...(job.saved ? { attachment: { ...(job.deliveryUrl ? { url: job.deliveryUrl } : {}), name: job.saved.name, mime: job.saved.mime, bytes: job.saved.bytes }, attached: job.published === true } : {}),
      ...(job.costInUsdTicks !== undefined ? { usage: { cost_in_usd_ticks: job.costInUsdTicks } } : {}),
      note: job.status === "cancelled"
        ? "Local polling and download stopped. xAI has no documented cancellation API; its generation may continue and be billed. retry resumes the same request."
        : job.status === "pending" || job.status === "downloading" || job.status === "submitting"
          ? "Generation is still running. Use status with job_id. The saved MP4 will be attached here when ready; cancel stops local work only."
          : job.status === "completed" ? "The MP4 is saved in Sagax; its attachment does not depend on xAI's temporary URL."
            : "retry only resumes a known request or its download; it never submits a second generation. A new generate request may be billed separately.",
    };
  }
  list(scope: VideoScope, offset = 0) {
    if (!this.deps.valid(scope)) throw new VideoJobError("This conversation is no longer available.", 404);
    const jobs = [...this.jobs.values()].filter(job => sameScope(scope, job.scope)).sort((a, b) => b.createdAt - a.createdAt);
    return { jobs: jobs.slice(offset, offset + 20).map(job => this.receipt(job)), total: jobs.length,
      ...(offset + 20 < jobs.length ? { next_offset: offset + 20 } : {}) };
  }
  status(scope: VideoScope, id: string) { return this.receipt(this.owned(scope, id)); }
  async generate(scope: VideoScope, input: VideoGenerationInput, requestKey: string, imageDataUrl?: string, canStart: () => boolean = () => true) {
    if (this.closing) throw new VideoJobError("The server is stopping. Try again after it restarts.", 503);
    const identity = hash(JSON.stringify([scope, requestKey]));
    const inputHash = hash(JSON.stringify([input, imageDataUrl]));
    const previous = [...this.jobs.values()].find(job => job.identity === identity);
    if (previous) {
      if (previous.inputHash !== inputHash) throw new VideoJobError("request_key already identifies a different video. Use the original arguments or a new request_key.");
      return this.status(scope, previous.id);
    }
    const credential = await this.deps.credential(scope);
    if (this.closing) throw new VideoJobError("The server is stopping. Try again after it restarts.", 503);
    if (!canStart() || !this.deps.valid(scope)) throw new VideoJobError("This turn ended before video generation started.");
    // Resolve may await a remote key. Recheck idempotency after that wait.
    const concurrent = [...this.jobs.values()].find(job => job.identity === identity);
    if (concurrent) {
      if (concurrent.inputHash !== inputHash) throw new VideoJobError("request_key already identifies a different video.");
      return this.receipt(concurrent);
    }
    const job: VideoJob = { id: randomUUID(), scope, identity, inputHash, payer: credential.payer, status: "submitting", createdAt: Date.now(), updatedAt: Date.now() };
    this.persist(job); // before the billable POST
    this.jobs.set(job.id, job);
    const abort = new AbortController();
    const task = (async () => {
      try {
        const requestId = await this.deps.provider.submit(credential.key, input, imageDataUrl, AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]));
        job.requestId = requestId;
        // A concurrent cancellation still needs the acknowledged id for a
        // safe resume; never turn it back into an active job.
        if (job.status !== "cancelled") job.status = "pending";
        this.persist(job);
      } catch (error) {
        if (job.status !== "cancelled") {
          job.status = error instanceof VideoProviderError && error.code !== "submission_unknown" ? "failed" : "unknown";
          job.error = error instanceof VideoProviderError ? error.message : "xAI did not acknowledge the video request. It may be billable. No second generation was submitted.";
          job.code = error instanceof VideoProviderError ? error.code : "submission_unknown";
          this.persist(job);
        }
      }
    })();
    this.running.set(job.id, { abort, task });
    try { await task; } finally { this.running.delete(job.id); }
    if (job.status === "pending") this.run(job);
    return this.receipt(job);
  }
  cancel(scope: VideoScope, id: string) {
    const job = this.owned(scope, id);
    if (job.status === "completed" || job.status === "failed") return this.receipt(job);
    job.status = "cancelled";
    this.cancellations.set(job.id, (this.cancellations.get(job.id) ?? 0) + 1);
    job.error = undefined;
    job.code = undefined;
    this.persist(job);
    this.running.get(id)?.abort.abort();
    return this.receipt(job);
  }
  /** Called by the existing authorized Stop flows, including an idle chat
   * whose asynchronous video is still running. Never cancels upstream. */
  cancelThread(threadId: string, botId?: string): number {
    let cancelled = 0;
    for (const job of this.jobs.values()) {
      if (job.scope.threadId !== threadId || botId && job.scope.botId !== botId || ["completed", "failed"].includes(job.status)) continue;
      this.cancellations.set(job.id, (this.cancellations.get(job.id) ?? 0) + 1);
      if (job.status === "cancelled") continue;
      job.status = "cancelled"; job.error = undefined; job.code = undefined;
      this.persist(job); this.running.get(job.id)?.abort.abort(); cancelled++;
    }
    return cancelled;
  }
  async retry(scope: VideoScope, id: string, canResume: () => boolean = () => true) {
    const job = this.owned(scope, id);
    const cancellations = this.cancellations.get(id) ?? 0;
    if (job.status === "completed" && job.published) return this.receipt(job);
    if (this.closing) throw new VideoJobError("The server is stopping.", 503);
    const previous = this.running.get(id);
    if (previous && job.status === "cancelled") await previous.task.catch(() => {});
    else if (previous) return this.receipt(job);
    if (job.status === "failed") throw new VideoJobError("xAI rejected or failed this generation. A new generate request is a separate, potentially billable attempt.");
    if (!job.requestId) throw new VideoJobError("This request has no acknowledged xAI id. It cannot be retried safely; it may already be billable. No second generation was submitted.");
    await this.deps.credential(scope, job.payer);
    // A newer Stop must win even while the remote key lookup is waiting.
    if (this.closing || (this.cancellations.get(id) ?? 0) !== cancellations || !canResume()) return this.receipt(job);
    if (!this.deps.valid(scope)) throw new VideoJobError("This conversation is no longer available.", 404);
    job.error = undefined; job.code = undefined;
    job.status = job.saved ? "completed" : "pending";
    this.persist(job);
    this.run(job);
    return this.receipt(job);
  }
  /** Restart: resume what was running. A paused job already showed its
   * receipt and resumes on retry, not on every restart. */
  recover(): void {
    for (const job of this.jobs.values()) {
      if ((job.requestId && ["pending", "downloading"].includes(job.status)) || (job.saved && !job.published && job.status === "completed")) this.run(job);
    }
  }
  private run(job: VideoJob): void {
    if (this.closing || this.running.has(job.id)) return;
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(this.deps.timeoutMs ?? 10 * 60_000)]);
    const task = (async () => {
      try {
        while (!job.saved) {
          signal.throwIfAborted();
          if (!this.deps.valid(job.scope)) throw new VideoJobError("This conversation or its person is no longer available.", 404);
          const credential = await this.deps.credential(job.scope, job.payer);
          signal.throwIfAborted();
          const result = await this.deps.provider.poll(credential.key, job.requestId!, signal);
          signal.throwIfAborted();
          job.progress = result.progress;
          if (result.usage?.cost_in_usd_ticks !== undefined) job.costInUsdTicks = result.usage.cost_in_usd_ticks;
          if (result.status === "failed" || result.status === "expired" || result.video?.respect_moderation === false) {
            job.status = "failed";
            Object.assign(job, providerFailure(result));
            this.persist(job); return;
          }
          if (result.status === "done") {
            if (!result.video?.url) throw new VideoProviderError("xAI reported completion without a video. Retry checks this same request.", "invalid_response");
            job.status = "downloading"; this.persist(job);
            job.saved = await this.deps.save(result.video.url, job, signal);
            signal.throwIfAborted();
            job.status = "completed"; job.progress = 100; this.persist(job);
            break;
          }
          job.status = "pending"; this.persist(job);
          await delay(this.deps.pollMs ?? 5_000, undefined, { signal, ref: false });
        }
        signal.throwIfAborted();
        if (!this.deps.valid(job.scope)) throw new VideoJobError("This conversation or its person is no longer available.", 404);
        if (!job.published) {
          job.deliveryUrl = this.deps.publish(job as VideoJob & { saved: SavedVideo });
          job.published = true; this.persist(job);
        }
      } catch (error) {
        if (this.closing || job.status === "cancelled") return;
        job.status = "paused";
        job.code = signal.aborted ? "timeout" : error instanceof VideoProviderError ? error.code : "resume_required";
        job.error = signal.aborted ? "Video tracking or download timed out. xAI may still be running and billable. retry resumes this same request."
          : error instanceof VideoProviderError || error instanceof VideoJobError ? error.message
            : "Video progress or download could not finish. retry resumes this same request without a second generation.";
        this.persist(job);
      }
    })();
    this.running.set(job.id, { abort, task });
    void task.finally(() => { if (this.running.get(job.id)?.abort === abort) this.running.delete(job.id); }).catch(() => {});
  }
  async close(): Promise<void> {
    this.closing = true;
    const running = [...this.running.values()];
    for (const item of running) item.abort.abort();
    await Promise.allSettled(running.map(item => item.task));
  }
  files(): Array<{ path: string; scope: { thread: string } }> {
    return [...this.jobs.values()].map(job => ({ path: join(this.deps.dir, `${job.id}.json`), scope: { thread: job.scope.threadId } }));
  }
}
