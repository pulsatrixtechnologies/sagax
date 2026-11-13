# Computers, browsers and coding

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

"The Computer tab" below names the computer view: the bot panel has no
Computer tab, Activity > Computer opens that view (2026-11-05, #2085, #2125).

## Web work stays out of sight; this computer's screen is announced (2026-10-28)

A bot on Auto, asked for "the latest video of" someone, opened Chrome on the
person's own screen and clicked through it in front of them. Cause: on Auto
the dispatch mounted this computer (cua-driver on the real screen) and, by
the "one place per turn" rule, NOT the built-in headless browser, so the
prompt said web pages go through this computer's own browser; Claude Code
could also load its own Claude in Chrome extension. Now:
- This computer keeps the built-in browser beside it (Auto, Works on, a
  pin: `resolveSurface` and the dispatch in server/index.ts). Other
  computers keep one place per turn.
- `HOST_SCREEN_RULE` (server/surface.ts) on every turn with this computer:
  lookups go to web search, fetch or the built-in browser, the result in
  the chat (a YouTube link draws as a player); the screen only when the
  person asks ("open it in my Chrome") or a signed-in session needs it,
  announced in one line first. Not a restriction: their request is enough,
  under their approval level. Same in the computer paragraph, the Auto
  rules and the desktop bridge's `browse` / `computer_use` descriptions.
- Claude turns pass `--no-chrome` (floor 2.1.0): the person's Chrome is
  reached through My Chrome or this computer, both visible and stoppable.
- The first screen action of a turn on this computer appends
  `HOST_CONTROL_NOTICE` (shared/host-control.ts, kept by chat-notices on
  desktop and iOS), and `GET /api/computer/host-control` lists the bot
  holding `computer:host`: `HostControlIndicator` draws the banner with Stop
  (the ordinary task stop). An organization server answers 404.
Tests: `server/host-screen-web.e2e.test.ts`, `server/surface.test.ts`,
`src/components/HostControlIndicator.dom.test.ts`,
`src/lib/activity-runs.test.ts`, `shared/chat-notices.test.ts`, iOS
`ChatNoticesTests`. Captures: `scripts/capture/host-control.mjs`,
docs/screenshots/host-control.

## Headless tasks run for real: sagax task give / task wait (2026-10-29)

`sagax team apply FILE`, `sagax task give --bot NAME --text TEXT` and
`sagax task wait ID` (server/cli/headless-cli.ts) only write files in the data
folder; the Sagax server running on that folder now does the work
(server/headless-task-runner.ts, wired in server/index.ts). About once a
second it beats `headless-runner.json`, creates any bot of
`headless-team.json` that does not exist yet (matched by name, any case;
title kept, the server's default engine and new bot level), and takes each
`queued` task of `headless-tasks.json`: state `running` with its boot id,
so it is never taken twice, then a turn of that bot in a conversation of
its own ("Task: ...", shown under the bot), spoken as the owner of this
computer (`origin: "operator"`). The final reply settles it `done`; an
unknown bot, an engine that cannot run or a failed turn settles it `failed`
with the reason. One turn at a time per bot. A task a stopped server left
`running` is queued again at the next start, and fails after 3 such stops.
The CLI and the server change the queue under `headless-tasks.lock`.
While a workspace backup copies the data folder, the server neither beats
nor takes tasks (paused with the routines, #4128), and picks up after.
`task wait` waits up to an hour by default and exits 0 (done, with the
reply and the thread), 1 (failed or unknown id), 2 (timeout) or 3 (no
server beats on this data folder: it says to start one, the task stays
queued). `SAGAX_HEADLESS_TASK_WAIT_MS` (1 h) bounds one task's turn. Tests:
`server/cli/headless-cli.test.ts`, `server/headless-task-runner.test.ts`,
`server/headless-tasks.e2e.test.ts` (fake engine).

## Show a task in my Chrome (2026-10-29)

The person shows a task once in their own Chrome and a bot replays it.
Teach a task (composer +) offers "Show it in my Chrome" where the server
offers My Chrome to this person (`src/components/MyChromeRecordDialog.tsx`).
No extension: Sagax opens one new tab in front through My Chrome's own
connection (`MyChromeGate.openRecorderTab`, a session of the gate's own,
never handed to an engine, not listed as a bot's tab) and records only that
tab (`server/browser/my-chrome/recorder.ts`). A script in an isolated world
reports trusted clicks (role, accessible name, a selector the page answered
with one element: id, test id, field name, label or short path), the text
typed in fields (on change, Enter or Tab), Enter and Escape, and the pages
opened (typed, back, forward, reload; a page a click led to is not a step).
A banner in the tab says Sagax records, with Stop. The person adds narration
notes in Sagax, typed or dictated (the composer's dictation). Recording needs
My Chrome on and not stopped, not an allowed site; My Chrome's Stop or
turning it off ends it (steps kept until the person stops in Sagax).

- Secrets: a password or secret field never sends its value from the page
  (only "a secret goes here" and, on a secure page, a SHA-256 digest); the
  server checks every field and text again (`isSecretField`,
  `looksLikeSecret`) and masks a later text whose digest matches a secret
  typed earlier. Addresses go through `sanitizeTeachUrl`. Memory only,
  dropped after 30 minutes idle.
- Stop gives the steps to `TeachStepsDialog`, saved through
  `POST /api/bots/:id/shown-path` with `replay`: "background" (the bot's own
  browser, no window on the person's screen, sign-ins from the vault's
  `fill_credential` or asked) or "my-chrome" (the person's signed-in
  session). The default is "background" (web work stays out of sight,
  2026-10-28 above); the person picks "my-chrome" when the task needs their
  signed-in session. The SKILL.md gets a "Where to Replay"
  section (`teachReplayPlan` in shared/teach-recording.ts): for My Chrome
  the bot says the announce sentence in the conversation before the first
  step, and `MyChromeIndicator` plus the tab's banner (Stop) show for the
  whole replay, as for every My Chrome drive (no second indicator: My
  Chrome's own, and `HostControlIndicator` stays for this computer's
  screen). Approval cards and every My
  Chrome rule are unchanged; secret steps point to `fill_credential` first.
- Routes: `POST /api/my-chrome/record/{start,status,note,stop,discard}`,
  same person-only check as the other My Chrome routes.
- Not followed: popups and other tabs the person opens from the recorded tab.

Tests: `server/browser/my-chrome/recorder.test.ts`,
`server/browser/my-chrome/recorder.e2e.test.ts` (headless test Chrome and a
local page: record clicks and typing, save, replay through My Chrome with
cards and banner, replay in the background with no gate, final page state),
`shared/teach-recording.test.ts`, `server/routes/my-chrome.test.ts`,
`src/components/MyChromeRecordDialog.dom.test.ts`. Captures:
`scripts/capture/my-chrome-recorder.mjs`.

## Bots' browser keeps its own Chrome profile: port of OpenMausBot #3141 (2026-10-20)

A saved session (a bot's own browser, a shared profile) runs Chrome on
`<data dir>/agent-browser-profiles/<sha256(session)>` (`AGENT_BROWSER_PROFILE`,
`server/browser/browser-engine.ts` `browserProfileDirectory`), so localStorage and
IndexedDB sign-ins survive restart, idle close, app restart and a crash; the
restore file still carries cookies. Never for the temporary browser,
confidential threads, meetings, or My Chrome / a CDP attach (no profile, no
gate bypass; My Chrome rules of #838/#859 unchanged). The disk cache is capped
at 64 MB. `releaseBrowserProfile` (`server/browser/browser-processes.ts`) stops a Chrome
orphaned on the profile and drops a stale SingletonLock before a launch; the
orphan sweep finds Chromes on kept profiles but only ever removes temporary
ones. Deleting a bot or profile deletes its kept profile
(`clearBrowserSessionState`); workspace backups leave the folder out. Windows:
profile kept, no lock handling. #3182 (identity-check retry) does not apply:
Sagax has no Chrome identity launcher.

## Tailcat remote sessions

A connected Tailcat session is a first-class card (`remoteSession` on the message) and a Sessions à distance section in the bot panel. The address and the client key stay in the Flow session folder on this host. Never accept them as tool arguments, never put them in an API answer, a log line, or visible text. The support code is the label. The 12-hex folder id stays off the screen. Screenshot in the Computer tab is read-only. Shell reuses the in-chat terminal (`provider: tailcat`). Sagax ships tailcat 0.7.0 beside the app (`dist-native/tailcat`, then the app resources) and in the server image at `/usr/local/bin/tailcat`. Do not tell a bot to install it onto the system PATH. The panel section always renders (empty state when none). A session the bot opened with `remote_support_open` registers itself through `PerspicaxMcp.relay` -> `server/remote-support/remote-session-register.ts` when the status says connected; Sagax does not wait for the person to say the script is launched: `server/remote-support/remote-support-watch.ts` polls the status in the opener's name from the open until connected (#1499); its tunnel is in `<data dir>/remote-support/sessions/<CODE>/`, and resolves only for the person and bot named in that folder's `open.json` (the speaker whose Perspicax credentials opened it; never the conversation owner, never the 12-hex id alone). Prendre le contrôle opens the Computer tab in every mode (`startRemoteControl`, `visiblePanelTabs`); the screen stays read-only until live control lands over `RemoteSessionScreen`. Bot guidance (standard rights, three calls, script in the first reply, no jpg, no Preview) lives in the tool descriptions and the `remote-support` guide. See `docs/remote-sessions.md`.

## Cloud computers: faster cold start, honest starting and off (2026-10-26)

Decision: the cluster still stops when nobody works (no always-on node).
Make each wait shorter, start it at the first keystroke, keep a reserve node
only while someone works (at most 4 people at once), and never wake a
computer only to show its state.

- Measured: 427 s from the start webhook to a running sandbox on a stopped
  cluster (246 s cluster, 67 s provisioner image pull, 71 s new node, 7 s
  volume, 12 s image). `node scripts/k8s-wake-timeline.mjs <events.json>
  --from <time>` reads it again (read-only, never prints a person's key).
  Levers and the isolation trial's figures: `docs/sandbox-kubernetes.md`.
- `deploy/k8s/provisioner/Dockerfile`: the provisioner alone (Node and
  `dist-server/sandboxd.js`), 353 MB unpacked instead of 1.6 GB.
- Typing: `src/lib/prewarm.ts` sends `typing: true` from the composer on its
  own refresh; `threadWarmRequest` calls `prewakeComputerWhileTyping`
  (`server/sandbox/sandbox-typing-prewake.ts` throttle, 2 min per person and bot),
  which uses `UserSandboxManager.prewake` (Kubernetes with the wake only, a
  bot that used it in 7 days only). Opening a conversation never wakes.
- Reserve: `server/sandboxd-k8s/sandboxd-k8s-spare.ts` (provisioner, every 15 s) sets the
  reserve Deployment from the sandbox Pods: 0 with nobody, `SPARE_COUNT`
  while someone works, 0 from `SPARE_MAX_ACTIVE`. Env
  `SAGAX_SANDBOX_K8S_SPARE_DEPLOYMENT`, chart `provisioner.spareScaler`
  (Role on that Deployment's scale only). It drives the `warmNode.spare`
  placeholders of the dedicated-node work.
- States: status reads stay `peek`. A `Pending` Pod sets `starting` on the
  container summary, `SandboxStatus`, `UserSandboxView` and
  `/api/computer/status` (`state` stays `"stopped"`); the Computer tab and
  iOS (`ServerEnvironmentStatus.isStarting`) show starting, no Start button.
- Zonal disks: a workspace disk pins its Pod to its zone; keep sandbox
  pools in that zone or use ZRS for new workspaces.

## Auto starts in the server environment; discovery is bounded (2026-11-07, #2670)

QA c2 (defects D2, D3, D7, G2, G5): bots looped 22 to 45 steps of
`sagax_help`, `skills_list`, `session_search`, `search_tool`, `workspace_read`
before a one-line answer or a clarifying question, and ran `run_command` or
`fetch_url` on the person's Mac while they had a server environment.

- `autoStartTarget` (`server/computer/auto-computer.ts`): a person-asked turn
  starts in the person's server environment when they have one
  (`sandboxConfigured`), with their computer connected or not; their computer
  only when their words ask for it or the step needs their machine. Without a
  server environment the old order stays (computer when connected, else cloud).
- `WORK_STYLE_PROMPT`: discovery (sagax_help, skills_list, search_tool,
  session_search, workspace_read, workspace_search, a skill catalog) takes at
  most two calls per turn, never the same one twice, and none when the first
  tool is already known or the request is ambiguous. A direct read or a
  clarifying question comes first and wins over a skill's own "catalog first".
- `VERIFY_FIRST_PROMPT`: a request whose object or recipient is missing and
  several fit ("Envoie-moi le rapport") is a decision: the card is the first
  step, in one turn, with zero tool calls before it.
- `AUTO_COMPUTER_RULES`: product versions in production come from this
  server's `/api/health` and the Perspicax server's `/healthz`, one `fetch_url`
  each; `host_health` reports failures, latency and drift, never a version.
- `PERSPICAX_CONVENTIONS_PROMPT`: after a 403 read once under another role
  (Sagax's note or an `identity_switch`), the bot says so to the person in one
  line by the role's name ("Lu avec le rôle Technicien"), never an id. The
  switch itself is wanted: a 403 of the limited role means find a role that may.
- The Flow entry skill `using-px-flow` (pulsatrix-flow repo) is aligned: a
  clarifying question and a single-record read come before `catalog --index`.

## Workspace: always Auto, the bot chooses (2026-10-18)

Decision: "It should ALWAYS stick to default, and the bot chooses. So basically bot
always have access to all of them, he is in control." Nobody picks a place
for a bot or a conversation any more:

- No Workspace row in the composer's + menu (and no "/setup" hint beside
  "Set up this bot"; typing /setup still works), no place chip on iPad, and
  Works on (bot editor's Workspace page, iPad and iPhone) offers Auto and
  Off only. The bot picks per task among the places available to it
  (`computer_select`, `select_computer`, start_thread `workspace`).
- Off stays: it withholds every computer and the browser, and team-backup's
  quarantine writes it. Lifting it would widen what a bot may reach.
- The server reads a requested place as Auto, without an error
  (`autoOnlyDestination`, `server/surface.ts`): `PATCH /api/bots/:id`
  `computer` (null, "auto" and "off" too), `POST /api/bots` settings, a bot
  zip import, and `PATCH .../tasks/:threadId` `surface` (validated, never
  stored). The engine-removal move writes no place.
- At start, `Store.retireFixedWorkspaces` moves a saved fixed Works on and
  every conversation pin back to Auto, Off kept, idempotent (log line
  "Workspace: N bot(s) and M conversation(s) back on Auto"). A bot or a
  conversation that was kept off this computer (Cloud, Local VM, Browser,
  by Works on or by a person's or legacy pin) may reach it on Auto, so it
  goes back to Ask (allow list cleared, a prepared grant dropped), until a
  person raises the level again. An auto pin changes no level.
- A creation request that names This computer keeps its guards: the
  Approve for me warning (`acknowledgeLocalAuto`) and Ask to start.
- Other guards are unchanged: organization policy
  (`managedPolicy.computers`), Deny/Ask rules, security keys, approvals,
  the person's app connected for their computer, routines on the owner's
  computer only when allowed. Known gap, as before for every Auto bot: the
  Approve for me warning is keyed on Works on This computer, so it does not
  show for an Auto bot (a decision for the maintainer whether Auto should show it).
- Linux: Auto never takes this computer (`server/local-routing.ts`), so a
  Linux bot that worked on This computer loses it (narrower, not wider).
- The Perspicax console lists an Auto bot under both the server
  environment and the desktop (`server/org/org-admin-computers.ts`).
- Test seam `SAGAX_TEST_FIXED_WORKSPACE=1` (with VITEST or
  `SAGAX_TEST_SEAMS=1`, never production): the suites that drive fixed
  places through the API keep them. Tests:
  `server/workspace/workspace-auto-only.test.ts`, `server/workspace/workspace-auto-only.e2e.test.ts`,
  `src/components/computer/WorksOnSetting.test.ts`.

## Workspace: Auto remembers no place (2026-10-16)

Decision: "Il doit toujours être en automatique, et le mode choisi à chaque tour
lui-même." On every server (solo and organization):

- Auto picks where to work on each turn from the request. No turn writes
  where it worked (the built-in browser, a claimed VM, the host, the cloud
  computer) to the conversation: the auto pin of issue #1650 is gone. Since
  2026-10-18 the composer has no Workspace menu (see above).
- Only a pin under the test seam above (`surfaceSource: "user"`) or a
  legacy pin of unknown origin holds a place (`honouredPin`,
  `server/surface.ts`); the start sweep clears both outside tests.
- A select_computer move (solo) holds the request it was made in, its
  continuation and the card continuations under it
  (`computerSelectionMoves`, in memory), and is dropped at the next fresh
  request, a person's pin or a failure there.
- At start, the auto pins an older build recorded are cleared, whatever the
  bot's Works on (log line "auto-pinned thread(s)").
- The thread's Workspace lines (`shared/workspace-line.ts`): the server still
  writes "On your computer" (`lastAutoPlace` reads it), but no client draws
  it (2026-10-18: "No need to specify 'On your computer'"): desktop
  `isHiddenStatusActivity` (`src/lib/activity-runs.ts`: the transcript,
  bot exchanges, rooms; `lastNonReceipt` for the sidebar), iOS and Android
  `isHiddenStatusNotice` (transcript rows and the Updates lines). The cloud,
  browser and Local VM lines and every "moved to" line stay, so a return to
  the computer after the cloud now leaves no line.
- Tests: `server/surface.test.ts`, `server/surface-pins.e2e.test.ts`,
  `server/host-lazy-claim.e2e.test.ts`, `server/group-local-vm.e2e.test.ts`,
  `server/place-view.e2e.test.ts`, `server/desktop/desktop-bridge.e2e.test.ts`.

## Server environments (organization mode)

On an organization server, bots run shell, file and browser tools in a
person's server environment (`user-sandbox`): the SPEAKER's for a
conversation, the bot OWNER's for routines, the asker's or else the room
creator's in a room (`sandboxPrincipalForTurn`). One isolated container per
person, never per bot, never on the Sagax host (`docs/user-sandbox.md`).
A cloud routine and a room stay on that environment. A team computer does
not open a shared machine. Keep these rules, each covered by `server/sandbox/user-sandbox*.test.ts`,
`server/sandboxd.test.ts`, `server/sandbox/sandboxd-*.test.ts` or `server/user-sandbox.e2e.test.ts`:

- Only `sagax-sandboxd` (`server/sandboxd.ts`) holds the Docker socket; the
  Sagax server calls it with signed requests (`server/sandbox/sandboxd-auth.ts`).
  `SANDBOX_BACKEND` defaults to `docker`. `kubernetes`
  (`server/sandboxd-k8s/sandboxd-k8s.ts`) is the same API with one Pod and one PVC per
  person, NetworkPolicies for egress, and no docker.sock. It runs; it does
  not exit. Secret encryption and NetworkPolicy enforcement are operator
  attestations. Sagax keeps both provisioners and routes with
  `SAGAX_SANDBOX_CANARY_PEOPLE`, `SAGAX_SANDBOX_CANARY_BOTS` and
  `SAGAX_SANDBOX_ROUTE` (`server/sandbox/sandbox-route.ts`). `docker` on that route
  sends everyone back to the Docker provisioner. The Kubernetes URL is
  https with `SAGAX_SANDBOXD_TLS_CA`. Manifests are `deploy/k8s/`
  (`provisioner/`, `sandboxes/`, `helm/`, `tofu/`). Copy a workspace with
  `scripts/sandbox-workspace-migrate.ts` (source kept, checksums, both
  directions). Runbook: `docs/ops/sandboxes/cutover-rollback.md`. Tests:
  `server/sandboxd-k8s/sandboxd-k8s-spec.test.ts`, `server/sandboxd-k8s/sandboxd-k8s.test.ts`,
  `server/sandbox/sandbox-route.test.ts`, `server/sandbox/sandbox-backend.test.ts`,
  `server/sandbox/sandbox-workspace-copy.test.ts`; kind only with
  `SAGAX_SANDBOX_K8S_INTEGRATION=1` (`scripts/sandbox-k8s-kind.sh`).
  Design and the SOC 2 mapping: `docs/sandbox-kubernetes.md`.
- The provisioner API is keyed by person (`sandboxKeyForPrincipal`); never add
  a bot parameter. Every create body passes `assertSandboxIsolation()`.
- Engines get no shell, file or fetch tool of their own there
  (`withholdHostTools`, `server/drivers/host-tools.ts`); an engine that
  cannot withhold them is refused (409 `host_tools`, matrix in "Engines on
  an organization server" below). `scripts/smoke-host-tools.ts` checks the
  real Claude Code CLI, `scripts/verify/dev/verify-org-host-tools.ts` the ACP ones.
- Server code runs under `--experimental-strip-types`: no TypeScript
  parameter properties in these files.
- `scripts/smoke-user-sandbox.ts` proves isolation on a real Docker host and
  removes everything it creates.
- The environment's desktop (`deploy/sandbox/sagax-desktop`, Xvnc on
  127.0.0.1 inside the sandbox only) starts on demand: computer use
  (`computer_list_tools`, `computer_use`, fixed argv, never a shell line) or
  The owner's live view. The view (`/api/desktop-viewer/sandbox/me`) is built
  from the caller's own session principal, never an id; read-only by default
  (view-only VNC password), `?control=1` for control; its WebSocket starts
  nothing and reaches the VNC port only through the provisioner's signed
  upgrade (`/v1/sandboxes/<key>/desktop`). While a control view is open,
  the bots' `computer_use` there is refused with `SANDBOX_CONTROL_REFUSAL`
  (`server/sandbox/sandbox-control.ts`, test `server/sandbox/sandbox-control.test.ts`). The
  desktop starts openbox, a background and a tint2 launcher bar (Chromium,
  Terminal, Files); a change there needs the sandbox image rebuilt. The
  Computer tab's power and usage
  routes (`/api/me/server-environment/power|stats`) act on the caller's own
  environment only; shutdown and pause under a running turn need `confirm`.
  Tests: `server/user-sandbox-desktop.test.ts`, `server/sandboxd.test.ts`;
  Docker: `scripts/smoke-sandbox-desktop.ts`.

## Desktop bridge (organization mode)

The machine-hosted engine worker (`electron/machine-worker.mjs`) stops and
cancels its requests when the local server becomes unavailable or the app
quits, then restarts when the server is ready. A claimed turn whose local
request or reply stream fails receives a failed result on its organization
server; failure delivery has its own bounded cancellation signal.

In server mode the desktop app is the bridge between the organization server
and the person's PC (`electron/desktop-bridge.mjs`, `electron/desktop-tunnel.mjs`,
`server/desktop/desktop-bridge*.ts`, `server/desktop/desktop-egress.ts`). Bots working for a
person run the solo-mode tools on that person's own computer, as the MCP
server `sagax-desktop` (shell, files, search, fetch, offscreen browser,
computer use, Local VM), and the engine's own network traffic leaves through
it. Keep these rules, each covered by `server/desktop/desktop-bridge*.test.ts`,
`server/desktop/desktop-egress.test.ts`, `server/attachments/attachment-staging.test.ts`,
`electron/local-vm.node-test.mjs`, `electron/desktop-bridge.node-test.mjs`,
`server/computer/local-vm-computer.test.ts` or
`scripts/verify/dev/verify-desktop-bridge.ts`:

- Where tools run is decided once per turn by `resolveBotWorkplace` from
  the bot's Works on (or the conversation's pin): Local VM or This computer,
  the speaker's desktop (when it is not connected, nothing runs there and
  the bot and the composer say so); Auto and Cloud, their server
  environment. The `place` of `sagax.botWorkplace.v1` no longer decides.
  Routines start in the server environment by default. They use the owner's
  desktop only when Works on (or an Auto `computer_select`) targets it, it
  is connected AND the owner allowed routines on it (off by default). Rooms:
  the person whose message triggered the turn; a follow-up nobody asked for
  never.
- Auto picks per step (2026-10-02, routines default 2026-11-01,
  `server/computer/auto-computer.ts`): a person-asked Auto turn prefers the person's
  computer when connected, else the cloud. A routine Auto turn starts in the
  cloud; `routinesAllowed` only permits an explicit `computer_select` to
  `this_computer` or `local_vm`. It mounts `sagax-computer` (`computer_select`,
  target `cloud`, `this_computer`, `local_vm` or `browser`, plus a reason) and,
  when the person's app is connected now (a routine: and the owner allowed
  routines on it), `sagax-desktop` beside `sagax-environment`. The selection
  (`TurnWorkplace.auto`) gates every later call of the turn
  (`autoComputerToolRefusal`: Local VM allows only the `local_vm` tool, and
  its `use` action sees and drives that VM's desktop, never the person's own
  screen) and resets with each message; the egress proxy still follows the
  turn's start. A fixed Works on gets the tool too and it answers that the
  setting is fixed. Each switch is `computer.switch` in the admin activity
  log (person, bot, from, to, reason); the transcript shows a "Working on"
  chip. Workspace fallback notices keep distinct reasons (`offline`,
  `routine-not-allowed`, `routine-default`; `shared/workspace-line.ts`).
  Claude pre-allows only `mcp__sagax-computer`. Rooms are unchanged. Tests:
  `server/computer/auto-computer.test.ts`, `shared/workspace-line.test.ts`,
  `server/desktop/desktop-bridge.e2e.test.ts`.
- Auto never becomes the conversation's setting: see "Workspace: Auto
  remembers no place" above. Where a turn worked never drops
  `sagax-desktop` from the next turns (`server/desktop/desktop-bridge.e2e.test.ts`).
- A bridge is bound to the person of the session that registered it and to
  a secret only the desktop's main process holds; every poll, result and the
  tunnel re-check that the session is live and still that person. A turn's
  capability names the person at mount; the hub reaches only that person's
  own desktop. The server host is never a target; engine host tools stay
  denied (`withholdHostTools`); `sagax-desktop` tools are never pre-allowed.
- Egress: an HTTP(S) proxy on 127.0.0.1 with a per-thread credential, valid
  only while that thread runs a turn for that person on their computer
  (`turnNetworkProxy`); the drivers set HTTP(S)_PROXY with NO_PROXY for the
  model hosts. The desktop opens each connection itself, through the OS proxy
  and VPN, refuses its own loopback and link-local, and applies "local network
  only". Destinations (host:port only) go to `desktop-bridge-audit.jsonl` and
  the desktop's own activity log.
- The OS proxy, per destination: `session.resolveProxy` (it evaluates a PAC
  file the system names) gives the routes, tried in order (`proxyChain`,
  `openConnection` in `electron/desktop-tunnel.mjs`): HTTP CONNECT, HTTPS
  proxy, SOCKS4a and SOCKS5. A SOCKS5 user name and password comes from the
  app's `ALL_PROXY`/`SOCKS_PROXY` (`socks5://user:password@host:port`), else
  from what the person typed once in the app's own window when the proxy
  asked (`electron/proxy-credentials.mjs`: kept per proxy host:port with
  `safeStorage` in `proxy-passwords.bin`, Cancel not asked again until a
  restart, a refused saved password forgotten). The OS's own proxy passwords
  (Keychain, Credential Manager) are not read. A proxy that fails never turns
  into a direct connection unless the answer lists DIRECT after it; a failed
  system proxy lookup (PAC out of reach, script error) is direct and logged
  as `direct (system proxy lookup failed)`. Behind a proxy, a name this
  computer cannot resolve is the proxy's to resolve (never with "local
  network only", never `localhost`). The activity log records the route
  (`via`) and the detailed error; the server, the bot and the audit get only
  a coarse reason (`coarseFailure`), never the proxy's address. Real
  Electron: `pnpm exec electron scripts/verify/dev/verify-desktop-proxy.electron.mjs`.
- Local VM creation (`local_vm` action `create`, operation `vm_create`):
  only after the person's yes in the desktop app's own prompt
  (`confirmBridgeLocalVm` in `electron/main.mjs`, the Local VM's
  `confirmCreate`), the same one-click setup as the Computer tab from the
  server's own recipe (`localVmDesktopSpec`, checked on the desktop by
  `validLocalVmSpec`) on this app's `vm-home`. An existing VM is reported,
  never recreated; a stale one is repaired from the Computer tab only. After
  the yes (never before), steps go
  to `/api/desktop-bridge/<id>/progress` (that desktop's live job only, 50
  at most); the first one shows the bot's computer being set up to whoever
  can see the bot (`computer` `provisioning`, then `ready`). The step text
  is not shown live: it comes back in the tool's result. A turn that ends
  does not stop a creation under way; the next `create` or `status` reports
  it.
- Local VM screen (`local_vm` action `use`, operation `vm_computer_call`,
  capability `localVm`): the bot sees and drives that VM's own desktop
  (screenshot, get_screen_size, list_apps, click, move_cursor, drag,
  type_text, press_key, scroll). The desktop runs a fixed `cua-driver call`
  as user cua. The allow-list is `electron/local-vm-computer.mjs`, checked
  again from `server/computer/local-vm-computer.ts` before the call leaves (the two
  builds cannot import each other; `server/computer/local-vm-computer.test.ts` fails
  if they disagree). A tool or argument that is not listed is refused.
  Screenshots come back inline. A path, a shell line and the person's own
  screen are not reachable this way. `computer_use` stays the person's own
  screen and is still refused while Local VM is selected. action `tools`
  lists the screen tools on the server, with no desktop round trip. An older
  desktop answers Invalid request or Unsupported operation; the tool then
  says to update the Sagax app. The Computer tab stays a still image plus
  the power buttons.
- Attachments of the CURRENT message are the speaker's only when the first
  message naming them is theirs; small text ones are inlined, all are copied
  where the tools run at the first tool call, and the tag names that path.
- Archives (zip, tar, tar.gz, 7z; 250 MB per file): the server only LISTS
  them (`server/attachments/attachment-archives.ts`); they are unpacked where the bot
  works, next to the copy, at the first tool call (python3 in the server
  environment, `extract_archive` on the desktop, `electron/archive-extract.mjs`;
  solo: next to the upload). No links, nothing outside the folder, bomb limits
  (5000 files, 512 MB, ratio 200, depth 24), an encrypted zip kept as is. The
  message carries an `<attached-archive>` manifest. A small archive (at most
  256 KB) also has its text files inlined there (`.txt`, `.md`, `.csv`,
  `.tsv`, `.json`, 100 KB each, 256 KB together), read in memory on the
  server, so the bot applies a profile with `propose_profile`,
  `skill_manage`, `memory_update` and `propose_routine` and does not
  download the zip or open a browser to read it. Tests:
  `electron/archive-extract.node-test.mjs`, `server/attachments/attachment-archives.test.ts`,
  `server/archive-attachments.e2e.test.ts`, `server/desktop/desktop-bridge.e2e.test.ts`.
- Large conversation files: documents and audio stop at 250 MB, videos at
  1 GB, shared images at 32 MB and solo images at 90 MB. Pictures in one
  message share 200 MiB and at most 32 images on every host
  (`IMAGE_AGGREGATE_MAX_BYTES`/`MESSAGE_IMAGE_MAX_COUNT` in
  `server/attachments/attachments.ts`, mirrored in `src/lib/composer-attachments.ts`,
  enforced by `server/turns/turn-images.ts` and refused before upload by
  `startAttachmentUpload` with a composer notice). Other files keep no
  message count. `attach_file` copies use the same per-kind ceilings. The exact-message
  POST may resolve a visible file to `/api/threads/<thread>/files/<opaque>`;
  it never returns the host path. Every GET checks current thread and person
  access again. Downloads and image, audio or video previews support one
  standard byte Range with `Accept-Ranges`, `Content-Range`, 206 and 416.
  `openMessageFile().stream()` decrypts only the intersecting 64 KiB chunks.
  The web app gives large downloads to the browser and gives video or audio
  elements the opaque preview URL, so neither path builds a whole-file Blob.
  PDF and old-server compatibility previews keep their separate 25 MB shared
  and 90 MB solo memory limits, with Save a copy always visible. Provider
  media through `server/media/media-proxy.ts` forwards Range and seek headers up to
  1 GB per response, applies downstream backpressure, stops upstream on
  client close, and times out missing upstream headers. Range responses
  carry `Cache-Control: no-transform` (the companion sidecar keeps it), so
  Caddy's `encode`, Cloudflare and other proxies never compress a body whose
  Content-Length and Content-Range describe stored bytes; Caddy already skips
  206. Tests:
  `server/threads/thread-files.e2e.test.ts`, `server/attachments/attachments-resume-org.e2e.test.ts`,
  `server/media/media-proxy.test.ts`, `src/components/AttachmentGallery.test.ts`,
  `src/components/bot-settings/FilesSection.media.dom.test.ts`,
  `server/turns/turn-images.test.ts`, `src/lib/attachment-uploads.test.ts`,
  `companion/test/proxy-response.test.ts`.
- The desktop never reads or writes the app's own data, its cookies or the
  person's credential stores through the bridge.
- My devices (2026-11-07): every Sagax install of the person is one of their
  devices. `DesktopBridges` keys a desktop by person + host name (lowercase)
  and remembers it in `DATA_DIR/desktop-devices.json` (name, platform, last
  seen, access) across reconnects and restarts; phones come from the push
  devices (presence only, never used by bots). Access per computer: `always`
  (bots use it), `ask` (a bot's request waits on the `use_computer` peer
  approval card, which offers Always allow), `never` (out of the Computer
  menu and of the default pick; a request naming it gets 403
  `access_never`). GET `/api/me/desktop-bridge` returns `devices` (this one
  first); POST `/api/me/desktop-bridge/computers/access` sets the level. The
  one place for them is Remote sessions > Enrolled hosts and the Computers
  panel (`src/components/remote-session/MyDevicesList.tsx`); the Computer
  menu reads the same status (`computerChoices` drops `never`) and Settings >
  Computer only points there. A member's own computers need no server-wide
  admin switch. Tests: `server/desktop/desktop-bridge-devices*.test.ts`,
  `src/components/remote-session/MyDevicesList.dom.test.ts`,
  `src/lib/desktop-bridge.test.ts`.

A change under `server/` needs the server image redeployed; under `electron/`
a desktop rebuild.

## Coding branches: the person acts on them (2026-10-19)

Decision: "Mets le même encadré pour les éléments de coding" and "Je devrais
pouvoir interagir (commit, push, etc.), archiver". Details > Coding's pull
requests, branches and commits sit in the Routines card (`GROUPED_CARD`,
`GROUPED_ROW` in `src/lib/grouped-card.ts`, used by `RoutineList` grouped
and `ActivitySection`; never a copy of the classes). A branch row
(`src/components/bot-settings/CodeBranchList.tsx`) is its icon, name, a
status pill (Not pushed, Pushed, PR #n open, Merged, PR closed, Deleted),
then repository, commits ahead, changed files and time, and a "..." menu:
Commit (proposed message, editable; the changed files, all chosen), Push,
Open the pull request (or open one), View diff (the Code section's
`DiffView`), Show in folder (local app, a local path only), Open in
Computer, Archive or Unarchive, Delete local branch. Each action shows a
spinner on the row, then one line saying what happened or why not. A
pull request carries its head `branch` (`server/activity/activity-code-work.ts`),
so the card shows what the bot did to it until GitHub says more.

Rules, none optional (`server/routes/bot-code-branches.ts`, git in
`server/code-branches.ts`):

- Where (2026-11-02, a branch the bot made on the person's cloud computer
  read "elsewhere" with every action greyed): a branch is acted on only if
  its thread worked on it (its own calls; never the folder's checked-out
  branch just because it is there), WHERE that thread's git ran for it
  (`server/remote-support/branch-place.ts`: the newest call that created,
  checked out, committed on or pushed it, its `cd`s and `git -C` followed;
  `""` is the folder where that computer's commands start, a git run there
  with no `cd`). On one of the bot's computers the actions run there,
  through the channel the bot's own commands used (`branch-channels.ts`,
  `place: "remote"`, `computer` says which): `sagax-environment`
  run_command, the viewer's own cloud computer (server environment, in the
  bot's folder there); `sagax-desktop` run_command and `local_vm`, the
  viewer's own computer and its Local VM through their desktop app (its
  text answer framed: output and errors come back base64 on one marker
  line, exact); `vm_exec`, a solo server's Local VM (never an organization
  server's host; the frame sized to its 20,000 characters); a remote
  session. A tool's name is read the same way whatever engine wrote it
  (`toolKey`: `mcp__server__tool`, `server__tool`, pi's own
  `sagax_environment_run_command`, the ACP titles, Codex's bare name). The
  ACP engines other than Grok name a run_command row by its command text
  (`server/drivers/acp/session-stream.ts`), so their branch has no place
  and the panel offers to ask the bot. The desktop's own shell (`$SHELL
  -lc`) and a remote session's login shell get the command inside `/bin/sh
  -c '...'` (fish and csh users too: no word holds a backslash, a `!` or a
  line break, `q()`). The panel takes one command slot at a time per
  person on their computers (2026-11-03, review: it reads every row at
  once, and their bots need the same slots): the desktop app (it runs its
  jobs one at a time and keeps eight), on the desktop the request named,
  and their cloud computer (sandboxd runs four commands of one person at
  once, shared by all their bots). A full computer reads busy, never
  stopped; a desktop command that ran out of time while that desktop stayed
  connected (a long job of its own ahead of it) reads busy, and the next
  panel commands to it answer busy at once while it still works. The panel
  holds at most one of the person's four sandboxd slots: while its command
  runs, a fourth command of their bots can still be refused (429), fewer
  refusals than before but not none. A command
  longer than its channel carries (a remote session's 8,000 characters, a
  solo Local VM's 20,000, the desktop app's 100,000; 120,000 UTF-8 bytes
  where Linux caps one argument at 131,072: the cloud computer, a Linux
  desktop, the desktop's Local VM) is not sent (`too_long`, 413), and a
  remote session's own `[cut at 64 KB]` mark reads as a cut, never as
  data. A commit there is one command (2026-11-03, final review: git add,
  then git commit only when the add worked), so a refusal before it runs
  (too long, busy, offline) leaves nothing staged. Every file checked in
  the dialog (it says so) commits every change, unnamed (`git add --all`),
  also those the list does not show (past 500, past a cut, made since), as
  the server path does; some files checked commits exactly those, each name
  to its last byte (`setWords`: a file "dup<LF>" is never committed as
  "dup"), a rename with its old path (given to git commit only: git add
  refuses a staged rename's old path). Too long, the answer says which: the
  message (`message_too_long_for_computer`: shorten it) or those files with
  it (`commit_too_long`). A cut status never lists a rename whose old path
  it lost; a word `q()` cannot carry exactly (a trailing line break) is
  refused, and a script holding a backslash, a `!` or a line break never
  reaches a login shell (`viaPosixShell` throws). One branch read is one script
  (one round trip after the folder probe), and git there takes no optional
  lock (`GIT_OPTIONAL_LOCKS=0`: no index.lock while the bot commits); the
  panel reads again only the rows of the conversation the bot just worked
  in. The folder is probed in one round trip (where the bot ran git, else
  another folder it ran git in there) and used by the real path of its
  repository's top folder (status names paths from there: a commit from a
  folder inside it missed them). A pull request read there runs nothing
  (`{ pull: null }`, and the panel does not ask). Only the viewer's own
  cloud computer and desktop are ever reached, never the bot owner's. Else
  the thread's own folder (`task.cwd`) when it is a git repository on this
  server. A branch no channel reaches (no computer of the person's, a tool
  no channel names, Boat cloud computers) reads `place: "elsewhere"`; an
  offline computer, an unknown folder, Windows or an unknown OS read as
  such, and a computer busy with other work (`busy`, 503) fails the read
  (also a read again over an earlier one: the row keeps its place and
  counts, and the menu never acts on that earlier read).
  In each of those the menu says why in plain words and what to do
  (outside the menu, which it describes), "Try again" first where reading
  it again can help (the computer was off or busy, its OS not known yet:
  the row then acts, or says why not), and each action becomes one click
  that asks the bot to do it ("Ask <bot> to do it", the request sent as
  the person's message in the branch's own conversation; a delete asks to
  confirm first). Never a silent grey menu, never "this server".
- Who: the thread must pass `thread.post` for the viewer (not theirs reads
  as 404). Their own branch asks no approval. Push and pull requests use
  their own credentials: on a solo server the host's git and gh are theirs;
  on an organization server only their GitHub connection
  (`usablePersonGithub`), as an extra header for github.com with no system
  or global git config, no credential helper, no ssh, and gh with
  `GH_TOKEN` and an empty config; without it the action is refused
  (`github_not_connected`), never done with the server's or the
  organization's tokens. The token rides the push call only (and the
  remote HEAD read with it), never status, add, commit or diff. The
  viewer's cloud computer holds only their own credentials too: their
  GitHub connection signs a push to `https://github.com/<repo>.git` and
  gh, through the exec's `SAGAX_GH_TOKEN` variable (never a command line);
  without a connection, or for a remote elsewhere than GitHub, that
  environment's own sign-in, which only they made there (Sagax puts
  nothing but their connection there, `github-connect.ts`), and a refusal
  says to connect GitHub (`github_not_connected`). A commit there is
  authored by them (their profile's name and email) when known, else by
  that environment's identity (none: `no_author`). Their own computer, its
  Local VM and a client's computer use that computer's own sign-in and
  identity (none: `no_git_identity`, which says to set git's name and
  email there, never the profile): no token is ever sent there (a push or
  pull request on a client's computer asks to confirm). On an
  organization server: a request with no person is refused (`no_person`),
  never run as the server; git and gh get no `HOME`, ssh agent or config
  folder of the server's (`isolated`); a commit needs the person's name and
  email (`no_author`); the repository's local and worktree git config
  must hold only plainly safe keys (`SAFE_LOCAL_CONFIG`, an allowlist:
  filters, diff drivers, signing programs, url rewrites, proxies, TLS,
  headers, helpers, includes and remote helpers are refused as
  `unsafe_config`, so an LFS repository is not acted on there); the push
  goes to `https://github.com/<repo>.git` named in the command (origin's
  URLs never decide it); a worktree counts only if its git folder is the
  repository's own; every answer (state, errors, git messages) shows a
  server path as its folder name only (`redactPaths`).
- What: never a force push, never the default branch (no push, delete or
  pull request): origin's HEAD, the remote's HEAD read at push time, and
  main, master, trunk and develop by name whatever HEAD says (or when
  origin has no HEAD); a pull request goes to GitHub's own default branch
  (`gh api repos/<repo>`) and never from it. Hooks, fsmonitor, textconv,
  signing programs and signature checks off on every call; gh runs in a
  fresh empty folder (an empty home and config per call on an
  organization server) with `--title`/`--body` from the commits, never
  `--fill`, the message
  through a fresh private temp file (`mkdtemp`, `wx`; never argv, never in
  the repository). Delete: refused while checked out in a
  worktree (no folder is ever removed); work not on origin needs
  `confirmUnpushed` (the panel asks twice). Pull requests: GitHub only,
  through `gh pr create --fill --repo`, an open one reused.
- Archive: per person and bot in `code-branch-archive.json` (0600), keyed
  `repo-or-folder:branch`; the branch stays; "Show archived (n)" brings it
  back. Archived branches do not take one of the five places.
- Every action writes an admin activity row (`code.branch.commit`, `push`,
  `pull_request`, `delete`, `archive`, `unarchive`).
- iOS and Android: their Coding section lists running jobs only, no
  branches yet; the card and a subset of actions (Push, PR, Archive) are
  for later.
- Tests: `server/routes/bot-code-branches.e2e.test.ts` (real git, a bare
  local remote; each computer kind, each action through the remote path,
  the credential rule), `server/remote-support/branch-place.test.ts`,
  `branch-channels.test.ts` (framing, and a branch read, committed and
  pushed through a login shell that is sh, bash, zsh, dash, ksh, csh or
  tcsh; the solo Local VM's clip; one desktop job at a time; reach per
  kind; five rows read at once against sandboxd's four-command gate; a
  long job holding the real desktop bridge; a remote session's cut mark
  and 8,000 characters, a message too long for it; a solo Local VM's frame
  cutting a rename refactor; each channel's length, in bytes where Linux
  caps one argument), `remote-code-branches.test.ts` (a rename a cut split,
  a picked rename committed as a move, every change with every file kept,
  one command per commit, a name ending in a line break),
  `src/components/bot-settings/CodeBranchList.test.ts`,
  `CodeBranchList.ask.test.ts` (the ask click, Try again), `ActivitySection.test.ts`,
  `server/activity/activity-code-work.test.ts`.
  Screenshots: `node scripts/capture/bot-panel-coding.mjs` (headless, the
  gallery `src/gallery/bot-panel-coding.html`).

## Computer tab and Local VM on an organization server

The Computer tab (`src/components/computer/OrgComputerTab.tsx`) draws the
solo screen: one rounded screen (`ComputerScreen.tsx`) with Play / Pause /
Stop on it and "<Bot>'s screen" below, and a usage panel that keeps
polling while the environment is off. Works on is not on this tab. It is
in Edit persona > Access, labelled Computer
(`worksOn` in `src/components/bot-settings/sections.ts`, `WorksOnSetting`).

Above the screen, one segmented control (`ScreenPicker`) when there is more
than one choice (2026-10-11): Cloud, then each of the person's online
computers that can run a Local VM, by the name its Sagax app registered
(`os.hostname()`), the most recently seen first (`computerChoices` in
`src/lib/desktop-bridge.ts`), so a person with two PCs sees two Local VMs.
A dot marks where the bot works; the first screen shown is that one
(`chosenComputer`). Picking one changes only what is shown and where that
Local VM's buttons go: `POST /api/me/desktop-bridge/local-vm` takes an
optional `desktopId` (a desktop id of the person's own, else 400), and
`DesktopBridges.request(..., desktopId)` reaches that desktop or answers 409
`not_connected` ("That computer is not connected right now ... or pick
another computer"); without it, the current one as before. Never another
person's desktop: the lookup stays by person. Browser mode is the
control's last chip, Browser, where the server has the built-in browser
(`builtInBrowserEnabled` or an installed engine; Screen | Browser on a solo
server): `BrowserPanel` in the screen's frame (`BrowserScreen`, "<Bot>'s
browser" below), opened first when the bot works on its browser. Tests:
`OrgComputerTab.test.ts`, `ComputerPanel.browser.test.ts`,
`server/desktop/desktop-bridge.test.ts`, `server/desktop/desktop-bridge-local-vm.test.ts`.
States are words (Off, Starting, Running, Paused, Error); never show the desktop's raw
answer. The server environment's live view is view-only with "Take control"
in the middle of the screen and a "Release control" chip while in control.

On an organization server the bot's Works on (or the conversation's pin)
decides where it runs, never a per-person switch (2026-10-02,
`resolveBotWorkplace`, `orgComputerFor` in `src/lib/place.ts`): Auto and
Cloud ("Cloud (server environment)") run in the person's server
environment, including a cloud routine and a room. Local VM and This
computer run on their own computer through the desktop app. No Boat, VPS
or host computer is claimed there, and a team computer does not open a
shared machine. Settings >
Computer says so and holds the Local VM card and the compact server
environment card (`settings/OrgComputerSettings.tsx`). VPS Computer and
Boat Computer are experimental flags (`features.vpsComputer`,
`features.boatComputer`, off): off hides their cards and backend choices
and, on a solo server only, the Cloud place; they never hide the
organization's Cloud nor the local places (`placeOffered(place, config,
organization)`). Tests: `OrgComputerTab.test.ts`,
`experimental-computers.test.ts`, `place.test.ts`,
`AccessSection.test.ts`, `server/desktop/desktop-bridge.test.ts`.

The Local VM in server mode lives on the person's computer
(`electron/local-vm.mjs`, `POST /api/me/desktop-bridge/local-vm`):

- Runtime detection runs on the desktop (Docker Desktop, OrbStack, Colima,
  Rancher Desktop, Podman; bare PATH, sockets, `docker context`), never on
  the organization server.
- A container whose bind mount or `com.openmausbot.workspace-path` label
  names another folder, or one that no longer exists, is stale: never
  started, recreated by setup on `<data>/vm-home` (the old folder is kept).
- Setup (one click) uses the server's recipe (`localVmDesktopSpec`), which
  the desktop checks (`validLocalVmSpec`) before running it. Nothing is
  installed without the person's click and an OS dialog.
- Tests never create a container under the real name: vitest sets
  `SAGAX_LOCAL_VM_TEST_NAMESPACE` (`server/testing/global-setup.ts`), names
  become `openmausbot-test-<ns>-computer`, labeled and removed at the end;
  a real-named VM is refused in the temp folder (`localVmFolderRefusal`).
  Tests: `electron/local-vm.node-test.mjs`, `server/computer/local-vm-hygiene.test.ts`,
  `server/desktop/desktop-bridge-local-vm.test.ts`.
- The bot sees and drives that VM's desktop with `local_vm` action `use`
  (operation `vm_computer_call`). The Computer tab itself stays a still
  image and the power buttons. See Desktop bridge above.
- iPhone and iPad show that same still and those power buttons when the
  phone is paired to the organization server and Works on is Local VM or
  This computer (`OrgLocalVmScreen` in
  `ios/Sources/CompanionCore/LocalVmComputer.swift`, drawn from
  `ios/App/ComputerView.swift` for both `ComputerView` and
  `BotPanelComputer`). Take control stays on the server environment. The
  bot still drives the VM with `local_vm` action `use`. The phone does
  not send `use`. A sidecar pairing is not an organization, so the
  companion allow-list is not widened for these routes: the app does not
  ask them there. Auto and Cloud keep the existing computer viewer.
  The same picker sits above the screen (`ios/App/ComputerChooser.swift`,
  `PersonDesktopBridge.computerChoices` and `chosen`, `desktopId` on
  `localVm(action:)`), and its Browser chip is browser mode, drawn like the
  VM as on the desktop (#473): the card is a live preview in the VM's 16:10
  frame (`ios/App/BrowserLiveView.swift` over
  `GET /api/bots/:id/browser/live?preview=1`, each frame acknowledged;
  Connecting, Busy, Live, Closed (`offline`, asked again every 10 s) and
  Error with Retry), and Take control opens a modal on the full stream where
  a tap, a drag (wheel) and the keyboard drive the page and back, forward and
  reload run (`POST /api/bots/:id/browser/action`: the first touch takes the
  browser, 8 idle seconds or Hand back control release it, closing releases;
  `BrowserLive.swift`, `BrowserLiveClient.swift`). While the modal is open the
  card streams nothing. Screenshots: `-browserGallery
  <live|offline|error|busy|connecting|takeover|window>` (DEBUG only).
  Tests: `ios/Tests/CompanionCoreTests/LocalVmComputerTests.swift`
  (`ComputerChoiceTests`), `BrowserLiveTests.swift` (`swift test` in
  `ios/`).

## My Chrome: a bot drives the person's own Chrome (2026-10-19)

Port of OpenMausBot #2706 (My Chrome) with what Sagax needs of #2925, #2928,
#2939 and #2949, narrowed by the maintainer's rules. Off by default. Settings >
Experimental > My Chrome (`src/components/settings/MyChromeSettings.tsx`,
under the built-in browser row) turns it on and lists the allowed sites, each
one exact origin (`https://host[:port]`, `http://localhost:port` the only
plain http; `server/browser/my-chrome/sites.ts`), with Revoke, Stop / Resume
and Chrome's address. A bot uses it when its browser session is "My Chrome"
(`browserProfile: "my-chrome"`, `MY_CHROME_PROFILE`; BrowserProfilesManager
offers it where the server does). Settings live in `my-chrome.json` (0600,
`server/browser/my-chrome/settings.ts`); a file that does not read is "off".
An organization server never offers it unless that file says
`allowOnOrganizationServer: true` by hand (no route sets it).

- The engine is still agent-browser (`AGENT_BROWSER_CDP`), but it reaches the
  gate (`server/browser/my-chrome/gate.ts`), never Chrome: a loopback
  WebSocket with a random 48-hex path per bot session. The gate holds one
  DevTools connection to the person's Chrome, found from the setting (a port,
  a loopback `ws://` or `http://`) or Chrome's `DevToolsActivePort` file
  (`locate.ts`: that file only, never the profile's cookies, Login Data or
  history; remote debugging on at `chrome://inspect/#remote-debugging`,
  Chrome 144+, which asks the person before it lets Sagax in).
- The engine sees only the tabs it opened through the gate (and popups they
  opened): `Target.getTargets` is filtered, attaching to any other tab is
  refused. A new tab starts blank, gets its guard, then goes to the address.
  The guard (the gate's own session per tab) intercepts documents (`Fetch`)
  and fails any top-level navigation outside the allowed sites: address,
  link, redirect, form, script, popup (held by `Target.autoAttachRelated`
  until guarded). Revoking a site refuses the engine on it at once.
- `cdp-policy.ts` allowlists methods: no cookie call (`Network.getCookies`,
  `getAllCookies`, `Storage.*`, `Page.getCookies`), no storage of any origin
  (`DOMStorage`, `IndexedDB`, `CacheStorage`), no body or interception
  (`getResponseBody`, `loadNetworkResource`, `Fetch`), no browser-wide call,
  context, download, file upload, permission, autofill. Network events lose
  every header, cookie and body; the `ExtraInfo` events are dropped. Frames
  and workers of another site inside an allowed page are detached from the
  engine; a frame of another origin on the same site (it would share the
  page's process) is not loaded (`maybeSameSite`, errs toward "same").
  `Page.captureSnapshot` and `addScriptToEvaluateOnNewDocument` with
  `runImmediately` are refused, downloads are denied in the tab, and a
  network event toward a site not allowed shows its origin only (no path,
  query or initiator). Unknown methods are refused.
- Each driven tab carries a banner (bottom right, "A Sagax bot is driving
  this tab" / "Un bot Sagax pilote cet onglet") in an isolated world, hidden
  from the accessibility tree, with a Stop button whose binding exists only
  in that world and counts only a trusted click. Sagax shows its own banner
  while a bot drives (`src/components/MyChromeIndicator.tsx`: which bot, on
  which site, Stop). Stop (`POST /api/my-chrome/stop`, the tab's button, or
  turning My Chrome off) terminates every engine connection first, then
  removes the guards and banners, closes the Chrome connection and the
  engines' sessions and forgets every gate address handed out (a copy left
  in an engine's environment cannot reconnect after Resume); `stopped` is
  saved and holds until Resume.
- `/api/my-chrome/*` answers the person only (security review 2026-10-20,
  #834): a session that is not an act/actAs one, or loopback on the desktop
  (Electron's capability); a headless server's loopback (a bot's shell) is
  refused.
- A bot with a shell (command tool) on the same computer as the person's
  Chrome is never given My Chrome (2026-10-20, after #838): it could read
  Chrome's `DevToolsActivePort` and talk to Chrome without the gate. It keeps
  its own bot browser. `server/browser/my-chrome/shell.ts`
  (`hasShellOnThisComputer`: every engine has a shell, so only a cloud-only
  or team-computer bot has none here); `effectiveBrowserProfile` in
  server/index.ts maps "my-chrome" to the bot's own session for a bot with a
  shell (session, integration, internal browser route), `MyChromeService.urlFor`
  refuses it too, the prompt says so (`MY_CHROME_SHELL_PROMPT`) and the
  profile picker's hint says "This bot has a terminal on your computer: it
  uses its own browser" (`shellBotIds` in the status). The saved profile
  stays "my-chrome" and applies again if the shell goes away.
- Gate hardening (2026-10-20): `Page.navigateToHistoryEntry` reads the
  entry's address first and refuses one off the allowed sites (the
  back/forward cache restores a page with no request for the Fetch guard to
  see; an unreadable entry is refused); the banner host carries `!important`
  inline styles and a MutationObserver that restores them (a page stylesheet
  or `host.style` cannot hide it).
- The bot's calls (`server/browser/my-chrome/pilot.ts`, from the internal
  browser route): only the page tools (no `agent_browser_eval`, cookies,
  state, profiles, `read` with a URL, screenshot to a file), elements only by
  `@eN` refs. A payment or purchase, a send (form, email, message, post,
  save, confirm) or a delete waits on the same Allow / Deny card as a safety
  hold (`confirmHeldCard` in server/index.ts), and the person's level
  answers it (#3502): the card reads the one Full access decision
  (`server/approvals/full-access-gate.ts`, marker `browser-held`). At Full
  access the bot acts unless one of the gate's holds applies (an
  organization rule set to Refuse or Ask first, the person's own rule or a
  security key they set on the action, isolation between people: a guest's
  turn, a mail-woken run, another person speaking), and the conversation and
  the decision journal name what was paid, sent or deleted
  (`myChromeHeldLevel`, `myChromeLevelAnswered`). Approve for me reads it the
  way it reads a safety hold on any other permission card: the card comes,
  as at Ask; its own Always allow below answers it at every level. It is named from the role and name of the ref in the
  bot's last snapshot, the key (Enter or Space, except after typing in a
  search box), text with a line break, or an address (`/delete`,
  `/checkout`...). An unknown ref or a button with no name is a card too.
  Refs come only from a snapshot (JSON `data.refs` first; a ref the text
  names twice differently is dropped), never from page text read by another
  tool. Enter or Space with any modifier (Control+Enter...) is a send.
  The card offers "Always allow" for one kind (payment, send or delete) on
  one exact origin (`my_chrome:<kind>:<origin>`, `myChromeAllowKey`), saved
  in the bot's `alwaysAllow` through the usual route (step-up, answerer
  checks) and revocable there; a doubt ("unclear") or a page without a web
  origin is carded every time.
  Passwords go only through the vault's `fill_credential`. What the gate
  blocked is added to the next result. The bot's prompt gets
  `MY_CHROME_SYSTEM_PROMPT`. A confidential conversation never uses it.
- Routes: `POST /api/my-chrome/{status,enable,sites,sites/revoke,address,stop,resume}`,
  POST only, the person or an admin (`adminOrDelegate(server.settings)`),
  admin and off in the agent tool policy.
- The egress gate of the bots' own browsers (#2930) does not apply to My
  Chrome (the person's browser); the site allowlist and the gate do.
  `browserEngine.attachCdpUrl` keeps its old meaning (every bot attaches,
  ungated): an operator setting, separate from My Chrome.

Tests: `server/browser/my-chrome/my-chrome.test.ts` (sites, settings,
locating Chrome, the DevTools policy, cards), `server/routes/my-chrome.test.ts`,
`src/components/MyChromeIndicator.dom.test.ts`, and
`server/browser/my-chrome/my-chrome.e2e.test.ts` against a throwaway headless
Chrome for Testing (temporary profile, `--headless=new`, its own loopback
port; `SAGAX_TEST_CHROME` or the Playwright cache, never the person's
Chrome) and two local sites: the person's tabs stay invisible, every cookie
and storage call is refused, no address, link, redirect or popup reaches the
other site, its frame stays away from the engine, revoking works at once, the
banner's Stop (a trusted click) and Sagax's Stop cut at once. With
`SAGAX_TEST_AGENT_BROWSER=<agent-browser binary>` the last suite drives the
real tool path: cards for delete, payment and send, refusals, Stop.

## Teach by demonstration (2026-10-16)

The composer's + > Teach a task, when the bot has a browser, offers "Show it
in the browser" beside "Describe it in words" (`/learn`, unchanged). Showing
opens the bot's browser window (Computer tab) and starts a recording; the
browser menu has the same Teach by demonstration / Stop recording entry.
Pieces: `shared/teach-recording.ts` (masking rules, SKILL.md builder),
`server/browser/browser-teach.ts` (recorder), the `record-start`, `record-stop` and
`record-discard` actions of `server/browser/browser-live.ts`,
`src/components/TeachStepsDialog.tsx` (editor and chooser),
`src/lib/teach-request.ts`. Rules, covered by `shared/teach-recording.test.ts`
and `server/browser/browser-teach.test.ts`:

- Only the person's own input through the live view is recorded (clicks,
  typed text, Enter/Tab/Escape, toolbar commands), never the bot's tool
  calls, and only for the person who started it in that browser session.
- A click asks the page (engine `eval`) for the element's role and
  accessible name; typing asks for the focused field's kind. A field's
  value is never read.
- Text typed in a password, one-time code, card, PIN or key field, in a
  field the page could not describe, or text that reads as a credential
  (JWT, token, key, card number) is never kept: the step says a secret goes
  there and the skill asks the person at run time. Addresses lose user info,
  secret query values and token fragments.
- The recording lives in server memory only: handed over once on stop,
  dropped on discard, after 30 minutes idle, 2 minutes after the person's
  last view of that browser closed, and on sign-out. Nothing is logged or
  written. The editor's list lives in the window; the raw recording is
  downloaded only when the person ticks "keep the raw recording".
- Saving builds a SKILL.md from the step fields (page words quoted, bounded,
  cleaned) and installs it through `POST /api/bots/:id/shown-path`, so it
  arrives turned off, with the skills routes' rights and an audit row. The
  person re-reads the steps first. Closing without saving, or mode `refuse`,
  writes nothing. A skill of the same name is replaced only when they send
  `replace: true`. Uploaded skills stay on `skill-upload`, which still
  refuses a name the bot already has. The bot replays the saved skill with
  its browser or computer tools and its usual approvals. The phone has the
  same review in Skills (one step per line).
- Not done: recording the desktop screen (only the bot's browser).

## Cloud agent runner: sagax-runner and the sagax-run image (2026-10-19)

The process of a cloud agent run's Pod (Perspicax spec "cloud agents",
lot P1.4). Entry `server/sagax-runner.ts` (at the server root so the
drivers' helpers resolve beside it once bundled), code in `server/runner/`,
image `deploy/run/Dockerfile` (built locally by `scripts/build-run-image.sh`,
never pushed). The Pod comes from the run provisioner
(`server/sandbox/sandboxd-runs-spec.ts`). Rules, none optional:

- The image has no Hermes, so its engines stage runs
  `scripts/harden-image-deps.mjs --no-venv` (npm overlay only; a venv found
  anyway fails the build). Without the flag the script requires a Hermes
  venv and the build stops at "no venv found" (fixed 2026-10-20).

- Known MVP limit: one run token, also the model proxy key, so the agent
  can call the runner routes itself; `verify` is information, not proof,
  and Perspicax checks every bundle again.
- HTTPS out only, no port (CA-3): bootstrap, secrets (once), events in
  batches (256 events, 1 MiB), long-polled commands, bundle. Every call
  carries the run token; a 401 anywhere stops the runner at once (engine
  stopped, secrets wiped, nothing more sent). `PX_CONTROL_URL` is https
  (loopback http for tests), and the token is only sent to its origin:
  a bootstrap whose `git_url` or `model_proxy` points elsewhere fails.
- Duration: the runner's own deadline comes from the bootstrap
  (`limits.max_duration_sec`) and is re-armed by a `limits` command
  (`{max_duration_sec}`: what the Pod has left after an admin extended the
  run, 1 s to 12 h, a number only). Perspicax enforces the run's maximum
  too; the Pod's hard deadline is the 12 h cap.
- Secrets: one 0400 file each in `/dev/shm/px-secrets` (memory), visible
  to `setup`; the `setup_only` ones (the default) are erased before the
  engine starts. Every secret value and the run token are masked in all
  events (`server/runner/mask.ts`, engine events masked whole before any
  cut). Nothing `setup` started survives it (process group killed, and on
  Linux any process whose environment holds a `setup_only` value). A branch
  whose diff or commit messages hold a secret value is never bundled (a
  warning names the files). The setup of a followup Pod runs the repository
  as the agent left it; the runner's own git calls ignore its hooks and
  fsmonitor.
- Git: read through Perspicax with the token as
  `http.<git_url>.extraHeader` in `GIT_CONFIG_*` variables (never argv,
  never `.git/config`), `remote.origin.pushurl = no-push://`, a pre-push
  hook that refuses (comfort only). The branch is `px/*`, never the base.
  Publishing is the incremental `git bundle create - ^<last_pushed_sha or
  base_sha> refs/heads/<branch>`, checked to name that one reference,
  posted to Perspicax, which pushes (CA-5); `received` and `pushed` move
  the start of the next bundle, `refused` is a visible warning. A followup
  Pod starts from the branch on the repository and fast-forwards a reused
  clone to it.
- Engines are Sagax's own drivers, headless (`server/runner/engine-drivers.ts`):
  Claude Code with `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` = model proxy and
  run token; Codex on the driver's Company provider at
  `<model_proxy.openai>/v1` with the token in `SAGAX_COMPANY_API_KEY`. No
  engine code in the runner; approval level from the bootstrap
  (`approval_level`, default `auto`), commits by the bootstrap's `author`
  (default Pulsatrix Agent), the command long poll starts at
  `commands_after` (a followup Pod never replays an old stop). Residual asks become
  `approval` events answered by the `approve` command (unknown option = deny).
- Tests: `server/runner/runner.test.ts` (whole cycle against
  `server/testing/fake-perspicax-runner.ts`, real smart HTTP git, fake
  engine; Git guard negatives), `server/runner/runner-drivers.test.ts` (the
  real Claude and Codex drivers with their fake CLIs),
  `server/runner/units.test.ts`.
