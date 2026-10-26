import { Component, type ReactNode } from "react";
import { t } from "@/lib/i18n";

/** One bad markdown node must not white-screen the app — the transcript
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

/** The kinds this version knows how to draw. A newer server may send others. */
const KNOWN_KINDS = new Set([
  "text", "options", "activity", "screen", "video", "secret", "routine.run",
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
