import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import type { SealedKeyMaterial, SearchHit } from "./messages/message-search-query.ts";

export class SearchUnavailable extends Error {
  readonly status = 503;
}

/** One read-only worker, not a worker per keystroke. Bound outstanding scans
 * so a burst of searches cannot build an unbounded queue behind the database. */
export class MessageSearchWorker {
  private worker: Worker | undefined;
  private stopping: Promise<void> = Promise.resolve();
  private sequence = 0;
  private readonly pending = new Map<number, {
    resolve: (reply: { hits?: SearchHit[]; references?: Array<[string, string[]]> }) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  private readonly file: string;
  private readonly timeoutMs: number;
  constructor(file: string, timeoutMs = 30_000) {
    this.file = file;
    this.timeoutMs = timeoutMs;
  }

  search(query: string, limit: number, threadId?: string, sealed?: { keys: SealedKeyMaterial[]; plaintext: boolean }): Promise<SearchHit[]> {
    return this.request({ query, limit, threadId, ...(sealed?.keys.length ? { keys: sealed.keys, plaintext: sealed.plaintext } : {}) }).then((reply) => reply.hits ?? []);
  }

  /** 2026-11-03 (audit S-5): the threads that mention each fragment, in one
   * pass over messages, in the worker. */
  references(fragments: readonly string[]): Promise<Map<string, string[]>> {
    return this.request({ query: "", limit: 0, references: [...fragments] }).then((reply) => new Map(reply.references ?? []));
  }

  private request(message: Record<string, unknown>): Promise<{ hits?: SearchHit[]; references?: Array<[string, string[]]> }> {
    if (this.pending.size >= 8) return Promise.reject(new SearchUnavailable("Search is busy. Try again shortly."));
    if (!this.worker) {
      const source = new URL("./message-search.worker.ts", import.meta.url);
      const worker = new Worker(existsSync(source) ? source : new URL("./message-search.worker.js", import.meta.url), {
        workerData: { file: this.file },
        // Do not inherit test loaders or inspector ports into the worker.
        execArgv: [],
      });
      this.worker = worker;
      worker.on("message", (reply: { id: number; hits?: SearchHit[]; references?: Array<[string, string[]]>; failed?: boolean }) => {
        if (this.worker !== worker) return;
        const request = this.pending.get(reply.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(reply.id);
        if (reply.failed) request.reject(new SearchUnavailable("Search could not finish. Try again shortly."));
        else request.resolve(reply);
        if (!this.pending.size) worker.unref();
      });
      worker.on("error", () => {
        if (this.worker === worker) void this.close().catch(() => {});
      });
      worker.on("exit", () => {
        if (this.worker === worker) void this.close().catch(() => {});
      });
    }
    const worker = this.worker;
    worker.ref();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { void this.close().catch(() => {}); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, ...message }); }
      catch { void this.close().catch(() => {}); }
    });
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new SearchUnavailable("Search was interrupted. Try again shortly."));
    }
    this.pending.clear();
    if (worker) this.stopping = Promise.all([this.stopping, worker.terminate()]).then(() => {});
    await this.stopping;
  }
}
