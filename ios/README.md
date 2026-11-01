# Sagax companion (iOS)

Your bots keep running on the laptop. This is the phone you watch them from,
answer their approvals on, and send them the next thing.

The laptop stays the only machine that persists agent processes, credentials,
transcripts and computers. The phone owns no copy — it is a second client of
the same harness the desktop app talks to, through the restricted sidecar
described in [`docs/ios-companion.md`](../docs/ios-companion.md).

## Status

Built and verified against a real harness on both a simulator and an iPhone:
QR handoff, Bonjour discovery, manual LAN and Tailscale pairing, the roster, paged chat,
streaming replies, shared sidebar sections, the computer view, and — the one that matters — an approval
raised by a bot on the Mac, answered on the phone, with the bot carrying on.

Pending API-key cards can also be completed on a freshly QR-paired phone.
The native secure field supports iOS Password AutoFill (Apple Passwords is the
free built-in option; enabled third-party providers work too), then CryptoKit
encrypts the value for the paired computer before it enters the network. The
phone clears the native field immediately; it may retain only the exact
ciphertext in memory for an idempotent retry, and never persists it. The
sidecar, hosted relay, transcript and SQLite database retain no plaintext copy.
Submission requires Secure phone access (HTTPS) or Tailscale; local Wi-Fi chat
still works, but the app does not send a reusable device token with a credential
request over cleartext LAN HTTP.

The app also installs an iOS Share extension. From any app's Share sheet, a
person can choose **Sagax**, review the paired computer and destination,
add a note, and send selected text, a link, images, or documents directly to a
bot or room. The extension remembers the last destination per computer, but it
never sends silently: the destination is always visible before confirmation.

The event stream deliberately reads raw bytes rather than
`URLSession.AsyncBytes.lines`. Three easy-to-miss failure modes are covered by
real `URLSession` tests:

1. `timeoutInterval = .greatestFiniteMagnitude` — reads as "never time out",
   actually produces a request that opens and delivers nothing, because
   URLSession turns a timeout into a deadline by adding it to the current time.
2. Keeping only the derived line iterator while letting `URLSession.AsyncBytes`
   go out of scope. AsyncBytes cancels its data task when released, so the
   connection died the moment the first frame was returned.
3. Reading with `bytes.lines`, which folds consecutive newlines into one
   separator and therefore never reports the blank line that terminates an SSE
   event. Zero frames, no error, a healthy-looking connection at both ends.

`EventStreamTests` catches that class by driving a real `URLSession`.
[`TESTING.md`](TESTING.md) is the end-to-end runbook.

## Threads on iPhone and iPad

The home list comes in two densities, chosen per device in **Settings → List
density**, like the desktop sidebar's density:

- **Compact** (the default) gives each bot and group one line: the face, the
  name, a crown after a Chief of Staff, the role, and the time — replaced by a
  spinner while the bot works, with a hand in the bot's colour when it waits
  on you. A bot with more than one active thread shows **› N** (closed,
  archived and snoozed threads are left out, as in the list it opens); tap it
  to list those threads under the bot's name, ending with **New thread**.
  Long-press any bot for **New thread** and **Manage threads**. Groups are
  rows too, and the **+** on their title makes a new one.
- **Comfortable** keeps the larger two-line rows with the latest message,
  groups as tiles, and a **Threads** row beneath every bot.

Desktop folders appear in the same order, with working, queued, waiting and
unread state shown on each thread. Search matches thread and folder names and
lists what matched under each bot. Internal routine runs are kept out of this
list.

Inside a chat, tap the bot/thread name in the header to switch conversations,
create a thread, or rename/delete one. In the thread picker, tap **Select** to
choose several idle threads and delete them after one confirmation. The thread
currently open on the phone stays in place; switch to one you want to keep
before selecting the others. Tap the avatar for bot settings.
Picking a bot thread is local to the phone; it does not move the desktop's
selection. Draft text and attachments stay with their original thread while
switching in that chat. Updates also lists sibling conversations separately.
Group conversations retain their existing shared, serial switching behavior.

Folder creation, moving threads between folders and folder reordering remain
desktop actions. See the [isolated thread checks](../docs/verification/ios-threads.md)
for simulator verification and its limits.

## Layout

