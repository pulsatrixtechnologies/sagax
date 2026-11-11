# Desktop and phone apps

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Desktop store subscriptions

Shell selects routing and chrome; BotSurface and GroupSurface subscribe to
conversation records at the leaves. ChatView, its viewport, focus and unread
hooks use useStoreSelector scoped by thread or bot. Event handlers use
useStoreGetter, not a captured workspace. Peer lists use view-slices.ts and
never subscribe to other conversations' transcripts; ownership, grants,
hiding and task navigation still invalidate them.
TransientNotice groups fresh routine failures in one dismissible banner, with
each run still available in its details. It remembers the whole burst and
does not extend the first notice's timer as failures arrive. Access cards
keep their separate settlement behavior. Regression: TransientNotice.dom.test.ts.
StoreCommandsContext carries flush/refresh services independently of state,
including inside BotEditorStore. Use useStoreCommands for them. Sidebar
layout helpers take SidebarState; rows memoize record fields and every
callback, and row selectors scope queues, motion and deletion to their bot.
The profile foot selects counts, not whole run or bot lists.
Render regression: src/components/StoreSubscriptions.renders.dom.test.ts
(real desktop, scoped store, neutral fixture, no network or visible window).

## API document for one person (2026-10-27)

`PUT /api/me/openapi` stores an OpenAPI 3 document for that person
(docs/openapi-connector.md). Their bots receive the operations in a 1:1
turn. Other members do not. Header values are sealed and stay out of the
tool list. A write (POST, PUT, PATCH, DELETE) follows the person's
approval level. On an organization server the call is pinned to the
address that was checked.

## Health scan (2026-10-27)

`server/health-scan.ts` is a separate process (docs/health-scan.md). It
reads logs and databases without modifying them and writes
`health-reports/latest.md`. `GET /api/me/health-report` shows that file.
It does not call a model and it does not open a ticket.

## iPhone: switching accounts keeps each account's state (2026-10-27)

Decision: switching between Personal and an organization server, or between
two saved servers, never signs out and shows at once. `Session.switchComputer`
(`ios/App/Session.swift`) keeps each saved connection's last `CompanionState`
(its bots, conversations and cursor) in memory, three at most, and shows it
the moment the account is picked; the stream resumes from that account's own
cursor instead of an empty screen and a full hydrate. Tokens stay one per
connection in the Keychain (never re-asked). A state is handed back to the
same saved connection only; forgetting, signing out or re-pairing it drops
it. Bot pictures are cached under each account's own key, so one server's
never shows on another's.

## Switching accounts is instant and never signs out (2026-10-27)

Decision: "passer du compte personnel à un serveur d'organisation, ou d'un
serveur à un autre, ne doit JAMAIS déconnecter", instant like a chat app's
workspace switch.

- Desktop: one page per account in the main window
  (`electron/page-contexts.mjs`). The window's own webContents is the first
  account's page; each other account (Personal, each saved server) gets a
  `WebContentsView` laid over it, with the same preload, rules
  (`wireAccountPage`) and persistent session. A switch shows the page as it
  was left (conversations, drafts, screen, live stream) and loads nothing;
  only a specific address (a sign-in, a Settings link) or a data-folder
  change loads it again (`navigateMainWindow`). Hidden pages are throttled
  and kept current by their own stream; at most four pages stay open (least
  recently shown closed first, never the one on screen). Personal's page opens
  hidden a few seconds after launch (`prepareOtherAccounts`); an organization
  server's page opens on its first switch, then stays.
- Isolation: each page stays on its own origin, so its cookie, storage and
  session are its own; a page navigates within its own account only. The
  bundled-UI handler (`protocol.handle`, a whole scheme) is installed only
  while an organization server is on screen: with it, every https request of
  the main process session goes through a JS passthrough (measured on a
  heavy page: about +20 % load, main CPU doubled, an embedded YouTube video
  stopped), so Personal never pays for it. A server's session rides only with
  its own page (`fromBundledPage`). The desktop-UI channels, the badge, the window title,
  permissions, floating bots and dialogs answer the page on screen only
  (`mainPage()`); a hidden account may still notify (a click opens it).
