# iPad: visual parity with the desktop app

Date: 2026-10-02 · Status: awaiting review · Scope: iOS companion on iPad (`ios/`), the
references and the harness in `ios/parity/desktop/` · Branch: `feat/ios-desktop-refs`
(on `feat/ios-visual-parity`)

## Goal

Owner's requirement (2026-10-02): **the iPad version of the app must look exactly like the
Electron one.** The Electron app is the React renderer in `src/` (shell `electron/`,
server `server/`). Today the iPad shows the phone surfaces in readable columns
(`ios/App/CompanionLayout.swift`: roster 680 pt, chat 760 pt, header 900 pt, one
`NavigationStack`, no size-class logic). This spec is what the iPad build implements:
the references, the layout rules read from the renderer, the tokens and component sizes,
the interactions, the API gaps, and the SwiftUI architecture.

The phone keeps its own design (the 2026-10-01 iOS visual parity spec). The iPad
switches between the two by window width (see "Architecture").

**Exceptions, decided here:**

- **No fake macOS chrome.** The desktop's top 36 pt band is the macOS `hiddenInset`
  title bar (traffic lights at 16,16, drawn by macOS, not by the renderer). The iPad
  draws no title bar and no traffic lights. It keeps the band's **height** as its top
  inset, and the iPadOS status bar (24 pt) sits inside it. The diff masks the band.
- **No floating mascots.** "Put on the desktop" floats a bot into its own frameless,
  always-on-top Electron window (`electron/floating-bot-window.mjs`, 156x172). iPadOS has
  no such windows. The iPad hides that menu item; the mascots stay where the desktop
  also draws them (sidebar rows, pinned tiles, chat header pill, bot panel). The Hibou 98
  retro assistant (Konami code) is not ported either.
- **Pointer, not touch, is the reference.** The renderer has a `touch:` variant
  (`@media (hover: none), (pointer: coarse)`, `src/styles.css:15-19`) and a coarse-pointer
  composer font (13 to 16 pt, `src/styles.css:56-62`). An iPad would match both if it ran
  the renderer, but the references are the Electron window (fine pointer). The iPad uses
  the **fine-pointer** values (composer text 13/20) and adds touch affordances only where
  the desktop has a hover-only control (see "Interactions").

## The references

### How they are made

`ios/parity/desktop/capture-desktop.mjs` runs the renderer the way the Electron window
does and captures every surface at the four iPad viewports, at 2x:

| Viewport (pt) | Device | Reference prefix |
|---|---|---|
| 1366x1024 | iPad Pro 12.9/13-inch, landscape | `desktop-1366x1024-` |
| 1024x1366 | iPad Pro 12.9/13-inch, portrait | `desktop-1024x1366-` |
| 1194x834 | iPad Pro 11-inch, landscape | `desktop-1194x834-` |
| 834x1194 | iPad Pro 11-inch, portrait | `desktop-834x1194-` |

```sh
node ios/parity/desktop/capture-desktop.mjs                  # every viewport, surface and skin (~20 min)
node ios/parity/desktop/capture-desktop.mjs --viewport 1366x1024 --only 'chat|panel' --no-skins
node ios/parity/desktop/capture-desktop.mjs --list            # the surface ids
node ios/parity/desktop/capture-desktop.mjs --viewport 1376x1032,1032x1376,1210x834,834x1210   # M5 sizes
```

- **Server:** `ios/parity/fixture-server.mjs` (the real server on a throwaway data
  directory, the same dataset as the phone references), with
  `PARITY_OUT=ios/parity/desktop/out`.
- **Renderer:** Vite's dev server (`pnpm dev`) with its `/api` proxy pointed at the
  fixture. The renderer reaches its server at its own origin's `/api`, as the packaged
  app does. A loopback origin is the owner (`server/auth/request-auth.ts`, `LoopbackTrust`
  `owner`), so no token is involved.
- **Browser:** the installed Google Chrome, headless, driven over the DevTools protocol
  by `cdp.mjs` (Node's own `WebSocket` and `fetch`; the repository has no puppeteer or
  playwright). sRGB colour profile, language en-US (the phone references are English).
- **Bridge:** `bridge-stub.js` stands in for `electron/preload.cjs` and provides only
  what selects the UI, with a packaged macOS app's values: `platform: "darwin"`,
  `getCapabilities()` (`windowChrome: "mac-inset"`), `onCapabilitiesChanged`,
  `remoteClient: { active: false }` (this is the local desktop page, so the welcome
  flow and every local Settings section apply), and no-op `setUnreadCount` and
  `applySkin`. Every other member stays absent, so each feature behind the bridge takes
  its "bridge unavailable" path. Nothing in the stub paints.
- **First run:** set through the server's own `PUT /api/config` (`onboarding`), in three
  phases: fresh (welcome), welcome done (guided tour), everything seen (all the rest).
- **Each capture** starts from a fresh page load with cleared storage and its preset
  (`omb-skin`, `openmausbot.sidebarDensity`, `omb-show-threads`, `omb-language`), selects
  Ara, opens the surface through the renderer's store (the actions its buttons dispatch,
  reached through React's fiber; nothing is written to the server) or real
  pointer and keyboard events, waits for fonts and images, finishes finite animations,
  pauses infinite ones at their first frame, and hides the text caret.
- **Output (gitignored):** `ios/parity/desktop/refs/desktop-<W>x<H>-<NN>-<surface>.png`,
  a DOM dump `desktop-<W>x<H>-<NN>-<surface>.json` next to each, and `refs/index.json`
  (captured, skipped with reason, not capturable). The fixture text is placeholder and
  the files are large, so the refs stay out of git; the scripts are committed.

### The DOM dumps

Each `.json` holds:

- `tokens`: every CSS custom property on `:root` for the active skin (the `--color-*`,
  radii, fonts).
