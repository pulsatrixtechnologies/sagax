// @ts-nocheck
/** settledWithinOrStop (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettledWithinOrStop(getHost: () => Host): any {
function settledWithinOrStop(work: Promise<unknown> | null, ms: number, signal?: AbortSignal) {
  void getHost();

  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, Math.max(0, ms));
    signal?.addEventListener("abort", done, { once: true });
    work?.then(done, done);
  });

}
  return settledWithinOrStop;
}
