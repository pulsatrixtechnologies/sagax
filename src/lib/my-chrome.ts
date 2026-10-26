// My Chrome on the client: the status the server sends (server/routes/my-chrome.ts)
// and the calls that change it. Every call is a POST: on the desktop a loopback
// change needs the app's own capability, so no other local process reads it.
import { api } from "@/state/store";

export const MY_CHROME_PROFILE = "my-chrome";

export interface MyChromeStatus {
  offered: boolean;
  enabled: boolean;
  stopped: boolean;
  sites: Array<{ origin: string; addedAt: number }>;
  chromeAddress: string;
  unavailable: string | null;
  connected: boolean;
  lastActionAt: number;
  /** Bots with a terminal on this computer: they keep their own browser. */
  shellBotIds: string[];
  driving: Array<{ botId: string; botName: string; tabs: Array<{ url: string; title: string }> }>;
}

export function myChromeCall(action: "status" | "enable" | "sites" | "sites/revoke" | "address" | "stop" | "resume", body: Record<string, unknown> = {}): Promise<MyChromeStatus> {
  return api<MyChromeStatus>(`/api/my-chrome/${action}`, { method: "POST", body: JSON.stringify(body) });
}

/** The origin of a tab, for a short label; the URL itself when it has none. */
export function tabOrigin(url: string): string {
  try { return new URL(url).origin; } catch { return url; }
}

/** Status changed in this window (Settings or the banner): listeners read it again now. */
export const MY_CHROME_CHANGED = "sagax:my-chrome-changed";

export function announceMyChrome(status: MyChromeStatus): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<MyChromeStatus>(MY_CHROME_CHANGED, { detail: status }));
}