```
ios/
  Package.swift                  CompanionCore + its tests
  project.yml                    XcodeGen spec for the app target
  Sources/CompanionCore/         no UI, no Apple frameworks beyond Foundation
    Models.swift                 the harness's wire types
    Frames.swift                 SSE frames, unknown kinds absorbed
    SSE.swift                    line parser + URLSession event stream
    Client.swift                 every call the phone is allowed to make
    Store.swift                  the fold: frames → state
    OrgSignIn.swift              organization sign-in outcomes, errors, connect state machine
    Demo.swift, DemoFixture.swift  the demo's in-memory server and made-up workspace
    BrandMascot.swift            which mascot stands for the app
    SectionSelection.swift       pure swipe/dwell selection state + grid hit testing
    Dictation.swift              composer text + transcript join
  Tests/CompanionCoreTests/
    Fixtures/                    captured from a real server — do not hand-edit
    DecodingTests.swift          the contract with the harness
    SSETests.swift               the parser, which is where this goes wrong
    StoreTests.swift             the fold
    DictationTests.swift         partials replace, they do not stack
  AppShared/                     connection metadata + Keychain access shared by trusted targets
  App/                           SwiftUI, and everything that needs a device
    CompanionApp.swift           entry; owns when the stream lives and dies
    Session.swift                connection, lifecycle, actions
    Discovery.swift              NWBrowser for _openmausbot._tcp
    Keychain.swift               the device token
    Mascots/                     the Sagax characters (owl, shapes, Trombi, Bunbu, Shiba, Grump, Ogre, Frog), the picture crop,
                                 group faces, and a DEBUG gallery (-mascotGallery owl|shape|trombi|group|motion|live-activity)
    PairingView.swift            QR handoff, discovery, address and code fallback
    Onboarding/                  welcome (three ways in), organization sign-in, shared page chrome
    Demo/                        demo launch options, drawn computer screen, home banner
    BrandMascotView.swift        the Sagax owl, or the Primary Bot once connected
    PairingScanner.swift         native QR camera, permission and recovery UI
    Glass.swift                  the one material the chrome is made of (Liquid Glass on 26+)
    SpeechBubble.swift           the bubble shape; the tail is the reference vector, scaled
    ChatListView.swift           roster: channels and shared desktop/mobile sections
    Updates.swift                what the Updates pill shows — only bots doing something
    UpdatesSheet.swift           the pill opened: needs you / working / to review
    NewGroupSheet.swift          make a channel from the phone
    NewSectionSheet.swift        tap or swipe bots together into a section
    ChatView.swift               transcript, tailed bubbles, approval cards, composer
    SpeechDictation.swift        composer mic: xAI listen socket (LiveDictation) or Apple on-device
    ComputerView.swift           opt-in live view of a bot's computer
    MarkdownText.swift           the supported Markdown presentation layer
    SettingsView.swift           status, computer switcher, and pairing removal
  ShareExtension/                native Share-sheet picker, item loading, upload, and send
  NotificationService/           APNs mutable-content: bot name and avatar on the banner
```

## Building

The core needs nothing but a Swift toolchain:

```sh
cd ios
swift test
```

The app needs Xcode. The `.xcodeproj` is generated rather than committed:

```sh
brew install xcodegen
cd ios && xcodegen generate && open Sagax.xcodeproj
```

Run `pnpm install` at the repository root first: the build copies
`node_modules/mermaid/dist/mermaid.min.js` into the app so chat diagrams draw
offline. A Release build without it fails; a Debug build warns and shows the
diagram source instead.

**Re-run `xcodegen generate` after pulling any change that adds a file to
`App/`.** The spec says `sources: App`, but XcodeGen resolves that to explicit
file references when it generates, so a new file is simply absent from the
target until you regenerate — and the build fails with `Cannot find 'X' in
scope`, which reads like a code error and is not one.

If you'd rather not install XcodeGen, make an iOS App target by hand, add the
`App/` folder and the local `CompanionCore` package, and copy the Info.plist
keys out of `project.yml` — `NSLocalNetworkUsageDescription` and
`NSBonjourServices` especially. Without them `NWBrowser` returns no results at
all, *silently*, which looks exactly like "no computers on this network".

## Regenerating the fixtures

Whenever the companion API changes:

```sh
node scripts/capture-companion-fixtures.mjs   # from the repo root
```

It boots a real harness against a throwaway home directory, drives the real
pairing handshake through the sidecar, and writes down what came back. The
harness may use SQLite internally; the fixture records the public HTTP/SSE
contract, which is the only storage surface the phone should know.
Commit the diff — a change there is a change to the contract, and reviewing it
is the point.

## What the phone may and may not do

Enforced by the default-deny policy in `companion/src/routes.ts`, and mirrored
here by simply not having the methods:

