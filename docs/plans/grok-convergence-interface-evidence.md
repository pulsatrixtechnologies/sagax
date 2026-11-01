# Lot 5: Interface convergence evidence

Branch: `feat/grok-convergence-interface`. Worker: Grok CLI UI.
Pinned base: `81e0dd358a7db3b1a5b8be1559ddb03f8dc373be`.
Plan: [`2026-10-31-grok-convergence.md`](2026-10-31-grok-convergence.md).
Native audit steering: Root 2026-10-31 (Grok Bot 0.78.1 macOS, Sagax 0.8.23
macOS + iOS Simulator). Preserve WIP; no reset.

Evidence kinds used below:

- **Documented**: official Grok Bot docs checked 2026-10-31
  (files-and-results, chat-and-collaboration, approvals-security-and-privacy).
- **Source-derived**: Grok Bot 0.78.1 bundled renderer
  (`/Applications/Grok Bot.app/Contents/Resources/app.asar` extracted
  eager-app `index.eager-app-D1juOWZp.js` under
  `sagax-grok-convergence-complete/.omb-scratch/work/`). No user data or
  auth inspected. Key traces: `data-page-stage-chat`, j7O9JP Message about,
  NMXpiR Back to chat, framed/bare stage modes; canvas companion
  `chat-pane` is a different page kind from HTML/file.
- **Measured (native, Root)**: authenticated Grok macOS UI; Sagax 0.8.23
  iOS Simulator Page demo. Screenshots private (account data); geometry and
  control names only in this note. GrokBot iOS simulator absent; device
  mirroring timed out.
- **Measured (synthetic)**: Sagax gallery / vitest / Playwright + installed
  Chrome. Not native Electron/iOS qualification and not a live Grok
  comparative qualification.

Sagax strengths kept: identity/themes, multi-engine personal accounts, local
models, Pages comments/annotations/versions/sharing/windows, split
conversations, advanced routines, personal autonomy (no new admin gate on
own-sandbox page actions). Settings remain Sagax richer
(provider/local/skills/routine/actions/theme). Root measured Grok settings
as a separate modal (General, Computer, Permissions, Vault, Usage and
Billing, Updates) and a three-pane bot detail (Details / Library /
Computer); comparative measurements pending Root.

## Decision (after native audit)

Default Page path for published HTML = **stage**: page covers the mounted
chat; floating/docked composer on the page (`data-page-stage-chat=docked`).
Matches measured Grok HTML Library Pages and Sagax iOS 0.8.23 Page demo.
Documented "chat beside" and source-derived canvas `chat-pane` are **not**
the default for HTML/file. Optional **Show conversation** (beside) is a
deliberate Sagax richer control when the person asks and the ChatView host
is wide enough (host ResizeObserver). Justified in `page-chat-layout.ts`
and ChatView more-menu comments.

Visible composer placeholder stays **Message &lt;botname&gt;** (measured).
**Message about &lt;title&gt;** is the stage-chat aria-label only
(source-derived j7O9JP), wired in `Composer.tsx`.

## Surface matrix

