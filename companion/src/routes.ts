// What a paired device is allowed to ask for.
//
// The default is deny, and that direction is the whole point: the sidecar
// sits in front of an API it does not own and cannot see the future of. A
// route that appears in the harness later is closed to phones until someone
// decides otherwise, because the alternative is that every upstream release
// silently widens what a lost phone can reach.
//
// This file used to claim that and not do it — it listed refusals and let
// everything else under `/api/` through. In the time between writing it and
// noticing, upstream added webhook triggers, connected-app authorisation and
// routines, all of which a paired phone could drive: minting an
// internet-reachable trigger, rotating a signing secret out from under
// whatever was sending to it, disconnecting a Google account. None of that
// was a decision anyone made. It was the default.
//
// So the list below is the surface, derived from what the app actually
// calls. Adding a feature to the phone means adding its route here, on
// purpose, in a diff someone can read. That cost is the feature.

/** A refusal to send back, or null to let the request through. */
export interface Denial {
  status: number;
  error: string;
}

/** One request, reduced to what the allowlist decides on. */
export interface RouteRequest {
  path: string;
  method: string;
  /** Whether the bearer token on the request matched a paired device. */
  authenticated: boolean;
}

/** The one companion route that crosses into full interactive desktop
 * control. Both the allowlist and capability gate consume this classifier so
 * their security decisions cannot drift apart. */
export const CLOUD_DESKTOP_JOIN_ROUTE = {
  method: "POST",
  path: /^\/api\/bots\/[\w-]+\/computer\/join$/,
} as const;

/** A POST whose response is file bytes. Keep this exact classifier shared
 * with the proxy: a `.json` document must not enter the ordinary JSON
 * scrub/re-serialise path and come back as different bytes. */
export const MESSAGE_FILE_ROUTE = {
  method: "POST",
  path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/file$/,
} as const;

export const CLOUD_DESKTOP_CONTROL_ROUTE = {
  method: "POST",
  path: /^\/api\/bots\/[\w-]+\/computer\/(?:control|screenshot|viewer-close)$/,
} as const;

/** The phone's native remote control (pointer, keys, text, clipboard). It is
 * full desktop control like a viewer join, so it rides the same per-device
 * capability; the harness also requires the person to hold control. */
export const CLOUD_DESKTOP_INPUT_ROUTES: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/computer\/input$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/computer\/clipboard$/ },
  { method: "PUT", path: /^\/api\/bots\/[\w-]+\/computer\/clipboard$/ },
];
/** Driving a bot's own browser: the frame stream, and the channel that sends
 * pointer and keyboard events into it.
 *
 * Deliberately separate from the cloud-desktop classifier above rather than
 * folded into it. A cloud desktop is a disposable VM; a bot's browser is
 * normally signed into the person's real accounts, with their cookies and
 * their sessions. A device trusted with a throwaway VM must not acquire the
 * second permission because the two looked similar from here. */
export const BROWSER_LIVE_ROUTE = {
  method: "GET",
  path: /^\/api\/bots\/[\w-]+\/browser\/live$/,
} as const;

export const BROWSER_ACTION_ROUTE = {
  method: "POST",
  path: /^\/api\/bots\/[\w-]+\/browser\/action$/,
} as const;

/** The Local VM's live desktop, relayed by the sidecar like a VPS viewer.
 * The harness grants it only while a person holds that bot's computer. */
export const LOCAL_VM_JOIN_ROUTE = {
  method: "POST",
  path: /^\/api\/bots\/[\w-]+\/local-computer\/join$/,
} as const;

/** A still of a bot's Local VM, on demand. The VM's lifecycle stays on the
 * host; this only reads a picture of it, behind the same per-device
 * computer-access capability as the cloud desktop. */
export const LOCAL_VM_SCREENSHOT_ROUTE = {
  method: "POST",
  path: /^\/api\/bots\/[\w-]+\/local-computer\/screenshot$/,
} as const;

/** The person's server-environment desktop (Electron SandboxDesktopView).
 * Screenshot of a bot computer 409s with org_user_sandbox; this is the live
 * view instead. */
