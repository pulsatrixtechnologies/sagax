// The places the screen side panel (#4452, lot d) can show for the person's
// own bot: its browser, its VM (the server environment, or the Local VM on the
// person's computer) and the remote computer it controls. Only places the bot
// really has are listed (a missing place is hidden, never greyed). Pure rules
// here; the panel (ScreenPanel) and its hook (useScreenPlaces) use them.
import type { RemoteSessionView } from "../../shared/remote-session";
import type { ServerEnvironmentStatus } from "@/lib/server-environment";
import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { effectivePlace, orgComputerFor } from "@/lib/place";
import { containedBox } from "@/lib/screen-marks";
import type { Bot } from "@/state/store";

export type ScreenPlace = "browser" | "vm" | "remote";
export const SCREEN_PLACES: readonly ScreenPlace[] = ["browser", "vm", "remote"];

/** The VM behind the tab: the person's server environment (VNC, live and
 * interactive) or the Local VM on their computer (the desktop app's picture). */
export type VmSource = "server" | "local";

export type ScreenPlaceInputs = {
  bot: Pick<Bot, "browser" | "computer">;
  environment: ServerEnvironmentStatus | null;
  bridge: DesktopBridgeStatus | null;
  sessions: readonly RemoteSessionView[];
  /** The focused remote session's id, when the person picked one. */
  focused?: string | null;
};

export type ScreenPlaces = {
  places: ScreenPlace[];
  vm: VmSource | null;
  remote: RemoteSessionView | null;
};

/** A server environment worth looking at: awake or paused, never one that is
 * missing or stopped (opening the view would start it for nothing). */
export function environmentWatchable(status: ServerEnvironmentStatus | null): boolean {
  return Boolean(status?.configured) && (status?.state === "running" || status?.state === "paused");
}

export function screenPlaces({ bot, environment, bridge, sessions, focused }: ScreenPlaceInputs): ScreenPlaces {
  const places: ScreenPlace[] = [];
  if (bot.browser !== false) places.push("browser");
  const place = effectivePlace(bot);
  const local = (place === "vm" || place === "local") && orgComputerFor(place) === "computer" && bridge?.connected === true;
  const vm: VmSource | null = environmentWatchable(environment) ? "server" : local ? "local" : null;
  if (vm) places.push("vm");
  const connected = sessions.filter((session) => session.state === "connected");
  const remote = connected.find((session) => session.id === focused) ?? connected[0] ?? null;
  if (remote) places.push("remote");
  return { places, vm, remote };
}

/** The tab to show: the person's pick while it still exists, else the first. */
export function activePlace(places: readonly ScreenPlace[], picked: ScreenPlace | null): ScreenPlace {
  return picked && places.includes(picked) ? picked : places[0] ?? "browser";
}

/** "Last picture at 14:32:05": the time of the newest frame of a place that has no live stream. */
export function frameTime(at: number, locale?: string): string {
  return new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export type ScreenSize = { width: number; height: number };

/** The size a VM's or remote computer's screen takes in the panel
 * (M-20261127-181): the whole width or the whole height of the room,
 * whichever it reaches first at the picture's own proportions, in whole
 * pixels. Null until both are known: the dark frame then fills the room. */
export function fitScreen(room: ScreenSize, picture: ScreenSize | null): ScreenSize | null {
  if (!picture) return null;
  const box = containedBox({ left: 0, top: 0, width: room.width, height: room.height }, picture.width, picture.height);
  const width = Math.floor(box.width), height = Math.floor(box.height);
  return width >= 1 && height >= 1 ? { width, height } : null;
}