| Surface | Acceptance | Status | Evidence |
| --- | --- | --- | --- |
| Pages HTML default (stage) | Full page in main frame; floating composer; no transcript beside at rest | Done (synthetic + aligned to measured) | Measured Root 2026-10-31. Implemented: `PAGE_CHAT_SURFACE_DEFAULT=stage`, `pageStageComposer`, PageSurface `footer` dock, `data-page-stage-chat=docked`. Synthetic: `pages-after-desktop-dark.png`, `pages-after-desktop-light.png`, integration dock. |
| Pages optional beside | Show conversation when host wide; host-narrow falls back to cover | Done (synthetic) | Deliberate Sagax control. `pageBesideChat` + host width. Menu: `pages.showConversation` / `pages.hideConversation`. Synthetic: `pages-after-desktop-beside-optional.png`; narrow host: `pages-after-narrow-pane-wide-desktop.png`, `pages-integration-narrow-pane-wide-desktop.png`. |
| Pages phone / narrow | Fullscreen page; close returns to exact chat/scroll | Done (synthetic) | Chat stays mounted under cover (`data-page-cover`, `inert`). Scroll place: `open-page` + mounted transcript. Synthetic narrow shots + DOM restore test. Physical iPhone: unmeasured. |
| Host-width (not window) | Beside/cover uses ChatView host width | Done | Review f1. `usePageChatHostWide` ResizeObserver. DOM: narrow pane on wide desktop covers. |
| Exchange sheet host | Portal into chat column; does not cover page | Done | Review f2. `exchangeColumnRef` on `data-chat-column`. DOM + integration: sheet contained in chat column. |
| Composer visible placeholder | Message botname while page open | Done | Measured. `composer-placeholder.ts` ignores pageTitle. Tests: `composer-placeholder.test.ts`, integration DOM. |
| Composer aria Message about | Stage-chat aria-label with page title | Done | Source-derived j7O9JP. `Composer.tsx` `composerAria`. |
| Page context on send | `dataContext.page` while page open | Already aligned | `withPageContext`; PageRefChip. Tests: data-context + integration send. |
| Updated below / live version | Stale card refreshes when thread has newer version; open latest | Done | Review f3. `threadLatestVersion` + `pageCardStatusWithThreadLatest`. DOM: `PublishedPages.card-refresh.dom.test.ts`. Deliberate version viewing preserved via explicit `version` on open. |
| Back to chat | Close control label | Done | Source-derived NMXpiR / measured. `pages.backToChat` on PageViewer close. |
| Comments / annotations / versions / sharing / windows / themes | Retain | Already aligned | PageViewer menus; PageShare; page-windows; skins. |
| Split conversations | Side chat does not steal the page panel | Already aligned | `openPage = side ? null`; `usePagePanelHost(bot.id, !side)`. |
| Navigation / palette | Common path usable | Already aligned | `palette-commands.ts`. |
| Composer busy send | Send while work in progress | Already aligned | steer/queue in Composer. |
| Files / attachments UI | Attachment control in composer | Already aligned for UI | Lot 4 owns limits/video. |
| Routines UI | Discoverable; richer Sagax kept | Already aligned | Routine calendar / conversation rows. Root measured Grok Details routine toggles; Sagax keeps richer controls. Unmeasured comparative geometry. |
| Approval feedback | Allow once / Always allow / Deny | Already aligned | PendingApproval. Root measured Grok Permissions Auto-Review / Always Ask / Allow without Asking; Sagax labels kept. Unmeasured comparative layout. |
| Settings shell | Sagax richer settings retained | Already aligned (Sagax) | Measured Grok: separate settings modal. Sagax keeps its settings surface + themes/providers. Comparative layout: unmeasured. |
| Bot detail panes | Sagax Library / Computer / richer tabs | Already aligned (Sagax) | Measured Grok: Details / Library / Computer three-pane. Sagax bot panel richer; comparative: unmeasured. |
| Keyboard / focus | Close reachable; chat inert when covered; Escape back; focus returns to the opener | Done (real ChatView DOM + headless) | Escape from the empty docked composer closes (PageSurface); focus goes back to the card or Library row that opened the page (ChatView, `Composer focusOnOpen`). `ChatView.page-real.dom.test.ts`, `after-capture.json`. |
| Light / dark / narrow / integration captures | Synthetic before/after on the real ChatView | Done | `scripts/capture-page-chat-real.mjs`, gallery `src/gallery/page-chat-real.html`, shots and DOM facts in `docs/screenshots/grok-convergence/real-chatview/`. Not native. |

## Review fixes (tip after 250053459)

1. Host-width beside/cover: Done.
2. exchangeColumnRef on chat column: Done.
3. PagePublishCard thread-latest refresh: Done.
4. Real-component integration DOM + gallery captures: Done (synthetic; not native).
5. Trace page-stage-chat; stage default; honest evidence: Done this note.

## Verification run (worker)

```
pnpm exec vitest run \
  src/lib/page-chat-layout.test.ts \
  src/lib/composer-placeholder.test.ts \
  src/lib/open-page.test.ts \
  src/components/PublishedPages.test.ts \
  src/components/PublishedPages.card-refresh.dom.test.ts \
  src/components/PageComposerParts.test.ts \
  src/components/ChatView.page-layout.dom.test.ts \
  src/components/ChatView.page-real.dom.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
node scripts/generate-locale.mjs --check
SAGAX_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node scripts/capture-page-chat-real.mjs
```

Full suite, verify:merge, native builds, push/PR: root integration only.
Root will open integrated Electron and current native iOS after these changes.

## Limitations (need real comparative / device evidence later)

- No side-by-side capture of live Grok Bot 0.78.1 at the same task state in
  this worktree (Root holds private native screenshots). Lot 6 owns
  measured comparative qualification.
- GrokBot iOS: simulator absent; mirroring timed out; real device pending Root.
- Phone scroll restore: architecture + unit/DOM; not a physical iPhone session.
- Attachment size limits and video generation remain lot 4.
- Settings modal / bot Details-Library-Computer geometry vs Grok: observed by
  Root, not re-implemented as a Grok clone; Sagax richer controls kept.
  Comparative measurements pending Root.
