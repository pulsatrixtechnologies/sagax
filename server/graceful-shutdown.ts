export interface GracefulShutdownOptions {
  /** Runs first, alone, bounded by drainTimeoutMs: the turns in progress
   * finish while nothing new starts. Its failure or timeout never blocks
   * the cleanup. */
  drain?: () => Promise<void>;
  drainTimeoutMs?: number;
  cleanup: ReadonlyArray<() => void | Promise<void>>;
  exit: (code: number) => void;
  timeoutMs?: number;
}

const bounded = (work: Promise<unknown>, ms: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return Promise.race([work.then(() => undefined, () => undefined), deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

/** Build one idempotent shutdown callback for process signals. Cleanup jobs
 * run together, but a wedged provider cannot keep the desktop child alive
 * forever. The browser capability clear is one of these jobs, so a normal
 * server stop does not leave a turn bearer usable until its absolute TTL. */
export function createGracefulShutdown({
  drain,
  drainTimeoutMs = 0,
  cleanup,
  exit,
  timeoutMs = 6_000,
}: GracefulShutdownOptions): () => void {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    if (!drain || drainTimeoutMs <= 0) {
      runCleanup(cleanup, exit, timeoutMs);
      return;
    }
    void bounded(Promise.resolve().then(drain), drainTimeoutMs).then(() => runCleanup(cleanup, exit, timeoutMs));
  };
}

function runCleanup(cleanup: GracefulShutdownOptions["cleanup"], exit: (code: number) => void, timeoutMs: number): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
  const settled = Promise.allSettled(cleanup.map((job) => Promise.resolve().then(job)))
    .then(() => undefined);

  void Promise.race([settled, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
    exit(0);
  });
}
