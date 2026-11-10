// What the app attaches when the person types /feedback (#2618, #3299):
// version, OS, surface, page and recent console lines (no picture: a
// picture cannot be anonymized). The command goes to the chat it is typed in; the server reads that
// chat, anonymizes everything and shows the exact report before it leaves.
import type { FeedbackAppContext } from "../../shared/feedback";

export interface FeedbackContextDeps {
  appVersion?: string;
  userAgent?: string;
  desktop: boolean;
  page?: string;
  locale: string;
  logs?: () => string[];
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

export function feedbackAppContext(deps: FeedbackContextDeps): FeedbackAppContext {
  const logs = deps.logs?.().slice(-40) ?? [];
  const os = osFromUserAgent(deps.userAgent);
  return {
    platform: deps.desktop ? "desktop" : "web",
    locale: deps.locale.toLowerCase().startsWith("en") ? "en" : "fr",
    ...(deps.appVersion ? { appVersion: deps.appVersion } : {}),
    ...(os ? { os } : {}),
    ...(deps.page ? { page: deps.page } : {}),
    ...(logs.length ? { clientLogs: logs } : {}),
  };
}