- `boxes`: every visible element that paints or holds text, in document order: tag,
  role, `aria-label`, `data-*` names, classes, own text, `rect` [x, y, w, h] in points,
  and the computed styles a SwiftUI reproduction needs (font family, size, weight,
  line height, letter spacing, colours, background, border widths, colours and radii,
  paddings, margins, gap, shadow, backdrop filter, opacity, z-index). Defaults are left
  out. `hit: false` marks a box covered by something else at its centre.
- `focusedField`: the focused text field's rect (the iPad diff masks its caret).

To read one: `jq '.boxes[] | select(.label == "Open agent profile")' refs/desktop-1366x1024-03-main.json`.

### Inventory

79 surface ids. 78 of them are captured at the four viewports (72 on the solo fixture,
6 on the organization fixture), plus the main window in the 10 other skins: **352
references** for both passes (the solo pass about 20 minutes), and 4 skips, each with its
reason (below). `NN` is the order in
`surfaces.mjs` (`--list`); the iPad screen id is the name without `NN`.

| NN | Surface (iPad screen id) | What it is |
|---|---|---|
| 01 | `onboarding-welcome` | first run: welcome flow, step 1 (owl, name and email, 6 dots) |
| 02 | `onboarding-tour` | guided tour, first spotlight (composer), "Step 1 of 9" |
| 03 | `main` | sidebar (comfortable) and Ara's chat. Also `03-main-skin-<skin>` for the 10 other skins |
| 04 | `main-compact` | sidebar density compact (one-line rows, 28 pt avatars) |
| 05 | `main-collapsed` | sidebar collapsed to the 80 pt icon rail |
| 06 | `main-threads` | Appearance > Show threads on: thread tree under each bot |
| 07 | `sidebar-row-hover` | pointer over a row: its actions |
| 08 | `sidebar-bot-menu` | a bot row's "Actions" menu |
| 09 | `sidebar-bot-context-menu` | right-click on a bot row (same items) |
| 10 | `sidebar-section-menu` | right-click on a section header: Add bots, Rename team, Share team, Delete team |
| 11 | `sidebar-profile-menu` | the account menu (Get Sagax for iOS, Settings, Keyboard shortcuts, About, Help Center) |
| 12 | `sidebar-new-menu` | New (+): compose-to picker (Create new Bot, Create group chat, bots with ⌘1-9) |
| 13 | `new-group` | compose-to picker in group mode |
| 14 | `search-palette` | command palette (⌘K), empty: bots list |
| 15 | `search-palette-query` | command palette with a query: message hits with highlights |
| 16 | `chat-top` | Ara's transcript scrolled to the top: links, day separators |
| 17 | `chat-attachments` | image tiles and file cards in the transcript |
| 18 | `chat-markdown` | reply with a table (CSV / Markdown actions), code block (Wrap, Save, Copy), list, quote |
| 19 | `chat-approval` | approval card ("Ara wants to run a command") and the pending-approval dock (Cancel turn, Deny, Always allow, Allow once) |
| 20 | `chat-question` | question card (AskUserQuestion: options with hints, Other, Submit answer) |
| 21 | `chat-message-hover` | pointer over a reply: its action row and time |
| 22 | `chat-composer-draft` | composer focused with a two-line draft, send button |
| 23 | `chat-composer-slash` | slash-command popup (`/learn`, `/setup`) |
| 24 | `chat-export-menu` | Export conversation menu |
| 25 | `chat-model-picker` | model picker (engine rail, scope, search, suggested models) |
| 26 | `chat-approval-mode` | approval-mode menu (Ask, Auto-accept edits, Approve for me, Command allowlist) |
| 27 | `chat-where-menu` | "where this conversation works" menu (bot setting, Cloud computer, Local VM, This computer) |
| 28 | `chat-find` | find in conversation (⌘F) with matches |
| 29 | `chat-threads` | thread picker (search, threads, New thread) |
| 30 | `inspector` | Inspector panel (Run log, Events, Raw) |
| 31 | `group-chat` | room chat (Peer Managers): bulletin, Goal chip, responder |
| 32 | `group-panel` | room panel: Details, Instructions, Advanced; people, bots, default responder |
| 33 | `panel-details` | bot panel, Details tab |
| 34 | `panel-avatar-editor` | character editor popover (Bot, Generate, Upload; character, colour, skin, style, moves) |
| 35 | `panel-routines` | bot panel, Routines tab |
| 36 | `panel-files` | bot panel, Files tab (filters, list) |
| 37 | `panel-computer` | bot panel, Computer tab (screen off, Allow control) |
| 38 | `panel-advanced` | bot panel, Advanced tab: searchable section list |
| 39-52 | `panel-advanced-<section>` | overview, soul, skills, memory, access, model, permissions, voice, history, usage; slack, sharing, perspicax (organization fixture), visibility (solo) |
| 53 | `routines-calendar` | Automations, week calendar, mini month, bots to drag |
| 54 | `routines-list` | Automations, list |
| 55 | `routines-logs` | Automations, run logs (empty state) |
| 56 | `team-map` | Team map canvas (zoom 49 %, zoom controls) |
| 57 | `templates` | Templates (team library) modal |
| 58 | `new-bot` | New Bot dialog (left nav, starting role, owl, name, label, description, team) |
| 59 | `plugins-apps` | Plugins: Connected apps (Marketplace, Connected) |
| 60 | `plugins-mcp` | Plugins: MCP servers (17 servers from the fixture) |
| 61 | `keyboard-shortcuts` | keyboard shortcuts sheet |
| 62 | `notice-thread-gone` | in-app notice banner ("That thread is no longer here") |
| 63-79 | `settings-<section>` | Settings: general, organization, appearance, experimental, connections (API keys), decisionModel, engines (Model providers), companion (Pair devices), computer (Local VM), usage, backups; `settings-general-scrolled` |

