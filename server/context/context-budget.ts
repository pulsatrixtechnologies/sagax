import type { ModelCatalog } from "../contracts.ts";
import { modelContextWindow } from "../models/model-context-window.ts";

export const DEFAULT_CONTEXT_WINDOW = 128_000;
const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function contextWindowFor(model: string | undefined, catalog?: ModelCatalog, reported?: number): number {
  if (positive(reported)) return reported;
  const declared = catalog?.options.find((option) => option.id === model)?.contextWindow;
  if (positive(declared)) return declared;
  const inferred = model ? modelContextWindow(model) : undefined;
  return positive(inferred) ? inferred : DEFAULT_CONTEXT_WINDOW;
}

/** Sagax's own fold point for an engine when the server sets none
 * (config context.compactAt wins). Grok: half the window by default
 * (SAGAX_GROK_COMPACT_PERCENT, 10-90), so a long thread is summarised before
 * its whole context has to be read again after the provider's cache
 * expired: measured on production, 94-173k uncached tokens took 8.7-19.8 s to the
 * first update, against ~1.5 s for a 15-30k conversation. */
export function defaultCompactAt(driverKind: string, env: NodeJS.ProcessEnv = process.env): number | undefined {
  if (driverKind !== "grokAgent") return undefined;
  const raw = env.SAGAX_GROK_COMPACT_PERCENT;
  const percent = raw !== undefined && raw.trim() !== "" ? Number(raw) : 50;
  return Number.isFinite(percent) && percent >= 10 && percent <= 90 ? percent / 100 : 0.5;
}

/** Leave headroom even for a small local model. An 8k lower bound would
 * make compaction unreachable on models whose entire window is 8k. */
export function compactBudget(window: number, compactAt?: number, nativeCompactAt?: number): number {
  if (!positive(window)) throw new Error("invalid model context window");
  const configured = positive(compactAt) ? (compactAt < 1 ? window * compactAt : compactAt) : window * 0.8;
  return Math.max(1, Math.floor(Math.min(configured, window * 0.9, positive(nativeCompactAt) ? nativeCompactAt * 0.9 : Infinity)));
}

export function shouldCompact(input: { contextTokens?: number; estimatedBytes: number; budget: number; floor?: number; window: number; nativeCompactAt?: number }): boolean {
  // Summed input across tool rounds is NOT a context-window measurement.
  const size = positive(input.contextTokens) ? input.contextTokens : Math.ceil(input.estimatedBytes / 4);
  // Regrowth avoids repeatedly folding an irreducible prompt, but cannot
  // delay the harness beyond a known provider-native compaction boundary.
  const ceiling = compactBudget(input.window, input.window, input.nativeCompactAt);
  const threshold = Math.min(ceiling, positive(input.floor) ? Math.max(input.budget, input.floor * 1.25) : input.budget);
  return size >= threshold;
}

/** Where an engine starts compacting its own session, in tokens, when Sagax
 * can know it. Sagax folds the thread itself below this point (compactBudget
 * keeps 10% under it), so the engine's own summarizer, which drops what it
 * likes and says so in its own words, is the rare backstop of a single very
 * long turn rather than the normal path.
 *
 * Values are the engines' documented or observed defaults on 2026-10-08:
 * - Claude Code: the --autocompact window Sagax passes (claudeWindow).
 * - Codex: model_auto_compact_token_limit defaults near 90% of the window.
 * - Gemini CLI: model.compressionThreshold, 0.5 of the window in recent
 *   releases (0.7 in older ones); the lower one is used.
 * - Qwen Code: its debug log reports auto=167000 of a 200000 limit.
 * - pi: compacts when the context passes the window less 16384 reserved.
 * - Other ACP agents (Kimi Code, Grok, OpenCode, Cursor, Droid, Hermes,
 *   custom): undocumented, so 80% is assumed, the earliest seen in practice.
 * Engines that resend the stored transcript every turn (the OpenAI chat
 * drivers) and the boat's remote agent have no session Sagax could lose
 * to a native compaction here: undefined. */
export function nativeCompactionPoint(driverKind: string, window: number, claudeWindow?: number): number | undefined {
  if (!positive(window)) return undefined;
  switch (driverKind) {
    case "claudeAgent": return positive(claudeWindow) ? claudeWindow : undefined;
    case "codex": return Math.floor(window * 0.9);
    case "geminiAgent": return Math.floor(window * 0.5);
    case "qwenAgent": return Math.floor(window * 0.835);
    case "piAgent": return window > 32_768 ? window - 16_384 : Math.floor(window * 0.5);
    case "kimiAgent": case "grokAgent": case "opencodeGo": case "cursorAgent": case "droidAgent":
    case "hermesAgent": case "customAcp": case "antigravityAgent":
      return Math.floor(window * 0.8);
    default: return undefined;
  }
}
