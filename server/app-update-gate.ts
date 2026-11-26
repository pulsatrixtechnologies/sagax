// The app's minimum version (owner 2026-11-26, D-20261126-004).
//
// The desktop app and the phone draw a server with the code they were
// installed with (electron/bundled-ui.cjs, the iOS app): an app from before
// 0.8.173 does not know the look keys of the shape mascots (material, mood,
// eyes, depth) and draws the default owl in their place. The owner's answer:
// such an app asks the person to update before it goes on.
//
// An installed app cannot receive new code, and none had a "minimum version"
// screen: the server is the only place that can ask. It does so where every
// app, old ones included, already shows the server's own words: the message
// the person sends. A send from an app older than the minimum is answered
// 426 with one sentence that says to update and how; the app puts the draft
// back and shows that sentence (the desktop's showError, the phone's
// APIError.status message). Reading, signing in, settings, stopping a bot,
// routines and every other client go on: nothing is lost while the person
// updates.
//
// Which app sends is read from what it already says:
// - the desktop app's User-Agent carries its release ("openmausbot/0.8.172
//   ... Electron/...": Electron's default, the runtime name of
//   electron/user-data-location.mjs, or "Sagax/...");
// - the phone and the iPad say "Sagax/<build> CFNetwork/..." (URLSession's
//   default): the build, not the release, so the last build below the
//   minimum is written here. From 0.8.174 they also send their release in
//   `x-sagax-app-version`, which wins, so a later minimum needs no build.
// Anything else (a browser, which runs the server's own page, a script, an
// AI client, a bot's own call) is never held, and neither is a version that
// cannot be read: the gate only ever holds an app it can name.
import { requestLanguage } from "./people/request-language.ts";

/** Apps older than this are asked to update before they send. */
export const MINIMUM_APP_VERSION = "0.8.173";

/** The phone's last build of a release below the minimum (0.8.172 was build
 * 234, ios/project.yml at pulsa-v0.8.172). A phone that sends its release
 * (0.8.174 and newer) is read from that instead. */
export const IOS_LAST_BUILD_BELOW_MINIMUM = 234;

/** The release an app runs, sent by the phone and the iPad from 0.8.174. */
export const APP_VERSION_HEADER = "x-sagax-app-version";

const RELEASE = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;
const DESKTOP_AGENT = /\b(?:sagax|openmausbot)\/(\d{1,9}\.\d{1,9}\.\d{1,9})\b.*\bElectron\//i;
const IOS_AGENT = /^(?:sagax|openmausbot)[^/\s]*\/(\d{1,9}) CFNetwork\//i;

/** The person's sends: a message to a bot (guarded or not) or in a room. */
const SEND_ROUTE = /^\/api\/(?:bots\/[\w-]+\/messages(?:\/guarded)?|groups\/[\w-]+\/messages)$/;

export interface RequestApp {
  family: "desktop" | "ios";
  /** The release (X.Y.Z), when the app says it. */
  version?: string;
  /** The phone's build number. */
  build?: number;
}

type Headers = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";

/** Negative, zero or positive as `a` is older than, the same as or newer than `b`. */
export function compareReleases(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The Sagax app a request comes from, or null for anything else. */
export function requestApp(headers: Headers): RequestApp | null {
  const agent = first(headers["user-agent"]);
  const desktop = DESKTOP_AGENT.exec(agent);
  if (desktop) return { family: "desktop", version: desktop[1]! };
  const phone = IOS_AGENT.exec(agent);
  if (!phone) return null;
  const said = first(headers[APP_VERSION_HEADER]).trim();
  return { family: "ios", ...(RELEASE.test(said) ? { version: said } : {}), build: Number(phone[1]) };
}

/** Whether this app is older than the minimum. `baseVersion`: the server's
 * own base version, which a development build of the desktop app runs at
 * (read only for an app that would otherwise be held). */
function olderThanMinimum(app: RequestApp, baseVersion: (() => string) | undefined): boolean {
  if (app.version !== undefined) {
    return compareReleases(app.version, MINIMUM_APP_VERSION) < 0 && app.version !== baseVersion?.();
  }
  return app.build !== undefined && app.build <= IOS_LAST_BUILD_BELOW_MINIMUM;
}

function sentence(app: RequestApp, french: boolean): string {
  const minimum = MINIMUM_APP_VERSION;
  if (french) {
    const version = app.version ? `cette version (${app.version})` : "cette version";
    const how = app.family === "ios" ? "Mets-la à jour dans l'App Store ou TestFlight." : "Ouvre le menu de ton compte, puis Aide, puis Rechercher des mises à jour.";
    return `Mets Sagax à jour pour continuer : ${version} est trop vieille pour ce serveur, qui demande la ${minimum} ou plus récente. ${how}`;
  }
  const version = app.version ? `this version (${app.version})` : "this version";
  const how = app.family === "ios" ? "Update it in the App Store or TestFlight." : "Open your account menu, then Help, then Check for updates.";
  return `Update Sagax to continue: ${version} is too old for this server, which needs ${minimum} or newer. ${how}`;
}

export interface AppUpdateRefusal {
  status: 426;
  body: { error: string; code: "app_update_required"; minimumVersion: string; appVersion?: string };
}

/** The answer to a send from an app older than the minimum, or null when the
 * request goes on (another route, another client, an app new enough, or one
 * whose version cannot be read). */
export function appUpdateRefusal(input: { method: string; path: string; headers: Headers; baseVersion?: () => string }): AppUpdateRefusal | null {
  if (input.method !== "POST" || !SEND_ROUTE.test(input.path)) return null;
  const app = requestApp(input.headers);
  if (!app || !olderThanMinimum(app, input.baseVersion)) return null;
  const french = (requestLanguage(input.headers) ?? "").toLowerCase().startsWith("fr");
  return {
    status: 426,
    body: { error: sentence(app, french), code: "app_update_required", minimumVersion: MINIMUM_APP_VERSION, ...(app.version ? { appVersion: app.version } : {}) },
  };
}