**Organization fixture** (`PARITY_ORG=1`, or `--org`:
`node ios/parity/desktop/capture-desktop.mjs --org [--viewport WxH] [--only <regex>]`).
`ios/parity/org-fixture.mjs` runs the server in organization mode (`SAGAX_IDENTITY=perspicax`)
against the repo's stub identity provider (`server/testing/fake-oidc-provider.ts`:
discovery, JWKS with an ES256 key made at start, authorize, token, revoke, directory,
token exchange; six placeholder people, two teams, three MCP profiles), signs in through
the real `/auth/oidc/start` flow as Alex Martin (admin), seeds Ara's sharing and MCP
profiles, adds a hosted workspace for Slack and a stub fleet agent with three
placeholder installations. The page is a served org page (no `remoteClient`). Without
the flag the fixture is unchanged. The org pass captures `panel-advanced-slack`,
`-sharing`, `-perspicax`, `settings-people`, `settings-activity`, `settings-workspaces`
(24 references, tagged `fixture: "org"` in `index.json`); the solo pass now also captures
`panel-advanced-visibility` (a non-organization server only) and `settings-mail`. After
both: **352 references**, 4 skips.

**Skipped, with the reason recorded in `index.json`:**

- `settings-cloudAccount`: needs the `cloudAccount` bridge (OMB Cloud, disabled in
  Sagax).
- `chat-approval-mode` returns a skip instead of failing when the composer has folded
  that control away (it did once at 834x1194; the final run captured it at all four).

**Not capturable from the renderer** (`index.json` `notCaptured`): the floating mascot
(own Electron window), the update banner (needs the updater bridge; the iPad updates
through the App Store), the launch screen (needs `orgJoin`/`serverMode`; the iPad pairs
instead), the Hibou 98 assistant.

## Layout, read from the renderer

### Breakpoints

Tailwind v4 defaults (sm 640, md 768, lg 1024, xl 1280); no custom breakpoints. What
switches by window width:

| Rule | Where | Effect |
|---|---|---|
| `< 768` (max-md) | `Sidebar.tsx:2149-2156`, `App.tsx:287-304` | sidebar becomes an overlay drawer with a hamburger at 12,12 and a 50 % black scrim |
| `< 1024` (max-lg) | `BotSettingsDialog.tsx:384,422`, `GroupPanel.tsx:129,167`, `InspectorPanel.tsx:194` | the bot panel, room panel and inspector stop docking and become `absolute` in the shell row (no resize handle). Measured: at 834 the bot panel sits at x 0, 360 wide, over the sidebar, with the chat still visible to its right; at 1024 it docks at x 664 |
| `< 768` | `ComputerPanel.tsx:1525,1543` | the standalone computer panel overlays (it docks from 768) |
| container `< 896` (`@4xl/chathead`) | `ChatView.tsx:1317`, `GroupView.tsx:1476`, `lib/compact-chip.ts` | chat header chips fold to 30 pt icon squares; the composer drops some controls |
| `< 640` (sm) | `SettingsModal.tsx:957,1008`, `NewBotDialog.tsx:216` | settings nav becomes a select; New Bot nav stacks |
| `max-width: 1023px` (matchMedia) | `bot-settings/FilesSection.tsx:282` | a file jump closes the panel (it covers the chat) |

Nothing else changes between 1024 and 1366. Electron's own window is 1100x780 by default
and at least **840x620** (`electron/window-state.cjs`), so **834 is below any designed
desktop state**: `desktop-834x1194-*` shows the renderer outside its range (the docked
sidebar is kept, panels overlay). The iPad treats 834 exactly as the renderer draws it.

### At each iPad width (default sidebar 280, default panel 360)

| Width | Sidebar | Content, no panel | Bot panel / inspector | Header chips |
|---|---|---|---|---|
| 834 | docked 280 | 554 | overlay at x 0, 360 wide (covers the sidebar) | folded |
| 1024 | docked 280 | 744 | docked 360, content 384 | folded |
| 1194 | docked 280 | 914 | docked 360, content 554 (inspector 460: 454) | full with no panel |
| 1366 | docked 280 | 1086 | docked 360, content 726 | full with no panel |

The transcript column caps at 960 (`ChatView.tsx:1482`), which only bites at 1366 with
no panel (or the icon rail at 1194 and up).

### Columns and sizes (measured in the DOM dumps at 1366x1024)

- **Sidebar** (`aside`, 0,0,280,1024, `--color-sidebar` `#060f20`, hairline right
  border 10 % ink): resizable 240 to 400 (`omb-sidebar-width-v2`), compact rows,
  `icons` rail 80. Top: the 36 pt title band, then the brand row (h 44: mark 22, "Sagax"
  16/20 semibold at x 46, New and Collapse 28 pt ghost squares), then the search field
  (8,86, 259x32, radius 8, 1 pt `#223353` border, fill 5 % ink, "Search..." 13/20,
  ⌘ K keycaps 11 pt). Pinned tiles: 72 pt mascot frames, name 11/16, title badge 10/16
  (radius 5, 1 pt border, fill 5 % ink). Section headers 11/16 medium, uppercase,
  tracking 0.44, `ink-secondary`, at x 20, chevron right. Comfortable rows: avatar 36, name 14/20 medium, title chip, preview
  13/18 `--color-ink-secondary`, min height 54, time right. Footer links 13/20 (Team
  map, Automations, Connected apps, Templates), account row 13/20 medium with a 28 pt
  initials circle.
- **Chat** (`main.app-glow`: `--color-app` `#030b17` with two radial accent glows from
  the top): header floats (min height 52, px 20): bot pill centred (radius full, 1 pt
  10 % ink border, fill `card`-ish `#0d1629`, mascot 20 + name 14/20 medium, 41 tall),
  right buttons 36x36 circles (Export, Inspector, panel toggle) at y 10. Transcript
  `px-5`, column max 960, `pt-14`, gap 12. Bot bubble: radius 18, 13/20, padding 12x7,
  fill `--color-card` `#0d192c`, max width min(80 %, 560, 100 %-82). User bubble: fill
  `--color-bubble-user` `#1e3358`, right aligned. Wide bubbles (tables, code) max
  min(94 %, 780, 100 %-82). Day separators 12 pt centred `ink-secondary`.
