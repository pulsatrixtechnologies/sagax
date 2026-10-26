# iOS companion architecture

The iOS app is a thin, native client for the Sagax instance running on
your Mac. The Mac remains the only machine that persists agent processes,
credentials, SQLite data, transcripts, and computers. The iPhone trusts a Mac
by scanning the QR code shown in desktop **Settings → Remote access**; it does not need
a Sagax account of its own.

## Use My Cloud on your phone

With MausBot Cloud, pair the phone with your Cloud instead of your computer, and
it keeps working while the computer is off.

1. In the desktop app, open the menu under your name and choose **Get the
   phone app**: the App Store for iPhone, or the APK for Android. Scan its code
   with the phone's camera.
2. In the same menu, choose **Connect your phone · to your Cloud (always on)**.
   (**Settings → Sagax Cloud → Use My Cloud on your phone** does the same.) The
   app opens your Cloud in its window, at the Cloud's phone pairing.
3. Choose **Create pairing code** and scan the QR code with the phone app.

On your computer, **Connect your phone** offers your Cloud first and this
computer second, once your plan is paid and your Cloud is Ready. Until the Cloud
is Ready it offers only *to this computer*, with a note that the Cloud will show
there. With the Cloud open in the app window, the entry reads *to your Cloud*
and pairs with it directly. On another server it pairs with that server, and it
is shown only to a session allowed to make pairing codes there.

## Current status

The first version includes:

- QR-first pairing from desktop **Settings → Remote access**, with the computer name
  confirmed on the iPhone before it connects.
- Hosted HTTPS for the default QR after the desktop owner enables it, with
  dedicated Tailscale and trusted-local QR routes only after an explicit
  choice.
- Nearby computers, a manual address, and a six-digit code under **Other ways
  to connect** when the QR path is unavailable.
- Secure per-device trust, device listing, and revocation.
- Multiple saved computers with a one-tap switcher. Each pairing has its own
  Keychain credential, and only the selected computer is connected at a time.
- Bot and room lists, paged transcripts, sending, interruption, and unread
  state.
- Approvals and questions, including narrow “always allow” grants.
- Resumable SSE, streamed reply text, reconnect hydration, and an opt-in live
  Boat computer view. The loopback-only VPS SSH viewer remains desktop-only.
- On-demand stills of a bot's Local VM, idle or working, for a phone the
  computer owner has allowed computer access.
- Markdown rendering and Keychain storage for the phone's pairing trust.
- Secure completion of supported credential-request cards using iOS Password
  AutoFill and QR-pinned HPKE encryption. Apple Passwords/iCloud Keychain is
  sufficient; 1Password, Bitwarden, and other AutoFill providers are optional.

Alerts work while the app is open or for the short period it remains connected
after moving to the background. Once iOS suspends or closes the app, new alerts
cannot arrive. Closed-app push delivery, voice, and App Store release
automation are not part of this version. The optional hosted transport connects
to the user's own computer; it is not a cloud transcript store and cannot wake
a terminated iOS app.

The Mac must be running Sagax and must not be asleep. Desktop
**Settings → Remote access** offers an off-by-default **Keep this computer awake**
switch that prevents system sleep while device access is on; the display may
still turn off. A sleeping or powered-off computer cannot receive phone
requests or run its local routines, including through the optional hosted
transport.

## Markdown

Bot and room replies are rendered. Messages the person typed stay literal.

Rendered blocks are paragraphs, headings, lists, task lists, quotes, thematic
rules, fenced code, and top-level tables indented by at most three spaces. A
table inside a list item, a blockquote, or a fence stays text or code, as
does a row indented by four spaces or a tab. Inline emphasis, code,
strikethrough, and links use Foundation attributed text. A table scrolls
horizontally inside the bubble. A task item shows a checkbox, and an ordered
task keeps its number beside that checkbox.

The in-app spoken form reads each table row and each task's words. It skips a
delimiter-only paragraph and the checkbox token. Closed-app voice is not part
of this version.

## Runtime architecture

```text
 iPhone (pairing trust in Keychain; credential plaintext only while editing)
       │                         │
       │ trusted LAN/Tailscale   │ optional hosted HTTPS
       ▼                         ▼
 sidecar :8810          Cloudflare Tunnel (outbound connector)
                                 │
                                 ▼
                        guardian gateway 127.0.0.1:8812
                                 │ exact per-launch socket/pipe
                                 └──────────────┐
                                                ▼
 companion sidecar (pairing auth, default-deny allowlist,
 response/SSE scrubbing, authenticated endpoint refresh;
 credential ciphertext only)
            │ loopback only
            ▼
 Sagax harness :8799
   HTTP API + event stream
   agent processes and approvals
            │ private Electron utility-process channel
            ▼
 OS-encrypted desktop credential store
            │
            ▼
 SQLite message store + local configuration
```

There are three deliberately separate trust surfaces:

| Surface | Bind | Purpose |
|---|---|---|
| Harness | `127.0.0.1:8799` | Existing app API; remains loopback-only |
| Companion | `0.0.0.0:8810` | Paired native devices; authenticated and allowlisted |
| Companion control | `127.0.0.1:8811` | Start pairing, cancel pairing, list devices, revoke |
| Hosted gateway | `127.0.0.1:8812` | Guardian-owned route to one exact sidecar generation |