- Signing out or forgetting an account closes its page only
  (`pageContexts.drop`); Personal and the other servers stay signed in.
- An organization server's page opens Personal with `accounts.openPersonal`
  (BUNDLED_EXTRA, `desktopUiOnly`): never `serverMode.leave`. The page names
  no destination and is never given the saved-server list.
- Tests: `electron/page-contexts.node-test.mjs`, `electron/server-mode.node-test.mjs`,
  `electron/bundled-ui.node-test.mjs`, `src/lib/account-menu.test.ts`; real
  Electron with timings: `scripts/verify/dev/verify-account-switch.ts`.

## One-line self-hosted install (2026-10-26)

`install.sh` (repository root) installs the server from the public image
`ghcr.io/pulsatrixtechnologies/sagax:<X.Y.Z>` into `~/sagax` (or `--dir`):
`.env` created once (0600, never overwritten, holds the generated vault key
`SAGAX_MCP_OAUTH_KEY`, which is never printed), plus generated
`compose.yaml`, `Caddyfile` and the `sagax` helper (`update [X.Y.Z]`, `pair`,
`status`, `logs`, anything else forwarded to the server CLI in the
container). The image is built only by `release.yml` job `server-image`, on
the `release: published` event of a `pulsa-vX.Y.Z` tag (or a dispatch with
`server_image_tag`); never add a push or PR trigger for it. Nothing waits for
that job. Keep the checkout path (`deploy/docker-compose.yml`, `--build`)
working. Tests: `scripts/install-sh.test.ts` (fake docker, shellcheck),
`scripts/ci-workflow.test.ts`. Docs: `docs/install.md`, `SETUP_PROMPT.md`.

## Server log on disk and expired approvals (2026-10-11)

- The server log tail behind `GET /api/org/admin/logs`
  (`server/process/server-log-ring.ts`) is a sliding window on disk as well as in
  memory: `serverLog.persistTo(<data>/server-log)` at start, two JSON-lines
  files (`current.jsonl`, `previous.jsonl`) of at most `LOG_FILE_MAX_BYTES`
  (2 MiB) each, 0600 in a 0700 folder, written in batches (1 s, flushed at
  exit), lines redacted before they are kept. A restart reloads the last
  2,000 lines and `seq` continues; the answer's shape is unchanged. The
  folder is never in a workspace backup (`ephemeralWorkspaceTokenPath`).
  Covered by `server/process/server-log-ring.test.ts`.
- A permission card whose own timeout passed with no answer
  (`request.resolved` with `source: "timeout"`) writes a decision row
  `expired` (source `timeout`), and `GET approvals/history` answers it as
  `decision: "expired"` with `by` null (`server/org/org-admin-routines.test.ts`).
  The bot activity log reads it as denied (nothing ran).

## Event loop stall line (#3629)

`server/process/event-loop-lag.ts` writes `[loop-lag] p50 .. p99 .. max ..`
every minute and one line per stop of the event loop of one second or more.
The main thread is sampled all the time (every `SAMPLE_INTERVAL_MS`, 20 ms,
about 0.6% of one core on a loop busy at 30%, in
windows of `WINDOW_MS` rotated without tearing the profiler down); a window
in which nothing stopped is dropped unread. A stop reads its window once the
loop is back, cut to the stopped stretch, and the line says what RAN during
it: at most eight functions by self time with their share (name, file
without its folder, line), then the heaviest stack, innermost frame first.
Native work called from JavaScript (a hash, a synchronous write, a SQLite
statement) shows under its own native name with its JavaScript caller in the
stack; `mostly garbage collection` follows the gc figure when collection took
most of the stop. A real line:

```
[loop-lag] event loop blocked 7779 ms (rss 474 MB, heap 202 MB), of which gc 35 ms; ran during the block (321 samples every 20 ms): update 94%, buildIndex ex.mjs:6 3%, (garbage collector) 2%, compileRoutes ex.mjs:8 1%, (program) 0%, writeFileUtf8 0%; heaviest stack:
  update
  update hash:179
  sealIndex ex.mjs:7
  compileRoutes ex.mjs:8
  (anonymous) ex.mjs:0
```