export const SANDBOX_VIEWER_ROUTE = {
  method: "GET",
  path: /^\/api\/desktop-viewer\/sandbox\/me(?:\/websockify)?$/,
} as const;

export const SERVER_ENVIRONMENT_POWER_ROUTE = {
  method: "POST",
  path: /^\/api\/me\/server-environment\/power$/,
} as const;

export function isCloudDesktopJoin(method: string, path: string): boolean {
  return method === CLOUD_DESKTOP_JOIN_ROUTE.method && CLOUD_DESKTOP_JOIN_ROUTE.path.test(path);
}

export function isMessageFileDownload(method: string, path: string): boolean {
  return method === MESSAGE_FILE_ROUTE.method && MESSAGE_FILE_ROUTE.path.test(path);
}

/** Every route that shows or drives a bot's computer — cloud or Local VM —
 * and so needs the device's computer-access capability, not just a token. */
export function isSandboxViewerAccess(method: string, path: string): boolean {
  return method === SANDBOX_VIEWER_ROUTE.method && SANDBOX_VIEWER_ROUTE.path.test(path);
}

export function isCloudDesktopAccess(method: string, path: string): boolean {
  return isCloudDesktopJoin(method, path)
    || (method === CLOUD_DESKTOP_CONTROL_ROUTE.method && CLOUD_DESKTOP_CONTROL_ROUTE.path.test(path))
    || CLOUD_DESKTOP_INPUT_ROUTES.some((route) => route.method === method && route.path.test(path))
    || (method === LOCAL_VM_SCREENSHOT_ROUTE.method && LOCAL_VM_SCREENSHOT_ROUTE.path.test(path))
    || (method === LOCAL_VM_JOIN_ROUTE.method && LOCAL_VM_JOIN_ROUTE.path.test(path))
    || isSandboxViewerAccess(method, path)
    || (method === SERVER_ENVIRONMENT_POWER_ROUTE.method && SERVER_ENVIRONMENT_POWER_ROUTE.path.test(path));
}

/** Both halves of browser control, behind one capability. Watching the frames
 * and driving them are the same permission: a viewer that can see a logged-in
 * session is already past the line the capability is drawn at. */
export function isBrowserControlAccess(method: string, path: string): boolean {
  return (method === BROWSER_LIVE_ROUTE.method && BROWSER_LIVE_ROUTE.path.test(path))
    || (method === BROWSER_ACTION_ROUTE.method && BROWSER_ACTION_ROUTE.path.test(path));
}

/** Every request the iOS app makes, and nothing else.
 *
 * Ids are `[\w-]+`, matching the harness's own route patterns. The paths
 * arrive undecoded and are anchored at both ends, so an encoded traversal
 * fails to match and is denied rather than forwarded — the failure mode of
 * a strict pattern is a closed door, which is the one to have. */