The desktop app owns the sidecar lifecycle through
`electron/companion.mjs`. The renderer only receives narrow IPC operations; it
does not fetch the control port directly. Every control route needs a token
the app makes for each sidecar launch and hands over Electron's private port
(port of OpenMausBot #2930), so a page served from `127.0.0.1:8811` itself, as
a bot's browser could open it, cannot start pairing or change a device's
access. A standalone sidecar prints its pairing page link with that token
(`http://127.0.0.1:8811/#token=…`); the page reads it from the fragment,
which never leaves the browser.

## SQLite compatibility

SQLite does not move onto the phone. It is an implementation detail behind the
harness API:

- `server/message-db.ts` and `server/store.ts` persist and page transcripts.
- The phone asks for `GET /api/bots?messages=50` and
  `GET /api/threads/:threadId/messages?before=…&limit=50`.
- SQLite ordering and cursors are therefore tested at the server boundary,
  while the Swift package tests decoding and prepend/deduplication using
  responses captured through the real sidecar.
- A storage migration may change the bytes on disk without changing the app.
  If an API payload changes, regenerate the fixtures with
  `node scripts/capture-companion-fixtures.mjs` and review the diff.

The sidecar keeps its device registry in `~/.sagax/devices.json`. That is
security state owned by the network boundary, not transcript data, so it does
not belong in the message database.

## Connectivity

### Same Wi-Fi

The QR code is still the primary path on the same Wi-Fi. If it is unavailable,
the user can open **Other ways to connect** and choose a nearby computer or
enter the address shown in desktop Settings → Remote access. Nearby discovery does not
run until the user opens that fallback.

Nearby discovery uses Bonjour and direct LAN traffic. Use it only on a network
you trust.

Choosing a nearby computer or manually entering a LAN address is therefore an
explicit fallback. Once the app is using a hosted or Tailscale route,
automatic reconnection stays within those protected transports. Moving back to
direct LAN requires choosing that computer or address again.

### Tailscale

Tailscale is an optional route away from home and on Wi-Fi networks that
isolate clients. In desktop **Settings → Remote access**, the primary card remains
**Secure HTTPS pairing — Recommended**. The separate **Tailscale pairing**
card is only for people who already use Tailscale. Install or open Tailscale
on both devices, sign in to the same tailnet, leave MagicDNS enabled, and
choose **Turn on device access & check** followed by **Pair over Tailscale**.
That first action explicitly starts Remote access so the phone has a listener
to reach. Sagax then places the computer's MagicDNS name in that
dedicated QR; it never silently replaces the default hosted HTTPS route.
Manual entry remains available as a fallback.

The URL is still `http`, but the path is encrypted and authenticated by
WireGuard inside the tailnet. Use the MagicDNS name rather than the
`100.64.0.0/10` address: App Transport Security exceptions are domain-based,
and `ios/project.yml` narrowly allows insecure HTTP for `ts.net` subdomains.

Tailscale is optional. The direct path does not use a Sagax-operated
relay or create a cloud copy of local transcript data.

### Optional hosted HTTPS

In desktop **Settings → Remote access**, **Use your phone anywhere** accepts a
passwordless email code and provisions one HTTPS address for that computer.
This desktop sign-in is only for hosted HTTPS. The iPhone never signs in; it
trusts the computer through the same pairing QR. Nearby, manual, and Tailscale
connections continue to work without an account.

The desktop runs an outbound connector to Cloudflare, so no inbound router
configuration or Tailscale installation is required. The hosted address is
included in a pairing invitation only after it is ready. The default setup
waits for that HTTPS address instead of silently substituting Tailscale;
Tailscale pairing remains an explicit choice in its own optional card.

Cloudflare terminates and proxies the encrypted connection to the connector.
The Sagax control plane stores account and installation metadata plus
opaque tunnel/DNS identifiers in D1, but not bots, transcripts, approvals,
screen frames, pairing tokens, or connector tokens. See `docs/ios-privacy.md`
for data and deletion details.

The connector does not point at the reusable LAN port. Electron launches one
private sidecar socket (or Windows pipe) and a guardian that owns both the
fixed loopback gateway and `cloudflared`. If Electron or that sidecar exits,
the guardian first makes forwarding unavailable, confirms the connector is
dead, and only then releases the gateway. Another process that later binds a
local port cannot inherit the public route.

## Pairing and device security

1. On the Mac, open **Settings → Remote access** and choose **Pair a phone**. The app
   starts device access as part of setup.
2. On the iPhone, choose **Connect my computer** and scan the QR.
3. Confirm the computer name and the displayed transport — **HTTPS connection**,
   **Tailscale connection**, or **Trusted local connection**. The phone stores
   its trust securely in Keychain; no iPhone account is required. A camera QR
   also pins that computer's public credential-encryption key. Manual and old
   pairings can still chat, but must scan a fresh QR before entering a key on
   the phone.
4. If scanning is unavailable, open **Other ways to connect** for a nearby
   computer, manual address, or six-digit code.
5. Revoking the phone on the Mac removes its access and lets it pair again.

To add another Mac, open **Settings → Computers → Connect another computer**
on the iPhone and scan that Mac's QR. The existing computer stays usable if
the new pairing fails or is cancelled. Switching computers replaces the live
event stream and in-memory chat state, but keeps every saved pairing; removing
one computer deletes only that computer's Keychain credential from the phone.
An app upgrade migrates the previous single saved pairing automatically.

The Mac must remain awake with Sagax running for chats, approvals, and
routines to work, including through hosted HTTPS or Tailscale.

After pairing, the phone periodically reads the authenticated, sidecar-owned
`GET /api/companion/endpoints` snapshot. This lets an existing phone learn a
new hosted address—or its withdrawal—without another pairing ceremony. The
route never reaches the harness and returns only the computer name plus a
bounded list of connection origins.

A Sagax account is not required for nearby, manual, or Tailscale
connections. Only the desktop owner signs in when enabling the optional hosted
HTTPS route; the iPhone always uses the same QR trust flow.

### Secure credential entry

This is Password AutoFill, not a password-vault integration. A native
`SecureField` marked as a password lets the user explicitly choose Apple
Passwords or any enabled third-party AutoFill provider. SagaxMobile does
not enumerate a vault, receive a provider token, or save the entered value in
its own Keychain.

The packaged desktop creates one stable P-256 recipient key pair and keeps the
private JWK inside its operating-system-encrypted credential document. Only the
65-byte uncompressed public point is added to a camera QR. The phone validates
and pins that point with the connection; manual and older pairings remain fully
usable for chat but cannot submit a credential until they scan a fresh QR.

Credential submission is enabled only while the phone is using hosted HTTPS or
a Tailscale route. Local and Bonjour chat pairing still work as before, but
their cleartext HTTP transport would expose the reusable device token to anyone
who could observe that Wi-Fi network, so the app directs the user to finish the
credential request on the computer instead.

Each submission uses RFC 9180 base-mode HPKE with P-256/HKDF-SHA256/AES-GCM-256
and authenticates this exact newline-separated context:

```text
openmausbot-phone-credential-v1
<key id>
<authenticated companion device id>
<bot id>
<thread id>
<message id>
<credential target>
<one-time request key>
```

The companion replaces any caller-supplied device header with the identity of
the bearer token it authenticated. The harness accepts only an allowlisted
target on the exact pending card, opens the ciphertext through its private
Electron channel, and waits for the encrypted desktop store and live config to
commit before it marks the card complete. Replays are idempotent; moving a
ciphertext to another device, bot, task, card, target, or computer fails
authentication. The native field is cleared immediately after local
encryption. If the response is interrupted, the app retains only that exact
ciphertext in memory and reuses it for Retry, so HPKE randomness cannot turn a
network retry into a second credential write. Nothing is persisted on the
phone. Development servers deliberately have no recipient key and fail closed
instead of advertising an unusable secure-entry route.

The device-facing socket rejects browser `Origin` headers before reading a
token. Its route policy in `companion/src/routes.ts` is default-deny: a new
harness route remains unreachable until it is deliberately added.

Allowed in the first release:

- Read the fleet, rooms, instances, configuration status, and transcripts.
- Fetch settled screen images and opt into live screen frames.
- Request a fresh interactive cloud-desktop viewer only when the computer
  owner has enabled that capability for this specific paired phone.
- With the same capability, fetch a still of a bot's Local VM
  (`POST /api/bots/:id/local-computer/screenshot`). The app always passes the
  conversation's `threadId`, so the harness answers 409 for a conversation
  that is not on the Local VM. This reads a picture; it cannot start, stop,
  remove the VM. Like the desktop panel's preview, each capture
  counts as use of the VM, so an open computer view keeps it from being
  reclaimed as idle; leaving the view or backgrounding the app stops that.
- With the same capability, drive the Local VM: take the bot's computer under
  a device control lease (`POST /api/bots/:id/computer/control`), then
  `POST /api/bots/:id/local-computer/join?controlLeaseId=…`. The harness answers
  that only for a loopback caller, only for a conversation on the Local VM,
  and only to the lease that holds the computer. The sidecar rewrites the
  loopback noVNC address into its device-scoped relay path, then asks the
  harness every few seconds whether that lease still holds
  (`action: "check"`, read-only) and closes the relay when it does not. The
  phone speaks RFB over the relay. Hand back closes the viewer and releases
  the lease, and so does backgrounding the app.
- A phone paired with the server directly (`openmausbot serve` behind
  Tailscale Serve or a tunnel, no sidecar) drives the Local VM the same way,
  but the join answers it with the server's own authenticated desktop proxy
  (`/api/desktop-viewer/local/<target>/websockify`), bound to its control
  lease, and the VNC password; never the loopback address. The proxy re-checks
  the lease and the session every few seconds and closes the socket when
  either lapses; hand back closes it at once. Computer access is the pairing's
  scope: Full access (`openmausbot pair`) may, chat-only (`--client`) is
  answered 403 and the app shows computer access as off.
- Phone control requires per-bot Local VMs. Shared and pool modes are refused
  on both connection paths until a viewer can reserve its desktop against
  other bots; a control hold on one bot alone cannot do that. Stills remain
  available in every mode.
- On an organization server (the phone paired to the server itself, not
  through the sidecar) Works on Local VM or This computer shows a still
  and Play, Pause and Stop through `GET /api/me/desktop-bridge` and
  `POST /api/me/desktop-bridge/local-vm`. There is no Take control on
  that screen. The phone does not send action `use`. The bot drives the
  VM from the server. The sidecar allow-list does not include those
  routes: a sidecar pairing is not an organization, so the app does not
  ask them there. Auto and Cloud keep Take control of the server
  environment. A solo server keeps the still and join routes above.
- Send messages, interrupt bots, answer approvals/questions, and mark chats
  read.
- Create a basic bot.
- Submit a supported pending credential card as an RFC 9180 HPKE envelope
  bound to the authenticated device, bot, task, message, request, and target.
  Only the paired packaged desktop's embedded server and Electron private
  process channel receive the private key or plaintext; the sidecar, hosted
  relay, chat transcript, and SQLite store see ciphertext or status only.

The write surface uses purpose-built `read` and `always-allow` endpoints. The
general bot and room `PATCH` endpoints reach the harness through the sidecar
since the visual parity work, but the harness holds a companion request to
the member fields (look, framing, name, instructions, notifications, model;
a room's name, reading state, pin and roster), never execution policy,
folders, computers or MCP servers (see "Visual parity routes" below).
An always-allow request succeeds only when its server-issued key is still on a
pending approval for that bot, so possession of a device token is not enough
to invent a broad execution grant.

Intentionally refused (the sidecar's `ALLOWED` list in
`companion/src/routes.ts` is the whole surface; everything else is denied,
with a sentence for the families below and "no route" for the rest):

- Reading credentials, arbitrary credential targets, and general provider
  configuration: API keys and `/api/config` writes ("API keys can only be
  changed on your computer"), engine setup (`/api/instances/:id` changes,
  sign-ins, refresh-models), the decision model, `/api/keys/test`. The only
  credential write is the exact pending-card envelope above, and it feeds the
  existing desktop OS-encrypted save path. `POST /api/instances/:id/claude-update`
  is the one engine action that crosses.
- Pairing new devices, device revocation, sessions and companion lifecycle
  (`/api/companion/*`, `/api/devices/*`, `/api/auth/pairing`, `/api/auth/sessions`).
- The Local VM (`/api/local-computer/*`, `/api/computers/*`), backups
  (`/api/workspace-backup/*`), people, mail, activity and fleet screens.
- Webhook management (`/api/webhooks*`), whole-service connector removal
  (`DELETE /api/connectors/:slug`), connector tool grants, single-routine
  reads and anything else under `/api/routines/:id` beyond `PATCH`, `DELETE`
  and `/run` ("this routine operation is only available on your computer").
- Team import/export, the template library and team computers (`/api/teams/*`,
  `/api/team-library/*`, `/api/team-computers*`), team instructions
  (`/api/section-context`), team rename and delete (`PATCH`/`DELETE`
  `/api/sidebar-sections`).
- A bot's execution policy and where it runs: approval mode, folder (`cwd`),
  computer, MCP servers, browser profile, peers (the harness refuses those
  fields on a companion `PATCH`), `/soul` writes, opening the memory folder on
  the host's screen (`POST /api/bots/:id/memory/open`), the legacy whole-file
  memory write, room setup (`PATCH /api/groups/:id/setup`, which sets the
  room's folder), room delete, calendar calls, the Inspector's raw events,
  New Bot defaults and removing a preset, MCP server writes. (Skills, memory,
  history, the system prompt and the preset list cross for the owner since
  decision D1: see "iOS feature parity routes" below.)
- Cloud computer provisioning, removal, sleep and shell execution. The phone
  receives only the fresh `join` viewer URL, never the provider key.
- Internal peer-agent routes, and new harness routes that have not been
  reviewed for device access.

Routines (list, create, edit, delete, run, cancel, seen, seen-all) and
Connected apps (catalog, connected accounts, authorize, removing one account)
cross since the routines and multi-account work; webhooks stay refused.

### Same surface as the desktop remote client

The Electron app can itself be a remote client of another computer
(`electron/desktop-companion-client.mjs`): it pairs with that computer's
sidecar like a phone, and its renderer runs with
`window.ogb.remoteClient.active`. That mode is the reference for what a paired
iPad shows and does (`docs/superpowers/specs/2026-10-02-ipad-desktop-parity-design.md`,
"What the phone API does not expose"): every request that renderer makes from
a surface it shows in that mode crosses the sidecar, and what it hides there
(the full bot panel, Inspector, approval-mode and "where" menus, the model
picker, room setup, rename and delete, team-map editing, Templates, archived
bots, Settings other than Pair devices, Appearance and Organization) the iPad
hides too. Added for that parity (2026-10-02):

| Route | Why |
|---|---|
| `GET /api/brand` | the deployment's name, icon and colours (also public on the harness) |
| `POST /api/bots/:id/queue/:queueId/steer` | Steer a queued message into the running turn (composer) |
| `POST /api/groups/:id/queue/:queueId/steer` | the same in a room |
| `POST /api/bots/:id/tasks/:threadId/title` | Regenerate a thread's title (thread menu, when generated titles are on) |
| `POST /api/bots/:id/projects`, `PATCH`/`DELETE /api/bots/:id/projects/:projectId`, `PATCH /api/bots/:id/projects/order` | thread folders (name and emoji only; the harness refuses any other field) |
| `POST /api/routine-runs/seen-all` | Automations > Mark all as read |

Tests: `companion/test/routes.test.ts` ("desktop remote-client parity": every
request the remote-client renderer makes crosses, what it hides does not) and
`companion/test/proxy.test.ts` (the new routes reach a real harness).

For a phone or tablet paired with a server (a client session), `CLIENT_ALLOW`
in `server/request-auth.ts` adds the two steer routes (the harness applies the
cancel's guards plus the send's: the viewer's own thread, a read-only member
of a shared room may not steer) and, on a solo or hosted server (not an
organization server, where a member's engines are `/api/me/engines`),
`GET /api/instances`, which a non-admin
session receives through `clientInstanceView()`: engine names, models,
capabilities, availability and billing, never CLI paths, install or sign-in
commands, account addresses or update commands. Folders, team filing
(`POST /api/sidebar-sections`) and `/api/usage` stay admin on a server: their
handlers have no per-viewer check, and the remote-client renderer does not
show Usage. A bot's Overview is a client route since the iOS feature parity
work, held to the bot's owner by its handler (see below). `/api/me/engines` is a client route
on an organization server (`orgDirectory`), as before.

## Phone tools (2026-10-21, Grok Bot parity row 81)

A bot can ask the person's own iPhone for something only the phone knows:
its position once, a contact by name (only the fields asked for), reminders
and calendar events (read, or add one), photos the person picks, one of
their Shortcuts by name, the clipboard text, and battery, network and Focus.
Health is not offered.

- Only over a protected transport (JC 2026-10-21): hosted HTTPS or
  Tailscale, read from the connection, never from what the phone says
  (`shared/phone-transport.ts`; through the sidecar, `companion/src/transport.ts`
  sends `x-openmausbot-companion-transport`: the guardian's socket or a
  tailnet address is protected). On plain local Wi-Fi the server offers
  nothing from that phone and says why; the phone also refuses with the
  reason, and Settings > Approval rules says the tools are off there.
- Only native clients answer: a phone the companion vouched for, or the
  native app's bearer session; never a browser cookie, a bot's session or
  an ephemeral one. The routes are `admin` rows in the tool policy
  (`defaultEnabled: false`): a bot's `act` never reaches them.
- Never in a turn another bot's words joined (an aside folded into the
  owner's live turn), nor in one `ownEnvironmentOrigin` does not call the
  owner's (internal turn, routine lineage, automation, unattended run).
  Parallel tasks the owner opens in their own turn inherit the owner's
  access; the card on the phone still asks.
- The bot sees one tool, `phone_tool` (`server/drivers/agents-phone-tools.ts`),
  only in a 1:1 turn the bot's owner started, and only while a phone of
  theirs offers tools (it registered in the last 15 minutes, or in the last
  day when the server can push to it). Its `tool` enum lists exactly what
  the phone offers. Never in a room, a routine, a webhook turn or a turn
  another bot started; never another member's phone.
- Each request shows a card on the phone (Refuser / Toujours permettre /
  Permettre une fois, `Features/PhoneTools`), never on the lock screen: the
  push uses the question category, without Allow. Toujours permettre is
  saved for exactly what was allowed (`<data>/phone-tools/grants.json`):
  status, the approximate position, contacts with that very set of fields,
  reading reminders or the calendar. Never for a precise position,
  creating a reminder or an event, a shortcut, the clipboard or photos. It
  runs only while the app is open on screen, and a banner says which bot
  used which tool each time. After a refusal the same bot cannot show the
  same tool's card again for a minute. Settings > Approval rules lists the tools this
  phone offers (a switch each) and the grants (Remove).
- The phone runs the iOS call after the yes, asks iOS for its own permission
  the first time (usage descriptions in `project.yml`, French in
  `App/InfoPlist.xcstrings`) and sends only the asked fields
  (`PhoneToolShaping`); the server cuts the answer again
  (`checkPhoneToolResult`, a position is rounded to about 100 m unless the
  bot asked precise). The answer stays in memory until the waiting turn
  reads it, once (a timer drops what nobody read); the transcript and the
  event log keep "Phone data not kept in the conversation." instead of the
  output, and photos go to the model only, never into the chat. The admin
  activity row names the tool and the decision (`approval`, `phoneTool.*`).
  What Sagax cannot control: the engine's own session files (Claude Code,
  Codex) keep the tool result like any other.
- The card shows everything that would be created (title, dates, place,
  list, notes), a shortcut's whole input with a warning that it can send,
  pay or change things, and the clipboard's text as read before it goes.
  The first time the phone offers tools, a sheet lists them (all on, each
  request still asks; Settings > Approval rules turns any off).
- A call holds the turn 45 s at most (under every engine's tool timeout),
  then hands the bot a request id to wait on again. A request expires after
  5 minutes. At most 5 wait on one person.
- Routes: `POST /api/me/phone-tools/device`, `GET /api/me/phone-tools/requests`,
  `POST /api/me/phone-tools/requests/:id`, `GET` and `DELETE /api/me/phone-tools/grants`
  (companion `ALLOWED` and `CLIENT_ALLOW`); the harness accepts them only
  from the companion's vouched phone or a person's own device session, never
  a bot's session. The `phone-tools` frame carries no data and reaches the
  person's own streams only.
- **Scanner avec l'iPhone** (row 84): the vault's New card form on the
  computer asks the person's phone to read a card (`card_scan`, never a bot
  tool: `/api/me/phone-tools/card-scan`, the computer only, never a bot's
  shell or session nor a phone). End to end (JC 2026-10-21): the form makes
  a one-time P-256 key and sends its public half; the phone reads the card
  on the device (`CardPhotoScanner`, Vision), shows the last four digits and
  seals the number, the expiry and the name for that key
  (`PhoneCardSeal.swift`, `shared/phone-card-seal.ts`: HPKE base mode,
  P-256, HKDF-SHA256, AES-256-GCM, bound to the request and the key). The
  server relays the envelope and never holds the number in clear, not even
  in memory (nor its logs, live frames, pushes or crash reports); the form
  opens it and fills the fields. This is not a defence against a malicious
  server: it serves the form's code and sees a card typed in the vault
  anyway. Both screens show a six digit code drawn from the key, a pairing
  check that the right form and the right phone are talking, not an
  authentication (20 bits a server could grind; a commit-reveal could come
  later). HPKE base mode authenticates no sender: only a native session of
  the same person may answer (the companion's phone or the app's bearer
  session), and only the person's computer starts a scan (the desktop app's
  owner token or a browser session, never a native bearer session). The
  security code is never read. Only over HTTPS or Tailscale, iOS 17 or
  later.

## iOS feature parity routes (2026-10-03)

From the feature parity matrix
(`docs/superpowers/specs/2026-10-03-ios-feature-parity-matrix.md`, packages S1,
S2 and S3, with JC's decisions D1 yes, D3 yes, D4 keep).

**Through the companion (S1, D1, D3).** A companion request is the computer's
owner to the harness, so these get the owner checks the desktop's own renderer
has. Added to `ALLOWED` in `companion/src/routes.ts`:

| Route | Why |
|---|---|
| `GET /api/bots/:id/harness-commands` | the engine's own slash commands (names, descriptions, hints) |
| `POST /api/bots/:id/parallel/:threadId/stop` | Stop on a parallel task card |
| `GET /api/bots/:id/activity`, `GET /api/bots/:id/activity/item` | what the bot is doing, its history and one item |
| `POST /api/bots/:id/primary` | Make primary bot (the harness checks the owner) |
| `GET /api/me/harness-connectors` | the owner's own claude.ai connectors (names, statuses) |
| `GET /api/bots/:id/computer` | the bot computer's status and phase (read-only) |
| `GET/PUT /api/groups/:id/memory` | a room's shared memory (D3): its people read, its owner edits or switches it off |
| `PUT /api/tts/provider` | the voice engine alone (`{ provider }`, nothing else); `PUT /api/config` stays refused |
| `GET /api/bots/:id/system-prompt` | prompt preview (D1) |
| `GET /api/bots/:id/history`, `POST /api/bots/:id/history/rollback` | history of changes, restore instructions (D1) |
| `GET/POST /api/bots/:id/skills`, `GET/PATCH/DELETE /api/bots/:id/skills/:name` | skills: list, read, import (lands disabled), enable, remove (D1) |
| `GET /api/bots/:id/memory`, `GET/PUT/DELETE /api/bots/:id/memory/file`, `GET /api/bots/:id/memory/journal`, `POST /api/bots/:id/memory/journal/:changeId/revert`, `GET /api/bots/:id/memory/upkeep`, `POST /api/bots/:id/memory/tidy` | memory: overview, files (saved with their hash), journal and revert, upkeep (D1) |
| `GET /api/bot-presets` | New bot's starting roles (D1) |
| `GET /api/me/achievements`, `POST /api/me/achievements/events`, `PUT /api/me/achievements/settings`, `GET /api/achievements/public` | achievements (D1) |

The companion's bot `PATCH` also takes `memoryEnabled` and `memoryUpkeep`
(`companionBotFieldViolation`): the advanced panel's memory switches. Approval
mode, folder, computer, MCP servers and access stay refused, as does
`POST /api/bots/:id/memory/open` (it opens a window on the host's screen).

**Client sessions on a server (S2).** Added to `CLIENT_ALLOW` in
`server/request-auth.ts`, each held by its handler:

| Route | Who |
|---|---|
| `POST /api/bots/:id/connector-cards/:messageId/authorize` | the bot's owner on a personal server, or this computer's own person; never a member on an organization server (it signs an account into the server's own connected apps); a Cloud guest only in a conversation it started |
| `GET /api/bots/:id/command-allowlist`, `DELETE /api/bots/:id/command-allowlist/:ruleId` | the bot's owner, or this computer's own person; adding a rule stays admin |
| `POST /api/plugins/install` | an admin, or this computer's own person |
| `GET /api/bots/:id/overview` | the bot's owner (or edit grant on an organization server), or an admin |

"This computer's own person" (`clientSessionIsComputerOwner`) is the loopback
owner, an admin session, or on a personal server (not an organization server,
not a Cloud home) a client session bound to the operator's principal or
address. A chat-only pairing, with nobody behind it, is not.

**Rooms from the phone.** `POST /api/groups` accepts
`setup: { defaultResponder }` without `bulletin` (it defaults to empty), so a
phone opens a room the way the desktop remote client does
(`{ defaultResponder: { kind: "mentions" } }`).

**Routine edits from the phone (S3, AU13).** `PATCH /api/routines/:id`
merges: an interval schedule that omits `weekdays`, `window` or `endsAt` keeps
the stored ones (explicit `null` clears one), and an omitted `overlap`,
`attachments`, `continuity`, `resultsThreadId`, `target` or `groupId` keeps
its value. The phone's editor body is pinned by `server/routines.test.ts`
("keeps every field a phone editor does not send") and end to end through the
sidecar by `companion/test/proxy.test.ts`.

Tests: `companion/test/routes.test.ts` ("iOS feature parity (S1, D1, D3)"),
`companion/test/proxy.test.ts` (the routes reach a real harness; the voice
engine route; the routine edit), `server/request-auth.test.ts`,
`server/routes/tts-provider.test.ts`, `server/ios-parity.e2e.test.ts` ("holds
the owner routes of a client session to the owner").

## Visual parity routes (2026-10)

The parity screens (`docs/superpowers/specs/2026-10-01-ios-visual-parity-design.md`)
use the routes below. Each one is reachable both through the companion
sidecar (a personal computer: the phone acts as its owner) and for a phone
paired with a server (`request-auth.ts` `CLIENT_ALLOW` for member reads and
owner actions, admin scope otherwise). The harness applies the same owner or
admin rule to both: a companion request is a loopback owner, but the harness
holds its bot and room `PATCH` to the member fields (`memberBotFieldViolation`,
`clientGroupPatchViolation`). Tests: `companion/test/routes.test.ts`
("iOS parity routes"), `server/ios-parity.e2e.test.ts` and each route
module's own test under `server/routes/`.

| Route | Payload / answer | Who |
|---|---|---|
| `POST /api/bots` | `{ name, settings: { color }, mascotLook, mascotSkin, ... }` | as before (member's own bot on an organization server) |
| `PATCH /api/bots/:id` | look and framing (`color`, `mascot*`, `avatarCrop`, `avatarZoom`, `avatarFocusX/Y`, `pinned`); owner adds `name`, `soul`, `notifications`, `avatarUrl`, `modelSelection` | any member for look; owner or admin for the rest |
| `GET /api/bots` | each bot carries `instructionsLead` (first non-empty line of `soul`, no heading marks, at most 140 characters) | member |
| `GET /api/bots/:id/soul`, `POST /api/bots/:id/avatar/generate`, `DELETE /api/bots/:id` | as before | owner or admin |
| `GET /api/bots/:id/links?cursor=&limit=` | `{ links: [{ url, domain, title?, messageId, threadId, at }], nextCursor, total }`, newest first, one per URL, the viewer's threads only | member |
| `GET /api/bots/:id/files?kind=media\|file&cursor=&limit=` | `{ files: [{ id, threadId, messageId, name, mime?, size, available, source, at, kind, url, previewUrl? }], nextCursor, total }`; `url` and `previewUrl` are the existing `/api/threads/:id/files/:fileId[?preview=1]` | member |
| `POST /api/bots/:id/export` | `{ document, filename, redacted, skipped, summary }`: the bot as a team package v2, without chats, header values or keys | owner or admin |
| `POST /api/bots/:id/computer/input` | `{ events: [{ type: "move", dx, dy } \| { type: "moveTo", x, y } \| { type: "button", button, action, count? } \| { type: "scroll", dx, dy } \| { type: "key", key, modifiers? } \| { type: "text", text }], controlLeaseId? }` (at most 64) -> `{ ok, applied }` | owner or admin holding control |
| `GET/PUT /api/bots/:id/computer/clipboard` | `{ text }` (16 KiB) | owner or admin holding control |
| `GET/PUT /api/settings/bot` | `{ settings: { autoReviewDefault, timeZone, timeZoneAuto }, scope, hostTimeZone, effectiveTimeZone }` | read: member; change: the person (organization) or the owner (personal) |
| `GET /api/auto-review/rules`, `DELETE /api/auto-review/rules/:id` | `{ rules: [{ id, scope, botId, botName, command, cwd, providerInstanceId }], global: [], total }` | owner or admin |
| `GET /api/computer/status`, `POST /api/computer/update`, `POST /api/computer/reset` (`{ confirm: true }`) | `{ kind: "org-sandbox" \| "local", configured, state, diskState: "normal" \| "almostFull" \| "full", workspaceBytes, limitBytes?, version?, problem? }` | the person (organization) or the owner (personal) |
| `POST /api/me/server-environment/update` | rebuilds the person's server environment from the current image, keeping `/workspace` | the person (organization) |
| `GET /api/plugins/search?q=&cursor=` | `{ featured, results, nextCursor, registryAvailable }` | member |
| `GET /api/plugins/installed` | `{ plugins: [{ kind: "mcp", name, url, domain, enabled, auth, icon?, catalogId? }], count }` | member |
| `POST /api/plugins/install` | `{ id, trust?, returnTo?, callbackOrigin? }` -> `{ name, alreadyInstalled, auth, authorizationUrl? }` | admin or owner |
| `POST /api/mcp/servers/:name/oauth/start` | adds `returnTo` and `callbackOrigin` | admin or owner |
| `PATCH /api/groups/:id` | adds `pinned` | member |
| `GET /api/auth/session` | personal computer: `name` (Settings > General, else the OS user) and `computerName`, never an email unless the desktop is signed in to an organization (then that person's name, address and `avatarUrl`); organization server: the person, and `avatarUrl` when Perspicax has their photo | anyone signed in |
| `GET /api/people/:id/avatar?v=` | the person's Perspicax avatar as `avatarUrl` names it (PNG or JPEG, `private, max-age=86400` for the current version), read by the server through its Perspicax link; the phone asks only this route, with its own bearer, and keeps the image keyed by the versioned URL (`AccountAvatar`, `AccountPhotoStore`) | anyone signed in (organization; on a personal computer whose desktop is signed in to an organization, its owner's avatar, `server/owner-identity.ts`) |
| `DELETE /api/me` | `{ confirm: true }` | the person (organization) |

Also through the companion: `GET /api/usage`, `GET /api/mcp/servers`,
`GET /api/bots/:id/command-allowlist` and deleting a rule there,
`GET/PUT /api/me/preferences`, `GET /api/me/server-environment` and its
reset/update, and `GET /api/threads/:id/files` with one file by id. On a
personal computer the preferences and server-environment routes answer 404
(they belong to an organization server); the phone uses
`/api/settings/bot` and `/api/computer/*` there.

**The computer's look.** Settings > Appearance > Same as my computer wears
the computer's skin and font (`omb-skin`, `omb-font`, and the Hibou 98 keys
`omb.retro98.on` / `omb.retro98.unlocked`). On an organization server the
phone reads them from the person's `GET /api/me/preferences` and writes a new
choice back with `PUT /api/me/preferences` (the whole record, read first). On
a personal computer that route answers 404, and the phone uses
`GET/PUT /api/me/appearance` instead (allowed through the companion):
`{ stored, preferences: { "omb-skin"?, "omb-font"?, "omb.retro98.on"?,
"omb.retro98.unlocked"? }, updatedAt }`, PUT `{ preferences }` replacing the
record, unknown keys and values dropped (`shared/desktop-appearance.ts`). The
desktop app keeps that record in step with what it wears and applies a look
the phone wrote within a few seconds (`src/lib/desktop-appearance-sync.ts`);
an organization server answers 404 there.

**Remote input.** The phone takes control first (`POST /api/bots/:id/computer/control`
`{ action: "take" }`, optionally with a `controlLeaseId`). Input without the
hold answers 409 `no_control` (or `control_lease` when another lease holds
it); a bot with no desktop answers 404 `no_computer`. Events become
`xdotool`/`xclip` lines run through the backend's own command path (the
Boat, a team Boat, the VPS container, the Local VM), the same tools the bot
itself drives. Typed text is base64 inside the command, never interpolated. The Local VM image ships xdotool and xclip for this (image layer 6). While in
control the phone refreshes the picture with `POST /api/bots/:id/computer/screenshot`
(`{ png, format }`), which also answers for a Local VM bot (owner or admin).
Each batch is audited as counts by event type (`computer.input`, at most one
admin-activity row per person and bot a minute); clipboard reads and writes
as byte counts. Through the companion these routes ride the per-phone desktop
capability, like the viewer.

**Auto-review default.** On: a conversation opened afterwards starts in the
engine's own reviewer level (`auto`, for Codex, Claude, Cursor, Grok and Qwen)
or, without a reviewer, Ask (Full and Auto tighten to Ask; Ask and Edits
stay). It never changes an existing conversation, never leaves Custom, and
never turns Auto on for a bot that works on this computer. Off: a new
conversation takes its bot's level, as before (`server/bot-settings.ts`).

**Time zone.** Routines read daily times, interval windows and weekdays in
the configured zone (the person's own on an organization server, else the
server's), else the host's; cron keeps the zone saved with it. Changing it
reschedules the affected routines. With `timeZoneAuto` on, the phone sends
`TimeZone.current.identifier`.

**Plugin sign-in from the phone.** `returnTo` must be an app address the
server lists (`sagax://oauth-done`, plus `SAGAX_PHONE_OAUTH_RETURNS`, comma
separated). The sign-in returns to the server's callback, which then
redirects the sheet to `returnTo?status=ok|error&server=<name>[&error=...]`
(never a code or token). An organization server uses its public address;
through the companion the phone passes `callbackOrigin`, the https (or
`*.ts.net`) origin it reached the computer on, and the companion forwards
the callback without a device token (its single-use state is the
authorization, and the code is useless without the server's PKCE verifier).
Without either, a companion start answers 409 `callback_unreachable`.

**Account deletion.** On an organization server `DELETE /api/me` first asks
Perspicax to erase the person's account (`POST
/api/v1/pulsabot/people/me/erase`, Perspicax 2026-10-17 and later), then
deletes their Sagax data (owned bots, own threads, server environment, saved
settings, sign-in grants and routine delegation, sessions, and their name,
address and photo on this server). Nothing is deleted unless Perspicax erased
the account first. An older Perspicax answers 501
`perspicax_deletion_unavailable` (the phone says to ask the organization);
Perspicax erases only after a sign-in of the last five minutes (2026-10-18),
so the first answer is 409 `reauth_required`: the phone calls `POST
/api/me/reauth` `{ "client": "phone" }`, opens the address it answers in the
authentication sheet (`ios/App/AccountReauthSheet.swift`; Perspicax asks for
the sign-in again), which ends on `sagax://account-reauth?status=ok` (a
refusal on `?error=<code>`), and sends the deletion again; an expired
Perspicax sign-in is 409 `account_sign_in_again`; the organization's
last active admin is 409 `last_admin`; a key a product the administrator
configured still uses is 409 `perspicax_key_in_use`; any other refusal is
`perspicax_deletion_failed` (on 502 the message says the deletion may have
gone through: the account purged push then finishes it); a local failure
after Perspicax erased the account is 500 `account_deletion_pending`, which
the same push finishes. A personal computer answers 400
`personal_server`: the phone forgets the pairing and erases its own data.

## Stream and state model

`CompanionCore` contains the wire models, client, raw-byte SSE parser, and pure
state fold. The SwiftUI target owns lifecycle and presentation only.

On connection, the server sends a `hello` frame containing a cursor and whether
the requested gap was replayed. The client:

1. resumes from its last `<streamId>:<seq>` cursor;
2. folds replayed and live frames when the gap is available;
3. hydrates the newest page of each visible conversation when it is not; and
4. paginates older transcript pages on demand.

Unknown message and frame kinds degrade safely instead of failing an entire
response, and one malformed fleet record does not hide every healthy chat.
Screen frames are off by default and enabled only while a computer view is
visible. Backgrounding keeps the stream for only the short grace period iOS
allows, then closes it; foregrounding reconnects from the saved cursor. A hello
cursor is committed only after a cold hydration succeeds; replayed streams
advance it one folded frame at a time, so a disconnect during recovery cannot
skip the remaining gap.

## Source layout

```text
companion/
  src/routes.ts       device-facing allowlist
  src/devices.ts      pairing and token registry
  src/proxy.ts        HTTP/SSE forwarding and scrubbing
  src/origin.ts       private per-launch hosted origin listener
  src/control.ts      loopback-only control plane
  src/mdns.ts         Bonjour advertisement
```

## Verification contract

The merge gate for this feature is:

```sh
pnpm typecheck
pnpm test
pnpm build:companion
pnpm check:electron

cd ios
swift test
xcodegen generate
xcodebuild -project Sagax.xcodeproj \
  -scheme Sagax \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

The simulator validates compilation, launch, layout, manual address parsing,
and failure states. Bonjour, Local Network permission, Tailscale routing,
Keychain behavior across a reboot, and approval delivery still require a real
iPhone pass.

## Follow-on releases

Keep the foundational merge separate from capabilities that widen security or
distribution scope:

1. **Foundation:** sidecar, desktop controls, Swift core/app, pairing, chat,
   approvals, reconnect, simulator and contract CI.
2. **Desktop conversation parity:** task create/switch/rename/delete, SQLite
   search with exact-message landing, transcript export/share, reactions, and
   edit/version controls. Archived or hidden chat management remains desktop-only.
3. **Notifications:** native permission, live/replayed alerts, time-sensitive
   approvals, badges, and a brief background grace period are in the app.
   Closed-app delivery still requires project-owned APNs credentials and a
   hosted relay; Tailscale cannot wake a terminated iOS process.
4. **Distribution:** signing, bundle ownership, privacy declarations,
   TestFlight, and App Store review material. Swift tests and an unsigned
   simulator build already run in the repository CI.
5. **Optional expansion:** voice/call mode or Local VM/host-computer
   interaction. Each requires its own threat-model review.