When the profiler cannot start, the watchdog pauses the main thread instead
and the line says `stack after the block`: that names the first function
entered after the stop, not the one that did the work.

## Launch flow (desktop)

First run on the desktop app's own window opens the launch screen
(`src/components/onboarding/LaunchScreen.tsx`, rules in `src/lib/launch.ts`)
before the welcome tour: **No server** is the solo app, **Server**
probes the address (`orgJoin.probe`, Perspicax-linked servers only) then
`orgJoin.join` saves the server and starts the existing **Sign in with
Pulsatrix** (`electron/org-join.mjs`, `startPulsatrixSignIn` in
`electron/main.mjs`). Do not add another sign-in path. The choice lives in
`config.onboarding.launchMode`; the address field starts empty (no build
ships a default server) and proposes only an organization server this
computer already saved in `environments.json`. The welcome tour and Settings > Organization no longer
offer the inherited managed-desktop Admin sign-in. Organization is Perspicax. See
`docs/self-hosting.md` ("At launch: No server or Server").

Server mode (the launch screen's Server): `serverModeId` in
`environments.json` (`electron/environments.cjs`) opens the app on that
organization server. While it is set nothing switches to another saved
server or a named local environment (`withActive`, `switchEnvironment`,
`requireNotServerMode`); Personal (this computer's own space) is a switch
away and never a sign-out (2026-10-27, below). The packaged app starts no
local server until Personal is first opened (`openPersonalInServerMode`
starts it in place; `personal: true` then starts it with the app). The only
way out is `leaveServerMode` in `electron/main.mjs` (Settings > General >
Server > Sign out, Server > Change server…), which asks in a native dialog
("Sign out of <name>?"), signs out and returns to the launch screen. That Server card names the server's
address in bold, the organization and the signed-in person
(`ServerModeCard`, test `src/components/SettingsModal.serverMode.test.ts`). Tests:
`electron/server-mode.node-test.mjs`, `electron/environments.node-test.mjs`.

An organization server (`org: true`, set by org-join after its probe) is
drawn with this app's own bundle (`electron/bundled-ui.cjs`): page requests
come from the bundle, `/api/`, `/.well-known/` and `/auth/` pass through.
Keep these rules: the session cookie rides only with the bundled page's own
requests (its referrer is the server's origin), never a widget's or another
origin's; main's own calls to a server pass `bypassCustomProtocolHandlers`;
the bundled page gets only `BUNDLED_EXTRA` in `electron/preload.cjs`, and
main checks those channels with `desktopUiOnly` (`electron/local-origin.cjs`);
anything touching this computer stays `localOnly`. Tests:
`electron/bundled-ui.node-test.mjs`; real Electron:
`scripts/verify/dev/verify-server-mode.ts`.

On an organization server (`SAGAX_IDENTITY=perspicax`) bots never use the
server's own machine: `ManagedDesktopPolicy` refuses `thisComputer` and
`localVm` there (`HOST_COMPUTER_REFUSAL`, every claim passes
`bindTurnComputer`), and the Local VM create/start routes refuse with
`hostComputerRefusal()`. A bot reaches the computer of the person who asks
through `server/computer/user-computers.ts`: `speakingPerson` (a person's message or a
hop carrying it; never a routine), then a provider per target
(`user-desktop`: that person's desktop app via the owner-scoped `SharedComputers`
`list(person)` and `request`, for the person `sharedComputerPrincipal` proves; `user-sandbox`: plugs in as a second provider). Not connected, not
theirs, or no person: the tool answers why. `shared_computer` is never
pre-allowed for Claude (`agentsAllowedTools`), so the bot's approval mode
applies. Tests: `server/computer/user-computers.test.ts`,
`electron/server-mode.node-test.mjs`.

A person's preferences on an organization server live per principal
(`shared/user-preferences.ts` lists the only keys that travel,
`server/people/user-preferences.ts`, `GET/PUT /api/me/preferences`). The renderer
syncs them before the app draws (`src/lib/user-preferences-sync.ts`); the
launch screen hands this computer's own values over once at join
(`orgJoin.join({ preferences })`, `takePreferences`). Device-only state
(drafts, sizes, floating list and positions, mood, voices) never travels.

## Sign in with Pulsatrix (desktop)

The desktop app always signs in through the system browser, never in a
window of its own (passkeys and password managers live in the browser).
`startPulsatrixSignIn` in `electron/main.mjs` and
`electron/oidc-system-sign-in.cjs` own it; there is no in-app sign-in
window, do not add one back. Return paths, in order: a one-shot loopback
listener on `127.0.0.1` (ephemeral port, random state path, exact Host and
Origin, ten-minute timeout, closed after use), then `sagax://auth` only
when this exact running copy owns the scheme and the server advertises
`nativeReturn`, else an error on `/pair`. The server side is
`validLoopbackReturn` in `server/auth/oidc-login.ts` (loopback IP literals with a
port and a state only; the credential rides in the fragment) and the
descriptor's `identity.loopbackReturn`. Tests:
`electron/oidc-system-sign-in.node-test.mjs`, `server/auth/oidc-login.test.ts`,
`server/oidc-session.e2e.test.ts` (S2-7b). The return lands in the main window as
`<origin>/pair?signin=<nonce>#code=...` (`authReturnTarget`): never a
fragment-only change of the `/pair` the window already shows, which would
not reload the page. `scripts/verify/dev/verify-desktop-sign-in.ts` proves it in a real
Electron window. A change to that server code needs the server image
redeployed.

## Achievements (2026-10-02)

Catalog `shared/achievements-catalog.ts` (pure data, ids never renamed),
engine `shared/achievements.ts`, store `server/achievements/achievements.ts` (one
`achievements.json`, per person on an organization server, the local
operator on a solo server), routes `server/routes/achievements.ts`, app
`src/lib/achievements.ts` and `src/components/achievements/`. Keep these
rules, each covered by `shared/achievements-catalog.test.ts`,
`server/achievements/achievements.test.ts`, `src/lib/achievements.test.ts`,
`src/lib/achievement-toasts.test.ts` or `achievements-ui.test.ts`:

- Server events come from the server's own hooks only (a request's method
  and path in `achievementRequestEvents`, a send in `achievementSendEvents`,
  live frames in `observeAchievementFrame`); `POST /api/me/achievements/events`
  takes client events only. Events are rate limited, an event id counts
  once, an achievement unlocks once.
- By default only the owl and its Common skins are usable. The crab unlocks
  when the person's own Claude account is linked (own `claude auth login` or
  own Anthropic key, recorded as server event `claude.linked`; an organization
  key does not link). Shapes unlocks when a Grok account is linked (the
  person's own sign-in or their own xAI key, reported as `grok.linked`).
  Trombi unlocks only from its hidden command (an easter egg; do not write
  the command down), or on a device that already found it. A locked
  character shows greyed on the look editor's To unlock shelf (Trombi stays
  out until found). An earned skin unlocks its character too (Trombi
  excepted, `characterUnlocked`, `masteryLock`). Every skin above Common, and
  Bunbu, is the reward of exactly one achievement. On first use a person keeps
  every character and skin their bots wear (`grandfatheredFromBots`); a later
  one-time `migratedCrab` pass keeps a crab that was already worn. What a bot
  wears now stays in the editor. Locked skins show in the editor, greyed with
  a padlock and the achievement that unlocks them; locked rewards stay out
  of the app icon picker until they unlock. The server never refuses a look.
- A server without the routes (404) locks nothing.
- The unlock frame (`kind: "achievements"`, `audience`) reaches that
  person's streams only (`achievementFrameAllowed`). Nobody reads another
  person's record; `/api/achievements/public` lists the points of people by
  default, and leaves out anyone who turned "Show my points to colleagues"
  off. Unlock percentages show only
  with five people or more.
- Visibility (2026-10-08, corrected). People rows in the sidebar never show an
  achievement title or points. The viewer's own account row at the bottom
  does: title then points under the name, each only while its switch is on,
  the name centred beside the avatar with both off, and the active routines
  badge always at the right edge of the row, centred (never under the name).
  The foot's account row (no pill, beside the round Connect apps button)
  shows the same second line; the row and the button take `--foot-tile-h`
  (36px, 44px with the line), so their heights always match.
  Titles and points also show in a person's detail (the person panel, from a
  people row or a DM header, the viewer's own included) and on
  Settings > Achievements. Two switches there, same style, stored in the
  person's settings on the server (so every device follows): "Show my
  points" (`showPoints`) and "Show my title" (`showTitle`, a missing flag
  means on). Each is the person's own choice for everyone who looks:
  `publicPoints` leaves `points` and `level`, or `title`, off their card,
  and the person panel draws only what the card carries. Profile stays the
  default tab. Title, gamerscore and the unlocked list sit together on the
  Achievements tab as one member card (large avatar, highlighted head, list);
  they never sit on the name line. A person who turned sharing off (no
  public card) sees "This person keeps their achievements private." and no
  private records. With neither title nor points, the member card centres
  the name beside the avatar. Settings > Achievements itself and the unlock
  toasts are unchanged by these switches. Tests: `server/achievements/achievements.test.ts`,
  `src/lib/public-achievements.test.ts`, `PersonPanel.test.ts`,
  `achievements-ui.test.ts`, `SidebarProfileMenu.footer.test.ts`.