- Canvas / other Grok page kinds that activate companion chat-pane by
  default: source-derived only; Sagax HTML published pages stay stage
  default. No invented feature flag; optional beside is explicit person
  control.
- Pane width `min(26rem, 38%)` for optional beside is a Sagax choice pending
  a measured Grok canvas pane proportion.

## Commits

| SHA | Item |
| --- | --- |
| `9418aed4224caa7001b5c0b7dffd7565c4b7428a` | Initial beside/cover layout (later superseded default by stage) |
| `b04ba355cae94002ffb9a233518c82fdc2b071a5` | Message about + Updated below opens latest |
| `6be2f65b5b4efb28f8160fe23721d4bd65b445d8` | Synthetic gallery captures (pre stage-default) |
| `cd1157a189ef44ef61ece205ef289d9ed09111c7` | Evidence note (pre native audit rewrite) |
| `8a5c0e2eeb4d2f0b78dd234d3de89f3143753102` | Plan table row points at this evidence note |
| `250053459…` | Tip listed in evidence before review fixes |
| `c291aae2d1118bd36fa712769cebf484f6139cc8` | Stage-default Pages, host-width beside, docked composer, aria split |
| `1930b6f7a18a7bf6fc040aa5ab21b0e76d156059` | PagePublishCard thread-latest version refresh |
| `085028fd4ae3c40cb45b34dbe899d5f25252e2d7` | DOM fixtures + synthetic stage/beside/narrow captures |
| `2a39526c84a001e1191f7bf31fe83d2eedae5198` | Honest evidence rewrite + AGENTS Page view contract + self-knowledge |
| `1b0d131bc3bb1b1fc83ed1d172c541b5b8cf77ef` | Pin evidence rewrite SHA in the commits table |

Verification after those commits (touched files only):

```
pnpm exec vitest run \
  src/lib/page-chat-layout.test.ts \
  src/lib/composer-placeholder.test.ts \
  src/lib/open-page.test.ts \
  src/components/PublishedPages.test.ts \
  src/components/PublishedPages.card-refresh.dom.test.ts \
  src/components/PageComposerParts.test.ts \
  src/components/ChatView.page-layout.dom.test.ts \
  src/components/ChatView.page-real.dom.test.ts
# 8 files / 41 tests passed

pnpm exec tsc -p tsconfig.json --noEmit   # exit 0
node scripts/generate-locale.mjs --check  # catalogs valid
pnpm gen:self-knowledge                   # knowledge.generated.json refreshed
SAGAX_CHROMIUM="…/Google Chrome" node scripts/capture-page-chat-real.mjs
# stage after desktop: cover=true stage=true beside=false
# optional beside: beside=true
# narrow pane beside: cover=true beside=false hostWide=false
# integration: stage dock, sheetInChat=true, scrollTop=240, page send context
```

## Independent review, 2026-11-01

Fresh review of `81e0dd358..528c511d4` against the lot 5 end state found the
evidence weaker than claimed and four real defects:

1. **Stand-in evidence.** `ChatView.page-integration.dom.test.ts` and both
   galleries re-implemented ChatView (a fake textarea and Send button that
   computed the context themselves), so they could not fail on a ChatView
   regression. The "before" PNGs were byte-identical to the "after" ones.
   Replaced by `src/components/ChatView.page-real.dom.test.ts` (real
   ChatView, Composer, PageSurface, cards, store reducer; 10 cases) and a
   real-ChatView gallery and capture script with a true before from a
   checkout of `81e0dd358`. Three of the new cases fail on `528c511d4`.
2. **Composer dock not re-measured.** The dock moves onto the page (stage)
   and back, but `useComposerDockPad` observed only the first element, so
   after a page closed the transcript pad stopped following the composer's
   height. Now `useComposerDockPad(ref, pageStage)`.
3. **Keyboard.** The docked composer takes focus when the page opens, so
   Escape (ignored in text fields) no longer closed the page; on close,
   focus fell to the body. Escape in the empty docked composer now goes back
   to the chat (its own Escapes, including stopping dictation, prevent
   default), and focus returns to what opened the page.
4. **Visual.** The composer backdrop band was painted across the bottom of
   the page (the old over-page hide was dropped); at 390 px the title pill
   ran under « … ». Backdrop hidden on the stage dock; narrow page header
   keeps Share as an icon and gives the pill the room between buttons.

