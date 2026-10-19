// What each engine really does, as flags (docs/runtime-contract.md §8).
// The level rule (level.ts) and the continuation rule read these, never
// driver names. The approval flags come from shared/approval-mode.ts, the
// one place that knows which provider mode each level maps to; the rest
// is read off the drivers themselves, and every row says where.
//
// No import from server/drivers: this module must stay cheap and pure, and
// the drivers pull in the whole provider stack. The table test
// (capabilities.test.ts) walks BUILT_IN_DRIVERS instead, so an engine added
// without a row here fails that test.
import { hasNativeAutoReview, supportsApprovalMode } from "../../shared/approval-mode.ts";

export interface EngineCapabilities {
  /** Keeps a native session: a later turn resumes it through resumeCursor
   * (the session id, thread id or session file the driver persisted), so
   * tool results from earlier turns are still in the model's context. */
  resume: boolean;
  /** Under Auto the provider's own reviewer decides what is safe; without
   * one, Auto would be a rubber stamp (hasNativeAutoReview). */
  nativeReviewer: boolean;
  /** Runs Full access: residual prompts are answered, by the provider or by
   * the harness's own tool gate for the chat family (supportsApprovalMode). */
  full: boolean;
  /** Has an auto-accept-edits mode of its own (supportsApprovalMode). */
  edits: boolean;
  /** Model steps a turn may take before the driver stops it with "ask only
   * for what's left". Absent where the engine bounds its own turns. */
  stepCap?: number;
  /** Runs native subagents of its own inside a turn. None does today: a
   * named teammate takes part only through an assignment of its own. */
  subagents: boolean;
}

/** The chat-completions family's step cap: MAX_CHAT_ROUNDS in
 * server/drivers/openai-chat.ts:158. The stop asks only for what is left,
 * and the next turn is rebuilt from the text transcript (:557), which holds
 * none of the tool results, so the continuation rule needs this number. */
const CHAT_STEP_CAP = 64;

type EngineRow = Pick<EngineCapabilities, "resume" | "stepCap">;

/** Per engine, what approval-mode.ts does not say. Keys are the drivers'
 * `driverKind` values (server/drivers/builtIn.ts registers them). */
const ENGINES: Readonly<Record<string, EngineRow>> = {
  // Native sessions a later turn resumes through resumeCursor.
  claudeAgent: { resume: true }, // claude.ts:1546 `--resume <sessionId>`
  codex: { resume: true }, // codex.ts:1885 thread/resume with the codex thread id
  piAgent: { resume: true }, // pi.ts:1175 switch_session with the session file
  antigravityAgent: { resume: true }, // antigravity.ts:78 resumeMethod "resume", through acp/core.ts:1930
  // The ACP family: acp/core.ts:1913 takes the cursor and :1930 sends
  // session/load (session/new with the replay when the agent refuses it,
  // server/resume-recovery.ts); a pooled process keeps the live session
  // either way.
  grokAgent: { resume: true }, // acp/grok.ts:349
  geminiAgent: { resume: true }, // acp/gemini.ts:86
  kimiAgent: { resume: true }, // acp/kimi.ts:500 (loadSession:true, :6)
  droidAgent: { resume: true }, // acp/droid.ts:217 (loadSession:true, :5)
  cursorAgent: { resume: true }, // acp/cursor.ts:387
  museCode: { resume: true }, // muse-code.ts session/resume with the Muse session id
  opencodeGo: { resume: true }, // acp/opencode-go.ts:838
  qwenAgent: { resume: true }, // acp/qwen.ts:219
  hermesAgent: { resume: true }, // acp/hermes.ts:418
  clineAgent: { resume: true }, // acp/cline.ts:56
  customAcp: { resume: true }, // acp/custom.ts:21
  // The chat-completions family (createOpenAIChatRuntime, openai-chat.ts):
  // no native session, every turn replays the transcript, MAX_CHAT_ROUNDS
  // steps per turn.
  "openai-compat": { resume: false, stepCap: CHAT_STEP_CAP }, // openai-compat.ts:6
  grok: { resume: false, stepCap: CHAT_STEP_CAP }, // grok.ts:6
  minimax: { resume: false, stepCap: CHAT_STEP_CAP }, // minimax.ts:11
  mistral: { resume: false, stepCap: CHAT_STEP_CAP }, // mistral.ts:48
  cerebras: { resume: false, stepCap: CHAT_STEP_CAP }, // cerebras.ts:41
  groq: { resume: false, stepCap: CHAT_STEP_CAP }, // groq.ts:41
  meta: { resume: false, stepCap: CHAT_STEP_CAP }, // meta.ts:54
};

/** The engines with a row, for the table test. */
export const ENGINE_KINDS: readonly string[] = Object.keys(ENGINES);

/** An unknown or absent engine gets the conservative answer on every flag:
 * no resume, no reviewer, no Full, no Edits, no cap known. */
export function engineCapabilities(driverKind: string | undefined): EngineCapabilities {
  const row = driverKind !== undefined && Object.hasOwn(ENGINES, driverKind) ? ENGINES[driverKind] : undefined;
  return {
    resume: row?.resume ?? false,
    nativeReviewer: hasNativeAutoReview(driverKind),
    full: supportsApprovalMode(driverKind, "full"),
    edits: supportsApprovalMode(driverKind, "edits"),
    ...(row?.stepCap === undefined ? {} : { stepCap: row.stepCap }),
    subagents: false,
  };
}
