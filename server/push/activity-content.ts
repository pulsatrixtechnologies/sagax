// Content-state for ActivityKit push updates. Must decode into the phone's
// `BotActivityContent` (ios/Sources/CompanionCore/BotActivityContent.swift)
// with a JSONDecoder that uses default strategies: Date is seconds since
// Cocoa's reference date (2001-01-01 UTC), the same as Swift's default
// JSONEncoder. Never snake_case keys.
//
// Validated against Apple's "Starting and updating Live Activities with
// ActivityKit push notifications" (content-state matches ContentState).

/** Seconds from Unix epoch to Cocoa reference date (2001-01-01 UTC). */
export const COCOA_REFERENCE_OFFSET_SEC = 978_307_200;

/** BotActivityContent as ActivityKit push content-state. */
export interface LiveActivityContentState {
  face: string;
  kind: string;
  headline: string;
  line: string;
  threadId?: string;
  requestId?: string;
  options: string[];
  isPermission: boolean;
  /** Seconds since 2001-01-01 UTC (Swift default Date JSON). */
  since: number;
}

export type LiveActivityPhase = "working" | "needsYou" | "done" | "answered";

/** Unix ms → Cocoa reference seconds (fractional OK; ActivityKit accepts Double). */
export function cocoaSince(unixMs: number): number {
  return unixMs / 1000 - COCOA_REFERENCE_OFFSET_SEC;
}

const LINE_MAX = 240;
const HEADLINE_MAX = 120;
const OPTIONS_MAX = 10;
const OPTION_MAX = 60;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export interface LiveActivityContentInput {
  phase: LiveActivityPhase;
  botName: string;
  /** Status line under the title (ask, tool step, or body). */
  line?: string;
  threadId?: string;
  requestId?: string;
  options?: string[];
  isPermission?: boolean;
  /** When this phase began (unix ms). Default: now. */
  sinceMs?: number;
  /** Confidential thread: placeholder only, no options. */
  confidential?: boolean;
}

/** Build content-state matching BotActivityContent exactly. */
export function buildLiveActivityContentState(
  input: LiveActivityContentInput,
  nowMs: number = Date.now(),
): LiveActivityContentState {
  const name = clip(input.botName || "Bot", 80) || "Bot";
  if (input.confidential) {
    return {
      face: input.phase === "needsYou" ? "alerting" : input.phase === "working" ? "working" : "happy",
      kind: input.phase === "done" || input.phase === "answered" ? input.phase : input.phase === "needsYou" ? "needsYou" : "working",
      headline: "Fil confidentiel",
      line: "",
      ...(input.threadId?.trim() ? { threadId: input.threadId.trim() } : {}),
      options: [],
      isPermission: false,
      since: cocoaSince(input.sinceMs ?? nowMs),
    };
  }
  const phase = input.phase;
  const face = phase === "needsYou" ? "alerting" : phase === "working" ? "working" : "happy";
  const headline = phase === "needsYou" ? `${name} needs you`
    : phase === "working" ? `${name} is working`
      : phase === "answered" ? `${name}: answered`
        : `${name} is done`;
  const options: string[] = [];
  if (phase === "needsYou" && input.options?.length) {
    for (const raw of input.options) {
      const choice = clip(raw, OPTION_MAX);
      if (!choice || options.includes(choice)) continue;
      options.push(choice);
      if (options.length >= OPTIONS_MAX) break;
    }
  }
  const state: LiveActivityContentState = {
    face,
    kind: phase,
    headline: clip(headline, HEADLINE_MAX),
    line: clip(input.line ?? "", LINE_MAX),
    options: phase === "needsYou" ? options : [],
    isPermission: phase === "needsYou" ? input.isPermission === true : false,
    since: cocoaSince(input.sinceMs ?? nowMs),
  };
  if (input.threadId?.trim()) state.threadId = input.threadId.trim();
  if (phase === "needsYou" && input.requestId?.trim()) state.requestId = input.requestId.trim().slice(0, 128);
  return state;
}

/** Final "done" card from a prior content-state (mirrors LiveActivityPlan.done). */
export function doneContentState(
  prior: LiveActivityContentState,
  nowMs: number = Date.now(),
): LiveActivityContentState {
  return {
    face: "happy",
    kind: "done",
    headline: prior.headline.replace(/\s+needs you$/i, " is done").replace(/\s+is working$/i, " is done"),
    line: prior.line,
    ...(prior.threadId ? { threadId: prior.threadId } : {}),
    options: [],
    isPermission: false,
    since: cocoaSince(nowMs),
  };
}

/** Relevance score matching LiveActivityPlan.relevance on the phone. */
export function liveActivityRelevance(kind: string): number {
  switch (kind) {
    case "needsYou": return 100;
    case "working":
    case "answered": return 50;
    default: return 0;
  }
}
