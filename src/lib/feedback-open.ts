// The one action every feedback entry point calls (#2618): the sidebar
// button, Help > Send Feedback…, Cmd/Ctrl+Shift+F and an error card's
// "Report this problem". It attaches what the app knows (version, OS,
// platform, page, the window's own screenshot, recent console lines), asks
// the server to open a report with the shared Feedback bot, and returns the
// bot and thread to open. Anonymization happens on the server.
import type { FeedbackSource, FeedbackStartRequest, FeedbackStartResponse } from "../../shared/feedback";

export interface FeedbackOpenDeps {
  post(body: FeedbackStartRequest): Promise<FeedbackStartResponse>;
  capture?: () => Promise<string | null>;
  appVersion?: string;
  userAgent?: string;
  desktop: boolean;
  page?: string;
  locale: string;
  logs?: () => string[];
}

export interface FeedbackOpenOptions {
  source: FeedbackSource;
  error?: string;
  /** The words typed after /feedback. */
  text?: string;
}

/** A short OS name from the user agent: never the full string. */
export function osFromUserAgent(userAgent: string | undefined): string | undefined {
  const agent = userAgent ?? "";
  const mac = /Mac OS X (\d+[._]\d+(?:[._]\d+)?)/.exec(agent);
  if (/iPhone|iPad/.test(agent)) return `iOS ${/OS (\d+[._]\d+)/.exec(agent)?.[1]?.replace(/_/g, ".") ?? ""}`.trim();
  if (mac) return `macOS ${mac[1]!.replace(/_/g, ".")}`;
  if (/Macintosh/.test(agent)) return "macOS";
  const windows = /Windows NT (\d+\.\d+)/.exec(agent);
  if (windows) return `Windows NT ${windows[1]}`;
  if (/Android/.test(agent)) return "Android";
  if (/Linux/.test(agent)) return "Linux";
  return undefined;
}

export async function requestFeedback(deps: FeedbackOpenDeps, options: FeedbackOpenOptions): Promise<FeedbackStartResponse> {
  const screenshot = deps.capture ? await deps.capture().catch(() => null) : null;
  const logs = deps.logs?.().slice(-40) ?? [];
  const body: FeedbackStartRequest = {
    source: options.source,
    platform: deps.desktop ? "desktop" : "web",
    locale: deps.locale.toLowerCase().startsWith("en") ? "en" : "fr",
    ...(deps.appVersion ? { appVersion: deps.appVersion } : {}),
    ...(osFromUserAgent(deps.userAgent) ? { os: osFromUserAgent(deps.userAgent) } : {}),
    ...(deps.page ? { page: deps.page } : {}),
    ...(options.error ? { error: options.error.slice(0, 4000) } : {}),
    ...(options.text?.trim() ? { text: options.text.trim().slice(0, 4000) } : {}),
    ...(logs.length ? { clientLogs: logs } : {}),
    ...(screenshot?.startsWith("data:image/png;base64,") ? { screenshot } : {}),
  };
  return deps.post(body);
}