- **Composer**: dock padding `max(16, (100 %-960)/2)` and 16 at the bottom; pill min
  height 44, radius 22, fill `--color-composer` `#16233c`, 1 pt border 30 % ink, soft
  shadow; left icons (attach, approval mode, where), text 13/20, then model chip
  (13 pt, chevron), dictation, voice.
- **Bot panel** (`aside.app-docked-panel`, 1006,0,360,1024, background `--color-app`):
  36 pt band, top bar h 48 (back on Advanced, Export, Inspector, close), mascot 112
  (the Edit avatar button, 112x119 at y 60), name 17/24 medium, title 12/16
  `ink-secondary`, tabs (13/20, padding 6x4, radius 6,
  selected fill `elevated-hover` and `ink`, others `ink-secondary`), then the tab body
  (`px-4`). Resizable 320 to 720 (`omb-settings-panel-width`).
- **Settings modal** (233,162, 900x700 at 1366x1024: `min(900, 100vw-40)` x
  `min(700, 100dvh-96)`, radius 14, 1 pt 15 % ink border, background `--color-app`, a
  scrim): left nav 198 (search, items 13/18, 32 tall, radius 8, selected fill
  `#77777752`), content with cards (radius 12, 1 pt hairline).
- **Plugins** `min(800, 100vw-40)` x `min(700, 100dvh-96)`; **New Bot**
  `max 900` x `min(760, 94dvh)`, nav 160; **Command palette** max 560 x
  `min(480, 70vh)`; **Compose-to** `min(440, 100 %-24)` x `min(440, 70vh)`;
  **Keyboard shortcuts** `min(500, 100 %-32)`; menus 228 to 240 wide, min 200,
  radius 12, 0.5 pt border, fill `--color-menu`.

Exact numbers for every box are in the DOM dumps; the SwiftUI views take their sizes
from there, not from this summary.

### Skins and tokens

Skins are pure CSS custom properties (`src/styles.css`, one `[data-skin]` block each;
list in `src/lib/skins.ts`; default `pulsatrix`; stored as `omb-skin`). Main colours:

| skin | app | panel | sidebar | raised | card | menu | composer | hairline | ink | ink-secondary | accent | bubble-user | sidebar-selected |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pulsatrix | `#030b17` | `#060f20` | `#060f20` | `#16233c` | `#0d192c` | `#0d1729` | `#16233c` | `#223353` | `#eef2fb` | `#9aa6c2` | `#3c76f4` | `#1e3358` | `#4f86f729` |
| pulsatrix-light | `#eef2f8` | `#f6f8fb` | `#24324d` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` | `#b8c3d9` | `#0b1526` | `#545e6e` | `#2f62dd` | `#dceafe` | `#6b9bff38` |
| midnight | `#070707` | `#111111` | `#111111` | `#2f2f2f` | `#262626` | `#262626` | `#2f2f2f` | `#333333` | `#fcfcfc` | `#fcfcfc99` | `#d6d6d6` | `#5a5a5a` | `#77777752` |
| atelier | `#f5f1eb` | `#fbf8f2` | `#fbf8f2` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` | `#c8bda8` | `#1a1a18` | `#6b6559` | `#a05f25` | `#f2e9dc` | `#77777752` |
| foundry | `#100e0b` | `#171410` | `#171410` | `#262019` | `#1e1a14` | `#1e1a14` | `#262019` | `#3d3529` | `#f4efe4` | `#b0a696` | `#d99a3e` | `#2a2318` | `#77777752` |
| lagoon | `#dfeceb` | `#ecf4f3` | `#ecf4f3` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` | `#aebfbd` | `#14201f` | `#4d5c5b` | `#11736d` | `#cfe4e1` | `#77777752` |
| graphite | `#111214` | `#181a1d` | `#181a1d` | `#2a2d32` | `#22252a` | `#22252a` | `#2a2d32` | `#3b4048` | `#f2f4f7` | `#b3b8c2` | `#d0d4da` | `#30343a` | `#77777752` |
| linen | `#eceff3` | `#f5f6f8` | `#f5f6f8` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` | `#b4bbc5` | `#1d2229` | `#59616c` | `#2a2a2a` | `#e1e6ed` | `#77777752` |
| dusk | `#121014` | `#19161c` | `#19161c` | `#2b2630` | `#231f27` | `#231f27` | `#2b2630` | `#403847` | `#f4eff6` | `#b9afbd` | `#765683` | `#332b38` | `#77777752` |
| daylight | `#fcfcfc` | `#f7f7f7` | `#f7f7f7` | `#e1e1e1` | `#eeeeee` | `#fcfcfc` | `#fcfcfc` | `#d0d0d0` | `#0d0d0d` | `#575757` | `#2a2a2a` | `#070707` | `#77777752` |
| retro98 | `#ffffff` | `#c0c0c0` | `#c0c0c0` | `#c0c0c0` | `#c0c0c0` | `#c0c0c0` | `#ffffff` | `#808080` | `#000000` | `#3c3c3c` | `#000080` | `#ffffff` | `#00008033` |

- The full set per skin (every `--color-*`, radii, fonts, `--app-glow`) is in the
  `tokens` of `desktop-*-03-main-skin-<skin>.json` (and `03-main.json` for Pulsatrix).
  Derived tokens are `color-mix` of ink into panel (`elevated` 3 %, `hairline-weak`
  10 %, `border` 15 %, `border-strong` 30 %; `src/styles.css:203-217`). The SwiftUI
  token set takes the **computed** values from the dumps (Chrome resolves `color-mix`
  into `color(srgb ...)`), so no mixing has to be reimplemented.
- **Fonts:** Pulsatrix and Pulsatrix Light use **Geist Variable** (OFL-1.1,
  `@fontsource-variable/geist` 5.3.0, licence in `third_party/geist/OFL.txt`); the
  iPad bundles the same variable TTF. Other skins: Inter (midnight, foundry,
  graphite, dusk, daylight), system-ui (atelier, lagoon, linen), Tahoma (retro98). The
  Appearance font override (`skin`, `system`, `inter`, `poppins`, `serif`;
  `src/lib/fonts.ts`) applies on top.
