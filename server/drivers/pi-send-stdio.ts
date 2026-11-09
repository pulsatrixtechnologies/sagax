/** stderr drain plus the child's error and close paths (#1383). */
import { engineExitedLine } from "../../shared/engine-exit-words.ts";
import { describeSpawnFailure } from "../procs.ts";
import type { PiSendCtx } from "./pi-turn-ctx.ts";

export function attachPiStdio(ctx: PiSendCtx): void {
  const { emit, base } = ctx.deps;
  // Drain diagnostics on cold turns too. An unread stderr pipe can
  // fill and stop pi before it sends its next protocol frame.
  ctx.child.stderr.setEncoding("utf8");
  ctx.child.stderr.on("data", (chunk: string) => {
    ctx.stderr = (ctx.stderr + chunk).slice(-8192);
  });
  ctx.child.on("error", (err) => {
    const fail = describeSpawnFailure(err as NodeJS.ErrnoException, ctx.deps.config.cli, ctx.turn.cwd);
    ctx.rejectWaiters(new Error(fail.message));
    emit({ ...base(ctx.threadId, ctx.turnId), type: "runtime.error", message: fail.message, setup: fail.setup });
    ctx.settle(false);
  });
  ctx.child.on("close", () => {
    // a clean close without a terminal event is a failed turn, never a hang
    const message = engineExitedLine("pi", ctx.stderr);
    ctx.rejectWaiters(new Error(message));
    if (!ctx.settled) emit({ ...base(ctx.threadId, ctx.turnId), type: "runtime.error", message });
    ctx.settle(false);
  });
}