Also: the "Message about" accessible name came from a non-reactive read of
the open page in every composer of the bot; it is now a prop given only to
the docked composer, with the live title. Unused deprecated
`PAGE_CHAT_SIDE_MQ` and `pageTitle` placeholder input removed.

Before/after (real ChatView, synthetic): the base already drew the page over
the mounted chat with the floating composer, so the stage look barely
changes; the measured differences are the accessible name, Back to chat,
Escape, focus return, the superseded card opening the latest version (the
base sent `version: 1` from it), Show conversation, and the 390 px header.

Not in this lot (decision for JC): Grok collapses its sidebar to an icon
rail at 700 px; Sagax switches to its drawer below 768 px (`md`). Sagax has
an icon density already; making it automatic at 700 px is an app-shell
change, not done here. Decided and done 2026-11-01, see below.

## Sidebar rail at medium widths (JC decision, 2026-11-01)

Branch `feat/grok-convergence-sidebar`. Measured reference: Grok Bot 0.78.1
macOS window at 700 x 809 collapses its sidebar to icons, at 1338 x 809 it is
full (native audit above).

- **Breakpoints.** Below 640 px (Tailwind `sm`, the app's existing phone
  boundary: `sm:` sheet paddings, page reader and published page themes at
  640) the sidebar stays the drawer. From 640 to 767 px it is the icons rail,
  in the flow, automatically. From 768 px (`md`, the old drawer boundary) it
  follows the person's density. 640 rather than ~600 because it is the
  breakpoint the CSS already uses; a JS media query at an ad hoc 600 would
  disagree with the `max-sm:` drawer classes.
- **Preference.** `effectiveSidebarDensity(saved, viewport)` in
  `src/lib/sidebar-preferences.ts`; `useSidebarViewport()` follows
  `matchMedia`. The automatic rail is never saved: its edge (resize
  separator) and the rail's "full sidebar" toggle are hidden there, and ⌘B
  (`toggleSidebarCollapsed`) leaves the density as it is. Widening restores
  the saved density; a drawer left open closes when the window leaves phone
  width.
- **Reachability.** Rows keep their accessible names (name, status, unread)
  and tooltips; search and New stay named buttons. The rail's foot is now the
  wide foot's row stacked (`SidebarRailFoot`): a waiting update and active
  routines when there are any, the round apps-grid button (replacing the old
  Puzzle icon), then the avatar with its account menu, a keyboard ring and
  the place-attention dot. Mascots are the same single avatar component.
- **Shell.** `src/components/AppSidebar.tsx` (menu button, scrim, Sidebar),
  used by `App.tsx`; ChatView, GroupView and Team map leave room for the
  menu button below `sm` only.

| Surface | Status | Evidence |
| --- | --- | --- |
| 390 px drawer, person's density, Escape returns focus | Done | `AppSidebar.layout.dom.test.ts`, `w390-*` captures |
| 700 px automatic rail, saved density untouched, ⌘B inert | Done | same test, `w700-*` captures, `capture.json` |
| 1338 px person's full sidebar and a chosen rail | Done | same test, `w1338-*` captures |
| Widening 700 to 1338 restores the saved density | Done | DOM test, `w700-*-widened-1338.png` |
| Rail foot: avatar menu and apps grid named, focusable | Done | DOM test |

Captures: [`../screenshots/grok-convergence/sidebar/`](../screenshots/grok-convergence/sidebar/README.md)
(synthetic, headless; not native Electron).

```
pnpm exec vitest run src/components/AppSidebar.layout.dom.test.ts \
  src/lib/sidebar-preferences.test.ts src/components/Sidebar.*.test.ts \
  src/components/SidebarFoot*.test.ts src/components/SidebarProfileMenu*.test.ts \
  src/components/ChatView.*.test.ts src/components/GroupView*.test.ts \
  src/lib/keyboard-shortcuts.test.ts
# 61 files / 486 tests passed (+ 8 new DOM, 3 new unit)
pnpm exec tsc -p tsconfig.json --noEmit && pnpm exec tsc -p tsconfig.gallery.json --noEmit
pnpm exec oxlint --deny-warnings <touched files>
node scripts/generate-locale.mjs --check   # no new keys
node scripts/capture-sidebar-rail.mjs
```

Remaining: native Electron window at 700 px and a side-by-side with Grok at
the same width (Root); `pnpm check:unused` could not run in this worktree
(knip fails loading `cloudflare/control-plane/vitest.config.ts`, missing
`@cloudflare/vitest-plugin`).
