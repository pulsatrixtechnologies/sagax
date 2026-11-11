/** Quiet-watch and turn settle for an ACP instance. */
import {
  classifyQuiet, describeQuiet, LogTail, quietKey, quietVerdict, sampleProcessTree,
  type LogSignal, type ProcessSample, type QuietState,
} from "./quiet-status.ts";
import { ACP_STUCK_AFTER_MS, envOr, promptIdleTimeoutMs } from "./constants.ts";
import { endTurn } from "./turn-end.ts";
import { turnLatencyLine } from "./turn-latency.ts";
import { turnTraceMarks } from "../../turns/turn-trace.ts";
import type { AcpSession, AcpSupport, AcpTurn } from "./types.ts";
import { reportBackgroundError } from "../../background-error.ts";

export type LifecycleDeps = {
  support: AcpSupport;
  DRIVER_KIND: string;
  emit: (event: any) => void;
  base: (threadId: string, turnId: string) => Record<string, unknown>;
  active: Map<string, unknown>;
  sessions: Map<string, AcpSession>;
  armIdle: (threadId: string) => void;
};

export function createStartQuietWatch(deps: Pick<LifecycleDeps, "support" | "emit" | "base">) {
  const { support, emit, base } = deps;
  return (threadId: string, session: AcpSession, current: AcpTurn) => {

    const noticeAfterMs = envOr("SAGAX_ACP_QUIET_NOTICE_MS", 60_000);
    const tickMs = envOr("SAGAX_ACP_QUIET_TICK_MS", 15_000);
    const { sessionId } = session;
    const logPath = support.statusLog && sessionId
      ? support.statusLog.path(session.env, sessionId)
      : null;
    const tail = logPath ? new LogTail(logPath) : null;
    tail?.read(); // skip what this log held before the prompt
    let logged: { signal: LogSignal; at: number } | null = null;
    let context: { tokens: number; threshold: number } | null = null;
    let previous: ProcessSample | null = null;
    let previousAt = 0;
    let shownKey: string | null = null;
    let noSignsSince: number | null = null;
    let notices = 0;
    let probing = false;
    let state: QuietState | null = null;
    // A reused session's last inbound message may predate this prompt:
    // idle time between turns is not the agent being quiet on this one.
    const promptStartedAt = Date.now();
    let readAt = promptStartedAt;
    const tick = async () => {
      if (probing || current.state.settled || session.current !== current) return;
      const now = Date.now();
      for (const line of tail?.read() ?? []) {
        if (!support.statusLog!.shared) session.acp.touch();
        const signal = support.statusLog!.parse(line, sessionId!);
        if (signal?.kind === "context") context = { tokens: signal.tokens, threshold: signal.threshold };
        // A shared row was written some time after the last read; date it then, so a reply since clears it.
        else if (signal) logged = { signal, at: support.statusLog!.shared ? readAt : now };
      }
      readAt = now;
      const quietMs = now - Math.max(promptStartedAt, session.acp.lastInboundAt);
      // A running tool or an open question is already on screen.
      if (quietMs < noticeAfterMs || current.asks.size || current.runningTools.size) {
        if (quietMs < noticeAfterMs && (!support.statusLog?.shared || session.acp.lastInboundAt > (logged?.at ?? 0))) logged = null;
        previous = null;
        shownKey = null;
        noSignsSince = null;
        state = null;
        return;
      }
      // A retry stays the answer until well past its wait (Qwen's SDK
      // retries on its own for about a minute before the next logged
      // attempt); after that the probe takes over.
      if (logged?.signal.kind === "retry"
          && now - logged.at > (logged.signal.delayMs ?? 60_000) + 120_000) logged = null;
      probing = true;
      const sample = session.child.pid ? await sampleProcessTree(session.child.pid) : { cpuMs: null, connections: null };
      probing = false;
      if (current.state.settled || session.current !== current) return;
      let next = classifyQuiet({
        logged: logged?.signal ?? null, context, sample, previous, sinceMs: previous ? now - previousAt : 0,
      });
      const first = previous === null;
      previous = sample;
      previousAt = now;
      // CPU use needs two samples; the first only sets the baseline
      // (unless the log already said what is going on).
      if (first && next.kind === "unknown") return;
      // An SDK sleeping between retries holds no socket and burns no CPU
      // (Qwen against a 429ing endpoint); waiting out a usage limit ends the
      // turn as that limit so limit-failover-host can carry on.
      const verdict = quietVerdict({ next, logged, noSignsSince, now, quietMs, name: support.displayName, stuckAfterMs: ACP_STUCK_AFTER_MS });
      next = verdict.next;
      noSignsSince = verdict.noSignsSince;
      if (verdict.stop) return void session.acp.failAll(verdict.stop);
      state = next;
      const key = quietKey(next);
      if (key === shownKey || notices >= 12) return;
      shownKey = key;
      notices += 1;
      emit({
        ...base(threadId, current.turnId),
        type: "runtime.notice",
        message: describeQuiet(support.displayName, next, quietMs, promptIdleTimeoutMs()),
      });
    };
    const timer = setInterval(() => { void tick().catch(reportBackgroundError); }, tickMs);
    timer.unref?.();
    current.stopQuietWatch = () => clearInterval(timer);
    return { lastState: () => state };

  };
}

export function createSettle(deps: LifecycleDeps) {
  const { support, DRIVER_KIND, emit, base, active, sessions, armIdle } = deps;
  return (threadId: string, session: AcpSession, ok: boolean, stopReason: string | null) => {

    const current = session.current;
    if (!current || current.state.settled) return;
    current.state.settled = true;
    current.acknowledge();
    current.stopQuietWatch?.();
    if (current.interruptTimer) clearTimeout(current.interruptTimer);
    for (const finish of current.asks.values()) finish("cancel", "system");
    session.acp.failAll(new Error("turn settled"));
    // detach before the final events: a listener that starts the next
    // turn synchronously must find this session free
    session.current = null;
    active.delete(threadId);
    // `end_turn` with nothing to show for it — no reply, no image, no
    // tool result — is a lost turn, not a success. An engine can report
    // exactly that (a provider may cut a reasoning-only stream and
    // still answer end_turn), and ok:true would end the thread quietly
    // while the person's message went unanswered. A reply that is only a
    // provider's error body fails the turn in plain words instead of
    // posting the raw JSON as an answer.
    const end = endTurn(
      current,
      ok,
      stopReason,
      support.displayName,
      `${DRIVER_KIND} ended the turn with no reply, image, or tool result`,
    );
    if (end.error) emit({ ...base(threadId, current.turnId), type: "runtime.error", ...end.error });
    emit({ ...base(threadId, current.turnId), type: "turn.completed", ok: end.ok, stopReason: end.stopReason, cost: null });
    if (current.latency) {
      const latency = current.latency;
      const marks = turnTraceMarks(threadId, latency.receivedAt ?? latency.start, latency.promptAt ?? latency.start);
      console.log(turnLatencyLine(DRIVER_KIND, threadId, latency, Date.now(), end.ok ? "ok" : (end.stopReason ?? "failed"), marks));
    }
    if (session.child.exitCode === null && !session.closing && !session.dead) {
      armIdle(threadId);
    } else if (session.dead && sessions.get(threadId) === session) {
      // a dead session is never pooled; the next turn respawns
      sessions.delete(threadId);
    }

  };
}