- **Radii:** Pulsatrix 8/12 (`--radius-lg`/`xl`); per skin from 0 (retro98) to 8/14.
- **Layout skins:** Pulsatrix Light paints the shell navy and insets the content and
  panel as cards (8 pt margin, radius 12, `src/styles.css:1005-1140`); retro98 draws a
  title bar, menus, toolbar and status bar (`RetroChromeHost.tsx`, `styles/retro98.css`).
  Every other skin is tokens only.
- iOS today has no skins (`Theme.swift`: `bg #141414`/`#1C1C1E`, grey palette). The
  iPad adds them; the phone keeps its own palette.

## Interactions

### Pointer and hover

The iPad supports a pointer (trackpad, mouse), so desktop hover states stay:
`.onHover`/`.onContinuousHover` for state, `.hoverEffect(.highlight)` on buttons whose
desktop fill changes on hover (`hover:bg-hover`, `#7777772c`), `.pointerStyle(.link)`
where the desktop shows a hand. Hover-only controls (`group-hover:` reveals):

- sidebar rows: "+" new thread, folder +, "⋯" actions (`Sidebar.tsx:345,1466-1470`); the
  time fades out on hover (`:1375`);
- thread rows and the thread picker (rename, move, delete);
- transcript replies: the action row (copy, raw markdown, speak, regenerate, reply, pin)
  and the time (`MessageActions.tsx`, `ChatView.tsx:159`);
- table and code actions (CSV, Markdown, Wrap, Save, Copy), attachment previews, the
  compose-to picker's shortcut hints, the calendar resize handle.

