import type { ChildProcess } from "node:child_process";
import { killCliTree } from "../procs.ts";
import type { WarmResourceLease } from "./warm-resources.ts";

/** Root close is not tree close. Match spawnCli's existing two-second
 * orphan-reap grace, then confirm its (coalesced) kill. A failed kill stays
 * charged and the budget's next sweep retries the owned tree. */
export function retireClosedWarmProcess(lease: WarmResourceLease | undefined, child: ChildProcess): void {
  if (!lease) return;
  lease.retiring();
  const timer = setTimeout(() => {
    void killCliTree(child).then(stopped => { if (stopped) lease.forget(); }, () => {}).catch(() => {});
  }, 2_000);
  timer.unref();
}
