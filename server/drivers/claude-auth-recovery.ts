import { TurnAuthenticationRefusedError, type RuntimeEvent, type SendTurnInput } from "../contracts.ts";
import { classifyError } from "./retry.ts";

type Frame = {
  type?: string; subtype?: string; error?: unknown; is_api_error_message?: unknown;
  is_error?: unknown; isReplay?: unknown; total_cost_usd?: unknown;
  message?: { model?: unknown; content?: unknown };
};
type Pending = { refusal?: string; refused?: boolean; buffered: RuntimeEvent[]; settle: (error?: Error) => void };

/** Only CLI-marked API errors count; assistant prose about signing out does not. */
export function claudeAuthFailure(frame: { error?: unknown; is_api_error_message?: unknown }, text: string): boolean {
  if (frame.is_api_error_message !== true && typeof frame.error !== "string") return false;
  return frame.error === "authentication_failed" || classifyError({ text }).reason === "auth";
}

function syntheticRefusal(frame: Frame): string | undefined {
  const content = frame.message?.content;
  if (frame.type !== "assistant" || frame.message?.model !== "<synthetic>" || frame.error !== "authentication_failed" ||
      frame.is_api_error_message !== true || !Array.isArray(content) || content.length === 0 ||
      !content.every(block => block?.type === "text" && typeof block.text === "string")) return undefined;
  return content.map(block => block.text).join("");
}

// Claude Code 2.1.296 sends `system/status "requesting"` before a signed-out refusal; neither it nor init is model activity.
const preamble = (frame: Frame) =>
  frame.type === "system" && (frame.subtype === "init" || frame.subtype === "status") || frame.type === "user" && frame.isReplay === true;

/** Holds a recoverable turn's ACK and events until its first model activity, so a signed-out refusal rejects it once its process has stopped. */
export function claudeAuthRecovery(
  publish: (event: RuntimeEvent) => void,
  retire: (threadId: string) => Promise<boolean>,
  busy: (threadId: string) => boolean,
) {
  const pending = new Map<string, Pending>();
  const accept = (threadId: string, held: Pending) => {
    if (pending.get(threadId) !== held) return;
    pending.delete(threadId);
    held.settle();
    for (const event of held.buffered) publish(event);
  };
  return {
    frame(threadId: string, frame: Frame, priorCost?: number | null) {
      const held = pending.get(threadId);
      if (!held || preamble(frame)) return;
      const refusal = syntheticRefusal(frame);
      if (refusal) held.refusal = refusal;
      else if (held.refusal && frame.type === "result" && frame.is_error === true &&
          (frame.total_cost_usd === undefined || frame.total_cost_usd === 0 || frame.total_cost_usd === priorCost)) held.refused = true;
      else accept(threadId, held);
    },
    emit(event: RuntimeEvent) {
      const held = pending.get(event.threadId);
      if (!held || event.type === "turn.started" || event.type === "session.started") return publish(event);
      if (held.refusal && event.type === "runtime.error" && event.setup && event.message === held.refusal) return void held.buffered.push(event);
      if (held.refused && event.type === "turn.completed" && !event.ok && event.stopReason === "auth_required" && typeof event.turnId === "string") {
        const turnId = event.turnId;
        held.buffered.push(event);
        return void retire(event.threadId).then(stopped => {
          if (pending.get(event.threadId) !== held) return;
          if (!stopped) return accept(event.threadId, held);
          pending.delete(event.threadId);
          held.settle(new TurnAuthenticationRefusedError(turnId, held.refusal!));
        }, () => accept(event.threadId, held));
      }
      accept(event.threadId, held);
      publish(event);
    },
    async send(turn: SendTurnInput, dispatch: (turn: SendTurnInput) => Promise<{ turnId: string }>) {
      if (!turn.startupRecovery || pending.has(turn.threadId) || busy(turn.threadId)) return dispatch(turn);
      let settle!: Pending["settle"];
      const done = new Promise<void>((resolve, reject) => { settle = error => error ? reject(error) : resolve(); });
      void done.catch(() => {});
      const held: Pending = { buffered: [], settle };
      pending.set(turn.threadId, held);
      try {
        const result = await dispatch(turn);
        await done;
        return result;
      } catch (error) {
        accept(turn.threadId, held);
        throw error;
      }
    },
  };
}
