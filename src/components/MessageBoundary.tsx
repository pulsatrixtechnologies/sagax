import { Component, type ReactNode } from "react";
import { t } from "@/lib/i18n";

/** One bad markdown node must not white-screen the app: the transcript
 * degrades to a plain-text bubble instead. Rooms use the same boundary. */
export class MessageBoundary extends Component<{ children: ReactNode; fallbackText: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="chat-text w-fit max-w-[min(80%,560px,calc(100%-82px))] rounded-[18px] bg-card px-3 py-[7px] text-[13px] leading-5 whitespace-pre-wrap text-ink">
          {this.props.fallbackText}
        </div>
      );
    }
    return this.props.children;
  }
}

function asTrimmedString(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    return value.trim();
  } catch {
    return "";
  }
}

/** Plain words for a step fallback: tool name / title / summary / text.
 * Never throws; every field access is guarded. */
export function stepFallbackText(source: unknown): string {
  try {
    if (!source || typeof source !== "object") return "";
    const record = source as Record<string, unknown>;
    const tool = record.tool && typeof record.tool === "object"
      ? (record.tool as Record<string, unknown>)
      : null;
    const candidates = [
      tool ? asTrimmedString(tool.spoken) : "",
      tool ? asTrimmedString(tool.summary) : "",
      tool ? asTrimmedString(tool.name) : "",
      asTrimmedString(record.summary),
      asTrimmedString(record.name),
      asTrimmedString(record.title),
      asTrimmedString(record.text),
    ];
    for (const candidate of candidates) {
      if (candidate) return candidate;
    }
    return "";
  } catch {
    return "";
  }
}

export function stepIdOf(source: unknown): string | undefined {
  try {
    if (!source || typeof source !== "object") return undefined;
    const id = (source as Record<string, unknown>).id;
    return typeof id === "string" && id.trim() ? id : undefined;
  } catch {
    return undefined;
  }
}

/** One bad tool step (or ActivityRun label) must not blank the window: the
 * step degrades to its raw text plus a short line, and siblings keep drawing. */
export class StepBoundary extends Component<
  { children: ReactNode; stepId?: string; fallbackText?: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    const id = typeof this.props.stepId === "string" && this.props.stepId.trim()
      ? this.props.stepId
      : "unknown";
    const message = error instanceof Error ? error.message : String(error);
    console.error(`step failed to draw (${id}): ${message}`);
  }
  render() {
    if (this.state.failed) {
      let raw = "";
      try {
        raw = typeof this.props.fallbackText === "string" ? this.props.fallbackText.trim() : "";
      } catch {
        raw = "";
      }
      return (
        <div
          data-step-failed
          className="w-fit max-w-[min(80%,560px,calc(100%-82px))] rounded-md border border-hairline/40 bg-card px-3 py-2 text-[12.5px] leading-5 text-ink"
        >
          {raw ? <p className="whitespace-pre-wrap break-words">{raw}</p> : null}
          <p className="text-[12px] text-ink-secondary">{t("chat.stepFailed")}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

/** The kinds this version knows how to draw. A newer server may send others. */
const KNOWN_KINDS = new Set([
  "text", "options", "activity", "screen", "video", "secret", "productKey", "routine.run",
  "goal.run", "digest", "compaction", "access", "nudge", "call", "widget", "routines",
]);

export function isUnknownMessageKind(kind: string | undefined): boolean {
  return kind !== undefined && !KNOWN_KINDS.has(kind);
}

/** Readable fallback for a message type from a newer version: its text when
 * it has one, and a line saying to update for the full message. */
export function UnknownMessageCard({ text }: { text?: string }) {
  return (
    <div data-unknown-message className="w-fit max-w-[min(80%,560px,calc(100%-82px))] rounded-[18px] border border-hairline/40 bg-card px-3 py-[7px] text-[13px] leading-5 text-ink">
      {text?.trim() ? <p className="chat-text whitespace-pre-wrap">{text}</p> : null}
      <p className="text-[12px] text-ink-secondary">{t("chat.unknownMessage")}</p>
    </div>
  );
}
