/** The inspector's wire data: what a thread's turn actually looked like.
 * Single home in shared/; server/threads/thread-events.ts re-exports under the
 * historical names and keeps the file-reading half. */
import type { RuntimeEvent } from "./runtime-events.ts";

/** One line of native/<threadId>.ndjson (server/drivers/native.ts). */
export interface NativeRecord {
  at: string;
  dir: "in" | "out";
  source: string;
  msg: unknown;
}

export type InspectorEntry =
  | { kind: "runtime"; at: string; data: RuntimeEvent }
  | { kind: "native"; at: string; data: NativeRecord };

export interface InspectorPage {
  entries: InspectorEntry[];
  /** line counts before the cap, so the UI can say "showing 200 of 1,687" */
  total: { runtime: number; native: number };
  /** Present while a log's total is still being counted: its total is then
   * only how many lines it holds at least ("last 300 of at least 4,200"). */
  totalPartial?: { runtime: boolean; native: boolean };
}