const ALLOWED: ReadonlyArray<{ method: string; path: RegExp }> = [
  // configured-or-not booleans. The write side is refused below: reading
  // which providers are set up is not reading their keys.
  { method: "GET", path: /^\/api\/config$/ },
  { method: "GET", path: /^\/api\/events$/ },
  { method: "GET", path: /^\/api\/instances$/ },
  // Run Claude Code's own `claude update` on the host when a turn failed
  // because it is too old for the model. A fixed command against the host's
  // configured CLI; the harness refuses it while any Claude turn is running.
  // Instance ids may carry dots, so a dots-only segment is refused outright.
  { method: "POST", path: /^\/api\/instances\/(?!\.+\/)[\w.-]+\/claude-update$/ },
  // A masked access key. The phone sends it once and afterwards only learns
  // whether one is saved.
  { method: "GET", path: /^\/api\/instances\/(?!\.+\/)[\w.-]+\/api-key$/ },
  { method: "POST", path: /^\/api\/instances\/(?!\.+\/)[\w.-]+\/api-key$/ },
  // In-app sign-in. The phone sees a phase, never a password.
  { method: "POST", path: /^\/api\/instances\/(?!\.+\/)[\w.-]+\/auth\/start$/ },
  { method: "GET", path: /^\/api\/instances\/(?!\.+\/)[\w.-]+\/auth\/status$/ },
  { method: "POST", path: /^\/api\/instances\/(?!\.+\/)[\w.-]+\/auth\/cancel$/ },
  { method: "POST", path: /^\/api\/instances\/(?!\.+\/)[\w.-]+\/auth\/complete$/ },
  { method: "GET", path: /^\/api\/team-map$/ },
  // Sidecar-owned, authenticated endpoint metadata. The proxy terminates it
  // locally; it never becomes a newly exposed harness route.
  { method: "GET", path: /^\/api\/companion\/endpoints$/ },

  // the fleet, and making a bot
  { method: "GET", path: /^\/api\/bots$/ },
  { method: "POST", path: /^\/api\/bots$/ },
  // One narrow, atomic organizer write. This can only file visible bots;
  // unlike the desktop's broad PATCH it cannot alter execution policy.
  { method: "POST", path: /^\/api\/sidebar-sections$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/messages$/ },
  { method: "PATCH", path: /^\/api\/bots\/[\w-]+\/cards\/[\w-]+$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/respond$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/interrupt$/ },
  { method: "DELETE", path: /^\/api\/bots\/[\w-]+\/queue\/[\w-]+$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/read$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/always-allow$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/messages\/[\w-]+\/edit$/ },
  // 2026-10-30: answer a proactive proposal card from the phone
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/proactive\/[\w-]+$/ },
  // A credential value crosses this one route only as an HPKE envelope. The
  // server binds it to the authenticated device and exact pending card before
  // Electron opens it into the OS-encrypted credential store.
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/secret-cards\/[\w-]+\/provide$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/active-branch$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/compact$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/tasks$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/tasks\/[\w-]+$/ },
  { method: "PATCH", path: /^\/api\/bots\/[\w-]+\/tasks\/[\w-]+$/ },
  { method: "DELETE", path: /^\/api\/bots\/[\w-]+\/tasks\/[\w-]+$/ },
  // Read-only summary: who the bot is, what it does and won't do, and its
  // recent activity. No settings, no transcript — read on open and on
  // pull-to-refresh.
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/overview$/ },
  // Read-only: what the bot did, with the outcome, built from logs that
  // already exist (server/activity.ts). No settings reachable through it.
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/activity$/ },
  // The section's shared team memory: people, places, decisions and terms.
  // Reading, adding, answering a proposal, editing a detail, and removing
  // are all content edits, not execution policy — the same line the profile
  // and sidebar-section routes draw. The section rides as a query string.
  { method: "GET", path: /^\/api\/team-memory$/ },
  { method: "POST", path: /^\/api\/team-memory$/ },
  { method: "PATCH", path: /^\/api\/team-memory\/[\w-]+$/ },
  { method: "DELETE", path: /^\/api\/team-memory\/[\w-]+$/ },
  // Paired-safe profile subset. The harness route itself rejects fields
  // outside identity, standing instructions (soul, byte-capped), avatar,
  // notifications, and voice preferences.
  { method: "PATCH", path: /^\/api\/bots\/[\w-]+\/profile$/ },
  // Full model selection, but no other bot settings. The harness validates
  // the live catalog and refuses changes while the bot is working.
  { method: "PATCH", path: /^\/api\/bots\/[\w-]+\/model$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/avatar\/generate$/ },
  // A shape mascot from a short description (the editor's Generate). The
  // harness checks the bot and runs the bot's own text model.
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/shape-avatar\/generate$/ },
  // Full cloud desktop access. The route is narrow and the proxy applies a
  // second, per-device capability check before it reaches the harness.
  CLOUD_DESKTOP_JOIN_ROUTE,

  CLOUD_DESKTOP_CONTROL_ROUTE,
  ...CLOUD_DESKTOP_INPUT_ROUTES,

  // iOS visual parity (docs/ios-companion.md). Who is signed in (on a
  // personal computer: its owner's name, never an address).
  { method: "GET", path: /^\/api\/auth\/session$/ },
  // The person's photo, when that session names one (`avatarUrl`, the
  // versioned `/api/people/<id>/avatar?v=` of a server that knows the
  // person's Perspicax avatar). The phone asks for nothing else under
  // /api/people; a computer without one answers 404 and the phone keeps the
  // initial.
  { method: "GET", path: /^\/api\/people\/[\w-]{1,80}\/avatar$/ },
  // The owner's bot edits from the profile: the harness holds a companion
  // request to the member fields (look, framing, name, instructions,
  // notifications, model), never where the bot runs or what it may do.
  { method: "PATCH", path: /^\/api\/bots\/[\w-]+$/ },
  // The profile's Links, Media and Files tabs, the files' thumbnails and
  // downloads, and Share as Template (a package without secrets).
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/(?:links|files)$/ },
  { method: "GET", path: /^\/api\/threads\/[\w-]+\/files$/ },
  { method: "GET", path: /^\/api\/threads\/[\w-]+\/files\/[a-f0-9]{24}$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/export$/ },
  // The Library's artifacts (server/routes/artifacts.ts): the bot's list, one
  // artifact's document, and its pin (PATCH takes favorite and popped only).
  // Refreshing (it runs the source) and deleting stay on the computer.
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/artifacts$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/artifacts\/art_[\w-]+$/ },
  { method: "PATCH", path: /^\/api\/bots\/[\w-]+\/artifacts\/art_[\w-]+$/ },
  // Settings: auto-review default and time zone, saved command rules.
  { method: "GET", path: /^\/api\/settings\/bot$/ },
  { method: "PUT", path: /^\/api\/settings\/bot$/ },
  { method: "GET", path: /^\/api\/auto-review\/rules$/ },
  { method: "DELETE", path: /^\/api\/auto-review\/rules\/[\w.-]+$/ },
  // Bot Computer: this computer's local container (status, update, reset).
  { method: "GET", path: /^\/api\/computer\/status$/ },
  { method: "POST", path: /^\/api\/computer\/(?:update|reset)$/ },
  // Its scheduled update (parity R7, O2): read and set, never the disk saver.
  { method: "GET", path: /^\/api\/computer\/maintenance$/ },
  { method: "PUT", path: /^\/api\/computer\/maintenance$/ },
  // Plugins: the catalog, what is installed, adding one and its sign-in.
  { method: "GET", path: /^\/api\/plugins\/(?:search|installed)$/ },
  { method: "POST", path: /^\/api\/plugins\/install$/ },
  { method: "POST", path: /^\/api\/mcp\/servers\/[a-z][a-z0-9_-]{0,31}\/oauth\/start$/ },
  { method: "GET", path: /^\/api\/mcp\/servers\/[a-z][a-z0-9_-]{0,31}\/oauth\/status$/ },
  // Account: a personal computer answers personal_server (the phone forgets the pairing).
  { method: "DELETE", path: /^\/api\/me$/ },
  // The rest of the phone's screens, each held by the harness to the owner
  // (or an admin) as for a server-paired phone: usage %, the bot's standing
  // instructions, deleting a bot, the MCP servers listing (names, addresses
  // and header names only, never values), a bot's saved command rules, the
  // person's own preferences and server environment (an organization server
  // only; a personal computer answers 404), and pinning a room.
  { method: "GET", path: /^\/api\/usage$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/soul$/ },
  { method: "DELETE", path: /^\/api\/bots\/[\w-]+$/ },
  { method: "GET", path: /^\/api\/mcp\/servers$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/command-allowlist$/ },
  { method: "DELETE", path: /^\/api\/bots\/[\w-]+\/command-allowlist\/[\w-]+$/ },
  { method: "GET", path: /^\/api\/me\/preferences$/ },
  { method: "PUT", path: /^\/api\/me\/preferences$/ },
  // a personal computer's look (skin, font), for Settings > Appearance > Same as my computer
  { method: "GET", path: /^\/api\/me\/appearance$/ },
  { method: "PUT", path: /^\/api\/me\/appearance$/ },
  { method: "GET", path: /^\/api\/me\/server-environment$/ },
  { method: "GET", path: /^\/api\/me\/server-environment\/stats$/ },
  { method: "POST", path: /^\/api\/me\/server-environment\/(?:reset|update|power)$/ },
  { method: "GET", path: /^\/api\/desktop-viewer\/sandbox\/me(?:\/websockify)?$/ },
  { method: "PATCH", path: /^\/api\/groups\/[\w-]+$/ },

  // Desktop remote-client parity (docs/ios-companion.md, "Same surface as
  // the desktop remote client"). The Electron app paired to this host
  // through this sidecar shows each of these and, until they were listed,
  // got "no route" for them; the iPad follows the same renderer. None of
  // them reaches settings, execution policy, credentials or the host.
  //
  // The deployment's public brand (name, icon, colours), also served to
  // anyone without a session by the harness itself.
  { method: "GET", path: /^\/api\/brand$/ },
  // Steer: fold the queued words into the running turn instead of waiting.
  // The same guards as cancelling that queued message (the thread must be
  // the device's, the queue entry must exist); it never starts a turn.
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/queue\/[\w-]+\/steer$/ },
  { method: "POST", path: /^\/api\/groups\/[\w-]+\/queue\/[\w-]+\/steer$/ },
  // Regenerate a thread's title with the bot's own engine (the harness
  // refuses it when generated titles are off or the engine cannot).
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/tasks\/[\w-]+\/title$/ },
  // Thread folders: a name and an emoji that group one bot's threads. They
  // own no settings, transcripts or working directories (the harness
  // refuses any other field).
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/projects$/ },
  { method: "PATCH", path: /^\/api\/bots\/[\w-]+\/projects\/[\w-]+$/ },
  { method: "DELETE", path: /^\/api\/bots\/[\w-]+\/projects\/[\w-]+$/ },
  // Automations > Mark all as read.
  { method: "POST", path: /^\/api\/routine-runs\/seen-all$/ },

  // A bot's browser, watched and driven from the phone. Like the cloud
  // desktop above, the proxy applies a second per-device capability check
  // before either of these reaches the harness.
  BROWSER_LIVE_ROUTE,
  BROWSER_ACTION_ROUTE,
  // A picture of the Local VM — not its lifecycle, which stays on the host.
  // Gated per device by the proxy like the cloud desktop above.
  LOCAL_VM_SCREENSHOT_ROUTE,
  // Its live desktop while a person holds the computer, relayed like the
  // VPS viewer and behind the same per-device capability.
  LOCAL_VM_JOIN_ROUTE,

  // iOS feature parity, package S1 (docs/superpowers/specs/
  // 2026-10-03-ios-feature-parity-matrix.md). Surfaces the remote-client
  // renderer draws and that got "no route" here: the engine's own slash
  // commands (names and hints only), stopping one parallel task (the
  // harness checks the thread), what a bot is doing, its owner's Primary
  // Bot star, the owner's own claude.ai connectors (names and statuses), and
  // the bot computer's status (read-only: no provisioning, no power).
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/harness-commands$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/parallel\/[\w-]+\/stop$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/activity(?:\/item)?$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/primary$/ },
  { method: "GET", path: /^\/api\/me\/harness-connectors$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/computer$/ },
  // A room's shared memory (decision D3): its people read it, its owner
  // edits it or switches it off (server/routes/group-memory.ts).
  { method: "GET", path: /^\/api\/groups\/[\w-]+\/memory$/ },
  { method: "PUT", path: /^\/api\/groups\/[\w-]+\/memory$/ },
  // The voice engine, alone: one field of the host's voice settings, never
  // a key or an address (server: PUT /api/tts/provider). PUT /api/config
  // stays refused.
  { method: "PUT", path: /^\/api\/tts\/provider$/ },
  // "Reach me" (#1187), Settings > Bots > Reach me: the person's own
  // channels and hours for each bot (no admin), and their own Telegram bot
  // (the token is write only, never in an answer).
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/reach-me$/ },
  { method: "PUT", path: /^\/api\/bots\/[\w-]+\/reach-me$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/reach-me\/telegram$/ },
  { method: "DELETE", path: /^\/api\/bots\/[\w-]+\/reach-me\/telegram$/ },

  // The advanced bot panel for the computer's owner (decision D1): the
  // same reads and edits the desktop's own renderer makes, nothing else.
  // Still refused: approval mode, the working folder, the computer, MCP
  // servers and access (the harness holds a companion bot PATCH to the
  // member fields plus the memory switches), and opening the memory folder
  // on the host's screen.
  //   prompt preview, history of changes and restoring instructions
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/system-prompt$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/history$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/history\/rollback$/ },
  //   skills: list, read, import (lands disabled), enable or disable, remove
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/skills$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/skills$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/skills\/[a-z0-9-]+$/ },
  { method: "PATCH", path: /^\/api\/bots\/[\w-]+\/skills\/[a-z0-9-]+$/ },
  { method: "DELETE", path: /^\/api\/bots\/[\w-]+\/skills\/[a-z0-9-]+$/ },
  //   memory: overview, one file (read, save with its hash, delete), the
  //   journal and its revert, upkeep status and a tidy pass
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/memory$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/memory\/file$/ },
  { method: "PUT", path: /^\/api\/bots\/[\w-]+\/memory\/file$/ },
  { method: "DELETE", path: /^\/api\/bots\/[\w-]+\/memory\/file$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/memory\/journal$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/memory\/journal\/[\w-]+\/revert$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/memory\/upkeep$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/memory\/tidy$/ },
  //   New bot's starting roles (the list; creating one is POST /api/bots)
  { method: "GET", path: /^\/api\/bot-presets$/ },
  //   the owner's achievements (their own record, and colleagues' shown points)
  { method: "GET", path: /^\/api\/me\/achievements$/ },
  { method: "POST", path: /^\/api\/me\/achievements\/events$/ },
  { method: "PUT", path: /^\/api\/me\/achievements\/settings$/ },
  { method: "GET", path: /^\/api\/achievements\/public$/ },
  //   phone tools (server/routes/phone-tools.ts): what this phone offers, the
  //   requests waiting on it, the person's answer, and "Toujours permettre"
  { method: "POST", path: /^\/api\/me\/phone-tools\/device$/ },
  { method: "GET", path: /^\/api\/me\/phone-tools\/requests$/ },
  { method: "POST", path: /^\/api\/me\/phone-tools\/requests\/[\w-]+$/ },
  { method: "GET", path: /^\/api\/me\/phone-tools\/grants$/ },
  { method: "DELETE", path: /^\/api\/me\/phone-tools\/grants$/ },
  // Inline video widgets: proxied media (also open without a device token,
  // see denyReason) and YouTube transcripts (session auth).
  { method: "GET", path: /^\/api\/media\/proxy\/.+/ },
  { method: "POST", path: /^\/api\/youtube\/transcript$/ },

  // rooms — making one, and talking in one
  { method: "POST", path: /^\/api\/groups$/ },
  { method: "POST", path: /^\/api\/groups\/[\w-]+\/messages$/ },
  // #1480, #1786: leave a group this person is listed in. The server reads
  // who leaves from the session.
  { method: "POST", path: /^\/api\/groups\/[\w-]+\/leave$/ },
  { method: "POST", path: /^\/api\/groups\/[\w-]+\/interrupt$/ },
  { method: "DELETE", path: /^\/api\/groups\/[\w-]+\/queue\/[\w-]+$/ },
  { method: "POST", path: /^\/api\/groups\/[\w-]+\/read$/ },
  { method: "POST", path: /^\/api\/groups\/[\w-]+\/tasks$/ },
  { method: "POST", path: /^\/api\/groups\/[\w-]+\/tasks\/[\w-]+$/ },
  { method: "PATCH", path: /^\/api\/groups\/[\w-]+\/tasks\/[\w-]+$/ },
  { method: "DELETE", path: /^\/api\/groups\/[\w-]+\/tasks\/[\w-]+$/ },

  // a transcript, its images, and answering an approval
  { method: "GET", path: /^\/api\/threads\/[\w-]+\/messages$/ },
  { method: "GET", path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/image$/ },
  MESSAGE_FILE_ROUTE,
  { method: "POST", path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/reactions$/ },
  // read receipts: who has seen what, and this person's own position
  { method: "GET", path: /^\/api\/threads\/[\w-]+\/read$/ },
  { method: "POST", path: /^\/api\/threads\/[\w-]+\/read$/ },
  { method: "GET", path: /^\/api\/threads\/[\w-]+\/export$/ },
  { method: "POST", path: /^\/api\/threads\/[\w-]+\/respond$/ },
  // the card of a phone call or a purchase a bot asks for (OutboundCard):
  // the person's one answer to that one action, never a card number or a
  // grant; the server keeps its owner gate and security-key step-up
  { method: "POST", path: /^\/api\/me\/phone-calls\/call_[a-f0-9]{16}\/answer$/ },
  { method: "POST", path: /^\/api\/me\/credentials\/purchases\/pay_[a-f0-9]{16}\/answer$/ },
  { method: "GET", path: /^\/api\/search$/ },

  // App-owned profile images. Upload is image-only and capped at 10 MB by
  // the harness; GET is a single bare generated filename, never a path.
  { method: "POST", path: /^\/api\/attachments$/ },
  // Voice notes are served from the same dir as .mp3; the harness honors
  // Range on them so a phone player can seek without the whole clip.
  { method: "GET", path: /^\/api\/attachments\/[\w-]+\.(?:png|jpe?g|gif|webp|mp3)$/i },
  // Share-sheet documents are raw, capped at 25 MiB, and stored under a
  // generated filename by the harness. The display name stays in the query;
  // only this exact upload route crosses the companion boundary.
  { method: "POST", path: /^\/api\/files$/ },

  // Renderer-neutral voice operations. These routes never expose or mutate
  // the workspace ElevenLabs key; the client receives labels or audio only.
  { method: "GET", path: /^\/api\/tts\/voices$/ },
  { method: "POST", path: /^\/api\/tts\/prepare$/ },
  { method: "POST", path: /^\/api\/tts\/speak$/ },
  // A live call (the phone's voice mode, ios/App/Call/): whether voice mode
  // serves this bot, xAI's voice labels, a sentence of the bot's answer
  // streamed as PCM, and a whole turn transcribed when the phone cannot
  // recognize speech itself. The xAI key never leaves the harness. The
  // listen socket stays desktop-only: it is same-origin by design.
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/voice\/(?:status|voices)$/ },
  // The call's start, keep-alive and end (POST /voice/call): every send to
  // the thread while it lasts is a call turn.
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/voice\/(?:prepare|speak|transcribe|stream|call)$/ },

  // Live calls: the phone holds its own WebRTC audio to OpenAI; the Mac
  // creates the session (the key never leaves it) and runs the call.
  { method: "POST", path: /^\/api\/live\/session$/ },
  { method: "POST", path: /^\/api\/live\/call\/end$/ },
  { method: "GET", path: /^\/api\/live\/call$/ },
  { method: "PATCH", path: /^\/api\/live\/settings$/ },

  // Routines create ordinary tasks using an existing agent configuration.
  // Webhook management remains explicitly denied below.
  { method: "GET", path: /^\/api\/routines$/ },
  { method: "POST", path: /^\/api\/routines$/ },
  { method: "PATCH", path: /^\/api\/routines\/[\w-]+$/ },
  { method: "DELETE", path: /^\/api\/routines\/[\w-]+$/ },
  { method: "POST", path: /^\/api\/routines\/[\w-]+\/run$/ },
  // "Check now" in the phone's routine editor (#1202): one reading of a
  // watch where the routine would read it, no model, nothing kept
  { method: "POST", path: /^\/api\/routines\/watch-check$/ },
  { method: "POST", path: /^\/api\/routine-runs\/[\w-]+\/(?:cancel|seen)$/ },

  // A remote client may decline or retry a credential request, but never
  // claim that it stored a host credential. Saving and `provided` stay local
  // to the host's OS-backed credential store.
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/secret-cards\/[\w-]+\/(?:resume|dismiss)$/ },
];

