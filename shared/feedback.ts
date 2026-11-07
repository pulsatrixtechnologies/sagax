// In-app feedback (#2618): the shared words of the Feedback bot, the
// filing labels and the light frustration heuristic every bot uses to offer
// a ready-made report. The server runs the conversation and files the issue
// (server/feedback/); the apps only open it (one shared action) and show its
// cards with the ordinary option card.

export type FeedbackKind = "bug" | "idea" | "question";
export const FEEDBACK_KINDS: readonly FeedbackKind[] = ["bug", "idea", "question"];

/** Where a report stands, read from its issue (server/feedback/github.ts).
 * "queued": not filed yet (no token configured, or the last try failed). */
export type FeedbackStatus = "queued" | "sent" | "received" | "in_progress" | "resolved";

/** What opened the Feedback conversation. */
export type FeedbackSource = "sidebar" | "menu" | "shortcut" | "slash" | "shake" | "error" | "frustration" | "chat";
export const FEEDBACK_SOURCES: readonly FeedbackSource[] = ["sidebar", "menu", "shortcut", "slash", "shake", "error", "frustration", "chat"];

export type FeedbackPlatform = "desktop" | "ios" | "web";

/** Labels every filed report carries, plus the kind's own label. The
 * untriaged flag is what the team filters on before handling them. */
export const FEEDBACK_LABEL = "feedback";
export const FEEDBACK_UNTRIAGED_LABEL = "feedback:untriaged";
export const FEEDBACK_IN_PROGRESS_LABEL = "feedback:in-progress";
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = { bug: "bug", idea: "enhancement", question: "question" };

/** POST /api/feedback/start: what the app attaches on its own. */
export interface FeedbackStartRequest {
  source: FeedbackSource;
  platform: FeedbackPlatform;
  appVersion?: string;
  os?: string;
  /** The page the person was on (a route name, never a URL with ids). */
  page?: string;
  /** An error card's own words, when the report starts from one. */
  error?: string;
  /** The app's own recent console lines (expurgated again on the server). */
  clientLogs?: string[];
  /** A PNG of the Sagax window itself (data URL), captured by the app. */
  screenshot?: string;
  locale?: "fr" | "en";
}

export interface FeedbackStartResponse {
  botId: string;
  threadId: string;
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

/** The marker the server puts on the Feedback bot's own messages, so the
 * next answer knows which question it answers. Server-side only. */
export type FeedbackStep = "kind" | "steps" | "expected" | "actual" | "describe" | "impact" | "followup" | "preview" | "offer" | "status";

export function isFeedbackCommand(text: string): boolean {
  return /^\/feedback\b/i.test(text.trim());
}

const SWEARS = [
  "merde", "calisse", "câlisse", "caliss", "tabarnak", "tabarnac", "tabarnaque", "osti", "ostie", "hostie", "crisse", "ciboire", "sacrament", "putain", "bordel",
  "fuck", "fucking", "shit", "wtf", "damn", "crap", "ffs",
];
const BROKEN = [
  /\bça\s+marche\s+pas\b/i, /\bca\s+marche\s+pas\b/i, /\bmarche\s+(?:toujours\s+|encore\s+)?pas\b/i, /\bfonctionne\s+(?:toujours\s+|encore\s+)?pas\b/i,
  /\bne\s+fonctionne\s+pas\b/i, /\btoujours\s+pas\b/i, /\bencore\s+cass[ée]\b/i, /\bc'est\s+cass[ée]\b/i,
  /\bdoes(?:n't|\s+not)\s+work\b/i, /\bnot\s+working\b/i, /\bstill\s+(?:broken|not)\b/i, /\bbroken\s+again\b/i, /\bdon'?t\s+work\b/i,
];

export type FrustrationReason = "swearing" | "broken" | "repeat" | "shouting";

function normalized(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function words(text: string): Set<string> {
  return new Set(normalized(text).split(" ").filter((word) => word.length > 1));
}

function similar(a: string, b: string): boolean {
  const left = words(a);
  const right = words(b);
  if (left.size < 3 || right.size < 3) return normalized(a) === normalized(b) && normalized(a).length >= 8;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared) >= 0.8;
}

/** Whether a person's message reads as frustration: swearing, "it does not
 * work", the same request again, or a message in capitals. `earlier` is the
 * person's previous messages in the same conversation, newest last. */
export function frustrationSignal(text: string, earlier: readonly string[] = []): FrustrationReason | null {
  const plain = normalized(text);
  if (!plain) return null;
  const tokens = new Set(plain.split(" "));
  if (SWEARS.some((swear) => tokens.has(normalized(swear)))) return "swearing";
  if (BROKEN.some((pattern) => pattern.test(text) || pattern.test(plain))) return "broken";
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  const upper = letters.filter((ch) => ch === ch.toUpperCase() && ch !== ch.toLowerCase());
  if (letters.length >= 12 && upper.length / letters.length >= 0.75) return "shouting";
  if (earlier.slice(-3).some((previous) => similar(previous, text))) return "repeat";
  return null;
}
