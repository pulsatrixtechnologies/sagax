# iOS feature parity matrix (iPhone and iPad vs the Electron renderer)

Date: 2026-10-03 (section 14 added 2026-10-08) · Status: inventory and plan, awaiting the owner review · Scope: `ios/` (iPhone
and iPad), with the sidecar (`companion/src/routes.ts`) and server (`server/auth/request-auth.ts`)
gates · Branch: `feat/ipad-desktop-parity`

## Why

Owner (2026-10-02): "the iOS version lacks a lot of the features of the Electron version. Since
we are working on iPad, improve the iOS (iPhone) version too, as long as the look of the chat
and interaction doesn't change. We need to be on parity with the features."

Two constraints frame every row below:

1. **iPhone look stays.** The chat, bubbles, composer and header match the phone reference
   screenshots (`docs/superpowers/specs/2026-10-01-ios-visual-parity-design.md`). New features
   enter through existing doors only: the composer "+" sheet (`ChatView.swift` `plusSheet`),
   long-press menus (message bubble `.contextMenu` at `ChatView.swift:1512`, chat rows
   `ChatListView.swift` `chatMenu`, thread rows), swipe actions, the bot profile
   (`Profile/BotProfileView.swift` tabs and its Advanced sheet `AgentProfileView.swift`),
   Settings pages, and sheets pushed from those.
2. **The reference for a paired device is the desktop remote client** (spec
   `2026-10-02-ipad-desktop-parity-design.md`, "Rule for the iPad"; `docs/ios-companion.md`,
   "Same surface as the desktop remote client"). Paired through a sidecar, iOS shows what the
   remote-client renderer shows. Paired with a server, iOS shows what the served renderer shows
   for the session's scope (client: `CLIENT_ALLOW`; admin: everything).

These two pull against the owner's "parity with the features": much of the Electron app is hidden
in remote-client mode (full bot panel, Inspector, approval mode, room setup, templates, most
Settings). The matrix therefore tags every feature with a **tier**, so the plan ships the
uncontroversial part first and isolates the policy decisions (see "Decisions for the owner").

## How to read the tables

Columns:

- **Desktop**: renderer component(s), paths under `src/components/` unless stated.
- **Routes**: the `/api` calls; `local` means local storage or store only; `bridge:` means an
  Electron preload member.
- **RC**: does the desktop remote client (`window.ogb.remoteClient.active`) show it. Y, N, or
  partial.
- **SC**: does the sidecar `ALLOWED` list let the route through (Y, N, partial).
- **CS**: client session on a server (`CLIENT_ALLOW`): Y, or `admin` (admin scope needed),
  or `org` (organization server only).
- **iPhone**: DONE, PARTIAL (what is missing in brackets), MISSING, P (phone-only extra, no
  desktop equivalent), N/A (not applicable to iOS). Swift paths under `ios/App/` unless they
  start with `Core/` (`ios/Sources/CompanionCore/`).
- **iPhone placement**: where it goes without changing the chat look (only when not DONE).
- **iPad**: the target. **Today the iPad shows the phone UI for every row** (one
  `NavigationStack` with readable columns, `CompanionLayout.swift`), so the iPad state equals
  the iPhone state everywhere. The column gives the desktop surface the iPad must reproduce
  (surface ids from `ios/parity/desktop/surfaces.mjs`, e.g. `chat-message-hover`) or `=`
  (same as iPhone placement inside the desktop shell).
- **T** (tier):
  - **A**: RC shows it and both gates already pass. Pure iOS work.
  - **B**: RC shows it (or iOS needs it for an RC surface) but a route is missing on the
    sidecar or in `CLIENT_ALLOW`. Server work first (package S1/S2).
  - **C**: RC hides it. Reachable for an admin-scope server pairing or an organization
    server. Ship behind the scope gate (`session.canAdminister` / org), never drawn disabled.
  - **H**: host only (bridge, host filesystem, API keys, Local VM, backups). Never on iOS.
  - **P**: phone-only extra that already exists.
- **Work**: server or sidecar change needed (`none` otherwise).

## 1. Sidebar and fleet (home list)