/** Notices the companion itself sends the harness, never a device: they are
 * not in ALLOWED, so the proxy refuses them from a phone, and the harness
 * accepts them only with the companion's private relay token
 * (server/request-auth.ts) or, for a standalone harness, from loopback.
 *
 * `POST /api/live/device-revoked`: a phone was just unpaired (the device id
 * rides in `x-openmausbot-companion-device`), so the harness ends the Live
 * call that phone holds. A phone's requests reach the harness as this
 * computer's own, so nothing else would tell it the phone lost its access. */
const COMPANION_NOTICES: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "POST", path: /^\/api\/live\/device-revoked$/ },
];

export function isCompanionNotice(method: string, path: string): boolean {
  return COMPANION_NOTICES.some((route) => route.method === method && route.path.test(path));
}

/** Route families worth naming in the refusal.
 *
 * Everything not allowed is denied either way; this only decides whether the
 * person gets a sentence or a 404. These are the ones someone might
 * reasonably expect to work from the phone, where "no route" would read as a
 * bug in the companion rather than a decision about where host configuration
 * happens. Order matters only in that the first match wins. */
const EXPLAINED: ReadonlyArray<{ path: RegExp; error: string }> = [
  {
    path: /^\/api\/(companion|devices)(\/|$)/,
    // Losing the phone must not mean losing the ability to lock it out.
    error: "Remote access settings are managed on the host computer",
  },
  { path: /^\/api\/config$/, error: "API keys can only be changed on your computer" },
  { path: /^\/api\/local-computer(\/|$)/, error: "the Local VM is set up on your computer" },
  {
    // Creating one exposes an endpoint to the internet, and rotating a
    // secret breaks whatever was sending to it. Neither belongs on a device
    // that lives in a pocket.
    path: /^\/api\/webhooks(\/|$)/,
    error: "webhooks are set up on your computer",
  },
  { path: /^\/api\/connectors(\/|$)/, error: "connected apps are set up on your computer" },
  {
    path: /^\/api\/routines(\/|$)/,
    error: "this routine operation is only available on your computer",
  },
  { path: /^\/api\/teams(\/|$)/, error: "teams are imported and exported on your computer" },
];

