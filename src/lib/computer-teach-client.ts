// Teach by demonstration on the bot's whole computer, from the app's desktop
// viewer (parity R7, system 11; server/routes/computer-teach.ts). The viewer
// reports where the person clicks (fractions of the remote screen), Enter,
// Tab and Escape, and that they type. The characters never leave the viewer.
import { api } from "@/state/store";
import type { TeachStep } from "../../shared/teach-recording";

export type ComputerTeachEvent =
  | { kind: "click"; x: number; y: number }
  | { kind: "key"; key: "Enter" | "Tab" | "Escape" }
  | { kind: "typing" };

/** A point inside the remote screen's picture, as fractions; null beside it. */
export function pointFraction(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } | null {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

const NAMED = new Set(["Enter", "Tab", "Escape"]);
const EDITING = new Set(["Backspace", "Delete"]);

/** What a key press is worth to the recording: a named key, "typing", or
 * nothing (a modifier, a shortcut, a navigation key). */
export function keyEvent(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): ComputerTeachEvent | null {
  if (NAMED.has(event.key)) return { kind: "key", key: event.key as "Enter" | "Tab" | "Escape" };
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key.length === 1 || EDITING.has(event.key)) return { kind: "typing" };
  return null;
}

const BOT_ID = /^[\w-]{1,128}$/;

/** The app's own viewer (/desktop-viewer#…) learns which bot it shows, so
 * it can offer Teach; any other viewer address is left as it is. */
export function withTeachBot(viewerUrl: string, bot: { id: string; name: string }, origin = location.origin): string {
  let url: URL;
  try { url = new URL(viewerUrl, origin); } catch { return viewerUrl; }
  if (url.origin !== origin || url.pathname !== "/desktop-viewer" || !BOT_ID.test(bot.id)) return viewerUrl;
  const params = new URLSearchParams(url.hash.slice(1));
  params.set("bot", bot.id);
  params.set("botName", bot.name.slice(0, 80));
  url.hash = params.toString();
  return url.href;
}

export function teachViewerParams(hash: string): { botId: string; botName: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const botId = params.get("bot") ?? "";
  if (!BOT_ID.test(botId)) return null;
  return { botId, botName: (params.get("botName") ?? "").slice(0, 80) };
}

const path = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/computer/teach`;

export function teachAction(botId: string, body: { action: "start" | "discard" } | { action: "event"; event: ComputerTeachEvent }): Promise<unknown> {
  return api(path(botId), { method: "POST", body: JSON.stringify(body) });
}

export function teachStatus(botId: string): Promise<{ recording: boolean; ended?: "control_lost" }> {
  return api(path(botId));
}

export function stopTeach(botId: string): Promise<{ steps?: TeachStep[]; recordedAt?: string; expired?: boolean }> {
  return api(path(botId), { method: "POST", body: JSON.stringify({ action: "stop" }) });
}