iPhone home: `ChatListView.swift`, `HomeRoster.swift`, `CompactRoster.swift`,
`BotThreadTree.swift`, `BotThreadRow.swift`, `Core/AttentionInbox.swift`,
`Core/RosterDensity.swift`, `Core/SectionSelection.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SB1 | Roster grouped by sections | Sidebar.tsx | GET /api/bots | Y | Y | Y | DONE (ChatListView, HomeRoster, CompactRoster) | | `main` | A | none |
| SB2 | Personal sections on an org server (#101) | Sidebar.tsx:1984-2032, OrgSectionMenu.tsx, lib/personal-sections.ts | synced pref `sagax.sidebarSections.v1` via GET/PUT /api/me/preferences | Y | Y | Y | MISSING (iOS reads only `bot.section`) | section header long-press > New, Rename, Delete; NewSectionSheet writes the pref on an org server | `sidebar-section-menu` (org items) | A | none |
| SB3 | New section (file bots) | TeamDialog.tsx | POST /api/sidebar-sections | partial | Y | admin | DONE (NewSectionSheet.swift, admin gated) | | `sidebar-new-menu` | A | none |
| SB4 | Rename, delete, edit bots of a section | TeamDialog, Sidebar.tsx:2615,2843 | PATCH/DELETE/PUT /api/sidebar-sections | N | N | admin | MISSING (NewSectionSheet can only add) | section header long-press > Rename, Edit bots, Delete (admin pairing) | `sidebar-section-menu` | C | none |
| SB5 | Share team | ShareTeamDialog.tsx | /api/teams/export | N | N | admin | N/A | | hidden | H | none |
| SB6 | Move bot to section | Sidebar MoveToSectionItem | POST /api/sidebar-sections | Y | Y | admin | DONE (chatMenu "Move to section") | | `sidebar-bot-menu` | A | none |
| SB7 | Collapse sections (synced) | Sidebar, pref `sidebarCollapsedSections.v1` | synced pref | Y | Y | Y | PARTIAL (device-local CollapsedSections in HomeRoster) | read/write the synced key | = | A | none |
| SB8 | Section order (drag, ⌥↑/⌥↓) | Sidebar, pref `sidebarSectionOrder.v1` | synced pref | Y | Y | Y | MISSING | section header long-press > Move up / Move down | drag + ⌥↑/⌥↓ | A | none |
| SB9 | Density comfortable / compact / icons rail | SettingsModal density row | local | Y | n/a | n/a | DONE (RosterDensity, Settings > Advanced > List density) | | `main`, `main-compact`, `main-collapsed` | A | none |
| SB10 | Show threads under each bot (global switch) | SettingsModal.tsx:596, lib/thread-preferences.ts | local `omb-show-threads` | Y | n/a | n/a | PARTIAL (per-bot disclosure in BotThreadTree, no global switch) | Settings > Appearance > Show threads | `main-threads` | A | none |
| SB11 | Pin / unpin bot, pinned tiles | Sidebar bot menu | PATCH /api/bots/:id {pinned} | N | Y | Y | DONE (chatMenu, Session.setPinned, Pinned row) | | pinned tiles in `main` | A (beyond RC) | none |
| SB12 | Pin room on home | (iOS extra) | PATCH /api/groups/:id {pinned} | n/a | Y | Y | P (Core/ClientHome.swift) | | = | P | none |
| SB13 | Unread dot, mark read on open | store.tsx:3560 | POST /api/bots/:id/read, /api/groups/:id/read | Y | Y | Y | DONE (BotThreadRow, Session.markRead) | | = | A | none |
| SB14 | Mark as unread | Sidebar bot menu | PATCH /api/bots/:id {unread} | N | Y | Y | MISSING | chat row long-press > Mark as unread; leading swipe | `sidebar-bot-menu` | A | none |
| SB15 | Needs-you attention list, answer approvals inline | SidebarAttentionPanel.tsx, PendingApproval | POST /api/bots/:id/respond | Y | Y | Y | DONE (ChatListView "Needs attention", UpdatesSheet, Island) | | attention panel | A | none |
| SB16 | Name search in the sidebar | Sidebar search | local | Y | n/a | n/a | DONE (ChatListView query) | | `main` search field | A | none |
| SB17 | Command palette with message hits (⌘K) | CommandPalette.tsx | GET /api/search | Y | Y | Y | PARTIAL (SearchSheet, no ⌘K) | | `search-palette`, `search-palette-query` | A | none |
| SB18 | Folders under a bot (view) | Sidebar | GET /api/bots (projects) | Y | Y | Y | DONE (CompactRoster, BotThreadTree, TaskManagerView) | | `main-threads` | A | none |
| SB19 | New folder, rename, emoji, delete | Sidebar folder row | POST/PATCH/DELETE /api/bots/:id/projects[/:p] | Y | Y | admin | MISSING | chat row long-press > New folder; folder header long-press > Rename, Emoji, Delete (TaskManagerView, CompactRoster) | folder row menu | A | none |
| SB20 | Reorder folders | Sidebar.tsx:1260-1306 | PATCH /api/bots/:id/projects/order | Y | Y | admin | MISSING | TaskManagerView edit mode `.onMove` | drag | A | none |
| SB21 | Bot menu: New thread | Sidebar | POST /api/bots/:id/tasks | Y | Y | Y | DONE (chatMenu, BotThreadTree) | | `sidebar-bot-menu` | A | none |
| SB22 | Bot menu: Edit profile / rename | Sidebar.tsx:1489 | PATCH /api/bots/:id/profile | Y | Y | Y | DONE (BotProfileView) | | = | A | none |
| SB23 | Copy conversation ID | Sidebar | local | Y | n/a | n/a | PARTIAL (BotProfileView.swift:536 copies `bot.id`, desktop copies the thread id) | chat row long-press > Copy conversation ID (thread id) | `sidebar-bot-menu` | A | none |
| SB24 | Put on the desktop (floating mascot) | Sidebar floatItem, floating-bots/ | local | Y | n/a | n/a | N/A (Island/LiveActivities are the phone analog) | | hidden (spec exception) | H | none |
| SB25 | Hide from sidebar, Hidden items list | Sidebar, SidebarHiddenSettings | synced pref `sagax.sidebarHidden.v1` | N for bots, Y for rooms and the list | Y | Y | MISSING (pref ignored) | row long-press > Hide; Settings > Appearance > Hidden from list | `sidebar-bot-menu`, settings-appearance | A | none. Since the DM close change (#219): a person DM is "Close" and never listed under Hidden; iOS follows in DC12 |
| SB26 | Archive bot, Archived bots, restore | Sidebar.tsx:2153, ArchivedBotsPanel | PATCH /api/bots/:id {hidden} | N | N (field refused) | admin | MISSING | Profile "..." > Archive; Settings > Archived bots (admin pairing) | as desktop | C | none (sidecar refuses by design) |
| SB27 | Delete bot | BotDeleteMenuItem | DELETE /api/bots/:id | N | Y | Y | DONE (BotProfileView "..." > Delete Bot) | | `sidebar-bot-menu` | A (beyond RC) | none |
| SB28 | Make primary bot | Sidebar.tsx:2178, PrimaryBotPicker | POST /api/bots/:id/primary | N | **N** | Y | MISSING | Profile "..." > Make primary; Settings > Primary bot | bot menu | B | S1: sidecar allow (owner check in handler) |
| SB29 | Footer places: Team map, Automations, Connected apps, Templates | Sidebar.tsx:2388-2420 | various | partial (no Templates) | | | PARTIAL (Automations and Plugins under Settings, no Team map) | see TM1, AU1, PL1 | sidebar footer | A | none |
| SB30 | Account menu (Your phone, Settings, Achievements, Shortcuts, About, Help) | SidebarProfileMenu.tsx:241-284 | various | partial | | | PARTIAL (Settings, Help, Terms) | Settings > About page (app, build, host versions) | `sidebar-profile-menu` | A | none |
| SB31 | Compose-to: new bot | ComposeToPicker, CompanionNewBotDialog | POST /api/bots | Y | Y | Y | PARTIAL (CreateBotSheet gated on `canAdminister`, CS allows it) | ungate for client sessions | `sidebar-new-menu` | A | none |
| SB32 | Compose-to: new room | ComposeToPicker | POST /api/groups | Y | Y | Y | DONE (NewGroupSheet) | | `new-group` | A | none |
| SB33 | Compose-to ⌘1-9, ⌘N | ComposeToPicker.tsx:166 | local | Y | n/a | n/a | MISSING | n/a (no hardware keys) | ⌘N, ⌘1-9 | A | none |

## 2. Chat: composer

iPhone composer: `ChatView.swift` (composer, `plusSheet` at :709, `QueuedSendList` at :2567),
`Composer/CommandSkillHUDView.swift`, `Composer/PredictiveActionChipsView.swift`,
`SpeechDictation.swift`, `Core/Client.swift` (`send` posts only `{text, threadId, sendId}`).

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CO1 | Send text, Return sends | Composer.tsx:688 | POST /api/bots/:id/messages | Y | Y | Y | DONE | | `chat-composer-draft` | A | none |
| CO2 | Reply to a message (quote strip above the composer) | ReplyQuote.tsx, Composer `replyTo` | POST messages {replyToId} | Y | Y | Y | MISSING (no `replyToId`) | bubble long-press > Reply; quote strip above the composer | hover row > Reply | A | none |
| CO3 | Attach image | ComposerAttachments.tsx | POST /api/attachments | Y | Y | Y | DONE ("+" > Photo Library) | | = | A | none |
| CO4 | Attach document | Composer.tsx:1066 | POST /api/files | Y | Y | Y | DONE ("+" > Choose File) | | = | A | none |
| CO5 | Paste image, long paste becomes a chip | Composer.tsx:764, composer-attachments.ts:434 | POST /api/attachments | Y | Y | Y | MISSING | paste handler on the field; "+" > Paste | = | A | none |
| CO6 | Drop files on the chat | ComposerAttachments.tsx:77 | /api/files, /api/attachments | Y | Y | Y | MISSING | n/a | `.dropDestination` on the chat column | A | none |
| CO7 | Folder / archive attach | composer-attachments.ts:16 | host path | partial | n/a | n/a | N/A | | | H | none |
| CO8 | Quote selected text as a citation | CitationUI.tsx, ChatView:1623 | local | Y | n/a | n/a | MISSING | SelectableTextSheet > Quote in reply | selection toolbar | A | none |
| CO9 | Slash menu: engine commands | ComposerCommandMenu.tsx, lib/harness-commands.ts | GET /api/bots/:id/harness-commands | Y | **N** | Y | PARTIAL (HUD hard-codes /computer, /threads and sends prose for diff, retry, steer) | "+" > Slash commands HUD filled from the route | `chat-composer-slash` | B | S1: sidecar allow GET harness-commands |
| CO10 | Sagax commands `/learn`, `/setup` | Composer.tsx:356-397 | send | Y | Y | Y | MISSING | same HUD | `chat-composer-slash` | A | none |
| CO11 | @mention autocomplete | MentionTextarea.tsx | local | Y | n/a | n/a | MISSING | suggestion strip while "@" is typed (PredictiveActionChipsView slot) | popup | A | none |
| CO12 | `#thread` reference autocomplete | ThreadRefs.tsx | local | Y | n/a | n/a | MISSING (rendering DONE) | same strip on "#" | popup | A | none |
| CO13 | Queue: edit, delete queued | ComposerQueuedMessages.tsx | DELETE /api/bots/:id/queue/:q | Y | Y | Y | DONE (QueuedSendList) | | queued chips | A | none |
| CO14 | Steer a queued message | ComposerQueuedMessages.tsx, store.tsx:3252 | POST /api/bots/:id/queue/:q/steer | Y | Y | Y | MISSING | queued row long-press / swipe > Steer now | Return on a queued chip | A | none |
| CO15 | Busy-send chooser (after, steer, parallel) | BusySendChooser.tsx | POST messages {busyMode} | Y | Y | Y | MISSING | confirmationDialog on send while busy | as desktop | A | none |
| CO16 | Interrupt the turn | Composer.tsx:1268 | POST /api/bots/:id/interrupt | Y | Y | Y | DONE ("+" > Interrupt) | | stop button | A | none |
| CO17 | Failed send: Retry | Composer.tsx:904 | resend | Y | Y | Y | PARTIAL (Dismiss only) | Retry on the banner | = | A | none |
| CO18 | ↑ edits the last message | Composer.tsx:1203 | edit route | Y | Y | Y | MISSING | n/a | ↑ in an empty composer | A | none |
| CO19 | Dictation | Composer mic (bridge) | bridge | Y | n/a | n/a | DONE (SpeechDictation) | | = | A | none |
| CO20 | Approval-mode menu, Full access warning | ApprovalModeSelector.tsx, FullAccessWarning.tsx | PATCH tasks {approvalMode} | **N** (Composer.tsx:1106) | Y | Y | MISSING | none (policy: phone never changes approval mode) | hidden when paired (`chat-approval-mode` only for admin) | C | none |
| CO21 | "Where this conversation works" menu (auto routing #86) | PlaceChip.tsx, WorkplaceNotice.tsx, LocalComputerAutoWarning.tsx | PATCH tasks {surface} | **N** (Composer.tsx:1119) | Y | Y | MISSING | read-only "Works on" line in the "+" sheet | `chat-where-menu` (admin only) | C | none |
| CO22 | Model picker | ModelPicker.tsx | PATCH /api/bots/:id/model | **N** in the composer | Y | Y | DONE in the profile (AgentProfileView:510) | | `chat-model-picker` (admin only) | C | none |
| CO23 | Quick replies, predictive chips | none | local | n/a | n/a | n/a | P (PredictiveActionChipsView, QuickRepliesEditor) | | = | P | none |
| CO24 | Compact the conversation | engine `/compact` | POST /api/bots/:id/compact | Y | Y | Y | MISSING | "+" > Compact conversation | slash menu | A | none |
| CO25 | Save a run as a skill (VerifyCard) | VerifyCard.tsx | local (fills draft) | Y | n/a | n/a | MISSING | strip above the composer | = | A | none |

## 3. Chat: transcript and message actions

iPhone: `ChatView.swift` (`MessageRow` :1433, bubble `.contextMenu` :1512 with reactions,
Copy, Select Text, Edit and retry; branch switcher :1495), `SelectableTextSheet.swift`,
`ActivityRunChip.swift`, `AssistantTurnChip.swift`, `Composer/TypingIndicatorView.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MS1 | Copy message | MessageActions.tsx | local | Y | n/a | n/a | DONE | | `chat-message-hover` | A | none |
| MS2 | Select text | browser | local | Y | n/a | n/a | DONE (SelectableTextSheet) | | native selection | A | none |
| MS3 | Raw markdown toggle | RawMarkdownToggle.tsx | local | Y | n/a | n/a | PARTIAL (Select Text shows source, no toggle) | long-press > View source | hover row | A | none |
| MS4 | Speak a reply | SpeakButton, lib/tts | POST /api/tts/prepare, /api/tts/speak | Y | Y | Y | MISSING | long-press > Speak | hover row | A | none |
| MS5 | Regenerate last reply | ChatView:1167 | POST .../messages/:m/edit | Y | Y | Y | MISSING (HUD "retry" sends prose) | long-press on the last reply > Regenerate | hover row | A | none |
| MS6 | Edit a user message (new branch) | ChatView:410 | POST .../messages/:m/edit | Y | Y | Y | DONE (alert "Edit and retry") | | inline editor | A | none |
| MS7 | Branch switcher ‹ 2/3 › | ChatView:604 | POST /api/bots/:id/active-branch | Y | Y | Y | DONE | | = | A | none |
| MS8 | Reply quote in the bubble, tap to jump | ReplyQuote.tsx | local | Y | n/a | n/a | MISSING (no `replyToId` decoded) | quote inside the bubble | = | A | none |
| MS9 | Pin message, pinned banner | ChatView:433,577,1436 | PATCH tasks {pinnedMessageId} | **N** | Y | Y | MISSING | long-press > Pin; strip under the header (if the owner lifts the RC rule, decision D2) | hover row (admin) | C | none |
| MS10 | Reactions on people's and bots' messages (2026-10-09): smiley in the hover bar, picker (8 quick + search), chips with count, mine highlighted, names in the tooltip | Reactions.tsx, MessageBar.tsx, GroupView tray | POST /api/threads/:t/messages/:m/reactions (toggle for the caller), live `message.patch` | Y | Y | Y | PARTIAL (emoji row in the long-press menu; chips count `actors`; mine only for an older `by: "user"`) | long-press > reaction row; chips under the bubble | keep | P | iPhone: highlight mine by the config viewer's principal, names on long-press of a chip |
| MS11 | Find in thread (⌘F) | ChatFindBar.tsx | GET /api/search?threadId= | Y | Y | Y | PARTIAL (global SearchSheet only) | "+" > Find in conversation (find bar over the header) | `chat-find` | A | none |
| MS12 | Export conversation | ExportTranscriptMenu.tsx | local | Y | n/a | n/a | DONE ("+" > Share transcript, GET /api/threads/:t/export) | | `chat-export-menu` | A | none |
| MS13 | Day separators | ChatView DaySeparator | local | Y | n/a | n/a | DONE | | = | A | none |
| MS14 | Jump to latest | ChatView jumpToLatest | local | Y | n/a | n/a | MISSING | glass arrow.down circle when scrolled up | = | A | none |
| MS15 | Load earlier | store | GET /api/threads/:t/messages?before | Y | Y | Y | DONE | | = | A | none |
| MS16 | Typing / working, live reasoning, activity runs, narration, tool chips | TurnPresence, ActivityRun, ActivitySection, TurnNarrationRun, ToolActivity | SSE | Y | Y | Y | DONE (TypingIndicatorView, AgentThoughtChamberView, ActivityRunChip, AssistantTurnChip, SkillExecutionReceiptView) | | = | A | none |
| MS17 | Bot-to-bot comm chip opens the room | ChatView ActivityChip | local | Y | n/a | n/a | PARTIAL (not tappable) | make the chip open the room | = | A | none |
| MS18 | Thread chip opens the thread | ThreadChip.tsx | local | Y | n/a | n/a | DONE | | = | A | none |
| MS19 | Collapse long user messages | ChatView:381 | local | Y | n/a | n/a | MISSING | lineLimit + Show more in the bubble | = | A | none |
| MS20 | "Sent mid-turn" marker | ChatView:496 | local | Y | n/a | n/a | MISSING | caption under the bubble | = | A | none |
| MS21 | Mention highlighting | MentionText.tsx | local | Y | n/a | n/a | MISSING | MarkdownText tints @names | = | A | none |
| MS22 | Routine execution banner (Logs, back) | ChatView:1411 | local | Y | n/a | n/a | MISSING | caption under the header | = | A | none |
| MS23 | Peer label on relayed lines | ChatView PeerLabel | local | Y | n/a | n/a | PARTIAL (rooms only) | small label above the bubble | = | A | none |
| MS24 | Inspector (Run log, Events, Raw) | InspectorPanel.tsx | GET /api/threads/:t/events | **N** | N | admin | MISSING | none (admin: "..." > Inspector sheet) | `inspector` (admin) | C | none |
| MS25 | Read receipts | SeenBy.tsx, read-receipts-feed.ts | GET/POST /api/threads/:t/read, `thread.read` | n/a | Y | Y | N/A | | | | none |
| MS26 | "Seen by" row with names (2026-10-09): label, up to 5 stacked avatars then +N, hover or focus shows "Name · time" | SeenBy.tsx (rooms, people, 1:1 with a bot) | GET /api/threads/:t/read (reader id and read time per thread) | n/a | Y | Y | DONE (DC52) | caption "Seen by" + faces under the last read line; long-press a face for the name and time | = | P | none |
| MS27 | Bot reactions (2026-10-09): react_to_message / remove_reaction, shown like a person's with the bot's mascot in the tooltip | Reactions.tsx | agents tool, /api/internal/reaction | n/a | Y | Y | DONE (DC52) | chip under the bubble | = | P | none |

## 4. Chat: threads (tasks) in a conversation

iPhone: `TaskManagerView.swift` (rename, pin, snooze, archive, bulk delete), `BotThreadTree.swift`,
`Core/ThreadNavigation.swift`, `Core/BotThreadSelection.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TH1 | Thread picker: switch, new, search | TaskPicker.tsx | POST/PATCH /api/bots/:id/tasks | Y | Y | Y | DONE (TaskManagerView, "+" > New thread) | | `chat-threads` | A | none |
| TH2 | Rename thread | TaskPicker, RenameTitle.tsx | PATCH tasks {title} | Y | Y | Y | DONE (TaskManagerView; not in BotThreadTree menu) | also in BotThreadTree menu | thread row menu | A | none |
| TH3 | Regenerate thread title | Sidebar.tsx:1249, store:3725 | POST /api/bots/:id/tasks/:t/title | Y | Y | Y | MISSING | thread long-press > Regenerate title | thread row menu | A | none |
| TH4 | Pin, snooze, archive, delete (bulk) | TaskPicker, SidebarThreadRow.tsx | PATCH/DELETE tasks | Y | Y | Y | DONE | | thread row menu | A | none |
| TH5 | Move thread to a folder | SidebarThreadRow.tsx:354 | PATCH tasks {projectId} | Y | Y | Y | MISSING | thread long-press > Move to folder | drag or menu | A | none |
| TH6 | Copy thread link | SidebarThreadRow.tsx:351 | local | Y | n/a | n/a | MISSING | thread long-press > Copy link (Core/DeepLink.swift) | thread row menu | A | none |
| TH7 | Thread status (waiting, working, queued, unread, closed by) | SidebarThreadRow.tsx:261,339 | GET /api/bots | Y | Y | Y | DONE (BotThreadRow) | | = | A | none |
| TH8 | Parallel task card with Stop | ParallelTaskCard.tsx, store:3349 | POST /api/bots/:id/parallel/:t/stop | Y | **N** | Y | MISSING (not decoded) | card in the transcript, Open and Stop | = | B | S1: sidecar allow parallel stop |
| TH9 | Threads in a conversation with a person, like a bot's (2026-10-09): switch, new, rename, pin, archive, snooze, move to folder, delete, folders; the pair shares the list, each has their own open thread and unread per thread; migrated "General" thread | TaskPicker.tsx `PersonThreadPicker`, Sidebar.tsx `PersonThreadList`, lib/person-threads.ts | POST /api/groups/:id/tasks, POST/PATCH/DELETE /api/groups/:id/tasks/:t, POST/PATCH/DELETE /api/groups/:id/projects(/:f, /order), POST /api/groups/:id/messages and /read and /api/nudges with `threadId`; header `x-sagax-person-threads: 1` | Y (org) | N | org | MISSING (the phone shows people DMs as one conversation: RM22; until ported it reads and writes the default thread, as a 0.4.16 client) | DM header thread button and long-press menus as TH1 to TH6 | `chat-threads` on a person | C | iOS port, not in the desktop PR; sidecar allow the group task and project routes |

## 5. Chat: cards and rich content

iPhone: `ChatView.swift` `CardView` :2302 and `CredentialRequestCardView` :1893,
`Cards/*.swift`, `MarkdownText.swift`, `Core/Markdown.swift`, `AttachmentViews.swift`,
`VoiceNoteBubble.swift`, `ClaudeUpdateCard.swift`, `WebhookMessageBody.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CA1 | Approval card: allow, deny | ApprovalCard.tsx, ApprovalParts.tsx | POST /api/threads/:t/respond | Y | Y | Y | DONE (CardView) | | `chat-approval` | A | none |
| CA2 | Always allow this tool | PendingApproval.tsx | POST /api/bots/:id/always-allow | Y | Y | Y | DONE | | dock | A | none |
| CA3 | Always allow for this session / this command | PendingApproval alwaysAllowSession, alwaysAllowCommand | respond, always-allow | Y | Y | Y | MISSING | extra buttons under the card | dock | A | none |
| CA4 | Allow all read-only, stepper over several pending asks | PendingApproval.tsx:441 | respond (many) | Y | Y | Y | MISSING | "Allow N read-only" and paging in the card | dock | A | none |
| CA5 | Cancel turn from the approval | PendingApproval.tsx:456 | POST interrupt | Y | Y | Y | PARTIAL ("+" > Interrupt only) | "Cancel turn" in the card | dock | A | none |
| CA6 | Skill request review (sha256) | SkillRequestPreview.tsx | respond {reviewedSha256} | Y | Y | Y | DONE | | = | A | none |
| CA7 | Question card (multi, Other) | QuestionCard.tsx | respond | Y | Y | Y | DONE (QuestionCardView) | | `chat-question` | A | none |
| CA8 | Option card: answer, dismiss | OptionCard.tsx | respond, PATCH /api/bots/:id/cards/:m | Y | Y | Y | PARTIAL (no dismiss) | card overflow > Dismiss | = | A | none |
| CA9 | Secret request: provide, already added, dismiss | SecretRequestCard.tsx | POST /api/bots/:id/secret-cards/:m/{provide,resume,dismiss} | Y | Y | Y | PARTIAL (provide only) | card buttons | = | A | none |
| CA10 | Connector card (connect an app in chat) | ConnectorCard.tsx | GET .../connector-cards/:m/status, POST authorize, resume, dismiss | Y | Y | partial (authorize admin) | MISSING (kind `connector` decodes as unknown) | card, Connect opens ASWebAuthenticationSession | = | B | S2: CLIENT_ALLOW connector-card authorize |
| CA11 | Access card (no engine or key) | AccessCard.tsx | local | Y | n/a | n/a | MISSING (kind `access` unknown) | card "Finish on your computer" | = | A | none |
| CA12 | Owner wait / settled | OwnerWait.tsx | SSE | Y | Y | Y | MISSING (`ownerName`, `state` not decoded) | inline status row | = | A | none |
| CA13 | Routine run card | RoutineRunCard.tsx | SSE | Y | Y | Y | DONE (RoutineRunCardView) | | = | A | none |
| CA14 | Goal run card (rooms) | GoalRunCard.tsx | message.goalRun | Y | Y | Y | MISSING | card in the room transcript | = | A | none |
| CA15 | Digest chip, compaction chip | DigestChip.tsx | local | Y | n/a | n/a | DONE (ReceiptChip, DigestSheet) | | = | A | none |
| CA16 | Turn access chip (which credentials paid) | DigestChip TurnAccessChip | local | Y | n/a | n/a | MISSING | line in DigestSheet | = | A | none |
| CA17 | Error row with Retry | ChatView ErrorRow | edit route | Y | Y | Y | PARTIAL (ClaudeUpdateCard only) | Retry on the error chip | = | A | none |
| CA18 | Claude update card | ClaudeUpdatePrompt.tsx | POST /api/instances/:id/claude-update | Y | Y | admin | DONE | | = | A | none |
| CA19 | Webhook message | ChatView webhookView | local | Y | n/a | n/a | DONE | | = | A | none |
| CA20 | Screen frame | ScreenFrame.tsx | GET .../messages/:m/image | Y | Y | Y | DONE | | = | A | none |
| CA21 | Code block: copy, save, wrap, highlight | ChatMarkdown CodeBlock | local | Y | n/a | n/a | PARTIAL (scroll and select only) | long-press on the block > Copy code, Share, Wrap | `chat-markdown` action row | A | none |
| CA22 | Diff rendering | ChatMarkdown | local | Y | n/a | n/a | DONE (GitPRDiffCardView) | | = | A | none |
| CA23 | Table: copy CSV / Markdown, sort | RichTable.tsx | local | Y | n/a | n/a | PARTIAL (grid only) | long-press on the table > Copy CSV, Copy Markdown | `chat-markdown` | A | none |
| CA24 | Chart block | ChartBlock.tsx | local | Y | n/a | n/a | MISSING | Swift Charts, table fallback | = | A | none |
| CA25 | Mermaid diagram | ChatMarkdown MermaidDiagram | local | Y | n/a | n/a | MISSING | source block + "Open on computer" | = | A | none |
| CA26 | Email draft card | EmailCard.tsx | local | Y | n/a | n/a | MISSING | card with Copy, Open in Mail | = | A | none |
| CA27 | Callouts, spoilers, footnotes, widget frame | ChatMarkdown | local | Y | n/a | n/a | MISSING (Markdown.swift: paragraph, list, task, heading, code, quote, table, rule) | new MarkdownText block kinds | = | A | none |
| CA28 | Inline markdown images | MarkdownImagePreview | /api/attachments/* | Y | Y | Y | MISSING | thumbnail via TranscriptAttachmentView | = | A | none |
| CA29 | Attachment tiles and file cards | AttachmentGallery.tsx | GET .../messages/:m/image, POST .../file | Y | Y | Y | DONE | | `chat-attachments` | A | none |
| CA30 | Preview: zoom, save, video, audio, PDF | AttachmentPreview.tsx | same | Y | Y | Y | DONE (QuickLook, ShareLink) | | = | A | none |
| CA31 | Conversation-wide lightbox (previous / next) | ConversationGallery.tsx | local | Y | n/a | n/a | MISSING | swipe paging in the preview | arrows | A | none |
| CA32 | Bot voice notes | VoiceNoteBubble.tsx | GET /api/attachments/*.mp3 | Y | Y | Y | DONE | | = | A | none |
| CA33 | Local file links | ChatMarkdown LocalFileLink | POST .../messages/:m/file | Y | Y | Y | DONE | | = | A | none |

## 6. Rooms (group chat)

iPhone rooms run in `ChatView.swift` (`.room`); creation `NewGroupSheet.swift`. The room header
opens Threads today (`ChatView.swift:645`), there is no room info surface. `Room` in
`Core/Models.swift:733-751` decodes `bulletin` but not `humanIds`, `routedBy` or `goalRun`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RM1 | Room transcript and send | GroupView.tsx | GET /api/threads/:id/messages, POST /api/groups/:id/messages | Y | Y | Y | DONE | | `group-chat` | A | none |
| RM2 | Create room with `setup: {defaultResponder: mentions}` | ComposeToPicker | POST /api/groups | Y | Y | Y | PARTIAL (no setup sent, Client.swift:1419) | send the RC setup | `new-group` | A | none |
| RM3 | Room threads new, switch, rename, delete, pin | store.tsx:3737-3761 | /api/groups/:id/tasks* | Y | Y | Y | DONE | | = | A | none |
| RM4 | Stop the room turn | store.tsx:3766 | POST /api/groups/:id/interrupt | Y | Y | Y | MISSING (ChatView.swift:849 bots only) | "+" > Interrupt in rooms | = | A | none |
| RM5 | Queued in a room: cancel, steer | store.tsx:3270,3278 | DELETE/POST .../queue/:q[/steer] | Y | Y | Y | PARTIAL (cancel only) | queued row > Steer now | = | A | none |
| RM6 | Room info panel: details, members, avatar stack | GroupPanel.tsx | local | Y | n/a | n/a | MISSING | room header tap > Room info sheet (Threads moves to a row in it) | `group-panel` | A | none |
| RM7 | Bulletin / instructions (read) | GroupView.tsx:1107, GroupPanel.tsx:256 | room field | Y (read-only) | Y | Y | MISSING (decoded, never shown) | Room info > Instructions | `group-chat` bulletin | A | none |
| RM8 | Room memory tab | GroupMemoryTab.tsx | GET/PUT /api/groups/:id/memory | Y | **N** | Y | MISSING | Room info > Memory | `group-panel` | B | S1: sidecar allow GET/PUT (or hide in RC, decision D3) |
| RM9 | Composer responder hint, @mention suggestions, coloured mentions | Composer groupComposerHint, MentionTextarea, MentionText | local | Y | n/a | n/a | MISSING | placeholder text; strip on "@" (CO11) | = | A | none |
| RM10 | Routed-by line | GroupView.tsx:464,488 | message.routedBy | Y | Y | Y | MISSING | message long-press > Info | = | A | none |
| RM11 | Room goal `/goal` and goal card | Composer.tsx:330, GoalRunCard.tsx | POST /api/groups/:id/messages | Y | Y | Y | MISSING | "+" > Goal; CA14 | = | A | none |
| RM12 | Room call (members in their own voices) | GroupCallView.tsx | /api/tts/*, groups messages, interrupt | Y | Y | Y | MISSING (Walkie targets bots, ChatView.swift:660) | "+" > Voice mode in rooms | call pill | A | none (after VO package) |
| RM13 | Copy room conversation ID, hide room | Sidebar room menu | local, synced pref | Y | Y | Y | MISSING | room row long-press | room row menu | A | none |
| RM14 | Rename room | Sidebar.tsx:517 | PATCH /api/groups/:id {name} | N | Y | Y | MISSING | Room info > Name (owner) | `group-panel` | C | none |
| RM15 | Move room to section | Sidebar.tsx:569 | PATCH {section} | N | Y | Y | MISSING | room row long-press > Move to section | room row menu | C | none |
| RM16 | Delete room | Sidebar.tsx:602 | DELETE /api/groups/:id | N | N | Y | MISSING | Room info > Delete (server owner) | room row menu | C | none |
| RM17 | Edit bulletin, pin message in room | GroupPanel, GroupView.tsx:177,1115 | PATCH {bulletin, pinnedMessageId} | N | Y | Y | MISSING | Room info > Instructions > Edit; message long-press > Pin | as desktop | C | none |
| RM18 | Manage bot members, people, leave | ManageMembersPanel, ChannelMembers, GroupPeoplePicker | PATCH {memberIds, humanIds}, GET /api/org/directory | N (partial for people) | Y (directory N) | Y | MISSING | Room info > Bots, People, Leave | `group-panel` | C | none |
| RM19 | Default responder / turn-taking | GroupView.tsx:500-543 | PATCH {defaultResponder} | N | N (refused) | org owner | MISSING | Room info > Who answers (server owner) | `group-panel` Advanced | C | none |
| RM20 | Room setup, working folder, turn timeout | GroupView setupPending, :577 | PATCH /api/groups/:id/setup, {cwd}, PUT /api/config | N | N | admin | N/A | | | H | none |
| RM21 | Person author label, person sheet | GroupView.tsx:478, PersonPanel | GET /api/org/directory | Y (org) | N | Y | MISSING | tap author > person sheet (org server) | as desktop | C | none |
| RM22 | People DMs | store.tsx:3585 | POST /api/people-dms | Y (org) | N | Y | MISSING (dm rooms filtered, ChatListView.swift:1277) | home Messages section; "+" > Message a person | compose-to people | C | none |

## 7. Bot panel (profile)

iPhone: `Profile/BotProfileView.swift` (tabs Info, Links, Media, Files; Routines card; "..."
menu), `Profile/ProfileLibraryTabs.swift`, `Profile/RoutineDetailView.swift`,
`AgentProfileView.swift` (Advanced sheet: identity, model, voice, notifications, overview link),
`BotOverviewView.swift`, `Mascots/CharacterEditor.swift`, `ComputerView.swift`,
`ComputerInputViews.swift`, `CloudDesktopBrowser.swift`. The desktop remote client replaces
the whole tabbed panel with `RemoteAgentSettingsPanel.tsx` (avatar, name, title, description,
voice, notifications, the chat's files). The iPhone already exceeds that in several places.

### 7a. Identity, character, details

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BP1 | Name, title, description | BotSettingsDialog.tsx:478-496, RAS:112-118 | PATCH /api/bots/:id/profile | Y | Y | Y | DONE (AgentProfileView) | | `panel-details` | A | none |
| BP2 | Upload / remove picture, crop shape | BotProfileAvatarCard.tsx | POST /api/attachments, PATCH {avatarUrl, avatarCrop} | Y | Y | Y | DONE | | `panel-avatar-editor` | A | none |
| BP3 | Frame picture (zoom, focus) | AvatarFraming | PATCH {avatarZoom, avatarFocus*} | N | Y | Y | DONE (PictureFramingSheet) | | = | A (beyond RC) | none |
| BP4 | Generate a picture | AvatarImageGenerator.tsx | POST /api/bots/:id/avatar/generate | N | Y | Y | DONE | | `panel-avatar-editor` Generate | A (beyond RC) | none |
| BP5 | Character, shape, colour, reset | floating-bots/MascotLookEditor.tsx | PATCH {mascotLook, color} | N | Y | Y | DONE (CharacterEditor) | | `panel-avatar-editor` | A | none |
| BP6 | Skin with tier tabs and achievement locks | MascotLookEditor.tsx:456 | PATCH {mascotSkin} | N | Y | Y | PARTIAL (character row hides locked characters including crab until character:crab; worn stays; skin row still has no tier tabs) | lock badges in the skin row | = | A | none |
| BP7 | Style 2D / 3D | MascotLookEditor.tsx:460 | PATCH {mascotLook.style} | N | Y | Y | MISSING (`MascotLook.style` already modelled) | Character card > Style segmented row | = | A | none |
| BP8 | Play a move | MascotLookEditor.tsx:556 | local | N | n/a | n/a | PARTIAL (tap cycles owl moves) | long-press mascot > Moves | = | A | none |
| BP9 | Read-only notice (shared for use only), proposal status | BotSettingsDialog.tsx:470, ProposalStatus.tsx | GET /api/config | N | Y | Y | MISSING | banner on the Info tab | = | A | none |
| BP10 | Activity: what the bot is doing, history, detail, stop, steer, open thread | bot-settings/ActivitySection.tsx, ActivityListModal, ActivityDetailModal | GET /api/bots/:id/activity[/item], interrupt, messages | N | **N** | Y | MISSING | Info tab > Activity card > See all > detail | `panel-details` | B | S1: sidecar allow GET activity |
| BP11 | Routines list, create, edit, pause | RoutinesSection.tsx | /api/routines* | partial | Y | Y | DONE (Routines card, RoutineDetailView) | | `panel-routines` | A | none |
| BP12 | Delete a routine from the profile | RoutinesSection.tsx | DELETE /api/routines/:id | N | Y | Y | PARTIAL (only in TasksRoutinesView) | RoutineDetailView menu > Delete | = | A | none |
| BP13 | Package provenance | PackageProvenance.tsx | GET /api/org-library | N | N | admin | MISSING | Info tab footer line | = | C | none |
| BP14 | Per-bot usage | bot-settings/UsageSection.tsx | local (task usage) | N | n/a | n/a | MISSING (`BotTask.usage` not decoded) | Advanced > Usage | `panel-advanced-usage` | A | none |

### 7b. Library (files), computer

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BF1 | Files of the open chat | FilesSection.tsx, RAS:145 | GET /api/threads/:id/files[/:f] | Y | Y | Y | PARTIAL (bot-wide Media/Files tabs via GET /api/bots/:id/files; ClientParity.threadFiles unused) | Files tab > "This thread" filter | `panel-files` | A | none |
| BF2 | Links library | none | GET /api/bots/:id/links | n/a | Y | Y | P (LinksTab) | | keep | P | none |
| BF3 | Search, filter, sort files | FilesSection.tsx | local | Y | n/a | n/a | PARTIAL (kind split only) | `.searchable`, Sort menu | `panel-files` | A | none |
| BF4 | Copy path, show in chat | FilesSection.tsx | local | Y | n/a | n/a | MISSING | file row long-press | = | A | none |
| BC1 | Live screen preview | remote-desktop-panel.tsx, CloudScreenPreview | POST /api/bots/:id/computer/screenshot | Y | Y | admin | DONE (ComputerView) | | `panel-computer` | A | none |
| BC2 | Open the live desktop, take / give back control | remote-desktop-panel.tsx, DesktopViewer | POST computer/{control,join,viewer-close} | Y | Y | admin | DONE (CloudDesktopBrowser, ComputerView menu) | | = | A | none |
| BC3 | Native input, clipboard | none | POST computer/input, GET/PUT computer/clipboard | n/a | Y | admin | P (ComputerInputViews) | | keep | P | none |
| BC4 | Computer status and phase | ComputerPanel.tsx:356 | GET /api/bots/:id/computer | N | N | admin | PARTIAL ("no computer", "Offline") | empty state with the phase | = | C | S1 optional: sidecar allow GET (read-only) |
| BC5 | Where the bot works, VM create/remove, VPS start/sleep, this Mac preview, Android, browser panel | ComputerPanel, WorksOnSetting, LocalScreenPreview, AndroidDevicePanel, BrowserPanel | various | N | N | admin | N/A | | | H | none |
| BC6 | Org server environment: power, stats, sandbox desktop | computer/OrgComputerTab.tsx, SandboxDesktopView | GET/POST /api/me/server-environment*, /api/desktop-viewer/sandbox/me | N | partial | org | PARTIAL (Settings: GET and reset) | ComputerView card for an org bot, "..." > Start / Stop | = | C | none |

### 7c. Advanced sections (hidden in remote-client mode)

All of these are **N** in RC. On a sidecar pairing they stay hidden unless the owner lifts the rule
(decision D1). On an admin-scope server pairing they ship behind `canAdminister`.

| ID | Feature | Desktop | Routes | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|
| BA1 | Overview (Does, Can reach, App tools, Won't, Recent changes) | OverviewSection.tsx | GET /api/bots/:id/overview | Y | admin | DONE but **not gated** (AgentProfileView.swift:253 fails for a client session) | gate on canAdminister for server pairings | `panel-advanced-overview` | C | none |
| BA2 | Prompt preview | PromptPreview.tsx | GET /api/bots/:id/system-prompt | N | admin | MISSING | BotOverviewView > Prompt preview | = | C | S1 if D1 |
| BA3 | Soul / instructions view and edit | SoulSection.tsx | GET /soul, PATCH {soul} | Y | owner | DONE (InstructionView) | | `panel-advanced-soul` | A (beyond RC) | none |
| BA4 | Skills: list, review, enable, remove, import, org library | SkillsSection.tsx, OrgSkillsCard.tsx | /api/bots/:id/skills*, /api/org-library/skills | N | admin | MISSING | Advanced > Skills list (toggle, swipe delete, "+" import admin) | `panel-advanced-skills` | C | S1 if D1 |
| BA5 | Memory: on/off, MEMORY.md and topics, daily logs, journal and revert, upkeep | MemorySection.tsx, lib/memory.ts | /api/bots/:id/memory*, PATCH {memoryEnabled, memoryUpkeep} | N | admin | MISSING | Advanced > Memory > list > editor (InstructionView pattern) | `panel-advanced-memory` | C | S1 if D1 |
| BA6 | Access: folder, browser, connected apps and tool grants, MCP servers, always-allowed list, webhooks, VPS auto start | AccessSection.tsx | PATCH bot fields, GET /api/connectors/tools, /api/mcp/servers, /api/webhooks | N (fields refused) | admin | PARTIAL (read-only App tools in BotOverviewView) | Advanced > Access, read-only lists (admin: toggles) | `panel-advanced-access` | C | none |
| BA7 | Model and effort, reasoning variants | ModelSection.tsx | PATCH /api/bots/:id/model | Y | admin | PARTIAL (no variants) | Model > Variant picker | `panel-advanced-model` | C | none |
| BA8 | Approval level, peer-contact approval, managed teams | PermissionsSection.tsx, ManagedTeamsSettings.tsx | PATCH {approvalMode, approvePeerComms, managedSections} | N | admin | MISSING | none by policy (admin only if D1) | `panel-advanced-permissions` | C | none |
| BA9 | Command allowlist: view, remove, add | CommandAllowlistDialog.tsx | GET/DELETE/POST /api/bots/:id/command-allowlist | Y (GET, DELETE) | admin | PARTIAL (`commandAllowlist()` in ClientParity, no UI) | Advanced > Allowed commands (swipe delete) | as desktop | C | S2 optional: owner GET/DELETE in CLIENT_ALLOW |
| BA10 | Voice per bot, speak replies, preview | VoiceSection.tsx, VoiceSettings.tsx | GET /api/tts/voices, PATCH /profile, POST /api/tts/speak | Y | Y | DONE | | `panel-advanced-voice` | A | none |
| BA11 | Voice notes allowed | VoiceSettings.tsx:483 | PATCH /profile {voiceNotes} | Y | Y | MISSING | Advanced > Voice toggle | = | A | verify profile PATCH field |
| BA12 | Voice engine switch | VoiceSettings.tsx:270 | PUT /api/config | N | admin | DONE but **not gated** (AgentProfileView.swift:268 always fails on a sidecar) | hide unless server admin | = | C | none |
| BA13 | Notifications per bot | VoiceSection.tsx, RAS:125 | PATCH /profile {notifications} | Y | Y | DONE | | = | A | none |
| BA14 | Visibility | VisibilitySection.tsx | PATCH {visibility} | N | admin | MISSING | Advanced (admin server) | `panel-advanced-visibility` | C | none |
| BA15 | Sharing grants | SharingSection.tsx, GrantEditor.tsx | GET/PUT/DELETE /api/bots/:id/grants | N | org | MISSING | Advanced > Shared with | `panel-advanced-sharing` | C | none |
| BA16 | Perspicax MCP profiles | PerspicaxSection.tsx | GET/PUT /api/bots/:id/perspicax | N | org | MISSING | Advanced > Perspicax toggles | `panel-advanced-perspicax` | C | none |
| BA17 | Slack link | SlackSection.tsx | GET /api/bots/:id/slack-management | N | org | MISSING | Advanced > Slack (opens Safari) | `panel-advanced-slack` | C | none |
| BA18 | History of changes, restore instructions | HistorySection.tsx | GET /api/bots/:id/history, POST history/rollback | N | admin | PARTIAL (Recent changes in BotOverviewView) | Overview > See all, swipe > Restore | `panel-advanced-history` | C | S1 if D1 |
| BA19 | Duplicate bot | store.tsx:3495 | POST /api/bots + PATCH | N (PATCH refused) | admin | MISSING | Profile "..." > Duplicate (member fields only) | bot menu | C | none |
| BA20 | Share as template / export | ShareTeamDialog, SharePresetDialog | POST /api/bots/:id/export | Y | Y | P (Share as Template) | | | P | none |

## 8. New bot, templates

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| NB1 | Quick create, name and look | CompanionNewBotDialog | POST /api/bots | Y | Y | Y | DONE (CreateBotSheet + CharacterEditor) | | `new-bot` (RC: one Create) | A | none |
| NB2 | Starting role (preset) | NewBotDialog.tsx:240, lib/bot-presets.ts | GET /api/bot-presets, POST /api/bots {preset} | N | GET **N**, POST Y | admin | MISSING | CreateBotSheet > Starting role row | `new-bot` | C | S1 if D1: sidecar allow GET /api/bot-presets |
| NB3 | Team at creation | NewBotDialog.tsx:168 | POST {section} | partial | Y | admin | MISSING | section header long-press > New bot here | `new-bot` | A | none |
| NB4 | Title, description, instructions at creation | IdentitySection, SoulSection | POST /api/bots | N | Y | Y | MISSING | optional rows in CreateBotSheet | `new-bot` | A | none |
| NB5 | Skills, memory, routines, access, model, permissions, voice, visibility at creation; defaults editor; picture defaults | NewBotDialog SECTIONS, lib/create-configured-bot.ts | /api/bot-defaults*, PATCH | N | partial | admin | MISSING | set on the profile afterwards | `new-bot` (admin) | C | none |
| NB6 | Read-only person sees a notice | BotsReadOnlyDialog | GET /api/config | Y | Y | Y | PARTIAL (create fails with an error) | notice instead of the sheet | = | A | none |
| NB7 | Templates library, project scout, org library, share team, org import | TeamLibraryPanel.tsx, OrgImportDialog | /api/team-library/*, /api/teams/*, /api/org-library* | N | N | admin | N/A on sidecar | long-press "+" > Templates (admin server, later) | `templates` (admin) | C/H | none |

## 9. Automations (routines, calendar, webhooks)

iPhone: `TasksRoutinesView.swift` (Settings > Advanced > Threads & Routines: list, recent runs,
`RoutineEditorView`), `Profile/RoutineDetailView.swift`, `Core/RoutineRunCard.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AU1 | Automations page: Schedule / Logs | RoutineCalendarPage.tsx:1783 | GET /api/routines | partial (no Webhooks) | Y | Y | PARTIAL (one list + recent runs, buried in Settings > Advanced) | home "+" long-press > Automations, segmented Schedule / Logs | `routines-list`, `routines-logs` | A | none |
| AU2 | Week / 3-day / day calendar, mini month, bots to drag | RoutineCalendarPage.tsx:1243, routines/CalendarSidebar.tsx | GET /api/routines | Y | Y | Y | MISSING | Calendar toggle: day agenda + graphical DatePicker | `routines-calendar` | A | none |
| AU3 | Create from the grid (drag bot, click-drag slot) | CalendarGrid | POST /api/routines | Y | Y | Y | MISSING | tap an empty agenda hour > editor prefilled | drag | A | none |
| AU4 | Move, resize an event | :1744-1764 | PATCH /api/routines/:id {schedule, durationMinutes} | Y | Y | Y | MISSING | row swipe > Reschedule; editor Duration | drag | A | none |
| AU5 | List (incl. paused, finished), detail | RoutineList.tsx, :1372-1560 | GET /api/routines | Y | Y | Y | DONE (RoutineRow, RoutineDetailView) | | = | A | none |
| AU6 | Bot filter, problems badge | :1630, :1842 | local | Y | n/a | n/a | MISSING | toolbar Menu > Filter by bot | = | A | none |
| AU7 | Run now, pause/resume, delete | :1534-1543 | POST .../run, PATCH {enabled}, DELETE | Y | Y | Y | DONE | | = | A | none |
| AU8 | Cancel a running run | store.tsx:3235 | POST /api/routine-runs/:id/cancel | Y | Y | Y | MISSING | run row / run card long-press > Cancel run | = | A | none |
| AU9 | Mark seen, mark all read, unseen-failure badge | :1790-1870 | POST /api/routine-runs/:id/seen, /seen-all | Y | Y | Y | MISSING | auto-seen on open; "..." > Mark all read; badge on the row | = | A | none |
| AU10 | Run logs: status filter, search | routines/RoutineLogs.tsx | GET /api/routines | Y | Y | Y | PARTIAL | Logs segment + Menu + `.searchable` | `routines-logs` | A | none |
| AU11 | Editor: name, prompt, bot, once / selected days / interval, run location, timeout | EventEditor :548 | POST/PATCH /api/routines | Y | Y | Y | DONE (RoutineEditorView) | | = | A | none |
| AU12 | Editor: weekly / monthly / yearly / custom cron | CronScheduleFields.tsx | same | Y | Y | Y | PARTIAL (cron shown raw, Models.swift:1197) | Repeats picker adds them; Custom cron field | = | A | none |
| AU13 | Editor: interval days, run-between window, end date | :418-445 | same | Y | Y | Y | MISSING; **risk**: iOS resends `schedule` without them | Editor > Advanced | = | A | S3: check PATCH merge (data loss) |
| AU14 | Editor: overlap skip / queue, attachments, results thread, team goal | :872, :318, ResultsDestination.tsx, :484-500 | same | Y | Y | Y | MISSING (not sent) | Editor > Advanced rows | = | A | none |
| AU15 | Open run thread, results thread, room goal | :1532-1537 | local | Y | n/a | n/a | PARTIAL (run thread only) | RoutineDetailView > Results thread | = | A | none |
| AU16 | Scheduled calls (calendar calls) | :567, :1465 | /api/calendar-calls* | N | N | admin | MISSING | admin server only, later | `routines-calendar` (admin) | C | none |
| AU17 | Webhooks: list, create, rotate, deliveries, test | WebhooksPanel.tsx | /api/webhooks* | N | N (explained) | GET Y, writes admin | PARTIAL ("Computer only" note) | none | hidden | H | none |
| AU18 | Keep the computer awake for routines | RoutineWakeBar | bridge | N | n/a | n/a | N/A | | | H | none |
| AU19 | Org routine delegation (act in my name) | settings/MyRoutineDelegation.tsx | /api/org/routine-delegation | Y (org) | N | org | MISSING | Settings > Organization > Routines act as me | settings | C | none |
| AU20 | Scope Mine / My teams / Everyone, filters Team, Bot, Owner, Status; others' routines read-only with owner avatar (2026-10-09) | routines/RoutineScopeBar.tsx, lib/use-routine-scope.ts | GET /api/routines?scope=mine\|team\|all&teamId&botId&ownerId&status, DELETE /api/routine-runs?scope=... | Y (org) | Y | Y | DONE, unbuilt (2026-10-11: TasksRoutinesView scope control and menu filters, `Core/RoutineScope.swift`, `RoutineScopeTests`; compiled and tested on Linux against the real models, the SwiftUI part only parsed: needs an Xcode build and a run) | Automations toolbar: segmented Mine / My teams / Everyone (disabled with the missing permission), Menu > Filter; owner line on each row; hide Edit, Pause, Delete when `canEdit` is false and Run now when `canRun` is false | = | A | none |

## 10. Plugins, MCP, connectors

iPhone: `PluginsView.swift` (search, install, sign-in), `ConnectedAppsView.swift` (gated on
`canAdminister`, `SettingsView.swift:565`), `PluginIconTile.swift`, `Core/ClientSettings.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PL1 | Connected apps marketplace | PluginsPanel.tsx:402 | GET /api/connectors/catalog | Y | Y | admin | PARTIAL (hidden on sidecar pairings by the `canAdminister` gate; no pagination) | ungate for sidecar pairings | `plugins-apps` | A | none |
| PL2 | Marketplace / Connected toggle | PluginsPanel.tsx:645 | GET /api/connectors/connected | Y | Y | admin | MISSING | segmented All / Connected | `plugins-apps` | A | none |
| PL3 | Search apps, connect (OAuth, alias), add account, refresh | PluginsPanel.tsx | POST /api/connectors/:slug/authorize | Y | Y | admin | DONE | | = | A | none |
| PL4 | Disconnect an account | PluginsPanel.tsx:551 | DELETE /api/connectors/:slug/accounts/:id | Y | Y | admin | MISSING | account row swipe > Disconnect | = | A | none |
| PL5 | Workspace Composio key | ConnectedAppsSetup.tsx | PUT /api/config | N | N | admin | DONE as a notice | | | H | none |
| PL6 | Per-bot "allow apps" prompt | PluginsPanel.tsx:692 | PATCH /api/bots/:id | Y | Y (owner) | Y | MISSING | profile > Connected apps row | = | A | none |
| PL7 | Claude.ai harness connectors (read) | HarnessConnectorsSection.tsx | GET /api/me/harness-connectors | Y | **N** | Y | MISSING | Plugins > From Claude.ai | = | B | S1: sidecar allow GET |
| PL8 | MCP servers list, status | McpServersPanel.tsx:239 | GET /api/mcp/servers | Y | Y | admin | MISSING (`mcpServers()` in ClientParity, no UI) | Plugins > MCP servers, read-only rows | `plugins-mcp` | A | none |
| PL9 | MCP sign-in and status | McpServersPanel.tsx:300,341 | POST .../oauth/start, GET .../oauth/status | Y | Y | admin | PARTIAL (after install only, no status) | MCP row > Sign in | = | A | none |
| PL10 | MCP add, edit, toggle, test, import, delete, sign out | McpServersPanel.tsx | POST/PATCH/DELETE /api/mcp/servers*, oauth/disconnect | Y drawn, refused | N | admin | MISSING (intentional) | admin server only | hidden on sidecar | C | none |
| PL11 | Plugin search and install (registry) | none in src/ | GET /api/plugins/search, /installed, POST /install | n/a | Y | install admin | P (PluginsView) | | keep | P | S2 optional: install for owners |
| PL12 | Browser profiles | BrowserProfilesManager.tsx | PUT /api/config | N | N | admin | N/A | | | H | none |

## 11. Settings

Desktop: `SettingsModal.tsx` sections (`:82-98`); remote client keeps only Pair devices,
Appearance and Organization (`:953`). iPhone: `SettingsView.swift`, `SettingsPages.swift`,
`AppearanceSettingsView.swift`, `PairingView.swift`, `PulsatrixSignIn.swift`.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ST1 | Skin, font, same as my computer | SkinPicker.tsx, FontRow | local + /api/me/appearance or /preferences | Y | Y | Y | DONE (AppearanceSettingsView, ThemeStore) | | `settings-appearance` | A | none |
| ST2 | App icon | settings/AppIconPicker.tsx | bridge | Y | n/a | n/a | MISSING | Appearance > App Icon (`setAlternateIconName`) | = | A | none |
| ST3 | Notification sounds | NotificationSoundsRow | local | Y | n/a | n/a | PARTIAL (always default sound) | Settings > Haptics > Sounds | = | A | none |
| ST4 | Run card, tool calls display | SettingsModal :635, :689 | local, PUT /api/config | Y / N | | | PARTIAL (Activity detail picker is local) | Advanced > Chat > Run card | = | A | none |
| ST5 | Language | LanguageRow | local | N | n/a | n/a | DONE (LanguageSettingsView) | | = | A | none |
| ST6 | Pair devices | ServerPairingCard, CompanionSection | /api/auth/sessions, /pairing | Y (sidecar refuses) | N | admin | DONE equivalent (PairingView, ConnectedComputersView) | | `settings-companion` (own pairing) | A | none |
| ST7 | Organization: remote-computer card, sign-in | OrganizationSettings.tsx:222 | bridge | Y | n/a | n/a | DONE equivalent (ConnectionSecurityView, PulsatrixSignIn) | | `settings-organization` | A | none |
| ST8 | Organization (Perspicax server): approvals, people, sharing, full-access policy, directory | PerspicaxOrgSettings.tsx, OrgDirectory | /api/org/* | Y on org | N | org | MISSING | Settings > Organization page (org pairings) | `settings-organization` (org) | C | none |
| ST9 | Achievements / trophies (#106), gamertag, toasts, unlocks | achievements/* | GET /api/me/achievements, POST events, PUT settings | N | **N** | Y | MISSING (ThemeStore knows only the retro unlock; screens exist: AchievementsPage.swift, AchievementToast.swift; category claude, server-side claude.linked, surprise reward copy on cards; do not widen ST9 past those rows in this sub-project) | Settings > Achievements (server pairings); top banner toasts | as desktop (server) | C | S1 if D1 for sidecar |
| ST10 | Usage history (by bot, CSV) | UsageSection.tsx | GET /api/usage | N | Y | admin | PARTIAL (month % only) | Usage page: by bot | `settings-usage` (admin) | C | none |
| ST11 | Settings search | SettingsModal query | local | Y | n/a | n/a | MISSING | `.searchable` on the Settings root | nav search | A | none |
| ST12 | About (version, build, host version) | AboutDialog | local | Y | n/a | n/a | PARTIAL (feedback footer) | Settings > About | `sidebar-profile-menu` | A | none |
| ST13 | Profile name, email, photo, About me | SettingsModal :167 | PUT /api/config | N | N | admin | PARTIAL (read-only card) | admin: edit on the Account page | `settings-general` | C | none |
| ST14 | General: new-bot effort and defaults, room turn timeout, thread concurrency, automatic recovery, thread cleanup, experimental | various *Settings.tsx | PUT /api/config | N | N | admin | MISSING | admin server only, later | `settings-general`, `settings-experimental` | C | none |
| ST15 | API keys, decision model, engines setup | ApiKeys.tsx, DecisionModelSettings, EnginesSettings | PUT /api/config, /api/instances* | N | N | admin | N/A (MyEngines on an org server: MISSING) | org: Settings > My engines | `settings-connections`, `settings-engines` | H (C for org MyEngines) | none |
| ST16 | Local VM, backups, mail, people, activity, workspaces, custom domain, cloud account | LocalComputerSection, *Backup*, MailSettings, PeopleSection, ActivitySection, WorkspacesSection | host or admin routes | N | N | admin | N/A (BotComputerSettingsView covers `/api/computer/*`) | | `settings-computer`, etc. (admin) | H | none |
| ST17 | Updates, prerelease, diagnostics, replay tour | SettingsModal :273-885 | bridge | N | n/a | n/a | N/A (App Store), Send Feedback exists | | | H | none |

## 12. Voice

The desktop voice mode (live call, call pill) is being ported on **`feat/ios-live-call`**
(worktree `sagax-ios-call`, not merged: "live call like the desktop's voice mode, replacing
Walkie", plus "companion: let a paired phone reach the live call's voice routes"). On this
branch the sidecar still has no `/api/bots/:id/voice/*` route. Rows below give the state on
this branch.

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| VO1 | Call button with availability | CallView.tsx:58-230, voice-mode/VoiceModeCallButton.tsx | GET /api/bots/:id/voice/status | partial | N here (Y on feat/ios-live-call) | Y | MISSING here | profile header Call; "+" > Voice mode | header call button | B | merge feat/ios-live-call |
| VO2 | Live call (streaming STT / TTS), call pill, mute, interrupt, transcript | voice-mode/LiveCall.tsx, VoiceModeBar.tsx | /voice/{listen,stream,transcribe,call,prepare,speak} | as VO1 | N here | Y | PARTIAL (Walkie: hold to talk, spoken reply) | full-screen call sheet + Live Activity | call pill | B | same |
| VO3 | Native half-duplex call with spoken approvals | CallView.tsx:323 | /api/tts/* | Y | Y | Y | PARTIAL (no spoken approvals, no narration) | Walkie: speak approvals, yes / no | = | A | none |
| VO4 | Push-to-talk, hang up | VoiceModeBar.tsx:312, CallView.tsx:670 | local | Y | n/a | n/a | DONE (Walkie) | | = | A | none |
| VO5 | Voice settings: input mode, pause, only my voice, isolation, earcons, speed, language | VoiceModeSettingsPanel.tsx | local, /voice/voices | as VO1 | N here | Y | PARTIAL (voice picker, sample) | Walkie voice sheet sections | = | B | same |
| VO6 | Group call | GroupCallView.tsx | /api/tts/*, POST .../voice/call | Y | Y (tts) | Y | MISSING | see RM12 | = | A | none |
| VO7 | Voice output on the device | lib/local-voice.ts | local | Y | n/a | n/a | DONE equivalent (ElevenLabs.swift, system voices) | | = | A | none |
| VO8 | Phone-side ElevenLabs key | none | direct | n/a | n/a | n/a | P (WalkieVoiceSettings) | | keep | P | none |

## 13. Team map, shortcuts, notices, misc

| ID | Feature | Desktop | Routes | RC | SC | CS | iPhone | iPhone placement | iPad | T | Work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TM1 | Team map (read-only canvas) | TeamMapPage.tsx:285 | GET /api/team-map | Y (canManage false) | Y | Y | MISSING | home "+" long-press > Team map (team list with mascots, pinch canvas later) | `team-map` | A | none |
| TM2 | Move a bot within its own team | TeamMapPage.tsx:303 | POST /api/sidebar-sections | Y | Y | admin | MISSING | team map row long-press > Move | drag | A | none |
| TM3 | Team menu, instructions, rename, delete, team computers | TeamMapPage.tsx:131-398, CanvasComputers | /api/section-context, sidebar-sections | N | N | admin | N/A on sidecar | admin later | admin | C | none |
| KB1 | Keyboard shortcuts (⌘K, ⌘N, ⌘1-9, ⌘⇧[ ], ⌘F, ↑ edit, Esc, ⌘Return, ⌥↑↓, ⌘,) | lib/keyboard-shortcuts.ts | local | Y | n/a | n/a | MISSING (no `.keyboardShortcut` in ios/App) | hardware keyboard on iPhone too (same commands) | `.keyboardShortcut` / UIKeyCommand, ⌘ overlay | A | none |
| KB2 | Shortcuts sheet (? or ⌘/) | KeyboardShortcutsModal.tsx | local | Y | n/a | n/a | MISSING | n/a | `keyboard-shortcuts` | A | none |
| DD1 | Drag and drop (sections, folders, calendar, team map, files) | Sidebar, RoutineCalendarPage, TeamMapPage | as features | Y | | | MISSING | menus replace drags on iPhone (SB8, SB20, AU4, TM2) | `.draggable` / `.dropDestination` | A | none |
| CM1 | Context menus (bot, thread, room, section, folder rows) | Sidebar, SidebarThreadRow | as features | partial | | | PARTIAL (chat row, thread manager) | items per rows above | `sidebar-bot-context-menu` | A | none |
| NT1 | Unread badge on the app icon | App.tsx:186 bridge setUnreadCount | local | Y | n/a | n/a | DONE (Session.swift:965,1008,2507 `setBadge(state.unreadCount)`) | | = | A | none |
| NT2 | OS notifications (needs you, finished) | desktop notifications | /api/events | Y | Y | Y | DONE (Notifications.swift, while connected) | | = | A | none |
| NT3 | In-app notice banner ("thread no longer here") | notice banner | local | Y | n/a | n/a | PARTIAL (error banners) | keep phone banner | `notice-thread-gone` | A | none |
| NT4 | Update banner, licence expiry, engine update notice | UpdateBanner, LicenseExpiryBanner, EngineUpdateNotice | bridge, /api/config | N | | | N/A | | | H | none |
| OB1 | Welcome flow, guided tour | onboarding/* | /api/config | N | | | DONE native (PairingView, SagaxWelcomeView, OrgSignInView) | | own onboarding | A | none |
| FM1 | Floating mascots, Hibou 98 assistant | FloatingBotsHost, floating-bots/* | local | Y | | | N/A (Island, LiveActivities) | | hidden (spec exception) | H | none |

## 14. Desktop changes of 2026-10-08 (#143 to #223)

Everything merged on `main` between 5ebd3dfda and fb1fe8308. Owner's rule for iOS (2026-10-04,
approved): **the iPhone takes the same usage paths as Electron** (names, groupings, order);
only the presentation adapts, and the iPhone chat look stays. Brand stays Sagax, with our
own mascots and skins.

Columns: **Kind** is `server` (server or sidecar only: already in effect for iOS, since the
phone talks to the same server), `iOS UI` (needs phone work), or `N/A` (desktop shell only;
the iOS equivalent is named). **Slice** is the stacked iOS PR that carries it: (a) sidebar
rows and people, (b) Connect apps, (c) settings and approvals, (d) bot panel and models;
`follow-up` means not in this wave (reason given).

| ID | Desktop change (PR) | Desktop path | Routes / frames | iOS decision (same path, adapted presentation) | Kind | Slice |
|---|---|---|---|---|---|---|
| DC1 | Threads only through the chat header button; nothing under a bot row (#143) | Sidebar.tsx, TaskPicker.tsx (`ThreadActionsPanel`, folder menu) | GET /api/bots | Header mode (default): the home lists nothing under a bot row (no thread tree, no thread count); the chat header's Threads button is the way in and lists only the open bot's threads, with the thread "..." actions (copy link, regenerate title, archive, snooze, refresh permissions) and folder actions. | iOS UI | a |
| DC2 | Threads location setting, per device: chat header or sidebar, never both (#210) | SettingsModal Appearance, `omb-threads-location` | local | Settings > Appearance > "Threads location" under Show threads, per device (`omb-threads-location`, not synced). Sidebar: the thread tree under each bot row and no Threads entry in the chat header's name menu. Header: the reverse. The phone's composer "+" door keeps New thread and Threads while threads are on (a phone-only door, not the header). Disabled while threads are off. | iOS UI | a |
| DC3 | Routines act in their owner's name, no consent, no reconnect card (#149) | server routine delegation; AccessCard neutral line | GET /api/org/routine-delegation (read only); POST/DELETE removed | Remove the phone's consent flow (`RoutineDelegationConsent.swift`), its automatic start and the reconnect button; Settings > Organization keeps a read-only line. A paused routine shows one neutral line. | server + iOS UI | c |
| DC4 | Run as and Run now on a routine (#149, RunAsField, RunNowButton) | routines/RunAsField.tsx, RunNowButton.tsx | GET /api/routines/run-as-options (CLIENT_ALLOW), POST/PATCH /api/routines {runAs}, POST /api/routines/:id/run | Run now is DONE (AU7). Run as: the "Runs as <name>" line on the routine row and detail (`routine.runAs`); the editor's Run as picker from the options route on an organization server. Slice c shows the line on the routine row and detail; the editor picker is a follow-up. | iOS UI | c (line), follow-up (picker) |
| DC5 | Auto model, the best model per task (#153) | ModelPicker.tsx (Auto row, chip "Auto · model") | model selection `{..., auto: true}` on the model routes; GET /api/bots/:id/auto-model | Auto as the first row of the phone model picker (bot panel Model page), the read-only line reads "Auto · model"; choosing a model pins it as before. Picking happens on the server. Done in slice d. | server + iOS UI | d |
| DC6 | Approval mode chip beside the model chip, Simple and Advanced (#150, #151) | Composer.tsx `ApprovalModeSelector` | PATCH tasks {approvalMode} | The iPad composer already carries the approval chip beside the model chip (`DesktopApprovalButton`). The iPhone has no Simple / Advanced composer and its chat look stays: the approval level stays in the bot panel's Permissions. Nothing to change. | none | d (checked) |
| DC7 | No white dot: the unread dot has its own tone (#182) | `--color-unread` (accent, Pulsatrix blue #3c76f4 in grey skins) | none | The phone's unread dot takes the skin's `--color-unread` instead of `accent-border` (white in Midnight, Graphite, Linen). Idle rows draw no dot. | iOS UI | a |
| DC8 | No New thread / New folder on bot rows (#182) | Sidebar BotListItem, BotContextMenu | none | Bot row long-press menu loses New thread and New folder; they live in the thread list (header picker, or the sidebar tree in sidebar mode). | iOS UI | a |
| DC9 | Custom labels for people (#172) | LabelTag.tsx, PersonPanel, settings/MyLabelField.tsx | GET /api/people/labels, PUT /api/people/:id/label, frame `person.label`, `label` on /api/org/directory | The bot role chip's tag beside a person's name: people DM rows, DM chat header, room members, New menu people; person sheet "Add a label" under the name (self, admin, team manager); Settings > General "My label". 40 characters, one line. | iOS UI | a |
| DC10 | Presence: online, away, offline (#167) | PresenceDot, StatusDot, src/lib/presence.ts | GET /api/org/presence, frame `presence.changed` (with `audience` for oneself), POST /api/presence/heartbeat | Same dot (green, amber, grey) and words on people DM rows, DM header, person sheet, room members, New menu people and the account button. Heartbeat `kind: "web"` every 60 s while foreground. A `kind: "phone"` needs a server change: follow-up. | iOS UI | a |
| DC11 | Settings > Privacy > Show when I am online (#167) | settings privacy row | synced pref `sagax.presenceVisible.v1` | Settings > General > Privacy row, writes the synced key; "(hidden from others)" on the own dot. | iOS UI | c |
| DC12 | People DMs close instead of hiding; never in Hidden (#219) | Sidebar member menu, sidebar-hidden.ts | synced pref `sagax.sidebarHidden.v1` (`person:` entry) | A people DM row's menu says Close (not Hide); a closed DM leaves the home and is never listed under Hidden; it comes back when selected (person sheet Message, New menu, search) or on a new message, whatever `unhideOnMessage.people` says. SB25 updated. | iOS UI | a |
| DC13 | Person panel header order, Member hidden (#219) | PersonPanel.tsx | GET /api/org/directory | Person sheet header: name, then title and points, then label, then the buttons; the role line shows only for an admin or a disabled account. "Close conversation" replaces Hide/Show. | iOS UI | a |
| DC14 | Own row shows title and points per switches; other rows never (#194) | SidebarProfileMenu.tsx | GET /api/me/achievements | The phone has no account row: the account menu's header line shows the person's name, title and points (each while its switch is on). People rows never show them. | iOS UI | a |
| DC15 | Routines badge on the account row, bigger, accent, never red (#215, #194) | SidebarProfileMenu.tsx | GET /api/routines | No badge on the account photo (owner, 2026-10-18: the reference design puts nothing there); the account menu's Automations entry shows the active routines count and opens Automations. | iOS UI | a |
| DC16 | Nudge reaches the person; sound, shake, notification (#164, #222) | src/lib/desktop-nudge.ts, electron/desktop-attention.mjs | frame `nudge` {open: {groupId, threadId}} | Receive: the wizz sound (bundled `nudge.mp3`), a haptic pattern, and a local notification when the app is in the background or another chat is open; tap opens the conversation. Sender never reacts; replays older than 2 min do nothing. | iOS UI | c |
| DC17 | Window shake, Dock bounce, taskbar flash, red button hides (#222) | electron/desktop-attention.mjs, window-nudge | bridge | N/A (Electron window and Dock). iOS equivalent: haptics + local notification + app icon badge. | N/A | c (equivalent) |
| DC18 | Settings > Notifications section (#222) | SettingsModal Notifications | local | Settings > Notifications, desktop order: notification sounds, keep notifications on screen (iOS: a note that the banner style is set in the iOS Settings app), unread count on the app icon, nudge sound, nudge haptic (the shake's iOS equivalent). The two sound rows leave Appearance. | iOS UI | c |
| DC19 | Per-person unread for people DMs (#222) | server `unreadFor` | GET /api/groups, live `group` frames | Server projects the reader's own flag; the phone already reads `unread`. | server | none |
| DC20 | Achievements in their own modal, category column, out of Settings (#220, #211) | AchievementsModal | GET /api/me/achievements, PUT settings | Account menu > Achievements opens its own full-screen sheet; categories as the desktop's phone-width select (All, Getting started, ... Secrets with unlocked/total), header card, recent unlocks on All, search, grid; switches (points, title, banners) at the bottom. Settings loses Achievements. Phone done in slice c (category select with unlocked/total, search, Show my title); the iPad keeps its modal as before. | iOS UI | c |
| DC21 | Release notes in the account menu with a version picker (#184) | ReleaseNotesPrompt browse mode | local (bundled docs/releases/*.md) | Account menu > Release notes (above About), sheet with a version picker newest first, current marked, French part for a French UI, "Changes since my last version". Notes bundled from docs/releases (a resource folder). The large layout: its account menu's Release notes and What's new after an update, in the desktop's dialog (section 19, P2-3). | iOS UI | c, section 19 (large layout, P2-3) |
| DC22 | Room turn limit leaves the chat header, lives in room settings Advanced (#216) | GroupPanel Advanced, ConversationTurnLimit | PATCH /api/groups/:id/tasks/:t {turnTimeoutMinutes} (a DM: PATCH /api/groups/:id) | Room info > Advanced > Turn limit (owner or admin), same options and default; nothing in the chat header. | iOS UI | c |
| DC23 | Model or provider switch keeps permissions; no dialog (#208) | ModelPicker | PATCH model routes (no `resetApprovalToAsk`) | The phone never sent `resetApprovalToAsk` nor showed the dialog: in effect. | server | none |
| DC24 | Org server: basic built-in tools run without an admin (#213) | server/member-tool-scope.ts | permission cards | Server rule: in effect. | server | none |
| DC25 | Admin approvals reach admins live (#213) | `org.approvals` frame, account row badge, Settings > Organization list | frame `org.approvals`, GET /api/org/approvals | For an org admin: count badge on the account button (opens Settings > Organization), a local notification per arrival, live list with Allow / Deny in Settings > Organization. | iOS UI | c |
| DC26 | Five more engines on the org server (#198), engines preinstalled (#179), local model for Claude Code (#183) | server drivers, `OrgHostToolsNote` | 409 `host_tools` | Server-side. The phone's model picker shows what the server lists, including the refusal reason text the server returns. | server | none |
| DC27 | Grok runs the picked model, its list comes from the engine, local models (#189) | server/drivers/acp/grok.ts | GET models | Server-side; the phone lists what GET models returns (Grok 4.7 Fast and local slugs included). Check the picker shows custom rows: slice d. | server + check | d |
| DC28 | Blue accent tones for on, paused, waiting (#188) | src/lib/status-tones.ts, styles.css | none | Routine on and paused, switches, info pills in the accent; green only for success, amber for warnings, red for errors. Skin tokens re-synced with styles.css. | iOS UI | d |
| DC29 | Mascots without the disc, silhouette drop shadow (#204, #186) | `.mascot-plinth` removed | none | The phone never drew the plinth disc (#186 was desktop only): nothing to remove. The light-skin silhouette shadow: done in section 19 (P2-2). | none / iOS UI | d (checked), section 19 (shadow, P2-2) |
| DC30 | Clean-room Shapes: 8 shapes, clay, cut-out eyes, 14 moves (#187) | shape-art.ts, shape-engine.ts, shape-moves.ts | PATCH {mascotLook} | Stored ids follow the desktop (`circle, bean, squircle, pill, pick, hexagon, cloud, drop`) with the legacy map. Since section 16 (MS1 to MS4): every skin id decodes, the still frames (outline, cut-out eyes per mood, clay on Plain) are the desktop's own, generated. The 14 moves and the 16 expressions: the desktop's engine, ported with its numbers generated (section 19, P2-1). | iOS UI | d (ids), section 16 (art), section 19 (moves, P2-1) |
| DC31 | Primary Bot hint removed (#196) | ProposalStatus | none | Remove "The Primary Bot can propose this" from the phone bot panel; the owner-only marker stays. | iOS UI | d |
| DC32 | Paid with pill removed; composer notices in flow (#201) | DigestChip, ComposerNoticeBand | none | Remove the "Paid with" section and line from the digest and turn chips; composer notices stay above the field in flow. | iOS UI | d |
| DC33 | Header working dots removed (#199) | ChatView header | none | The phone and iPad chat headers never drew working dots beside the name: nothing to remove (the iPad sidebar rows keep theirs, as the desktop's). | none | d (checked) |
| DC34 | Bot panel scrolls on every tab, More list not clipped (#214) | BotPanel card | none | The phone bot panel is one scroll view on every tab: the More list already reaches Usage. | none | d (checked) |
| DC35 | Connect apps: main view, Manage, detail, per-tool switches (#203, #218) | PluginsPanel, plugins/* | GET /api/connectors/catalog, /connected, GET/PATCH /api/mcp/servers {disabledTools}, /api/skills-library | Same three views in the phone navigation: Connect apps (search, category chips, sections, one row per app, "N connected >"), Manage (Installed, Private skills with skill page, Advanced folded), detail (accounts, tools with a switch per tool, details, Uninstall). Writes stay admin as on the desktop. Done in slice b, with two phone limits: Add manually and Paste config stay on the computer (keyboard and secrets), and the Bot templates button is not drawn yet. | iOS UI | b |
| DC36 | Custom marketplaces (#206) | Manage > Advanced > Marketplaces | GET/POST/DELETE /api/marketplaces, plugins install | Listed in Manage > Advanced and as a chip under More; add, refresh, remove and plugin Add for an admin pairing. | iOS UI | b |
| DC37 | Providers tab (#207) | plugins/ProvidersSection.tsx | engine accounts, GET /api/me/harness-connectors | Manage > Providers: each provider with its accounts; Claude lists the claude.ai connectors, others say their connectors do not reach bots. | iOS UI | b |
| DC38 | Composio setup card and MCP trust notice removed (#197) | PluginsPanel, McpServersPanel | none | Remove both from the phone. | iOS UI | b |
| DC39 | Settings > My connections removed, now Manage > Your connections (#218) | MyConnectionsSettings | /api/me/... connections | The phone never had a My connections page; Manage > Your connections on the phone: done in section 19 (P2-4). The large layout still shows it as Settings > My connections. | iOS UI | section 19 (phone, P2-4), follow-up (large layout placement) |
| DC40 | Webhook bearer token always required (#185) | WebhooksPanel, server/webhook-ingress.ts | /hooks/:id with `Authorization: Bearer` | Server-side; the phone never shows webhook URLs (AU17, Computer only). | server | none |
| DC41 | Voice calls 2: streaming TTS over one xAI socket, intonation end of turn (#200) | voice-mode/speech-stream.ts, prosody.ts | GET /api/bots/:id/voice/speech (WebSocket) | The phone call path still posts `/voice/stream` and `/api/tts/speak` (the POST fallback the server keeps). Moving to the socket and the contour endpointing: follow-up, it needs a Swift WebSocket client and the prosody port. | server + follow-up | follow-up |
| DC42 | Desktop mascot slices, click opens the balloon (#174, #191, #209) | floating-bots | local | N/A (floating window). iOS equivalent: Island and Live Activities (FM1). | N/A | none |
| DC43 | Routine page header no-drag top bar (#221) | RoutineCalendarPage | none | N/A (Electron drag regions); the phone page uses its navigation bar. | N/A | none |
| DC44 | Person panel resizes like the bot panel (#175) | layout | none | N/A (docked panels); the phone uses a sheet. | N/A | none |
| DC45 | Hide Go to conversation chips whose conversation was deleted (#176) | ChatView chips | none | The phone decodes the server's `gone` stamp and drops "Open thread" for a thread that no longer exists. | iOS UI | d |
| DC46 | Plan usage reads the person's own subscription on an org server (#177) | server | GET /api/usage | Server-side. | server | none |
| DC47 | Mastery tier: 24 hard achievements unlock the Mastery characters and skins; locked looks show their achievement and progress (docs/achievements.md) | AchievementsPage Mastery cards, MascotLookEditor locks, shared/mascot-unlocks.ts | GET /api/me/achievements; PATCH /api/bots/:id(/profile) answers 403 `look_locked` with the achievement id | The achievements sheet lists Mastery (and Tiers) with the generated catalog, shows the progress bar from 0 and a "Locked: N looks to unlock" line on Mastery cards. The phone has no look editor for the Mastery characters yet: when it gets one, it reads the same registry keys (`mastery:<id>`, `character:<id>`, `skin:<character>:<skin>`) from `rewards`. | iOS strings | none |
| DC48 | Shiba, a Mastery character: 13 skins, sixteen faces, dog moves on the desktop mascot (walk, wander and back, turn in circles, bark, sit, lie down, sniff, stretch, wag...) (feat/mascot-shiba) | shiba-art.ts, shiba-moves.ts, ShibaMascot.tsx, skin-fx/shiba-skins.tsx, floating-bots/mascots.tsx | PATCH {mascotLook: {character: "shiba", skins: {shiba}}} (403 `look_locked` while locked) | The phone decodes the look and every skin (legacy ids included) and draws Shiba from the generated `ShibaStillArt.swift` with `ShibaArt` palettes (fixture-checked), the bust under 48 pt; the editors list its skins behind the reward keys. Moves on the phone: idle breath, blink, tail wag and ear twitch while animated, and the walk cycle (gallery page only, nothing on the phone walks). The desktop-only moves (wander, turn in circles, bark, sit, lie down, sniff, stretch, the cue reactions, the bark sound) are N/A: they belong to the floating mascot (FM1). Premium skins show their palette and coat gradient without their effects (`MascotSubstitution`). | iOS UI | b |

Not listed: releases and chores with no feature (#190 upstream sync, #192, #193, #195, #202,
#205, #217, #223).

## 15. Voice call bar on iOS (2026-10-09, branch `feat/ios-call-bar`)

Owner's ask: on iOS the bot call works exactly like Electron (0.4.10, #178): no full-screen
page, the floating bar under the bot name. Presentation only: the call engine, the call
machine states, CallKit and the server routes are unchanged. Sources:
`ios/App/Call/CallViews.swift` (`CallBar`, `CallSettingsPanel`, `CallTranscriptPanel`),
`ios/App/Features/Chat/ChatHeader.swift` (`callBar`), `ios/App/ChatView.swift`.

| ID | Desktop behaviour | Desktop path | iOS now | State |
|---|---|---|---|---|
| CB1 | No full-screen stage; a call starts folded | VoiceModeBar.tsx | The full-screen `CallPillView` and its collapsed row are gone; the call shows only the bar. | DONE |
| CB2 | Bar centred under the bot name, in its own row of the banner stack | VoiceModeBar.tsx, ChatView banner stack | `CallBar` under the name capsule (and the pinned banner), 16 pt side gutter, at most 420 pt wide; the transcript's top inset grows by the bar's row, so nothing hides under it. iPhone and the iPad desktop header both. | DONE |
| CB3 | Order: avatar, waveform, Settings, Transcript, Mic, End (push to talk before Settings when on) | VoiceModeBar.tsx | Same order and same controls; UI test checks the order on screen. | DONE |
| CB4 | Sizes: row 64, padding 12, avatar 40, round buttons 40, icons 18, gap 8, corners 32 then 22 at the bottom with a card | VoiceModeBar.tsx, layout test | Same values in points (`CallBarMetrics`); Dynamic Type scales them up to 4/3. | DONE |
| CB5 | Waveform: dotted, 7 px columns, 6 px rows, 4 px dots, bot in accent, person in ink; folds away when the bar is under 21rem | VoiceModeBar.tsx `Waveform` | Same dot grid and colours; hidden under 336 pt of bar width. It draws a scrolling level history (the phone has levels, not an analyser buffer). | DONE (drawing differs slightly) |
| CB6 | Avatar is the bot's face with the call state's expression; tap interrupts while the bot speaks | VoiceModeBar.tsx | `BotMascotView` with `CallState.mascot`; tap interrupts while audible; VoiceOver reads name, time and state (the desktop's tooltip). | DONE |
| CB7 | Settings and Transcript open a card under the bar, height and opacity reveal, 200 ms, cubic-bezier(0.22, 1, 0.36, 1); one card, switching moves between heights | MenuMotion.tsx `useHeightReveal` | Card clipped from 0 to the content's measured height with the same curve and length; content never reflows; switching animates between the two heights; Reduce Motion shows and hides without motion. | DONE |
| CB8 | Transcript scrolled to its last line before it shows | VoiceModeBar.tsx `toLastLine` | Scrolled to the end as it opens and on every new line. | DONE |
| CB9 | Card closes on a click outside or Escape | VoiceModeBar.tsx | A tap on the thread folds it; Escape on a hardware keyboard too (an open list first). | DONE |
| CB10 | Settings: Voice, Speed, Language rows, then Advanced folded by default and remembered, then Hold | VoiceModeSettingsPanel.tsx | Same rows (desktop layout: label, value button with a chevron), Advanced folded by default and remembered (`CallSettings.advancedOpen`, same key as the desktop), Hold / Resume under it. | DONE |
| CB11 | Advanced: Microphone, End of turn, Only my voice (enrollment), Call sounds, Soft tone, streaming voice, faster end of turn, with switches | VoiceModeSettingsPanel.tsx `CallSection` | Microphone, End of turn, Only my voice (switch, Record my voice / Record again / Forget my voice, progress while recording), Call sounds and Soft tone (switches), in the desktop's order; `onlyMyVoice` and `thinkingCue` saved in `omb.voiceCall.v1` with the desktop's defaults (both on). Only my voice gates by the enrolled speaking level (far-field gate and a turn-level check, `CallVoiceprint`), not by a speaker embedding: see P1-1. Streaming voice and faster end of turn still need engine work (DC41). | PARTIAL (streaming voice, faster end of turn) |
| CB12 | Alerts (note with Retry, passing notice, access card) in the card under the bar | VoiceModeBar.tsx | Note with Try again and the notice in the card; the access card stays the existing alert at call start. | DONE (access card differs) |
| CB13 | Hang up returns to the plain header | VoiceModeBar.tsx `onEnd` | End (bar or composer capsule) removes the bar and the transcript inset. | DONE |
| CB14 | Room call | GroupCallView.tsx | The room's call uses the same bar under the room's name (P1-2): the members' faces in the avatar seat, the one speaking or working ringed, the room's status line, Settings and Transcript cards, Mic, End. `GroupCallOverlay` is gone. | DONE (iOS presentation, see P1-2) |

## 16. iOS parity lot 1 (2026-10-09, branch `feat/ios-parity-lot-1`)

Plan D.5 (Perspicax master plan 2026-10-09). Four items; each row says what matches the desktop and what still differs.

| ID | Desktop behaviour | Desktop path | iOS now | State |
|---|---|---|---|---|
| P1-1 | Call card, Advanced: "Only my voice" (switch, enrollment row: Record my voice, progress, Your voice is enrolled, Record again, Forget my voice; turning it on without a voice records one) and "Soft tone while a slow answer is coming" | VoiceModeSettingsPanel.tsx, voice-mode/call.ts (`enroll`, `verify`, `armCue`), speaker-id.ts, call-settings.ts | Same rows, order, words and defaults; settings under `omb.voiceCall.v1` (`onlyMyVoice`, `thinkingCue`), the print under `omb.voiceCall.voiceprint.v1` in the desktop's shape, on the phone only. Enrollment: 6 s of voiced speech within 25 s while the bot is silent, as on the desktop (`CallEnrollmentRecorder`). Soft tone: the desktop's two notes (392, 523 Hz) 1.2 s after the person stopped when nothing is audible yet, its own switch, quieter than the call sounds. Engine hook: `LiveCallEngine.enroll`, `verifying`, `forgetVoice`. **Gap:** no speaker embedding on the phone (the desktop runs CAM++ in ONNX): the gate is the enrolled speaking level (frames under 22 % of it never start a turn, turns averaging under 35 % are dropped with the rejected tone, the level learns from accepted turns). A second voice as close and loud as the person passes; iOS voice processing may also level voices out. Tests: `CallAdvancedTests` (settings, print, gate, enrollment, soft tone), UITest `testTheAdvancedCardHasOnlyMyVoiceAndTheSoftTone`. | PARTIAL (no embedding) |
| P1-2 | A room's call | GroupCallView.tsx (desktop: full overlay) | Owner's ask: the bot call's floating bar under the room's name, no full-screen screen. `CallBar(subject: .room)`: up to three overlapping member faces (focused one ringed and in front, "+N" for more), each with its own state face; the room's status ("Nova is speaking", "Bringing the group in"); Settings card (language, Advanced, hold) and Transcript card with the room's hint. Same engine and turn-taking as before. Differs from the desktop on purpose (the desktop still draws its overlay). UITest `testARoomCallTakesTurns` now checks the bar and the faces. | DONE (iOS presentation) |
| P1-3 | Routine "Runs as" (organization server): the person a routine runs as, a dropdown for an admin or a team manager (people who cannot run the bot listed, not choosable, "(cannot run this bot's routines)"), a search past 8 people, "Will run once {name} signs in", the help line; the line alone for anyone else; nothing on a solo server | routines/RunAsField.tsx, RoutineCalendarPage.tsx, GET /api/routines/run-as-options, POST/PATCH /api/routines {runAs} | Editor section after the results thread, as on the desktop: a row with the person's initials and name that opens the list (search past 8, disabled rows with the reason, pending line, check on the chosen one), or the "Runs as {name}" line when the person cannot choose; options asked again when the bot, type or room changes; a choice that no longer stands falls back; the save sends `runAs` only when it differs from the routine's current person. Differs: initials only, no Perspicax picture (the phone does not fetch them yet). Tests: `RoutineRunAsTests`, UITest `testRunAsListsWhoMayRunTheRoutine` (org fixture). | DONE (initials, no picture) |
| P1-4 | "Bot templates" beside the Connect apps search: closes Connect apps, opens the Templates library when Templates is on, else the new bot dialog | plugins/ConnectAppsView.tsx, PluginsPanel.tsx `openBotTemplates` | A "Bot templates" row heading the Connect apps list (the phone's search lives in the navigation bar, so the button cannot sit inside it): closes Connect apps (and Settings around it), then Templates (`features.templates` and an admin pairing, `BotTemplatesEntry`) or the new bot sheet. Differs: placement (list head, not beside the field); the iPad's desktop Plugins modal does not draw it yet. Tests: `BotTemplatesEntryTests`, UITest `testBotTemplatesBesideTheSearchOpensTheNewBotSheet`. | DONE (placement adapted) |
| P1-5 | Browse Bots replaces the Templates library (2026-10-09, `feat/catalog-replaces-templates`): "Bot templates" in Connect apps, "Browse templates" in New bot, the sidebar's Templates place and install links open Browse Bots on its Templates section (organization packages, presets, community teams with their apps as chips and an app filter, built-in roles, then Import, From a folder and Share a team). Follow-up (`fix/browse-bots-swap-templates`): the swap is 1:1. The sidebar row is "Browse Bots" (catalogue icon, opens the catalogue's home view, hidden until Settings > Experimental features > Browse Bots is on, off by default, same `features.templates` key); Connect apps' row is "Browse Bots"; Browse Bots is gone from the composer To: menu, the mascot and "..." menus and the sidebar section menu. iOS mirrors this placement. | bot-catalog/BotCatalogModal.tsx, BotCatalogView.tsx, TemplateTools.tsx, src/lib/templates-entry.ts | Not done. iOS mirrors the placement above. iOS needs the catalogue (Browse Bots with its Templates section) to replace its "Bot templates" row of P1-4 (`BotTemplatesEntry`, which still opens Templates behind `features.templates` or the new bot sheet). Until then iOS keeps P1-4 as shipped. | DONE on iOS 2026-10-09, see DC49 |

## Counts

Rows per state, iPhone (a row may cover several closely related controls):

| State | Rows |
|---|---|
| DONE (incl. "DONE equivalent" and "DONE but not gated") | 77 |
| PARTIAL | 50 |
| MISSING | 116 |
| P (phone-only extras) | 8 |
| N/A on iOS (host only or not applicable) | 15 |
| **Total rows** | **266** |

By tier, for the 166 PARTIAL or MISSING rows: **A 115** (RC shows it, routes already open:
pure iOS work), **B 10** (needs a sidecar or client-session route first), **C 40** (hidden in
RC: admin or organization pairings, or a policy decision), **H 1** (webhooks note, stays).

iPad: every row is today in the iPhone state (phone UI). The desktop look for the iPad is the
separate shell work of the 2026-10-02 spec; this document adds the feature work both share.

## Top 10 iPhone gaps (by daily value for the owner)

1. **Message actions**: Reply (with quote), Regenerate, Speak, View source (CO2, MS8, MS5,
   MS4, MS3). All routes open.
2. **Steer and busy-send**: steer a queued message, the after / steer / parallel chooser, room
   interrupt (CO14, CO15, RM4, RM5).
3. **Approval dock completeness**: always allow for the session or command, allow all
   read-only, stepper, cancel turn from the card (CA3, CA4, CA5).
4. **Real slash commands and compact**: engine commands from `harness-commands`, `/learn`,
   `/setup`, Compact (CO9, CO10, CO24); today the HUD sends prose.
5. **Threads and folders**: regenerate title, move to folder, copy link, folder create /
   rename / reorder, mark unread (TH3, TH5, TH6, SB19, SB20, SB14).
6. **Routine runs and editor safety**: cancel run, mark seen / all read, and the editor fields
   that today can be wiped on save (AU8, AU9, AU13, AU14).
7. **Bot activity**: what the bot is doing, history, detail, stop and steer from the profile
   (BP10).
8. **Connected apps and MCP for sidecar pairings**: ungate Connected apps, disconnect, MCP
   servers list and sign-in (PL1, PL2, PL4, PL8, PL9).
9. **Find in conversation and jump to latest** (MS11, MS14), plus @mention suggestions (CO11).
10. **Interactive cards that decode as unknown**: connector, access, parallel task, owner wait,
    goal run (CA10, CA11, TH8, CA12, CA14).

## Bugs found while inventorying (fix in WP0b)

- `AgentProfileView.swift:268`: the voice engine picker calls `PUT /api/config`, which the
  sidecar always refuses and a client session may not use (BA12). Hide it unless the pairing is
  a server admin.
- `AgentProfileView.swift:253`: the "What this bot does" link reaches `GET /overview`, admin
  only for a client session (BA1). Gate it.
- `BotProfileView.swift:536`: "Copy ID" copies the bot id, the desktop copies the conversation
  (thread) id (SB23).
- `TasksRoutinesView.swift` editor: resends `schedule` without the interval window or end date
  and never sends overlap, attachments, results thread or target (AU13, AU14). Check the
  server's PATCH merge (S3) before anyone edits a desktop routine from the phone.
- `NewGroupSheet` / `Client.swift:1419`: rooms created without `setup: {defaultResponder:
  mentions}`, unlike the remote client (RM2).
- `ConnectedAppsView` is gated on `canAdminister` although the sidecar allows connectors and
  the remote client shows them (PL1); `CreateBotSheet` likewise although `CLIENT_ALLOW` permits
  `POST /api/bots` (SB31).
- The remote client draws the room Memory tab, but the sidecar has no `/api/groups/:id/memory`
  route (RM8): a renderer bug on the desktop side too.

## Decisions for the owner

- **D1. Advanced bot panel on a sidecar pairing.** RC hides skills, memory, history, prompt
  preview, presets, achievements (BA2, BA4, BA5, BA18, NB2, ST9). Parity "with the features"
  means opening read routes (and some writes) on the sidecar. Proposed: open the reads (skills
  list, memory read, history, system prompt, bot presets, achievements) and memory file edits
  for the owner; keep approval mode, folder, computer, MCP and access writes refused.
- **D2. Message pin** (MS9, RM17): route open on both gates, hidden by RC. Proposed: allow
  (owner only), and also unhide on the desktop remote client.
- **D3. Room memory** (RM8): open the sidecar route (proposed) or hide the tab in RC.
- **D4. Beyond-RC features the iPhone already has** (bot pin, delete bot, framing, generate
  picture, export bot): keep (proposed); the spec rule would remove them.


**the owner's answers (2026-10-03):** D1 yes: open the advanced panel on the sidecar for the owner (reads and edits, tested routes). D2 yes: message pin on iPhone and iPad. D3 open the room memory route (GET/PUT) on the sidecar. D4 keep the iPhone extras (pin bot, delete bot, framing), owner or admin only.

## Build plan

### Principles

- **One feature module, two presentations.** Each package puts its state and actions in
  `ios/Sources/CompanionCore/` (models, `Client+<Area>.swift`, pure logic with unit tests in
  `ios/Tests`) and its views in a new `ios/App/Features/<Area>/` folder. Views take a
  `presentation: .phone | .desktop` (or are split into a small core view plus two thin
  wrappers). The phone wrapper mounts into the existing doors (menu, "+" sheet, profile,
  Settings). The desktop wrapper is mounted by the iPad shell packages (I1-I8) at the
  desktop surface ids in the iPad column. Feature packages ship the phone wrapper; the
  desktop wrapper is a stub until the matching iPad shell package lands.
- **No package edits another package's files.** Today `ChatView.swift` (2627 lines) and
  `Session.swift` (2585 lines) would make every chat package collide, so WP0b first extracts
  seams: `Features/Chat/MessageMenu.swift` (bubble menu items), `Features/Chat/PlusActions.swift`
  (the "+" sheet's action list as a registry), `Features/Chat/ChatHeaderMenu.swift`,
  `Features/Chat/ComposerAccessories.swift` (strips above the composer: reply quote, find bar,
  suggestion strip). Session gains extensions in their own files (`Session+Threads.swift`,
  `Session+Routines.swift`, ...), one per package.
- **Gates in one place.** WP0a adds `Core/SurfaceGate.swift`: `allowed(_ feature)` from the
  pairing kind (sidecar, server client, server admin, org), the RC rule and the owner's decisions D1-D4.
  Every new row goes through it; nothing is drawn disabled.
- **Tests:** CompanionCore logic and decoding get unit tests (`swift test` on the package, no
  simulator). UI rows get phone parity screens only when they change a captured surface (they
  should not: new items live behind menus and sheets).
- Size: each package is about half a day for one agent.

### Packages, in order of value

| # | Package | Rows | Main files (owned) | Depends on | Server |
|---|---|---|---|---|---|
| WP0a | Core models and gates: decode `replyToId`, `pinnedMessageId`, `steered`, `ownerName`/`state`, `parallelTask`, `connector`, `access`, `goalRun`, `routedBy`, `BotTask.usage`, `Room.humanIds`; `Client.send` options (`replyToId`, `busyMode`); `SurfaceGate` | foundations | Core/Models.swift, Core/Chat.swift, Core/Client.swift (send), new Core/SurfaceGate.swift | none | none |
| WP0b | ChatView seams and the gate bugs above (the routine editor goes to WP8 + S3, the room Memory tab to S1) | foundations, BA1, BA12, SB23, RM2, PL1, SB31 | ChatView.swift (extraction only), new Features/Chat/*, AgentProfileView.swift, BotProfileView.swift:536, Client.swift (groups) | none (parallel with WP0a) | none |
| S1 | Sidecar routes batch with tests: GET harness-commands, POST parallel/:t/stop, GET bots/:id/activity[/item], GET/PUT groups/:id/memory, POST bots/:id/primary, GET /api/me/harness-connectors; plus D1 reads if approved | CO9, TH8, BP10, RM8, SB28, PL7 | companion/src/routes.ts, companion/test/routes.test.ts, proxy.test.ts | none (parallel with all) | yes |
| S2 | Client-session routes: connector-card authorize; owner GET/DELETE command allowlist; plugin install for owners (if wanted) | CA10, BA9, PL11 | server/auth/request-auth.ts and tests | none | yes |
| S3 | Routine PATCH merge check (keep window, endsAt, overlap, attachments, results, target when absent) and a test | AU13 | server/routes (routines), tests | none | yes |
| WP1 | Message actions: Reply (send + quote strip + quote in bubble), Regenerate, Speak, View source, collapse long messages, steered marker, routed-by info, mention tint | CO2, MS3-MS5, MS8, MS19-MS21, RM10 | Features/Chat/MessageMenu.swift, Features/Chat/ReplyQuote.swift, MarkdownText.swift (tint) | WP0a, WP0b | none |
| WP2 | Approval dock and interactive cards: session / command always-allow, allow read-only N, stepper, cancel turn, option dismiss, secret resume / dismiss, connector card, access card, owner wait, parallel task card, error Retry | CA3-CA5, CA8-CA12, CA17, TH8 | Cards/* (new ApprovalDock, ConnectorCardView, AccessCardView, ParallelTaskCardView), CardView extracted from ChatView in WP0b | WP0a, WP0b; S1 (parallel stop), S2 (authorize) for the last steps | via S1/S2 |
| WP3 | Composer power: steer queued, busy-send chooser, failed-send Retry, paste image and paste chip, @ and # suggestion strip, real slash commands (`/learn`, `/setup`, engine list), Compact, room interrupt and steer | CO5, CO9-CO12, CO14, CO15, CO17, CO24, RM4, RM5, RM9 | Composer/*, Features/Chat/PlusActions.swift, Features/Chat/ComposerAccessories.swift, QueuedSendList (moved) | WP0a, WP0b; S1 for CO9 | via S1 |
| WP4 | Find in conversation and jump to latest; citation quote; lightbox paging | MS11, MS14, CO8, CA31 | Features/Chat/FindBar.swift, SelectableTextSheet.swift, AttachmentViews.swift | WP0b | none |
| WP5 | Threads and folders: thread menu shared by BotThreadTree and TaskManagerView (regenerate title, move to folder, copy link, rename), folder CRUD and reorder, mark unread, copy conversation id | TH2, TH3, TH5, TH6, SB14, SB19, SB20, SB23 | new Features/Threads/ThreadMenu.swift, TaskManagerView.swift, BotThreadTree.swift, Session+Threads.swift | WP0a | none |
| WP6 | Synced sidebar preferences: personal sections (#101), collapse, order, hidden items and Hidden list, show threads switch; section admin menu | SB2, SB4, SB7, SB8, SB10, SB25 | ChatListView.swift (section header, row menu), HomeRoster.swift, CompactRoster.swift, new Core/SidebarPrefs.swift | WP0a | none |
| WP7 | Bot panel details: Activity card, list, detail (stop, steer, open); routine delete on profile; thread files filter, search, sort, copy path, show in chat; Style 2D/3D, skin locks, moves; read-only notice; per-bot usage; voice notes toggle; make primary | BP6-BP10, BP12, BP14, BF1, BF3, BF4, BA11, SB28 | Profile/*, Features/BotActivity/*, Mascots/CharacterEditor.swift | WP0a; S1 (activity, primary) | via S1 |
| WP8 | Routine runs and editor: cancel run, seen, seen-all, badge, filter; editor Advanced (window, end, overlap, attachments, results thread, team goal, weekly / monthly / yearly / custom cron, duration); results thread link | AU6, AU8-AU10, AU12-AU15 | TasksRoutinesView.swift, Profile/RoutineDetailView.swift, Core/Models.swift (RoutineSchedule; coordinate with WP0a by landing after it) | WP0a; S3 before shipping editor saves | via S3 |
| WP9 | Plugins: Connected apps on sidecar pairings, All / Connected, disconnect, per-bot allow apps; MCP servers read-only list, sign-in and status; Claude.ai connectors | PL1, PL2, PL4, PL6-PL9 | PluginsView.swift, ConnectedAppsView.swift, Features/Plugins/McpServersList.swift | WP0b (gate); S1 for PL7 | via S1 |
| WP10 | Automations page and calendar: promote Automations to the home "+" long-press, Schedule / Logs segments, day agenda calendar, tap-to-create, reschedule | AU1-AU4 | new Features/Automations/*, ChatListView.swift (one menu item; after WP6) | WP8 | none |
| WP11 | Rooms: Room info sheet (details, members, instructions read, memory, threads row), goal `/goal` and goal card; owner items behind gates (rename, move, delete, bulletin edit, pin, members, leave, who answers) | RM6-RM8, RM11, RM13-RM19, CA14 | new Features/Room/*, Cards/GoalRunCardView.swift, ChatView header hook (from WP0b) | WP0a, WP0b; S1 for memory | via S1 |
| WP12 | Settings and appearance: app icon, sounds, run card, Settings search, About, achievements (server pairings), org page and routine delegation, usage by bot | ST2-ST4, ST8-ST12, AU19 | SettingsView.swift, SettingsPages.swift, AppearanceSettingsView.swift, Features/Achievements/* | WP0a | S1 if D1 for achievements on a sidecar |
| WP13 | New bot: team at creation, title, description, instructions, read-only notice; starting role if D1 | NB2-NB4, NB6 | CreateBotSheet.swift | WP0b | S1 if D1 |
| WP14 | Rich content: code block actions, table CSV / Markdown, chart (Swift Charts), mermaid fallback, email card, callouts, spoilers, footnotes, inline images, turn access line | CA16, CA21, CA23-CA28 | MarkdownText.swift, Core/Markdown.swift, Features/Chat/RichBlocks/* | WP1 (MarkdownText shared: land after) | none |
| WP15 | Team map (read-only list, then canvas) and move within team; people DMs and person sheet on org servers | TM1, TM2, RM21, RM22 | new Features/TeamMap/*, Features/People/* | WP0a | none |
| WP16 | Advanced bot panel for admin / approved pairings: skills, memory, history and restore, prompt preview, access read-only, model variants, command allowlist, visibility, sharing, Perspicax, Slack, duplicate | BA2, BA4-BA7, BA9, BA14-BA19 | Features/BotAdvanced/* (one file per section), AgentProfileView.swift (row list) | D1; WP7; S1/S2 | via S1/S2 |
| WP17 | Voice: merge `feat/ios-live-call`, then spoken approvals, voice settings sections, room call | VO1-VO6, RM12 | WalkieView/Controller (or their replacement on that branch) | merge of feat/ios-live-call | on that branch |

iPad shell packages (from the 2026-10-02 spec, consuming the modules above):
**I1** `DesktopTheme` (tokens per skin, Geist) and `DesktopShell` (sidebar / content / docked
or overlay panel, size rules); **I2** `DesktopSidebar` (densities, pinned tiles, section and
row menus from WP5/WP6, ⌘ keys KB1/KB2, drag DD1); **I3** desktop chat (bubble metrics, hover
action row from WP1, composer pill with WP3 popups, find bar WP4, approval dock WP2, rich blocks
WP14); **I4** `BotPanel` docked (tabs Details, Routines, Files, Computer, Advanced from WP7 and
WP16); **I5** Settings modal and Plugins modal (WP9, WP12); **I6** Automations calendar week
grid with drag (WP10); **I7** room panel (WP11) and Team map canvas (WP15); **I8** palette,
compose-to, New Bot dialog, keyboard shortcuts sheet, notice banner. I1 has no dependency and
can start now; I2-I8 each follow I1 and their feature package.

### Order and parallel lanes

Wave 1 (start together, no shared files): **WP0a**, **WP0b**, **S1**, **S2**, **S3**, **I1**.

Wave 2 (after WP0a and WP0b): **WP1** (message menu), **WP2** (cards), **WP5** (threads),
**WP7** (profile), **WP9** (plugins). These own disjoint files: Features/Chat/MessageMenu +
ReplyQuote; Cards/*; Features/Threads + TaskManagerView + BotThreadTree; Profile/*;
PluginsView + ConnectedAppsView. **WP3** waits for WP1 only if both touch MarkdownText (they do
not: WP3 owns Composer/* and PlusActions), so WP3 can join wave 2 too.

Wave 3: **WP4**, **WP6** (ChatListView), **WP8** (routines), **WP11** (rooms), **WP12**
(settings). WP6 and WP10 both touch ChatListView: WP10 goes after WP6.

Wave 4: **WP10**, **WP13**, **WP14** (after WP1), **WP15**, then **WP16** (after D1) and
**WP17** (after the live-call merge). iPad I2-I8 run alongside from wave 2, each after its
feature package.

Daily-value order if only one lane runs: WP0a, WP0b, S1, WP1, WP2, WP3, WP5, WP7, WP8 (+S3),
WP9, WP12, WP6, WP4, WP11, WP10, WP13, WP16, WP14, WP15, WP17.

## 16. Mascot looks and sidebar sync (2026-10-09, branch `fix/ios-desktop-state-sync`)

Owner's report (TestFlight 0.4.9 build 14 against the production organization server, 0.4.15): bots
showed as the owl on the phone and not on Electron; sections deleted on the phone stayed on
the desktop. Causes: the phone refused a look whose `skins` carried a key it did not know
(the desktop's editor saves `skins.shape`, `skins.trombi` and `skins.bunbu` together, so
every look edited there became the owl) and did not know `bunbu`, the premium skins or the
Clay colours; the desktop read the person's preferences only at start and wrote its whole
stale copy back (PUT) at its next change, bringing deleted sections back, and no device heard
another's save.

| ID | Desktop behaviour | Desktop path | Routes / frames | iOS now | State |
| --- | --- | --- | --- | --- | --- |
| MS1 | A look keeps its character whatever its skins carry (`botMascotLook`) | shared/mascot-look.ts | `bot.mascotLook` | `MascotLook` decodes as `botMascotLook` reads: unknown or foreign skin keys and values are dropped, never the look; fixture of every desktop look (`MascotLookFixtureTests`, generated by `src/components/ios-mascot-export.test.ts`) | DONE |
| MS2 | Bunbu, twelve skins | BunbuMascot.tsx, bunbu-art.ts, skin-fx/bunbu-skins.tsx | `bot.mascotLook` | `bunbu` character, `BunbuSkin`, `BunbuMascotView` (still frame, moods, base finishes; Plush and Velvet included); offered in both editors | DONE (premium layers: base finish, logged) |
| MS3 | Thirteen shape skins, eight Trombi skins, thirteen owl skins, legacy ids | shared/mascot-look.ts, shared/mascot-skins.ts, skin-fx/*, lib/owl/owl-skins.ts | `bot.mascotLook`, `bot.mascotSkin` | every id decodes; shape and Bunbu base finishes ported (`shapeSkinBase`), owl palettes, auras and rims ported; Trombi's four repainted skins are tinted toward their colours | DONE (layers and Trombi repaint: logged substitutions, follow-up) |
| MS4 | Shapes drawn as clay with cut-out eyes | ShapeMascot.tsx, shape-engine.ts | none | `ShapeStillArt.swift` (generated still frames, five moods), clay radial light on Plain; the live engine, the sixteen faces and the fourteen moves since P2-1 | DONE |
| MS5 | Clay palette (twelve colours) | shared/mascot-colors.ts | `bot.color` | every colour has its value (`MausColors.hex`, `MausColors.clay`); both editors offer a Classic / Clay row switch where the desktop offers Clay (P2-1) | DONE (Vivid, Pastel, Deep, Neon, Neutral tabs: the phone keeps its twelve) |
| MS6 | Substitutions visible | none | none | `MascotSubstitution` logs each look drawn with less than the desktop once (subsystem `ca.pulsatrix.sagax`, category `mascot`); never another character | DONE |
| GR1 | Grump, the grumpy cat: sixteen faces, thirteen skins, legacy ids, the bust under 48 pt | GrumpMascot.tsx, grump-art.ts, skin-fx/grump-skins.tsx, shared/mascot-look.ts | `bot.mascotLook` | `grump` character and `GrumpSkin` decode as `botMascotLook` reads them; `GrumpMascotView` draws the desktop's own paint operations (`GrumpStillArt.swift`, generated) with each skin's flat palette (`GrumpArt.palette`, checked against Fixtures/grump-palettes.json); offered in both editors. The moves (walk, stalk, stretch, groom...) and the premium effects stay on the desktop (logged substitutions) | DONE (still frame), follow-up (moves) |
| MS28 | Ogre, thirteen skins, its moves (docs/mascots.md) | OgreMascot.tsx, ogre-art.ts, ogre-rig.ts, ogre-moves.ts, skin-fx/ogre-skins.tsx | `bot.mascotLook` | `ogre` character, `OgreSkin` (legacy ids), `OgreMascotView` drawing `OgreStillArt.swift` (generated: the approved head and shoulders, sixteen faces, bust, marks) with `OgreArt` (palette ported and checked against the desktop for every bot colour), breath and blink; offered in both editors and the widgets. The moves (walk, laugh, roar, flex, nap on a log...) are desktop-only: the phone has no floating mascot | DONE (premium layers: colours and marks, logged; moves: N/A on the phone) |
| MS29 | Frog, thirteen skins, sixteen faces, hop and throat puff (docs/mascots.md) | FrogMascot.tsx, frog-art.ts, frog-moves.ts, skin-fx/frog-skins.tsx | `bot.mascotLook` (`skins.frog`), Mastery locks (`polyglot`, rungs) | `frog` character, `FrogSkin` with legacy ids, `FrogMascotView` from the generated `FrogStillArt.swift` (every face, CSS idle with the throat, one eye blinking after the other, throat puff while thinking, the hop in the gallery), `FrogArt` palettes checked against the desktop for every skin; offered in both editors behind its Mastery locks. The desktop-only moves (tongue and fly, pond, lily pad, croak) stay on the desktop mascot. | DONE (patterns and premium layers: base tones, logged) |
| SY1 | A save changes only its keys | src/lib/user-preferences-sync.ts | `PATCH /api/me/preferences` `{ set, remove }` | `saveSidebarPreferences` PATCHes the changed keys; an older server (403, 404, 405) gets GET then PUT as before | DONE |
| SY2 | Every save reaches the person's other devices | server/index.ts `savePersonPreferences`, `preferencesFrameAllowed` | frame `preferences` (audience only) | `Frame.preferences`, `SidebarPrefsModel.receive`: the server wins except keys changed here and not saved yet (`SidebarPrefs.receiving`) | DONE |
| SY3 | Sections list, membership, order, collapsed state follow the person | personal-sections.ts, sidebar-preferences.ts, Sidebar.tsx | keys `sagax.sidebarSections.v1`, `openmausbot.sidebarSectionOrder.v1`, `openmausbot.sidebarCollapsedSections.v1` | live both ways; the desktop sidebar re-reads them on the frame | DONE |
| SY4 | Team map order of each team's bots follows the person on an organization server | TeamCanvas.tsx, team-canvas.ts | key `sagax.teamCanvasBotOrder.v1` (and `sagax.teamCanvasPositions.v1`, desktop canvas only) | `TeamMapModel` reads and writes the synced key on an organization server, offering this phone's order once | DONE |
| SY5 | Pinned bots | Sidebar.tsx | `PATCH /api/bots/:id {pinned}`, frame `bot` | already server state on both sides | DONE (unchanged) |
| SY6 | First launch keeps the local copy | user-preferences-sync.ts | GET then PUT when `stored` is false | unchanged on both sides: the first device with no record offers what it had | DONE (unchanged) |

Not verifiable from the tests: a real organization server with Perspicax sign-in (the route
and frame tests use the server modules and a stub client).

## 17. Markdown editor (2026-10-09, branch `feat/markdown-editor`)

The desktop's markdown fields share one editor (`docs/markdown-editor.md`). iOS is not in this
branch; the row records the gap.

| ID | Desktop behaviour | Desktop path | iOS now | State |
|---|---|---|---|---|
| ME1 | Every markdown field (SOUL.md, MEMORY.md and topic files, a skill's instructions, routine, trigger and webhook instructions, group and team instructions, group memory, About me) edits in one CodeMirror editor: headings sized, bold, italic, code, quotes, tables and checked tasks styled as typed; Write, Preview (chat renderer) and, in Advanced, Side by side; toolbar with shortcuts (bold, italic, heading, lists, checklist, quote, code, link, table, divider, Format); list continuation, Tab and Shift+Tab in lists, auto-pairs, link and table paste; word and character count. Values and save paths unchanged | markdown/MarkdownEditor.tsx, markdown/MarkdownEditorCore.tsx, markdown/markdown-edits.ts | Plain text fields (`InstructionView` for the soul; memory and skills not on the phone yet, BA4, BA5) | DONE on iOS 2026-10-09, see DC53 |

## 18. Bot workspace: Rules, Files, docs/ (2026-10-09, branch `feat/persona-rules-files-docs`)

The persona editor gains Rules and Files (`docs/bot-workspace.md`). Server side every engine
and every client gets the same prompt; iOS is not in this branch, the rows record the gap.
RULES.md and docs/ go through the workspace routes, open to the bot's owner like the Soul
(BA3), so they are tier A for an owner on the phone; memory files stay admin (BA5).

| ID | Desktop behaviour | Desktop path | Routes | iOS now | State |
|---|---|---|---|---|---|
| WS1 | Rules: RULES.md in the markdown editor, starter template on first open, counter against 60 lines / 8 KB, the Perspicax inheritance note | bot-settings/RulesSection.tsx | GET/PUT /api/bots/:id/workspace/file?path=RULES.md | `BotWorkspaceDocEditor` (Rules under the instructions) | DONE (DC53) |
| WS2 | Files: the whole workspace with Every turn / On demand / Never loaded badges, budgets, created, modified, last used, Forgotten marker; Simple mode keeps the badges only | bot-settings/WorkspaceFilesSection.tsx, lib/workspace-files.ts | GET /api/bots/:id/workspace | none | MISSING (Advanced > Files list, read-only first) |
| WS3 | Documents in docs/: create, upload a .md, rename, delete, edit in place; other files download | WorkspaceFilesSection.tsx | PUT/DELETE /api/bots/:id/workspace/file, POST /api/bots/:id/workspace/docs/rename, GET /api/bots/:id/workspace/download | `BotDocsList`: create, rename, delete, edit in the markdown editor (no upload or download of other files) | PARTIAL (DC53) |
| WS4 | The bot's tools rules_update, docs_update, workspace_read, workspace_search; the Rules block after the soul and the docs index in every turn | server/workspace/workspace-files.ts, server/workspace/workspace-tools.ts | agents MCP | server side: a phone conversation gets them like any other | DONE (no iOS work) |

## 19. iOS parity lot 2 (2026-10-09, branch `feat/ios-parity-lot-2`)

Plan D.6 (Perspicax master plan 2026-10-09). Each row says what matches the desktop and what still differs.

| ID | Desktop behaviour | Desktop path | iOS now | State |
|---|---|---|---|---|
| P2-1 | Shapes as a live clay figure: the gaze wanders on five loops, the body drifts and breathes, seeded blinks, the face turns toward the pointer, shape, face and colour changes slide over 0.45 s; sixteen faces; fourteen one-shot moves (thinking, wink, wide, alert, notify, exclaim, sleep, egg, hexagon, play, orbit, swirl, burst, comet) with their dots, badge, specks, 3D rings and ribbons; live only for an animated drawing of 44 px or more, still under Reduce Motion; the editor's Moves play them; the Clay palette offered for Shapes, Shiba, Grump, Ogre, Frog or a bot already in a Clay colour | shape-engine.ts, shape-moves.ts, shape-art.ts, ShapeMascot.tsx, floating-bots/MascotLookEditor.tsx, editor-tabs.ts `colorGroupsFor` | `ShapeEngine.swift` (CompanionCore) ports the engine line for line; its numbers (the 64 radii of every body and move body, the faces, timings, rings, loops, blink schedule, light) are generated into `ShapeEngineData.swift` by `src/components/ios-mascot-export.test.ts`, which also writes `Fixtures/shape-frames.json` (frames the desktop drew: every face, every move at three moments, the idle loop, a morph); `ShapeEngineTests` checks the Swift frames against them number by number. `ShapeMascotView` draws the frame (clay light, cut-out eyes, the notch under the badge, specks, rings behind and in front, dashed ribbons), live from 44 pt when animated, still below and under Reduce Motion, the working bounce kept. Moves: the phone profile mascot's long press (Moves section, the desktop's names) and the large layout's avatar editor (Moves chips). Colours: a Classic / Clay row switch above the 6 + 6 swatches (phone editor) and beside Color (large layout editor), opening on the row of the colour worn; the phone's avatar card now grows past the owl's 252 pt instead of cutting a shape's colour rows off. Gallery page `-mascotGallery shape-moves`. Tests: `ShapeEngineTests`, `ClayPickerTests`, UITest `testAShapePlaysItsMovesAndWearsAClayColour`. Differs: the pointer turn only while the pointer is over the mascot (the desktop follows it across the window); premium skin layers stay base finishes (MS3); the Vivid, Pastel, Deep, Neon and Neutral tabs are not on the phone (it keeps its original twelve as Classic). | DONE (see differences) |
| P2-2 | On a light skin every character (shape, owl, Bunbu, Shiba, Grump, Ogre, Frog, Trombi) wears a soft drop shadow that follows its silhouette, so a white mascot reads on a light surface; dark skins none (`--mascot-filter`: drop-shadow 0 0 1px and 0 1px 2px in `--mascot-shadow-color`, then 0 3px 8px in `--mascot-shadow-wide`, per skin) | src/styles.css (Mascot shadow), src/lib/mascot-shadow.test.ts | `MascotShadowTone` (CompanionCore) carries each light skin's two tones (Pulsatrix Light, Atelier, Lagoon, Linen, Daylight, Hibou 98), read back from src/styles.css by `MascotShadowTests`; `MascotDropShadow` on `MascotCharacterView` draws the three layers in the same order (each shadowing the ones before, as a CSS filter list does) wherever a character is drawn: home rows, chat, profile, editors, the large layout. Dark skins and the phone's own Black and Dim draw none; the widgets and the Live Activity keep none (they draw without the app's skin). Differs: a CSS blur of b px is drawn as a SwiftUI shadow radius of b / 2 (the same Gaussian), so the edge may differ by a fraction of a point; Meadow is not an iOS skin. | DONE |
| P2-3 | Release notes dialog: What's new once per version after an update (never on a fresh install, never in a dev build) with the running version's notes; Release notes (the account menu) with a version picker newest first, the running one marked "(current)", "Changes since my last version (x)" listing each version since; 520 px wide at most, Close at the bottom, Escape or a click outside closes; the seen record keeps the version before for "since" | ReleaseNotesPrompt.tsx, ReleaseNotesMarkdown.tsx, src/lib/release-notes.ts (`whatsNewDecision`, `seenReleaseRecord`) | `DesktopReleaseNotesModal` over the large layout's shell (at most 520 pt wide, 48 pt from the edges, radius 14, the dimmed backdrop and Escape close it), opened by the account menu's new Release notes entry (above About) and by What's new on the first launch of a new version (`ReleaseNotes.whatsNew`, a port of `whatsNewDecision`; a prior install is a pairing saved before this launch). Same notes as the phone page (docs/releases, the person's language). The seen record is now the desktop's JSON (`ReleaseNotesSeen`, the phone's plain record still reads), shared with the phone page, so "Changes since my last version" survives What's new. Tests: `ReleaseNotesPromptTests` (the desktop's decision cases), UITests `DesktopReleaseNotesUITests` (What's new once, the account menu's dialog with the picker and since). Differs: "before an update" does not apply, the App Store and TestFlight install updates and show their own notes first; the phone shows no automatic What's new (its account menu page only); parity and UI test launches stay quiet unless they pass `-releaseNotesWhatsNew`. | DONE (see differences) |
| P2-4 | Plugins > Manage > Your connections (organization server only, after the private skills): the person's own GitHub account (connected as @login with Disconnect, a code to type at GitHub while it waits, Connect GitHub, Use a token) and their own MCP servers (name, address or command, state, the server's error, a switch to use it, Sign in or Sign out for OAuth, Remove, Add an MCP server); read only under an administrator's management; a waiting code or sign-in asked again every two seconds | plugins/ManageView.tsx `personal`, PluginsPanel.tsx, settings/MyConnectionsSettings.tsx, src/lib/my-connections.ts | GET /api/me/connections, POST /api/me/github/device, DELETE /api/me/github, PATCH/DELETE /api/me/mcp/servers/:name, POST /api/me/mcp/servers/:name/oauth/start and /oauth/disconnect | `YourConnectionsSection` in the phone's Manage (Plugins and skills), after Private skills and before Advanced, when the gate allows `myConnections` (an organization server, through the server, not the sidecar): GitHub with its state, Disconnect (asks first), the code with Copy code and Open GitHub, Connect GitHub when the server offers the device flow; each server with its place and state, its error, a switch, Sign in (opens the provider's page), Sign out, Remove (asks first); the administrator's notice and read-only rows; polling while a code or sign-in waits. Same model and routes as the large layout's page (`MyConnectionsModel`). Tests: UITest `YourConnectionsUITests` (organization fixture: the person's server listed, switched off and removed, each read back from the API); the routes and decoding stay covered by `MyConnectionsTests`. Differs: adding a server and pasting a GitHub token stay on the computer (a keyboard and a secret, as Add manually and Paste config in Manage); Remove and Disconnect ask first on the phone; the large layout still draws the section under Settings > My connections, not in its Plugins modal. | DONE (see differences) |

## 20. Desktop ports of 2026-10-09 (branch `feat/ios-ports-1009`)

Desktop features merged on 2026-10-09 (#253 to #274), ported to iOS in new Swift files where
possible (`ios/App/Features/BrowseBots/`, `ios/Sources/CompanionCore/BotCatalog.swift`, ...).
IDs continue the DC and MS ranges.

| ID | Desktop behaviour | Desktop path | Routes | iOS now | State |
|---|---|---|---|---|---|
| DC49 | Browse Bots, the organisation catalogue (#240, #253, #259): sections Featured, Shared with me, My Bots, Organization, Templates; search by name or creator (case and accents ignored), category chips, Show archived; per bot Add to my sidebar / Remove from sidebar (hidden list `sagax.sidebarHidden.v1`), Open, Import Bot, Publish with a category, Remove from the catalog, Feature (admin); read-only detail (instructions, memories, skills, routines, integrations); templates folded in | bot-catalog/BotCatalogModal.tsx, BotCatalogView.tsx, BotCatalogDetailView.tsx, src/lib/bot-catalog.ts | GET /api/bot-catalog(/:id), PUT /api/bot-catalog/:id/listing, POST /api/bot-catalog/:id/import (CLIENT_ALLOW; no sidecar route) | `BrowseBotsSheet` (App/Features/BrowseBots/) from the place that was Templates (home foot and large layout sidebar, same `features.templates` switch), gate `browseBots` (any server pairing, never the sidecar); `BotCatalogRules` ports sections, actions, search and categories. Templates: New bot presets (admin), community teams (admin, read only: added on the computer) and the built-in roles; Use creates the bot at once. Differences: no organization packages (`/api/org-library` is read on the computer), no app chips, no Import / From a folder / Share a team tools, a role is created directly instead of opening New bot prefilled, sections are a list (6 rows then View all) instead of two columns | DONE |
| DC50 | Threads in a conversation between two people, like a bot's (#262): shared list, titles, pins, archive, snooze, delete; the open thread and unread are each person's own; unread threads in bold; a notification tap opens the exact thread | Sidebar.tsx PersonThreadList, TaskPicker.tsx PersonThreadPicker, store.tsx `personThreadKept`, `peopleDmReadTarget`, `openNotificationTarget` | header `x-sagax-person-threads: 1`; POST/PATCH/DELETE /api/groups/:id/tasks(/:t), POST /api/groups/:id/messages {threadId}, POST /api/groups/:id/read {threadId}; frame `group` (default thread) | Every request sends the header (`makeRequest`); `Chat.supportsTasks` is true for a person's conversation, so the header menu offers Threads and New thread and the thread sheet lists them (pinned first, unread in bold, Archived folded); the thread menu archives and snoozes (`ThreadMenuPlan personThreads`, `patchRoomTask`); a live frame keeps the thread open here (`PersonThreads.keptThreadId` in the store fold); a send goes to the open thread; a read names the open thread only; a notification with no bot falls back to its `groupId` and opens the thread. Differences: no folders for a person's conversation (the room model has no `projects` on iOS yet), the large layout sidebar does not list a person's threads under the row (they are in the header menu and the thread sheet), the companion sidecar drops the header (an older desktop gets the default thread, as on the desktop remote client) | DONE |
| DC51 | Tagging a person in a room notifies them like a direct message (#274): "@Name" in the composer, "Person · Gets a notification" in the suggestions, the notification "Sender in Room" opens that room thread | Composer.tsx mentions, server/rooms/room-mentions.ts, shared/person-mentions.ts | frame `notify` {botId:"", groupId, threadId}; APNs `groupId` | The "@" strip offers the room's other people by their directory name (`MentionSuggestions.pool(people:)`, `PersonMentions`), labelled "Person · Gets a notification"; the tap opens the room on that thread (same fallback as DC50). Differences: no "@all notifies everyone" switch in the room info (owner setting, follow-up) | DONE |
| DC52 | Reactions and Seen by (#270): eight quick reactions and a search over every emoji, chips in the order they landed with a count, highlighted when the viewer reacted (the read receipts' `self`), tooltip naming everyone ("You", a bot with its mascot); Seen by: each participant once under the last line they read, five faces then +N, "Name · time" on hover; a 1:1 with a bot shows "Seen" until it answers; the client posts its position while the window shows | Reactions.tsx, src/lib/reactions.ts, SeenBy.tsx, src/lib/read-receipts.ts, read-receipts-feed.ts | POST /api/threads/:t/messages/:m/reactions, GET/POST /api/threads/:t/read, frames `message.patch`, `thread.read` | `ReactionChipsRow` (chips in landing order, `mine` from the viewer's ids: the old phone compared against nobody), touch and hold a chip lists who reacted, the list sheet shows bots with their mascot; the message menu has the eight quick reactions and "Add reaction" (any emoji from the keyboard, one grapheme); `SeenByRow` under each message (faces, +N; touch and hold for "Name · time", a tap opens the list; "Seen" or "Seen at" with a bot), `ReadReceiptsCenter` reads GET once per thread, folds `thread.read` (a reset reads again) and posts the newest line shown while the app is in front. Differences: no emoji search list (the keyboard's emoji picker takes its place); the position posted is the newest line drawn, not the last fully visible one | DONE |
| DC53 | One markdown editor on every markdown field (#258, docs/markdown-editor.md): live formatting, Write and Preview, toolbar (bold, italic, heading, bullets, numbers, checklist, quote, code, link, table, divider, Format), Enter continues a list or a quote and ends it on an empty item, Tab and Shift+Tab nest, auto-pairs, link and table paste, task boxes toggle, word and character counts, shortcuts; Rules (RULES.md) and docs/ edited in it (#269) | markdown/MarkdownEditor.tsx, MarkdownEditorCore.tsx, markdown-edits.ts, bot-settings/RulesSection.tsx, WorkspaceFilesSection.tsx | none (the fields' own routes); GET /api/bots/:id/workspace, GET/PUT/DELETE /api/bots/:id/workspace/file, POST .../workspace/docs/rename | `MarkdownEdits` ports markdown-edits.ts case for case (`MarkdownEditsTests`, offsets in UTF-16); `MarkdownEditor` (App/Features/MarkdownEditor/) on the soul (phone and large layout panel, New bot), memory (phone and panel), group instructions and memory, routine instructions, quick automation, About me (4,000 cap); toolbar above the keyboard with nest and un-nest buttons (no Tab key on a touch keyboard), the desktop's shortcuts on a hardware keyboard, Write and Preview (`MarkdownText`), counts. Rules and Documents open from under the instructions (`BotWorkspaceShortcuts`): RULES.md with its counter and starter template, docs/*.md created, renamed, deleted, edited, a 409 offers Reload or Overwrite with mine. Differences: no Side by side, no Simple mode "More" fold (the toolbar scrolls), styling is lighter (no dimmed marks, no table monospace), no skill, trigger, webhook or team instructions editors on iOS yet, no Files list with load badges (WS2) | DONE |
| DC54 | Model picker, one mode (#261): "Only this thread" is gone; a pick runs the thread and becomes the bot's model in one request; "Use <bot>'s model" puts a thread back on it, "(bot's model)" beside it, "N threads use their own model."; the models under Cloud and Local (loaded local models first; an organization never lists the server's own custom models); the effort kept on the same engine, a variant only on the same model; an organization lists only the providers its admin allows, the current one shown as "Not allowed by your organization" | ModelPicker.tsx (`modelSelectionForPick`, `FollowBotModelRow`, `pick`), src/lib/local-models.ts, shared/org-allowed-engines.ts, shared/thread-model.ts | PATCH /api/bots/:id/tasks/:t {modelSelection, updateBotDefault}; GET /api/config `allowedEngines`; task `followsBotModel`; model option `local`, `loaded` | `ModelPickerRules` (core, tested); the large layout picker (`DesktopModelPicker`) drops the scope buttons and the second PATCH, groups its list under Cloud and Local, shows "Use <bot>'s model" with the count of threads on their own model, filters the rail by `allowedEngines`; the phone's Model page (`BotModelSection`) saves with `updateBotDefault: true`, groups the Model menu under Cloud and Local, filters providers, offers "Use <bot>'s model" and says the one-mode rule in its footer. Differences: the large layout keeps its search and Suggested list instead of the desktop's dropdown; no Connect button for an organization person's own engine in the picker (Settings has it); local rows a provider cannot run are not greyed out | DONE |
| DC55 | A bot as one zip (#271, docs/bot-package.md): Export as zip in the persona Overview (conversations and sharing on request, never a secret); Import from zip in New bot and Templates: the file is staged, previewed (Will be created, Needs a step after import, Left out, Never in a zip), named, then imported as a new bot; a member's copy drops host settings; a locked Mastery look stays the default | PersonaOverview.tsx, BotZipImport.tsx, TemplateTools.tsx, src/lib/bot-zip.ts | GET /api/bots/:id/export.zip, POST /api/bots/import/upload (raw bytes), POST /api/bots/import/:id/preview, POST /api/bots/import/:id, DELETE /api/bots/import/:id (CLIENT_ALLOW; no sidecar route) | `BotZip.swift` (core, tested); "Export as zip" at the foot of the bot's overview for its owner or an admin (`BotZipExportSection`), downloaded to a file named like the desktop's and handed to the share sheet; "Import from zip" in the New bot sheet and the Browse Bots toolbar (`BotZipImportSheet`): Files picker (.zip, and the older .json or .md package), the server's preview lines, the name (re-previewed on Return), the two switches, Import, then the new bot opens; Cancel discards the staged file. Differences: the preview lines show the server's English `detail` (no `botZip.line.*` translation on iOS yet), no drag and drop, the import warnings are not listed after the import | DONE |
