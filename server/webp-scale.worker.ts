// Worker thread: decode one WebP, scale it, encode a PNG. See webp-scale-worker.ts.
import { parentPort, workerData } from "node:worker_threads";

import { scaleWebpInline } from "./webp-scale.ts";

const job = workerData as { bytes: Uint8Array; width: number; height: number };
try {
  const png = await scaleWebpInline(job.bytes, { width: job.width, height: job.height });
  parentPort!.postMessage({ png: new Uint8Array(png.buffer, png.byteOffset, png.byteLength) });
} catch (error) {
  parentPort!.postMessage({ failed: error instanceof Error ? error.message : "decode failed" });
}