/** Why this request may not go through, or null when it may.
 *
 * Default deny: the answer for anything not on the list is "no route", which
 * is what keeps a stolen token from mapping the API. An allowlist rather than
 * a blocklist is the property this whole module exists for, and the one that
 * quietly stopped being true once before. */
export function denyReason({ path, method, authenticated }: RouteRequest): Denial | null {
  // Pairing is the one thing a device does before it has a credential.
  if (method === "POST" && path === "/api/pair") return null;
  // Liveness is the other: it exists to be the first thing anyone curls when
  // pairing will not work, and behind the token check it answered 401 to
  // exactly the person it was for — which reads as "broken" rather than
  // "unpaired". It discloses nothing a port scan would not.
  if (method === "GET" && path === "/api/health") return null;
  // An MCP server's sign-in returns here from the phone's browser sheet,
  // which carries no device token: the single-use state bound to the
  // pending sign-in is its authorization, as on the harness itself.
  if (method === "GET" && path === "/api/mcp-oauth/callback") return null;
  // Proxied media for the inline video widget: AVPlayer fetches the playlist
  // and its segments itself and cannot add the device token. The signed,
  // short-lived token in the path is the authorization, and the harness
  // checks it (server/routes/media-widgets.ts) before anything is fetched.
  if (method === "GET" && /^\/api\/media\/proxy\/[^/]+$/.test(path)) return null;

  if (!authenticated) {
    return { status: 401, error: "pair this device from Remote access settings on the host computer" };
  }

  if (ALLOWED.some((route) => route.method === method && route.path.test(path))) return null;

  const explained = EXPLAINED.find((family) => family.path.test(path));
  if (explained) return { status: 403, error: explained.error };

  // Everything else, including routes the harness really does have. Saying
  // "no route" rather than "not allowed" keeps the sidecar from enumerating
  // the API to anyone holding a stolen token — and it is what the peer-agent
  // endpoints under /api/internal/ always got, since off this machine they
  // genuinely do not exist.
  return { status: 404, error: `no route: ${method} ${path}` };
}
