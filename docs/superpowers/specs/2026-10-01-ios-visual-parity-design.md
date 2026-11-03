# iOS companion: visual parity with the reference app

Date: 2026-10-01 · Status: awaiting review · Scope: iOS companion (`ios/`), plus the
server and shared code the screens need · Branch: `feat/ios-visual-parity`

## Goal

Owner's decision (2026-10-01): the iPhone app must look **identical** to the 21
reference screenshots, screen for screen, in layout, sizes, colours, type,
mascots and behaviour.

**Two exceptions:**

- **Our brand.** "the reference design" becomes "Sagax", "Cursor account" becomes "Sagax
  account", and no third-party logo ships unless its plugin really exists in
  our catalog. Copying another product's name or marks would get the app
  rejected and is not ours to use.
- **Our mascots and our customization (owner, 2026-10-01).** Wherever the
  screenshots show their shape characters, we draw **our Sagax characters**
  with each bot's own stored look. The layout, sizes and placement stay
  identical; what sits inside a mascot frame or a picker is ours (see "Sagax
  mascots and customization" below).

## References

- **Screenshots:** `ios/parity-refs/01-home.png` to `21-bot-computer.png`. They are
  git-excluded (`.git/info/exclude`) because they show a personal photo, an
  email address and private conversations. They are iPhone @3x captures at
  1206x2622 px, which is 402x874 pt, the size of the iPhone 17 Pro simulator.
  To regenerate them, export the originals from Photos (HEIC) with
  `sips -s format png`.
- **Measurements:** in `assets/ios-visual-parity/`. All values are in pt, with
  accuracy of about ±0.33 pt for geometry and ±0.5 pt for font sizes.
  - `measure-home.md`: home, "+" menu, search, new group, create bot, and the
    mascot geometry.
  - `measure-chat-profile.md`: chat, computer, profile and its tabs, routine
    detail, instruction.
  - `measure-settings.md`: settings sheet, plugins, account, bot computer.

| # | Screen | # | Screen |
|---|---|---|---|
| 01 | Home | 12 | Settings (top) |
| 02 | Chat | 13 | Computer |
| 03 | Profile, Info | 14 | Settings (bottom) |
| 04 | Profile, Info scrolled | 15 | Plugins |
| 05 | Routine detail | 16 | Account |
| 06 | Routine instruction | 17 | New group chat |
| 07 | Profile "..." menu | 18 | Home "+" menu |
| 08 | Profile, Links | 19 | Search |
| 09 | Profile, Media | 20 | Create bot |
| 10 | Profile, Files | 21 | Bot computer |
| 11 | Computer, trackpad toast | | |

## Decisions (settled by "identical")

1. **Palette: ours.** We keep the 12 Sagax colours of `MAUS_COLORS`
   (`src/lib/mascot.ts`): green, blue, red, orange, purple, cyan, pink,
   yellow, teal, coral, white, black. Nothing changes on the server or the
   desktop. The reference's 11 hexes in `measure-home.md` are **not** used.
2. **Mascots: ours.** Every mascot frame draws the bot's own character from
   `bot.mascotLook` (`shared/mascot-look.ts`), as the desktop already does.
   iOS gets ports of the desktop renderers; nothing is redrawn to look like the
   reference. `measure-home.md` §6 (their shape geometry and eyes) is
   **not** applied. Only the frame sizes and positions from the measurements
   are used.
3. **Native remote control.** We build server input routes; noVNC is not used
   on the phone.
4. **Every row in the screenshots exists and works.** Where the server has no
   equivalent, we build it (see Server work).
5. **Appearance.** The default theme is dark "Black" (`#141414`). System
   follows the device; Light is a later pass and not part of the parity bar.

## Sagax mascots and customization

**What a bot can look like today.** These fields are stored with the bot and
shared by the desktop, the web and the phone:

| Field | Values |
|---|---|
| `mascotLook.character` | `owl` (the Sagax owl, the default), `shape` (the original shapes), `trombi` (the Hibou 98 paperclip) |
| `color` | the 12 `MAUS_COLORS`. Used by the owl and the shapes; Trombi has no colours |
| `mascotSkin` | owl skins: none, lightning, gold, neon, inferno, frost, carbon (`shared/mascot-skins.ts`) |
| `mascotLook.shape` | circle, blob, squircle, pill, triangle, hexagon, cloud, drop |
| `mascotLook.skins.shape` | plain, glossy, outline, neon, pastel, night |
| `mascotLook.skins.trombi` | classic, gold, neon, retro98 |
| `mascotLook.style` | 2d / 3d. The phone draws 2d; 3d stays a desktop option and is preserved |
| `avatarUrl`, `avatarCrop`, `avatarZoom`, `avatarFocusX/Y` | an uploaded or generated picture (`POST /api/bots/:id/avatar/generate`) with its framing; it replaces the character when the crop is not `mascot` |
| `mascotExpression` | the owl's or the shape's resting expression |

Today iOS draws none of these characters. `MausAvatar` only knows the
inherited Sagax bodies (`mascotBody`).

**iOS renderers** (new, in `ios/App/Mascots/`). Each takes `(bot, size,
state)`; one `BotMascotView` dispatches on the character and replaces
`BotAvatarView` everywhere.

- **`OwlMascotView`.** A port of `src/lib/owl/owl-art.ts`: the SVG parts and
  palette, colour and skin, the resting pose, blinks, and the
  working/success/alert states from `owl-state.ts`. Small sizes use
  `OWL_DETAIL_MIN_SIZE` exactly as the desktop does. Wing moves play on tap
  in the profile preview.
- **`ShapeMascotView`.** A port of `src/components/ShapeMascot.tsx` as it is
  (paths, eyes, the 6 skins).
- **`TrombiMascotView`.** A port of `retro-assistant/AssistantArt.tsx` and
  `Trombi.tsx` (4 skins).
- **The uploaded or generated picture**, with its crop and framing.
- **Placement.** The mascot sits in the frame the reference uses at that place
  (85 pt pinned, 42 pt row, 24 pt chat capsule, 84 pt profile, about 70 pt
  create preview).
- **Groups.** The pinned group composite uses the members' own mascots in the
  three-member layout of the reference.
- **Tests.** Port the desktop tests' expectations, plus snapshot tests of each
  character, skin and colour at 24, 42 and 85 pt, compared with renders of
  the desktop components.

**The Character card** (profile Info tab 03/04, and the create-bot sheet 20)
keeps the reference's card grammar: rounded `#202020` card, option rows
centred, 2 pt selection ring with a 2.7 pt gap, hairline, blue "Reset to
default", grey footer. The content is our editor, following
`floating-bots/MascotLookEditor.tsx`:

1. **Character row:** Owl, Shape and Trombi, three large thumbnails in the
   bot's colour.
2. **Shape row**, only for Shape: the 8 shapes as 2x4, exactly where the
   reference puts its shapes.
3. **Colour rows:** the 12 Sagax swatches as 6+6 on the reference's 53 pt
   pitch. Hidden for Trombi.
4. **Skin row:**
   - Owl: 7 skins.
   - Shape: 6 skins.
   - Trombi: 4 skins.
5. **Picture row:** "Photo": Upload (PhotosPicker), Generate (with direction
   text) and Remove, plus a framing view (pinch to zoom, drag to set the
   focus). It maps to `avatarCrop`, `avatarZoom` and `avatarFocusX/Y`.
6. **Reset to default:** the owl in green with no skin and no picture, the
   same values as the desktop reset (`BotProfileAvatarCard.tsx`).

Every choice saves at once through `patchBot` (`color`, `mascotSkin`,
`mascotLook`, `avatarCrop`, and so on). The phone-client allow list in
`server/auth/request-auth.ts` gains `mascotSkin`, `mascotExpression` and the avatar
framing fields.

**Our other customizations stay** inside the new layout:
- the Chief of Staff crown after the name;
- the "needs you" hand in the bot's colour and the working spinner in place
  of the time;
- the multiple-threads indicator;
- org channels as the home sections (Perspicax mode);
- the approvals island, Walkie and quick replies;
- French localization, where every new string goes into
  `Localizable.xcstrings` in en, fr and pt-BR.

The settings footer shows the Sagax owl (white) above "Sagax".

## Design tokens (`ios/App/Theme.swift`, new)

| Token | Value |
|---|---|
| `bg` | `#141414` (computer view `#000000`) |
| `card` | `#202020` |
| `hairline` | `#313131`, 1 pt, inset to the text column |
| `glass` | `#333333` fill (about 13% white over bg), 1 px top/bottom rim highlight, 1 px dark side rim. iOS 26 Liquid Glass when available, tuned to match |
| `chip` | `#252527` (role chip), `#2B2B2D` (Add pill) |
| `text` | `#FFFFFF` / secondary `#97969D` to `#9C9BA1` / tertiary `#575659` / placeholder `#6B6A6C` / chevron `#6B6A6D` |
| `toggleOn` | `#68CE67` |
| `blue` | `#2D6DE7` (actions), unread dot `#2D6BE3` |
| `destructive` | `#F49A96` (settings rows), `#FF7876` (menus) |
| `dim` | black 50% over the home behind a card sheet |
| Type | SF Pro, body 14 pt regular (18.1 pt line pitch), row title 13.5, labels and footers 11, header title 13.5 medium |
| Controls | Glass circle 44 pt (42 in sheets), 18 pt from screen edges, 8 pt apart. Card radius 16. Card sheet inset 8 pt, radius about 37 top / 50 bottom |

Odd font sizes (11.5, 13.5) are measured values: use them as is. Radii are
circle fits; apply continuous corners at about 12% less.

## Screens

Each screen lists what changes and where its data comes from. "Client" means
`ios/Sources/CompanionCore/Client.swift` and `Models.swift`.

### 01 Home, 18 "+" menu (`ChatListView`, `CompactRoster`)
- **Top bar.** The user photo opens the Settings card sheet. On the right are
  glass circles: search, then "+".
  - The "+" glass popover has two items: New Bot and New Group Chat.
  - The bottom floating bar goes. Updates, Walkie and New section move into
    Settings and long-press menus.
- **Pinned row.** Three equal columns of 134 pt with 85 pt mascots. The label
  sits under the mascot, followed by the unread dot.
  - A group shows three member mascots at 0.57x, separated by 5 pt
    background-coloured cut-outs.
  - Pin and unpin go through a new `patchBot(pinned:)`.
- **Sections.** A grey header with a `chevron.down` that collapses the section.
  The collapsed state is stored per device.
- **Rows.** 80 pt pitch, 42 pt mascot, name 14 medium, role chip (19 pt high,
  6.3 radius, `#252527`), tertiary time right. The preview line has a leading
  icon: `paperclip` for an attachment, `paperplane` for a message the bot sent
  to another bot.
  - No dividers, no chevrons.
  - `rosterPreview` returns a kind along with the text.
- **Density.** This layout is the only one in the parity build; Compact stays
  behind Settings, Advanced.

### 19 Search
- A full-height sheet starting 62 pt from the top: X glass, a "Search" glass
  capsule and a filter glass circle (Bots / Group Chats / Messages).
- Each row shows the mascot, the name, a type label ("Bot" or "Group Chat") on
  the right, and a subtitle with the first line of the bot's instructions.
- New: `Bot.instructionsLead` (server: the first line of the soul, added to the
  roster payload).

### 17 New group chat (`NewGroupSheet`)
- Header: X, the title, and a "Next" glass capsule (dimmed until two bots are
  picked).
- A "To:" token field filters the list, which shows bots as small mascot plus
  name. The keyboard is up on open.
- "Next" leads to a name step, then `createRoom`.

### 20 Create bot (new `CreateBotSheet`)
- A floating card sheet with a live preview of our mascot (owl by default)
  and a "Name your Bot" field.
- The pickers sit where the reference has its shape and colour grids: the
  Character card content (character, then shape for Shape, then the 12
  colours, then skin), with the selected ring (2 pt, 2.7 pt gap, `#545356`).
  - The picture (Upload, Generate) is set later, from the profile.
- The Create capsule is disabled grey until a name is entered.
- On submit: `POST /api/bots` with `name`, `settings.color` and, new on the
  server, `mascotLook` and `mascotSkin`, accepted at create time.

### 02 Chat (`ChatView`)
- **Top bar.**
  - Back glass circle.
  - Centred glass capsule (83x44) with a 24 pt mascot and the name in 14
    medium. A tap opens the profile.
  - Computer glass circle on the right.
  - The large header face, the Threads capsule and the slash-command button
    go. Threads move to the profile "..." menu and the slash commands to the
    "+" sheet.
- **Under the top bar:** blur and fade over y 36 to 116.
- **Bubbles.** The assistant bubble is `#202020`, radius 20, x 16 to 349, with
  no tail. Padding is 14 pt on the sides and 10 pt top and bottom.
  - Inline code is SF Mono 12 with no chip.
  - Bullets are 5 pt dots with the text indented 26 pt.
- **Composer.**
  - "+" glass circle and a 289x44 glass capsule with "Ask {name}".
  - A mic icon, and a white 36x28 capsule with a waveform that starts voice
    (Walkie).
  - Once there is text, the white capsule becomes send.

### 13 Computer, 11 Trackpad toast (`ComputerView`)
- **Layout.** Black background and a top bar: back, mascot plus name, "?"
  (gesture help), "..." (take/release control, open full screen, reset view).
  - The frame sits at y 166.7 to 417.7, full width (16:10).
  - Clipboard and keyboard glass circles (38 pt) sit under the frame.
- **Trackpad mode.** A relative pointer:
  - one finger moves, tap clicks, two-finger tap right-clicks, two fingers
    scroll;
  - a glass toast "Trackpad mode" shows when the mode starts.
- **Keyboard.** The keyboard button raises the system keyboard; keys stream to
  the remote.
- **Clipboard.** The clipboard button pushes the phone clipboard to the remote
  and pulls it back.
- **Server:** new input routes (see below). Frames keep coming from today's
  stream, at a higher rate while in control.

### 03, 04, 07, 08, 09, 10 Profile (new `BotProfileView`, replaces the `AgentProfileView` sheet)
- **Header.** Pushed in navigation: back, share, "...".
  - "..." menu: Copy ID, Threads, Advanced (model, voice, avatar image:
    today's fields), Delete Bot (red, confirm).
  - Delete calls a new `deleteBot`; the server already has
    `DELETE /api/bots/:id`.
- **Identity.** 84 pt mascot, a name card (name, hairline, role), then
  underlined tabs Info, Links, Media, Files (2x64.7 pt underline).
  - The role is the bot's title, or "Admin" for the Chief of Staff when no
    title is set.
- **Info tab.**
  - Character card: our editor (see "Sagax mascots and customization"), on
    the reference's grid (35 pt cells on a 60 pt pitch, 26 pt swatches on a
    53 pt pitch), with "Reset to default" and the footer. Every change saves
    at once.
  - Instructions row, to screen 06 showing the soul (`GET /api/bots/:id/soul`;
    editing goes through `patchBot(soul:)`).
  - Routines of this bot: a green clock when active, red when paused, a cron or
    human subtitle, and "+ Add routine" through `RoutineEditorView`.
  - Notifications toggle, saved at once.
  - Share as Template: a single-bot export (new server route), then the
    share sheet.
- **Links.** URLs from the bot's messages, newest first, deduplicated. Each row
  has a globe, the domain in bold and the full URL in 2 grey lines. "Show more"
  pages through. Server: new route.
- **Media.** A two-column grid of rounded image thumbnails from all the bot's
  threads, with "Show more". Data comes from `GET /api/threads/:id/files` and
  `?preview=1`, merged by a new per-bot route.
- **Files.** Non-image files from the same source, opened with Quick Look.

### 05 Routine detail, 06 Instruction (new `RoutineDetailView`, `TextCardView`)
- An "Active" toggle (`setRoutineEnabled`).
- Schedule card: the cron expression shown raw, and "Next run" (relative, or
  "due now").
- An Instruction row leading to 06.
- Run history filtered by `routineId`, with "No runs yet" when empty.
- Client: decode the `cron` schedule kind (`expression`, `timeZone`); today it
  falls to `.unknown`.
- Cards use 16 pt side margins on these two screens (24 on the profile).

### 12, 14 Settings (rebuilt `SettingsView`, card sheet over the dimmed home)
- **Account card:** photo, name, email, leading to 16 Account. Data from
  `GET /api/auth/session`; on a personal computer, the computer name and
  owner.
- **Usage %:** from `GET /api/usage` `budget.percent`; the row is hidden when
  the server returns null.
- **Plugins:** leads to 15.
- **Bot section:**
  - Auto-review: a global default with its subtitle. New server setting.
  - Auto-review Rules, with a count: the global plus per-bot saved command
    rules, in a list.
  - Set Time Zone Automatically and Time Zone: new server setting. When on,
    the phone sends `TimeZone.current.identifier`.
  - Bot Computer: leads to 21.
- **App section:**
  - Notifications as a toggle.
  - Appearance (System or Dark, then Black or Dim).
  - Language (System, English, Français, Português BR).
  - Haptics (On or Off; a new `PrefKey` wired into `PlatformBridge`).
- **Links:** Help Center, Privacy Policy, Terms of Service and Sagax Terms
  (Pulsatrix URLs), then Send Feedback (mail compose to support).
- **Sign Out** in red.
- **Footer:** a white mascot plus "Sagax".
- **Advanced** (a row at the bottom, not in the screenshots, needed to keep
  today's features): activity detail, intro animation, quick replies, list
  density, threads and routines, connected computers.

### 15 Plugins (rebuilt `ConnectedAppsView`)
- **Header:** back, title, and an "N installed" capsule with 3 stacked 19 pt
  icons.
- **Search:** a search capsule and a filter circle.
- **Sections:**
  - Featured: the curated catalog. This ships Part B of the 2026-09-30 MCP
    spec: `shared/plugin-catalog.json` and `/api/plugins/search`.
  - Team plugins: the organization's MCP servers and Composio apps.
- **Rows:** 38.5 pt icon tiles (radius 11.5), name, description, and an
  Add/Added pill.
- **Add from the phone:** an OAuth sign-in runs in `ASWebAuthenticationSession`
  against the server's OAuth start route. Where the spec required "sign in on
  your computer", the phone now does it.

### 16 Account
- Profile card.
- Switch Account: the paired computers and organization servers (from
  `ConnectionRegistry`), with a check on the current one, plus "+ Add Account"
  (pairing).
- Sign Out.
- Delete Account (red) with its footer.
  - Organization server: calls a new Perspicax-backed account deletion. It
    needs a Perspicax route and is gated by Perspicax policy.
  - Personal computer: forgets the pairing and erases this phone's data.

### 21 Bot Computer
- Update Computer (blue) and Reset Computer (red) with their descriptions;
  each asks for confirmation.
- The footer, and "Disk space: Normal / Almost full / Full" from
  `GET /api/me/server-environment`.
- Reset uses the existing `POST /api/me/server-environment/reset`.
- Update is a new route that rebuilds the sandbox from the latest image and
  keeps `/workspace`.
- On a personal computer, the computer is the local container: Update is
  today's image pull, Reset rebuilds from it.

## Server work

| Route / change | For |
|---|---|
| `POST /api/bots` accepts `mascotLook` and `mascotSkin` | 20 |
| Phone allow list (`request-auth.ts`): `mascotSkin`, `mascotExpression`, avatar framing; avatar upload/generate open to the bot's owner from the phone | 03, 04 |
| Roster payload: `instructionsLead` | 19 |
| `GET /api/bots/:id/links?cursor=` | 08 |
| `GET /api/bots/:id/files?kind=media\|file&cursor=` | 09, 10 |
| `POST /api/bots/:id/export` (single-bot template, package v2) | 03 Share |
| `POST /api/bots/:id/computer/input` (pointer, button, scroll, keys, text) and `GET/PUT .../clipboard`; control lease required | 13 |
| Settings: `autoReviewDefault`, `timeZone`, `timeZoneAuto` (`/api/me/preferences` or org settings) and routines use it | 12 |
| `GET /api/auto-review/rules` (global + per bot, count) | 12 |
| `POST /api/me/server-environment/update` | 21 |
| Account delete (Perspicax route + Sagax cleanup) | 16 |
| Plugin catalog Part B (`shared/plugin-catalog.json`, `/api/plugins/search`) + phone OAuth start | 15 |

Every new route gets tests in `server/` and keeps the phone-client limits in
`server/auth/request-auth.ts`: owner or admin only for delete, export, input, reset
and update.

## Client work (CompanionCore)

The following get new methods and `Codable` models, each with tests:

- `patchBot`, `deleteBot`
- `soul`
- `botLinks`, `botFiles`
- `exportBot`
- `computerInput`, `clipboard`
- `authSession`
- `usage`
- `preferences`
- `autoReviewRules`
- `serverEnvironment` (status, reset, update)
- `plugins`
- `cron` schedule decoding
- `Bot.mascotLook`, `Bot.instructionsLead`

## Phases (one branch and PR each, merged on the owner's GO)

1. **P0 Foundations:** `Theme.swift`; the Sagax mascots on iOS
   (`OwlMascotView`, `ShapeMascotView`, `TrombiMascotView`, picture, and the
   `BotMascotView` dispatcher, with `Bot.mascotLook`, `mascotSkin` and the
   framing fields decoded); the CompanionCore additions above that use
   existing server routes; and the parity harness.
2. **P1 Home** (01, 18) and **P2 Sheets** (19, 17, 20). These can run in
   parallel.
3. **P3 Chat** (02) and **P4 Profile, routines** (03 to 10, 05, 06). These can
   run in parallel.
4. **P5 Settings** (12, 14, 16, 21) and **P6 Plugins** (15).
5. **P7 Computer** (13, 11) with the input routes.
6. **Server routes** land with the phase that first needs them.

## Verification: the parity harness

- **Fixture server.** `ios/parity/fixture-server.ts` serves a fixed dataset
  shaped like the screenshots: the same bot names, sections, times and message
  lengths. Placeholder text replaces the private content, and a generic photo
  replaces the personal one. Each bot carries a Sagax look (owls, shapes,
  Trombi, in our colours).
- **Capture.** `ios/parity/capture.sh` boots an iPhone 17 Pro simulator (402x874
  @3x, the reference size), forces dark mode, the status bar (`simctl
  status_bar override`: 6:54, full bars) and the fixture, opens each screen
  through deep links, and saves `out/NN-name.png`.
- **Diff.** `ios/parity/diff.py` compares each capture with
  `ios/parity-refs/NN-name.png`.
  - Masked: the status bar, the regions whose text differs because of
    placeholder content, and **every mascot frame**, since our characters
    differ by design. A mascot is checked for its frame box only (size and
    position), and separately against the desktop render of the same look.
  - It reports a per-screen score and writes a heatmap.
  - **Gate:** at least 98% of unmasked pixels within ΔE 3, and no element box
    off by more than 1 pt.
- **Each phase PR** includes the side-by-side images for its screens, plus
  `swift test` (CompanionCore), the server tests, and `make ci` run locally.
- **the owner** checks each phase on a real device before the merge.

## Risks

- **Computer input** is the largest new surface. It is admin- or owner-only,
  control-lease gated, logged, and refused in org mode unless the policy
  allows it.
- **Account deletion** depends on Perspicax and may slip behind the rest. The
  row stays visible and explains it when the server says it is not available.
- **The owl port** (`owl-art.ts`, about 1,400 lines with its loop and
  skins) is the largest mascot job. P0 ships the resting pose, colours, skins
  and blinks first; states and wing moves follow in P4 with the profile
  preview.