With a pointer they appear on hover as on the desktop. **Without a pointer** (fingers
only) the same actions come from a long press (`.contextMenu`, the row's own menu items),
as the renderer's `touch:` rule makes them visible on a touch screen. The resize handles
(sidebar, panel) are pointer-only on the desktop; on iPad they accept a drag from either.

### Keyboard (hardware keyboard: `.keyboardShortcut`, shown in the iPadOS ⌘ overlay)

| Keys | Action |
|---|---|
| ⌘K | command palette |
| ⌘N | compose-to picker (new bot / group) |
| ⌘1 to ⌘9 | jump to bot N in the roster (in compose-to: pick row N) |
| ⌘⇧[ / ⌘⇧] | previous / next bot |
| ⌘F | find in conversation; Return / ⇧Return next / previous; Esc closes |
| ? or ⌘/ | keyboard shortcuts sheet |
| Return / ⇧Return | send / new line; Return again on a queued chip steers |
| ↑ in an empty composer | edit the last message |
| ↑ ↓ Return Tab Esc | @mention and slash popups, palette |
| Esc | close the panel, modal, find bar, recording |
| ⌘Return | save the room bulletin |
| ⌥↑ / ⌥↓ | move the focused sidebar section |
| ⌘, | Settings (the desktop's app menu) |
| Team map: + / - / 0 | zoom in, out, fit |

Source: `src/lib/keyboard-shortcuts.ts:27-94` and the handlers it cites. The Konami code
(Hibou 98) and push-to-talk (Ctrl+Option, needs the speech bridge) are desktop-only.

### Context menus

`.contextMenu` with the desktop's items, in the same order:

- bot row: Put on the desktop (**hidden on iPad**), Pin, Move to, Mark as Unread,
  Rename Bot, Copy conversation ID, Hide from sidebar, Delete (captured: 08, 09);
- thread row: Copy link, Rename, Regenerate title, Move to folder, Pin, Archive, Snooze
  (until activity, tonight, tomorrow), Delete;
- room row: Rename, Move to section, Copy conversation ID, Delete;
- section header (solo): Add bots, Rename team, Share team, Delete team (captured: 10);
  organization: New section, Rename, Delete;
- folder row: Rename, emoji, Delete.

### Drag and drop

HTML5 drag on the desktop; `.draggable` / `.dropDestination` (or `onDrag`/`onDrop`
with the same type identifiers) on iPad: sidebar sections (reorder, before or after by
the pointer's half), folders (reorder, move threads), Automations calendar (drag a bot
onto the grid, move an event, resize a call), Team map (drop a computer on a team),
files onto the composer (window-wide on the desktop: the whole chat column on iPad)
and team packages onto Templates. iPad adds drag from Files and Photos for free.

### Mascots

The desktop draws the bot's mascot in the sidebar rows (36/28/48), pinned tiles (72),
the chat header pill (20), the bot panel (112), the compose-to and palette rows, and the
character editor. The iPad reuses `ios/App/Mascots/` (`BotMascotView`, `CharacterEditor`)
at those sizes. They animate on both; the diff masks every mascot frame (positions from
the DOM dump) and the frames are compared by position. No floating mascots (see Goal).

## What the phone API does not expose

The iPad reaches its server the way the phone does: through the companion sidecar on a
personal computer (`companion/src/routes.ts` `ALLOWED`, default deny) or with a session
on a server (`server/auth/request-auth.ts`: `CLIENT_ALLOW` for a client session, anything
else needs `admin`). A phone paired with admin scope reaches the admin routes on a
server; the sidecar has no admin notion (a companion request reaches the harness as the
loopback owner, which narrows it further: bot and room `PATCH` to member fields).

**The reference for a paired iPad is the desktop's own remote-client mode** (owner,
2026-10-02). The Electron app can itself pair with another computer
(`electron/desktop-companion-client.mjs`): a loopback relay injects the device token and
forwards every `/api/*` call to that computer's sidecar, through the same `ALLOWED`
list, and the renderer runs with `window.ogb.remoteClient.active`. Whatever that
renderer shows, the iPad shows and can do through the same routes; whatever it hides,
the iPad hides. Audit (2026-10-02): every `/api/*` call in `src/` (263 method and path
pairs), the component that makes it, whether the component is reachable in remote-client
mode, and the two gates.

What remote-client mode changes in the renderer (every `remoteClient` gate in `src/`):

- **Bot panel:** `RemoteAgentSettingsPanel` replaces the tabbed panel (`App.tsx:376-382`):
  avatar upload and removal, name, title, description (`PATCH /profile`), voice and
  speak replies (`VoiceSettings`, workspace configuration locked), notifications, and
  the open chat's files. No Routines, Computer or Advanced tab; the Computer panel is
  `RemoteDesktopPanel` (viewer only). No Inspector.
- **Composer:** no approval-mode menu, no "where this conversation works" menu, no
  model picker (`Composer.tsx:1033,1045,1172`); no trusted thread access. Steer, queue,
  attachments, slash commands as on the host.
- **Chat:** no pin or unpin of a message (`ChatView.tsx:445,587,1437`), no Inspector
  button; renaming the bot goes through `PATCH /profile`.
- **Sidebar:** bot menu is Move to team (`POST /api/sidebar-sections`), Edit profile,
  Copy conversation ID, plus New thread and New folder when threads are shown
  (`Sidebar.tsx:933-951`); no pin, archive or delete. Room menu is Copy conversation ID
  only (no rename, move or delete). No section context menu (rename, share, delete
  team). No Templates, no Archived bots. Renaming a bot inline uses `PATCH /profile`.
- **Rooms:** no room setup (`setupPending` false, setup button disabled), bulletin
  read-only, no Manage members, no message pin, no auto-responder banner; the room is
  created with `setup: { defaultResponder: mentions }`.
- **New bot:** `CompanionNewBotDialog`, one Create button, no presets, defaults or
  sections (`NewBotDialog.tsx:69-74`).
- **Automations:** routines only (`RoutineCalendarPage.tsx:1621`): no calendar calls,
  no webhooks.
- **Team map:** read-only canvas (`canManage` false): no team menu, instructions,
  rename, delete, team computers; moving a bot inside its own team only.
- **Plugins:** Connected apps without the workspace key setup (`canConfigure` false);
  MCP servers list. The MCP panel still draws add, edit, test and delete, which the
  sidecar refuses (see "Remaining differences").
- **Settings:** Pair devices, Appearance and Organization only (`SettingsModal.tsx:838-861`);
  Organization shows the remote-computer card (the bridge's connection to the host),
  not enrollment. Pair devices draws `ServerPairingCard`, whose routes
  (`/api/auth/sessions`, `/api/auth/pairing`) the sidecar refuses.
- **Elsewhere:** no welcome flow or tour, no launch screen, no Cloud account, no Local VM
  workspace, no update banner; the "no engines" screen says to configure the host.

| Surface (remote-client mode) | Renderer calls | Sidecar | Client session | Final status |
|---|---|---|---|---|
| Boot, brand, stream | `GET /api/config`, `/api/events`, `/api/instances`, `/api/routines`, `/api/bots`, `/api/auth/session`, `/api/brand`, `/api/me/preferences` | yes (`/api/brand` added) | yes (`/api/instances` added, redacted; not on an organization server) | open |
| Sidebar: fleet, search, bot menu | `GET /api/search`, `PATCH /api/bots/:id` (unread), `PATCH /profile` (rename), `POST /api/sidebar-sections` (move to team) | yes | sidebar-sections: admin | open on the sidecar; filing stays admin on a server (no per-viewer check in the handler) |
| Sidebar: threads and folders | `POST/PATCH/DELETE /api/bots/:id/tasks*`, `POST .../tasks/:t/title`, `POST /api/bots/:id/projects`, `PATCH/DELETE .../projects/:p`, `PATCH .../projects/order` | yes (title and folders added) | tasks and title yes; folders admin | open on the sidecar; folders stay admin on a server (shared, no per-viewer check) |
| New bot, compose-to, new room | `POST /api/bots`, `POST /api/groups` | yes | yes | open |
| 1:1 chat and composer | `/api/bots/:id/messages` (+ edit, active-branch, compact, interrupt, read, queue cancel, **steer**, tasks, respond, cards, always-allow), `/api/threads/:id/messages`, reactions, export, file, attachments, `/api/files`, connector and secret cards, `claude-update` | yes (steer added) | yes (steer added) | open |
| Room chat | `/api/groups/:id/messages`, interrupt, read, queue cancel, **steer**, tasks, `PATCH /api/groups/:id` | yes (steer added) | yes (steer added) | open; setup, delete, members, bulletin hidden as on the desktop |
| Remote agent settings | `PATCH /api/bots/:id/profile`, `POST /api/attachments`, `GET /api/tts/voices`, `POST /api/tts/speak`, `GET /api/threads/:id/files*` | yes | yes | open |
| Remote desktop panel | `POST /api/bots/:id/computer/{control,join,screenshot,viewer-close}` | yes (per-device capability) | admin | open on the sidecar (unchanged) |
| Automations (routines only) | `/api/routines*`, `/api/routine-runs/:id/{cancel,seen}`, `/api/routine-runs/seen-all` | yes (seen-all added) | yes | open |
| Team map (read-only) | `GET /api/team-map`, `POST /api/sidebar-sections` (same-team move) | yes | team-map yes | open; editing hidden |
| Plugins: Connected apps, MCP list | `/api/connectors`, `/catalog`, `/connected`, `POST .../authorize`, `DELETE .../accounts/:id`, `GET /api/mcp/servers`, MCP OAuth start and status | yes | connectors and MCP: admin | open on the sidecar (unchanged) |
| Settings: Pair devices, Appearance, Organization | bridge `remoteClient`, local storage | n/a | n/a | iPad-local: its own pairing, skins, density |
| Rooms on a host without an organization | `GET /api/org` (remote role lookup) | no route (404) | yes | same outcome on a personal computer: the harness answers 404 `no_organization` |
| Hidden in remote-client mode | full bot panel (Overview, Soul, Skills, Memory, Access, Model, Permissions, History, Usage, Slack, Visibility, Sharing, Perspicax), Inspector, approval-mode and where menus, model picker, room setup and delete, team editing, Templates, presets and defaults, calendar calls, webhooks, every other Settings section | refused (as before) | as before (org routes for org members) | hidden on the iPad when paired through a sidecar |

Changed by this audit (`feat/ipad-phone-api`):

- Sidecar `ALLOWED` adds `GET /api/brand`, `POST /api/bots/:id/queue/:q/steer`,
  `POST /api/groups/:id/queue/:q/steer`, `POST /api/bots/:id/tasks/:t/title`,
  `POST /api/bots/:id/projects`, `PATCH|DELETE /api/bots/:id/projects/:p` (which also
  covers `PATCH .../projects/order`), `POST /api/routine-runs/seen-all`.
- `CLIENT_ALLOW` adds both steer routes (the harness now also refuses a steer to a
  read-only member of a shared room and, on a Cloud home, to a guest outside a
  conversation it started, exactly as it refuses their sends) and, except on an
  organization server (feature `serverCatalogue`), `GET /api/instances`,
  answered to a non-admin session through `clientInstanceView()` (names, models,
  capabilities, availability, billing; never CLI paths, install or sign-in commands,
  account addresses, update commands). `/api/me/engines` was already a client route on
  an organization server.
- Not opened, on purpose: `PATCH /api/groups/:id/setup` (hidden in remote-client mode,
  and it sets the room's folder), Overview and `/api/usage` for client sessions (not
  shown in remote-client mode), sidebar sections and folders for client sessions (no
  per-viewer check in their handlers), team-map editing, Templates, New Bot presets and
  defaults (all hidden in remote-client mode), and every host-only route (API keys,
  engines setup, Local VM, backups, pairing, MCP server writes). The phone still never
  changes approval mode or execution policy: the desktop remote client cannot either.
- Tests: `companion/test/routes.test.ts` ("desktop remote-client parity"),
  `companion/test/proxy.test.ts` (the new routes reach a real harness),
  `server/auth/request-auth.test.ts` (scopes, `clientInstanceView`),
  `server/engines/claude-account-api.test.ts` (a client session's `/api/instances`).
- `docs/ios-companion.md`: "Intentionally refused" rewritten (routines and connected
  apps cross; webhooks do not) and a "Same surface as the desktop remote client" table.

**Remaining differences, intentional:**

- The desktop remote client's MCP servers panel draws add, edit, test, import and delete;
  the sidecar refuses them (MCP servers run commands on the host). The iPad leaves them
  out rather than drawing controls that fail.
- Pair devices: the desktop remote client draws the server pairing card, which the
  sidecar refuses; the iPad shows its own pairing (forget, re-pair) there.
- On a server (client session), folders, team filing, Overview and Usage stay admin;
  an admin-scope pairing reaches them, as on the served web page.

**Rule for the iPad:** paired through a sidecar, the iPad shows exactly the
remote-client renderer's surfaces listed above (a section it cannot reach is left out,
never drawn disabled). Paired with a server, it shows what the served renderer shows for
the session's scope: a client session gets the client routes above (and the organization
surfaces on an organization server), an admin session everything.

## Mapping to the SwiftUI building blocks

| Desktop | Existing SwiftUI | Work |
|---|---|---|
| Tokens (`styles.css` skins) | `ios/App/Theme.swift` (phone palette, `Theme.Font`, `Theme.Metric`) | new `DesktopTheme` (per-skin colour set from the dumps, Geist font, radii); the phone `Theme` stays |
| Sidebar rows, pinned tiles, sections | `ChatListView.swift`, `HomeRoster.swift`, `CompactRoster.swift`, `BotThreadTree.swift`, `BotThreadRow.swift` | new `DesktopSidebar` with the three densities; reuse the roster model and thread tree |
| Mascots | `ios/App/Mascots/*` (`BotMascotView`, `CharacterEditor`, `OwlMascotView`, `ShapeMascotView`, `TrombiMascotView`), `CompanionCore` art | reuse at the desktop sizes |
| Chat transcript, bubbles, markdown, attachments | `ChatView.swift` (`MessageRow`, `TextBubble`), `MarkdownText.swift`, `AttachmentViews.swift`, `ChatChrome.swift` | desktop bubble metrics (13/20, radius 18, card fill), table and code blocks with their action rows |
| Approval, question, routine run, digest cards | `ios/App/Cards/*` (`QuestionCardView`, `RoutineRunCardView`, `DigestSheet`) | restyle to the desktop card and the pending-approval dock |
| Composer | `ChatView.swift` composer, `ios/App/Composer/*`, `KeyboardSuggestions.swift` | desktop pill (44, radius 22), approval-mode and "where" menus, model chip, slash and @ popups |
| Model picker | `AgentProfileView.swift` model catalogue | desktop picker layout (engine rail, scope) |
| Bot panel tabs | `Profile/BotProfileView.swift`, `ProfileComponents.swift`, `ProfileLibraryTabs.swift`, `Profile/RoutineDetailView.swift`, `BotOverviewView.swift`, `AgentProfileView.swift` | a docked `BotPanel` with Details, Routines, Files, Computer, Advanced |
| Computer tab | `ComputerView.swift`, `ComputerController.swift`, `ComputerInputViews.swift`, `CloudDesktopBrowser.swift` | panel-sized embedding |
| Search palette | `SearchSheet.swift` | centred palette 560 wide, ⌘K |
| Compose-to, new group, new section | `NewGroupSheet.swift`, `NewSectionSheet.swift` | compose-to popover anchored to New |
| New bot | `CreateBotSheet.swift` | desktop New Bot dialog (the iPad shows the sections it can save) |
| Settings | `SettingsView.swift`, `SettingsPages.swift`, `SettingsComponents.swift`, `ConnectedAppsView.swift` | modal with left nav 198 and desktop cards |
| Plugins | `PluginsView.swift` | desktop Plugins modal (Connected apps, MCP servers) |
| Routines, Automations | `TasksRoutinesView.swift`, `TaskManagerView.swift` | list and logs; the calendar is new |
| Team map, Inspector, Templates, keyboard shortcuts sheet | none | new |
| Notifications, updates | `Notifications.swift`, `UpdatesSheet.swift`, `Island.swift` (phone only) | desktop notice banner |

## SwiftUI architecture

- **A custom three-pane shell, not `NavigationSplitView`.** The desktop is a row:
  sidebar (fixed width, resizable, collapsible to an 80 pt rail), content, and a docked
  right panel that becomes an overlay below 1024. `NavigationSplitView` brings its own
  column widths, toolbars and iPadOS 26 glass sidebar and cannot express "dock at 1024,
  overlay below". So: `DesktopShell` = `HStack(spacing: 0) { DesktopSidebar; content;
  if docked { BotPanel } }` with the overlay case as a `ZStack` over the content column,
  widths from `@AppStorage` (sidebar 280, 240 to 400; panel 360, 320 to 720), drag
  handles 12 pt wide.
- **Navigation state** mirrors the renderer's store: `selectedId` (bot or room),
  `activeView` (chat, team map, routines), `panel` (closed, settings tab or section,
  computer, inspector), modal (settings, plugins, new bot, palette, compose-to,
  shortcuts, templates). One `@Observable` (or `ObservableObject` on iOS 16) owned by the
  shell; deep links and the parity launcher set it directly.
- **Sizing rules,** from the window width `w` (`GeometryReader` on the scene, not the
  device):
  - `w >= 768`: desktop shell. Sidebar docked.
  - `w >= 1024`: right panels dock; below, they overlay at the leading edge with
    their stored width, as measured (`desktop-834x1194-33-panel-details`).
  - content width `< 896`: chat header chips fold (container rule).
  - `w < 768` (Slide Over, a third of Split View, a narrow Stage Manager window, iPad
    mini portrait): **the phone UI**, unchanged. The switch is live as the window
    resizes; the selected conversation carries over.
- **Stage Manager and resizable windows:** declare `.defaultSize(1366, 1024)`
  (`CompanionLayout.defaultWindowSize`, defined but not applied today), support every
  size, and let the rules above follow the window. Multiple windows: each scene keeps its
  own selection (the desktop has one window; the iPad may open a second on a room).
- **Top inset:** the shell reserves 36 pt at the top of the sidebar and panel (the
  desktop band) and ignores the safe area elsewhere so the chat glow reaches the top,
  as on the desktop.
- **Pointer, keyboard, menus, drag:** as in "Interactions". Commands go in a
  `.commands` / `UIKeyCommand` set so the ⌘ overlay lists them.
- **Tokens:** `DesktopTheme` read from the environment, chosen by the Appearance skin
  picker; colour values from the dumps' `tokens`; Geist bundled.

## The iPad harness

```sh
ios/parity/desktop/capture-ipad.sh                    # build, all four viewports, every surface
ios/parity/desktop/capture-ipad.sh --skip-build main chat-approval
ios/parity/desktop/capture-ipad.sh --skins            # main-skin-* too (-paritySkin)
ios/parity/desktop/capture-ipad.sh --device m5        # iPad Pro (M5) sizes; refs must match
python3 ios/parity/desktop/diff-ipad.py [--gate] [--viewport WxH] [surface ...]
```

- **Devices:** the references' point sizes are those of the iPad Pro 12.9-inch (6th
  generation, 1024x1366) and 11-inch (4th generation, 834x1194), so those are the
  default simulators and a capture lines up point for point. The current iPad Pro (M5)
  is 1032x1376 and 834x1210 pt: `--device m5` uses it, with references made at those
  sizes (`capture-desktop.mjs --viewport 1376x1032,1032x1376,1210x834,834x1210`). The
  diff never rescales a capture to another size: a different width is a different
  layout.
- **Simulators** `parity-ipad13` and `parity-ipad11`, created on the newest iOS
  runtime, dark, status bar pinned, **deleted at the end** (`--keep-sims` to reuse).
- **Orientation:** iPadOS refuses `requestGeometryUpdate` in its windowing mode
  (`UISceneErrorDomain` 101, observed) and `simctl` cannot rotate, so one UI test
  (`ios/UITests/ParityOrientationUITests.swift`, skipped unless
  `TEST_RUNNER_PARITY_ORIENTATION` is set) turns the device with `XCUIDevice`; the
  device keeps the orientation for the captures. The app is therefore built with
  `build-for-testing`.
- **Screens:** `ios/App/ParityLaunch.swift`, `IPadParityScreen` (DEBUG launch argument
  `-parityIPadScreen <id>`, plus `-paritySkin`, `-parityOrientation`). The ids are the
  surface names of `surfaces.mjs`; `capture-ipad.sh` refuses to run when the two lists
  differ. Every id routes to `IPadParityPlaceholder` (the desktop's `#030b17` and the
  id) until its view exists: `IPadParityRoot` switches on the screen, and
  `IPadParityScreen.implemented` flips per screen as the work lands.
