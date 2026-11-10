// In-app feedback (#2618, #3299): `/feedback` typed in any chat is the one
// way in. The server reads the chat it is typed in, builds a precise,
// anonymized GitHub issue, shows the person the exact text and files it
// (server/feedback/). No bot of its own, no sidebar button, no card that
// offers a report on its own: a bot that hears frustration with Sagax tells
// the person to type /feedback (server/system-prompt.ts). This file holds the
// shared words: the filing labels and what the app attaches to the command.

export type FeedbackKind = "bug" | "idea" | "question";
export const FEEDBACK_KINDS: readonly FeedbackKind[] = ["bug", "idea", "question"];

/** Where a report stands, read from its issue (server/feedback/github.ts).
 * "queued": not filed yet (no token configured, or the last try failed). */
export type FeedbackStatus = "queued" | "sent" | "received" | "in_progress" | "resolved";

/** What opened the report: the slash command, the one way in (#3299). */
export type FeedbackSource = "slash";

/** The surface the person used. */
export type FeedbackPlatform = "desktop" | "ios" | "web";
export const FEEDBACK_PLATFORMS: readonly FeedbackPlatform[] = ["desktop", "ios", "web"];

/** Labels every filed report carries, plus the kind's own label. The
 * untriaged flag is what the team filters on before handling them. */
export const FEEDBACK_LABEL = "feedback";
export const FEEDBACK_UNTRIAGED_LABEL = "feedback:untriaged";
export const FEEDBACK_IN_PROGRESS_LABEL = "feedback:in-progress";
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = { bug: "bug", idea: "enhancement", question: "question" };

/** What the app attaches on its own when it sends `/feedback` (the
 * `feedback` field of POST /api/bots/:id/messages). Everything is
 * anonymized again on the server before it reaches an issue. */
export interface FeedbackAppContext {
  platform: FeedbackPlatform;
  appVersion?: string;
  os?: string;
  /** The page the person was on (a route name, never a URL with ids). */
  page?: string;
  /** The app's own recent console lines. */
  clientLogs?: string[];
  locale?: "fr" | "en";
}

/** One report as its author sees it (GET /api/feedback). */
export interface FeedbackReportView {
  id: string;
  kind: FeedbackKind;
  title: string;
  status: FeedbackStatus;
  createdAt: number;
  issueNumber?: number;
  issueUrl?: string;
}

/** The marker the server puts on its feedback messages, so the next answer
 * knows what it answers: "detail" is the one question it may ask, "preview"
 * the Send card. "offer" marks a card older versions offered on their own
 * after a frustrated message; it answers nothing now (#3299). Server-side only. */
export type FeedbackStep = "detail" | "preview" | "offer" | "status";

export function isFeedbackCommand(text: string): boolean {
  return /^\/feedback\b/i.test(text.trim());
}