| Allowed | Refused |
|---|---|
| Read bots, rooms and transcripts | Write API keys (`PUT /api/config`) |
| Send messages, make a bot or a room | Manage pairing or revoke devices |
| Share selected text, links, images and documents | Browse arbitrary files on the phone or Mac |
| **Answer approvals and questions** | Drive the Local VM or this computer |
| Interrupt a bot, mark chats read | Reach `/api/internal/*` |
| File visible bots into one sidebar section | Use general bot or room `PATCH` routes |
| Fetch screen images on demand | Load the packaged desktop UI |
| Open an explicitly enabled cloud desktop | Provision, sleep or run shell commands on cloud computers |

Marking a chat read and remembering an approval use purpose-built server
verbs. Section creation likewise uses one strict atomic batch route. The
sidecar does not expose the general bot or room `PATCH` routes,
because those can also change execution policy, computers, connected apps, and
working directories.

Companion settings stay on the computer on purpose: losing the phone must not
mean losing the ability to lock it out.

Interactive cloud desktop access is additionally enabled per paired device and
starts off. The phone asks the Mac to mint a fresh provider URL after an
explicit warning, validates that it is HTTPS, opens it in an in-app Safari
sheet, and never persists it. The Local VM's loopback-only noVNC listener and
the host computer remain unreachable through the companion.

## Design notes

- **Zero third-party dependencies.** The raw-byte SSE reader, Keychain,
  `NWBrowser`, and notifications are all first-party.
- **QR scan confirms before connecting.** The QR carries a short-lived,
  high-entropy credential rather than relying on the visible six-digit code.
  The app validates the target, asks the user to confirm it, exchanges the
  credential once, and persists only the resulting device token in Keychain.
- **Thin client.** The harness already folds provider events into settled
  messages. The phone folds `message`, `message.patch`, and `bot` frames, plus
  the small `runtime` delta subset needed to show a reply while it is typed.
- **`screens=off`.** The harness would otherwise push a base64 desktop capture
  every few seconds to a device on cellular.
- **Reconnect by cursor.** The stream is resumable: hold the `<streamId>:<seq>`
  cursor, and on reconnect the server replays what was missed or says
  `resumed: false`, which is the signal to hydrate. Lifecycle — not the parser —
  is the hard part of a phone client, which is why the stream is torn down
  deliberately on backgrounding rather than left for iOS to kill.
- **No optimistic state.** Actions call the harness and let the event stream
  deliver the result. A phone that draws its own version of what just happened
  is a phone that disagrees with the laptop.
- **Every desktop look decodes, and a known character is drawn as itself.**
  `MascotLook` reads a stored look exactly as `botMascotLook` does: owl,
  shape, Trombi, Bunbu, Shiba and Frog, every skin id of `shared/mascot-look.ts` and
  `shared/mascot-skins.ts` with the legacy ids, and a `skins` key of another
  character is dropped, never the look (the desktop's editor saves every
  character's skin). Only an unknown character, an unknown top-level key or a malformed
  style or shape is the owl, as on the desktop. The Shapes are the
  desktop's own still frames (`ShapeStillArt.swift`, generated from
  `shape-engine.ts` by `src/components/ios-mascot-export.test.ts`, which also
  writes the fixture `MascotLookFixtureTests` reads), clay on Plain, eyes cut
  out; Bunbu is `BunbuMascotView`; Shiba is `ShibaMascotView`, drawn from
  `ShibaStillArt.swift` (generated by the same test from shiba-art.ts and
  shiba-moves.ts) with `ShibaArt` palettes the fixture checks; Ogre is
  `OgreMascotView`, the desktop's own draw operations (`OgreStillArt.swift`,
  generated from `ogre-art.ts` by the same test) painted by `OgreArt` (the
  palette ported, checked against the desktop's for every bot colour); Frog is
  `FrogMascotView`, drawn from `FrogStillArt.swift` (generated the same way
  from frog-art.ts and frog-moves.ts) with `FrogArt` palettes the fixture
  checks; every colour of `shared/mascot-colors.ts`
  (Clay palette included) has its value. Where a premium skin's extra layers
  are not on the phone, its base finish shows and `MascotSubstitution` logs
  it once (category `mascot`). After a desktop change to the looks, run
  `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`.
- **Messaging-app shape, not settings-list shape.** Mascot faces at roster size,
  the bot's role beside its name (quiet text in compact, a chip in
  comfortable), timestamps that say "Yesterday"
  rather than a date, and a gap-based separator in the transcript instead of a
  stamp on every message. The palette in `CompanionCore/MascotLook.swift` is copied verbatim
  from `src/lib/mascot.ts`: a bot the user knows as "the orange one" should be
  the same orange on both screens.