- **Diff:** `diff-ipad.py` imports the phone harness's `diff.py` (CIEDE2000, pass at
  dE00 <= 3, gate 98 %), rotates a portrait framebuffer to a landscape reference, and
  masks: the top 36 pt band (masks.json `_all`), per-surface rects (masks.json, keyed by
  surface id), every mascot frame and the focused field read from the reference's DOM
  dump. Sheets: `out/diff-ipad/<W>x<H>-<NN>-<surface>.png`.
- First run (2026-10-02, placeholders): 8 captures (`main`, `chat-approval` at the four
  viewports), scores 13.6 % to 33.6 % with 4.5 % to 7.9 % masked, as expected for a
  placeholder; sheets render reference, capture and heatmap side by side.

## Decisions (owner, 2026-10-02)

1. **834 portrait:** the iPad keeps the docked sidebar, as the reference shows (the
   renderer is below its 840 pt minimum there).
2. **Skins:** all 11, including Hibou 98 with its own chrome.
3. **Organization surfaces** (Slack, Visibility, Sharing, Perspicax; People, Mail,
   Activity, Workspaces): captured from the organization fixture (`PARITY_ORG=1`, see
   "Inventory").
4. **Paired client:** the iPad matches the desktop renderer in remote-client mode (see
   "What the phone API does not expose").
