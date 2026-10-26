// Run WebP scaling off the main thread, a bounded number at a time (2026-10-21).
// A decoded 16 Mpx picture is 64 MB of RGBA and several seconds of CPU, so it
// never runs on the server's event loop, and at most WEBP_WORKERS run at once
// across all turns; the others wait in line.
import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";

import type { Size } from "./webp-scale.ts";

export const WEBP_WORKERS = 2;
const WEBP_JOB_TIMEOUT_MS = 60_000;

/** The WebP could not be decoded (damaged, animated, or the worker gave up). */
export class WebpUndecodable extends Error {}

let running = 0;
const waiting: Array<() => void> = [];

async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (running >= WEBP_WORKERS) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await run();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

function runInWorker(bytes: Uint8Array, size: Size): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const source = new URL("./webp-scale.worker.ts", import.meta.url);
    const worker = new Worker(existsSync(source) ? source : new URL("./webp-scale.worker.js", import.meta.url), {
      workerData: { bytes, width: size.width, height: size.height },
      // Do not inherit test loaders or inspector ports into the worker.
      execArgv: [],
    });
    const timer = setTimeout(() => { void worker.terminate(); reject(new WebpUndecodable("WebP scaling timed out")); }, WEBP_JOB_TIMEOUT_MS);
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    worker.once("message", (reply: { png?: Uint8Array; failed?: string }) => {
      done(() => (reply.png ? resolve(Buffer.from(reply.png)) : reject(new WebpUndecodable(reply.failed ?? "decode failed"))));
    });
    worker.once("error", (error: Error) => done(() => reject(new WebpUndecodable(error.message))));
    worker.once("exit", () => done(() => reject(new WebpUndecodable("WebP worker exited"))));
  });
}

/** The WebP at `size` as a PNG, scaled in a worker thread. Rejects with
 * WebpUndecodable when libwebp cannot read it. */
export function scaleWebpOffThread(bytes: Uint8Array, size: Size): Promise<Buffer> {
  return slot(() => runInWorker(bytes, size));
}