- **Return sends, Shift+Return breaks the line**, via `.onKeyPress`. Returning
  `.ignored` for the shifted case hands the keypress back to the text field,
  which is the only thing that can insert the newline once Return is claimed.
  Software keyboards have no Shift+Return, so there `.onSubmit` sends.
- **Composer dictation is the mic.** Tap to talk, tap to stop, then edit or
  send. Recognition stays on-device when the phone supports it, and the mic
  remains visible so another spoken sentence can be appended. Search covers
  the SQLite transcript store and opens the exact task,
  branch, and message; the roster's "+" creates the same basic bot the desktop
  endpoint creates, then opens it.
- **Files stay with their draft.** Attach up to 32 items. Images share a
  200 MiB message budget, with 32 MiB per image on a shared host and 90 MiB on
  a solo host. Documents, archives and audio fit up to 250 MiB each; MP4,
  WebM and QuickTime videos fit up to 1 GiB each. The server's attachment
  store has its own 8 GiB capacity and gives a visible error when full.
  Photo Library accepts photos and videos; Choose File accepts supported
  documents, archives, audio and video. Files from providers are copied into
  the app's protected temporary storage before their URLs expire.
  Upload starts on intake and shows acknowledged progress, remove/cancel
  and Retry on the same chip. Pending or failed uploads hold Send. Leaving
  and reopening the conversation restores its protected, file-backed draft,
  including after app relaunch. Two transfers run at once, each reading one
  4 MiB chunk.
  Retry keeps its UUID and asks the computer for the last confirmed offset
  or completed receipt. Removing a completed unused attachment asks the
  server to clean it; files already used in a transcript stay intact.
- **Share-sheet files use the same resumable transport.** The extension
  copies provider files into its protected App Group, uploads bounded chunks
  and sends the generated server path to the selected destination. The
  iPhone's sandbox URL is never sent. Send first saves the files, destination,
  UUIDs and retry-safe message in the App Group. The Share sheet can finish
  directly or hand off with **Finish in Sagax**. Reopening the containing app
  resumes accepted jobs after extension termination or suspension. There is
  no total upload deadline; each chunk retains its bounded network timeout.
  A cross-process lease prevents the sheet and app from delivering together.
  A lost message receipt replays the same body, options and sendId. Explicit
  Cancel leaves a tombstone so a recovery worker cannot resurrect the job.
  Temporary provider copies can be purged without removing durable jobs.
  Quick Look and system sharing download larger files directly
  to protected storage; text previews read at most 2 MiB. Automatic transcript
  thumbnails retain their separate 25 MiB buffered-download ceiling.

## Limits in this version

The live connection is foreground-only. Notification frames produce native
banners, sounds, time-sensitive approval alerts, and an app badge while connected;
the resume cursor replays alerts missed during a short background pause. There is
no APNs delivery after the app is terminated and no cloud-resident bot service.
A voice call with a bot is the desktop's floating call bar under the bot's name
in the chat header (face, waveform, Settings, Transcript, Mic, End); Settings
and the transcript open in a card under the bar while the conversation stays on
screen, and there is no full-screen call page. A room's call keeps its own
screen. Optional hosted HTTPS is an encrypted route
back to the user's computer, not a second transcript store. Composer dictation is available.
Task management, SQLite transcript search,
transcript sharing, reactions, and edit/version controls use narrow companion
routes and the computer remains the source of truth. Tailscale is supported
through manual MagicDNS entry; it is not a dependency and Sagax does not
operate a cloud copy of local data.

## Legacy wire identifiers

The app is Sagax everywhere a person can see it (`ca.pulsatrix.sagax`,
`sagax://` only, display and bundle name "Sagax"). A few upstream spellings
stay inside the binary because the server protocol requires them; nobody
sees them:

- `_openmausbot._tcp`: the Bonjour service type the desktop advertises.
- `/.well-known/openmausbot/environment`: the environment probe every
  released server answers (`/.well-known/sagax/` exists only from 0.4.0).
- The health body's `app: "openmausbot"`.
- `omb_pair_`: the pairing credential prefix.
- `openmausbot-phone-credential-v1` and `OpenMausBot phone credential v1`:
  the phone credential encryption labels (#63). Changing them breaks
  credential entry.
- `https://openmausbot.invalid/` reserved origin in binaries.
- `openmausbot.sidebarCollapsedSections.v1` and
  `openmausbot.sidebarSectionOrder.v1` preference keys.

No visible text names the upstream: the install hint says
`sagax browser install` (the `sagax` bin of the npm package).

`scripts/check-ios-bundle-names.sh path/to/Sagax.app` fails on any other
"openmaus" in the built bundle; CI runs it after the simulator build.
