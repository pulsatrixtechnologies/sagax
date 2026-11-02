/** Timeouts and limits shared by the ACP driver phases. */
export const envOr = (key: string, fallback: number): number => Number(process.env[key] ?? fallback);
export const INIT_TIMEOUT = 300_000;
export const SESSION_CONFIG_TIMEOUT = 300_000; // configureSession's per-request default
export const NEW_SESSION_TIMEOUT = 300_000;
export const LOAD_SESSION_TIMEOUT = 120_000; // history replay on a long thread is slow
/** How long a quiet agent shows no sign of life before it is called stuck. */
export const ACP_STUCK_AFTER_MS = 180_000;
/** How long an agent gets to answer session/cancel before its process is
 * closed. A person's stop must free the conversation in under 2 s
 * (2026-10-28); an agent that ignores the cancel is reloaded next turn. */
export const ACP_CANCEL_GRACE_MS = 1_500;
/** ACP agents may compact their own history without telling the client;
 * re-send the full prompt after this many bare turns as a backstop to
 * compaction detection. */
export const ACP_PROMPT_RE_ANCHOR_TURNS = 8;
/** A reported context below this share of the peak marks a compaction.
 * OpenCode compactions measured 30-52% of the peak; ordinary dips stay
 * above 83%. A false alarm costs one extra full prompt. */
export const ACP_COMPACTION_COLLAPSE_RATIO = 0.6;
// Read lazily (not at import) so a test can shorten the window. Unlike the
// setup calls above, session/prompt legitimately streams for minutes, so a
// wall-clock deadline would false-positive: this guard only trips when the
// child sends nothing at all for the whole window (a wedged OpenCode turn
// streams thought chunks, then goes silent forever and never resolves). 0
// disables the guard, restoring the pre-fix "hang until the user cancels"
// behavior.
//
// Healthy agents go silent for minutes too. Qwen Code 0.24 sends nothing
// over ACP while it compresses history, while it backs off a rate limit
// (60 s up to 5 min per wait), or while one model request runs (its SDK
// waits up to 600 s). The old 180 s default killed those turns mid-work,
// and the retry redid it all. A false trip costs the whole turn; a real
// wedge only costs waiting, and the user can press Stop - so the default
// sits above the longest normal silence.
export const DEFAULT_ACP_PROMPT_IDLE_MS = 15 * 60_000;
export const promptIdleTimeoutMs = (): number => {
  const raw = process.env.SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_ACP_PROMPT_IDLE_MS;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
};
export const formatQuietLimit = (ms: number): string =>
  ms >= 120_000 && ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`;

export const CLIENT_FILE_MAX_BYTES = 8 * 1024 * 1024;