- People rows in the sidebar sit at the bot rows' inset (`pl-1`, `pl-2` compact) with thread
  mode on or off and carry no thread chevron, like bot rows since #152; room
  rows too since 2026-10-12: every row takes `pl-6` and its chevron only in
  the sidebar location (`Sidebar.simple-mode.test.ts`).
- The toast never shows while the person types, one at a time, its chime
  follows Notification sounds, and reduced motion stills it.

## Release notes in the app

Every release has `docs/releases/<version>.md`: the French part first, then a
`## English` section (`scripts/check-release-notes.mjs` refuses a release
without it). The `pulsa-vX.Y.Z` tag itself must be an ancestor of `main`:
squash-merge the release PR first, then tag that squash commit
(`scripts/check-release-tag.mjs`, docs/releasing.md; issue #1709). The notes
files are compiled into the renderer by `import.meta.glob`
in `src/lib/bundled-release-notes.ts`, so the notes work offline and an
organization server serves the same bundle. Three ways in, all through
`src/components/ReleaseNotesPrompt.tsx`:

- "What's new" opens once after an update (`whatsNewDecision`), never on a
  fresh install or a dev build. Before an update the feed's release body is
  shown by `UpdateBanner`, folded under "What's new in <version>" in the
  small "Update ready" dialog (title, one sentence, the pills Later and
  Restart to install). The dialog opens when an update has downloaded; after Later,
  the round cloud button at the right of the sidebar's account row
  (`SidebarProfileMenu`, `showsUpdateButton`, a downloaded update only)
  opens it again through `openUpdatePrompt` (`src/lib/update-prompt.ts`).
  That button widens into a pill, its right edge pinned, on hover or focus
  and for five seconds after the update lands, while the name folds away to
  the avatar; the collapsed rail keeps its dot. Tests:
  `src/components/UpdateBanner.test.ts`,
  `src/components/SidebarProfileMenu.update-button.test.ts`.
- Account menu > "Release notes" (`profileMenuItems`, key `release-notes`,
  above Check for updates) opens the same sheet in browse mode:
  a version picker (newest first, the running version marked current) and,
  when the previous version is known, "Changes since my last version". The
  seen record in localStorage (`sagax.releaseNotes.seen.v1`) keeps
  `{ version, previous }`.
- About and the Help menu open the running version alone.

The French UI gets the French part, every other language the English one; a
file with no English section is shown whole. A new release only needs its
file in `docs/releases`; no list to edit. Tests:
`src/lib/bundled-release-notes.test.ts`, `src/lib/release-notes.test.ts`,
`src/components/SidebarProfileMenu.test.ts`.

## Updates: confirmed, visible, never silent on Windows (2026-10-19)

A Windows report: account menu > Help > "Check for updates" on an update
already downloaded quit the app straight into a silent NSIS install, minutes
with no window, shortcut and pin icons blank, Sagax not reopened; and a
relaunch during that install showed a bare "Not Found". Keep these rules:

- "Check for updates" (menu, Settings > Updates) never installs: it calls
  `requestUpdateCheck` (`src/lib/update-prompt.ts`) and `UpdateBanner`
  follows the check in its dialog: searching, "Sagax X.Y.Z is available"
  (notes, progress, Later keeps it downloading), "Update ready" (Later,
  Restart to install), "Sagax is up to date", or the failure with Try again.
- Only the dialog's Restart to install installs, as
  `updater.install({ confirmed: true })`. Main installs an unconfirmed call
  (an older organization page) only after a native question, Later by
  default (`electron/update-confirm.mjs`, coordinator `confirmInstall`).
- Windows: `autoInstallOnAppQuit` is off (electron-updater would run the
  installer silently on quit) and `quitAndInstall(false, true)` runs the
  NSIS installer with its progress window, then reopens Sagax. macOS and
  AppImage keep install on quit and the silent swap.
- NSIS identity is pinned (`electron/packaging-windows.node-test.mjs`):
  appId, productName, package name (install folder), shortcutName,
  one-click per user, shortcuts created once and kept by updates
  (`--keep-shortcuts`). `build/installer.nsh` only refreshes shell icons.
- At start the packaged app waits on the loading screen while its bundle is
  incomplete (`uiBundleState`, `waitForUiBundle`), and a main-frame load of
  its page that answers an HTTP error or cannot connect is retried behind a
  loading page, then shown as an error page with Try again
  (`installLoadRecovery`, `electron/load-recovery.mjs`).
- Tests: `electron/updater-coordinator.node-test.mjs`,
  `electron/updater.test.mjs`, `electron/update-confirm.node-test.mjs`,
  `electron/load-recovery.node-test.mjs`, `src/components/UpdateBanner.test.ts`.

## Resource usage card (2026-10-21)

Decision: « un graphique de consommation du CPU, RAM, Disque (IO, usage), Network
usage qui s'affiche de manière esthétique lorsqu'on le demande ». The agents
tool `resource_usage` (target `this_computer`, `sagax_server`, `host`,
`remote_session`, `bot_computer`) posts a live card (`resourceUsage` on the
message) and answers the bot with the first sample in words.

- Only when asked (#876): the server refuses unless the person's message of
  the turn asks about usage (`askedForResources`, shared/resource-usage.ts, or
  `askedForView`). Read-only, so no approval card (#875).
- Rights are the existing ones (server/resource-usage/targets.ts): this
  computer or the Sagax server for the solo operator or an organization admin;
  SSH and unRAID hosts by `terminalResourceAllowed`; a Tailcat session only
  for its person and bot while `readTunnel` resolves (owned + tunnelOf); the
  bot's Local VM for its owner (solo). Reprendre opens the target again, so
  the check runs again. Organization: the person's own computer is not offered
  yet (it would need a native bridge action in the desktop app).
- Sampling (server/resource-usage/): one read-only loop per card, `scripts.ts`
  (macOS top, vm_stat, ioreg, netstat -ibn, df; Linux /proc; Windows CIM
  performance classes, which read the same on a French Windows and need no
  admin; PowerShell as -EncodedCommand). The loop ends by itself on the
  computer after the run. `sampler.ts`: 2 s cadence, 5 min runs, pauses after
  20 s with nobody watching, at most 2 running per person (a third pauses the
  oldest), a flooding stream is dropped. Parsers are tested from fixtures
  (`server/resource-usage/fixtures`).
- Card: `src/components/resource-usage/` (`ResourceUsageBody` is pure), the
  stream is `GET /api/resource-usage/:id/live`, for the person who asked only.
  Chart colors are `CHART_PALETTE` (dataviz), values are ink text beside
  colored marks, a full volume shows an icon and a word, a Valeurs table
  shows the same numbers. Never an id on screen.
- Gallery: `src/gallery/resource-usage.html`; captures
  `node scripts/capture/resource-usage.mjs` (`SAGAX_CHROMIUM` for another
  headless shell); four of them are in `docs/screenshots/resource-usage/`.
- iOS and Android show the row's text fallback (none yet): a native card is a
  follow-up.
