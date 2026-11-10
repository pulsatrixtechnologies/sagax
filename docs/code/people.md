# People, groups and direct messages

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## A bot writes to a person via a group (#2118, 2026-11-06)

A bot messages another person of the organization with `message_user`
(rooms family, permission `people:message`, member scope `own-account`):
the person's own approval card and level (Allow, Always allow, Ask, Deny,
Full access), no extra guard. Sagax posts the message as the bot in the
group whose people are exactly the bot's owner and that person, with the
bot in it (`server/people/bot-message-user.ts` `findBotPersonGroup`); when
missing, `POST /api/internal/message-user` creates it in the same request
as the post (`"<Owner>, <Person> et <Bot>"`, owned by the owner, no
section, default responder the bot), so there is never an empty group.
Person resolution: id, exact name / login / email, then a unique partial
name; self, unknown and ambiguous are refused and create nothing. Both
people get unread and the usual message notification; the person's answer
lands in that group where the bot is a member. Activity rows reuse the
"posting in a group" label. Tests: `server/routes/internal-message-user.test.ts`.

### The second implementation, to retire (#2118, #3292)

The same issue landed twice on 2026-11-06. `message_user` above is the
current one (the person's own card and level, no extra guard). The text below
describes `message_person`, still on main with its route and tests; it is to
be retired by a code change of its own, and no new code calls it.

`message_person` (agents tool, `POST /api/internal/message-person`) posts into
a triad group chat: the bot's owner, the recipient and the bot. It finds an
existing room with exactly those three or creates one, then posts on the
group's main thread (unified chat). The owner approves a card with Always
allow (`message_person:<principalId>`). Organization servers only; writing
to the owner is refused (use this conversation). Helpers:
`server/people/message-person.ts`. Confidential threads refuse the route.

## Leave a group chat (#1480, #2119, 2026-10-28 / 2026-11-06)

On an organization server a person listed in a group in their own name
leaves it on their own, owner included, without an admin:
`POST /api/groups/:id/leave` (server/groups/group-leave.ts `planGroupLeave`). The
session names who leaves, never the body. They leave `humanIds` under every
id they are listed by; their private bots (owned by them, no grant) leave
with them, a shared bot stays. The owner hands the group to the person
listed longest (first non-team entry left). #2119: leaving that would leave
zero people is refused (`sole_member`; bots and `team:` seats do not count);
the sole remaining person deletes instead of leaving, so the group never
becomes a ghost. Only the owner (or an org admin for moderation) may delete
(`mayDeleteGroup`); an invited member may only Leave. Their past messages
stay. The others get one neutral line, message kind `roster`
(`WireMessage.roster`, drawn by RosterLine, `text` is the English fallback);
their own devices get `group.left` (`roomId`, their streams only) and drop
the group. Leave group sits in the sidebar menu, the conversation's « … »
and the group panel on desktop (LeaveGroupDialog confirms), and in the row
menu and Room info on iOS. They can be added back like anyone. Tests:
`server/groups/group-leave.test.ts`, `src/lib/group-leave.test.ts`,
`src/components/Sidebar.member-menu.test.ts`, iOS `GroupLeaveTests`.

## Conversations with a person: how their threads are stored (2026-10-09)

On screen a conversation with a person is one conversation, like a bot's
(unified chat: see "One conversation: THE rule"; the owner's rule of 2026-11-05, #2098). What follows is how the server keeps its threads.

A direct conversation between two people (`peopleDm`, server/people/people-dms.ts)
has threads and folders exactly like a bot's, through the room thread routes
and `server/routes/group-folders.ts`. Keep these rules, covered by
`server/people-threads.e2e.test.ts` and `server/people-dm-threads-store.test.ts`:

- The pair shares the thread list, titles, pins, folders, archive and snooze.
  The open thread and unread are each person's own (`PeopleDmSelections`,
  `unreadFor` per thread, stripped by `peopleDmForViewer`).
- Only the two people reach them; an admin gets 404 like anyone else. No
  generated title (no model ever reads the pair's words), no turn limit.
- The stored `threadId` is the default thread ("General" after the one-time
  migration, `personThreads: 1`). Only a request with the
  `x-sagax-person-threads: 1` header is answered with the person's own open
  thread; a live frame always names the default thread and a client that
  knows threads keeps its own (src/state/store.tsx `personThreadKept`). A
  client from before threads keeps working on the default thread, the only
  one it is shown.
- No thread picker and no thread list: the conversation is one stream
  (unified chat: see "One conversation: THE rule"; the owner's rule of 2026-11-05, #2098).

## Group memory and direct messages between people

A user-created group keeps one shared memory (`server/memory/group-memory.ts`,
`DATA_DIR/group-memory/<groupId>/MEMORY.md`), separate from every bot's own
workspace. Keep these rules, each covered by `server/memory/group-memory.test.ts`,
`server/memory/group-memory.e2e.test.ts` or `server/people/people-dms.e2e.test.ts`:

- Every bot of the group reads it in each room turn there (the
  `group-memory` prompt section); a bot writes it only with
  `group_memory_update` (`/api/internal/group-memory`: a bot of that group,
  speaking in it, group memory on, the bot's own memory switch on). Nothing
  moves between a bot's private memory and the group's on its own.
- Entries, budget and expiry are the bot memory's (`applyMemoryUpdate`);
  secrets are redacted on every write; it goes away with its group.
- `GET/PUT /api/groups/<id>/memory`: the group's people read, its owner
  (`ownsGroup` in `server/groups/group-ownership.ts`; on a solo server the
  operator or an admin session) edits it or switches it off (`memoryEnabled`). A removed member
  gets 404 at once (the channel gate).

On an organization server a person writes to another person through
`POST /api/people-dms` (`server/people/people-dms.ts`): a group record with
`peopleDm: true`, two `humanIds` and no bot. Only those two list, read,
stream, search, export or write it (not an admin, a section, nor loopback);
it stays people-only (no bot, task, rename, delete, folder or memory); a
message starts no turn and notifies the other person only (`notify` kind
`message` with `audience`). Backups and packages leave it out. The To:
picker offers the directory's active persons (never `service` accounts,
nor oneself).

A nudge (`POST /api/nudges`, `server/nudge.ts`) is organization only.
`{ principalId }` shakes that person and writes the line in the direct
conversation. `{ groupId }` shakes the other people of that group chat
(listed people, `team:` members who are not managers, and the shared
section's owner and members) and writes one line on the group, never a
new direct conversation. The sender, service accounts and people who are
out are skipped. Someone who cannot post is refused. The room shares one
5 minute clock (`group:<id>`), separate from a direct nudge. A refusal
writes nothing. The button is last in the composer when the room names
someone else (`src/lib/group-nudge.ts`). A bot uses `nudgePerson` or
`nudgeGroup`, both rewritten to that one POST. A nudge RECEIVED (the `nudge`
frame in `src/state/store.tsx`) shakes the window and plays
`public/nudge.mp3` once (`onNudgeReceived` in `src/lib/desktop-nudge.ts`,
`playNudgeSound` in `src/lib/nudge-sound.ts`, volume 0.6, a refused play is
logged once and ignored). The sender's own window shakes without the sound,
and the server skips the sender, so a group member hears it once. Settings >
Appearance > "Nudge sound" (`omb-nudge-sound`, per computer, on by default,
`src/lib/notification-preferences.ts`). The file is served like
`app-icon.svg`: vite copies `public/` to `dist/`, which the packaged app
carries as `resources/ui` (outside the asar) and serves from there. Tests: `src/lib/nudge-sound.test.ts`,
`server/nudge.test.ts`, `server/routes/nudges.test.ts`,
`src/components/GroupView.test.ts`. The server image must be installed
before an organization server accepts `{ groupId }`.

## Report, Block and the terms between people (App Store 1.2, 2026-10-26)

Rooms with several people and direct messages between people carry content
between users. Keep these rules, covered by `server/safety/moderation.test.ts`,
`server/routes/moderation.test.ts`, `src/lib/moderation.test.ts` and
`ios/Tests/CompanionCoreTests/ModerationTests.swift`:

- Report: `POST /api/threads/:t/messages/:m/report { reason, note? }`
  (`server/routes/moderation.ts`) on a line someone else wrote. The author
  comes from the stored message, never the body; the thread gates run
  first (a people DM's two people, a read-only member too, like a reaction).
  The report (with the message's words) is stored in
  `DATA_DIR/moderation.json` and a `notify` of kind `report` reaches the
  organization's admins and the operator (a solo server's owner) only
  (`audience`). Admins read `GET /api/moderation/reports` and mark one
  handled (`POST .../:id/resolve`), admin scope; the desktop shows them in
  Settings > Notifications > Reports. A bot's reply keeps its own Report
  on iOS (an email to Pulsatrix, `MessageReport.swift`).
- Block is personal: `GET/POST /api/me/blocks`, `DELETE /api/me/blocks/:id`,
  the session's person only. Clients fold the person's lines into "Message
  from a blocked person" (Show opens it) for that person only; nothing
  changes for anyone else and no admin option turns Report or Block off.
  Unblock: desktop Settings > Notifications, iOS Settings > Privacy and
  security, or the message menu.
- Terms: `GET/POST /api/me/terms`, accepted once per person with the date
  (`TERMS_VERSION`), asked by the desktop (`TermsGate`) and the phone
  (`TermsAcceptanceSheet`) after sign-in. An older server without the route
  asks nothing. The demo (`Demo.swift`) answers all these routes.
- Account deletion forgets the person's blocks and acceptance; reports stay
  with the admins.

## Seen by: read receipts (2026-10-08)

Who has seen a message, people and bots (2026-10-08). Keep these rules,
covered by `server/messages/read-receipts.test.ts`, `server/messages/read-receipts.e2e.test.ts`,
`src/lib/read-receipts.test.ts`, `src/components/SeenBy.test.ts` and
`src/components/GroupView.seenBy.test.ts`:

- Model (`server/messages/read-receipts.ts`): one position per participant per thread,
  `readUpTo[participantId] = { messageId, at }`, in the `thread_reads` table
  of `messages.db` (`server/messages/message-db.ts`); a thread without rows has no
  receipts (no migration) and its rows go with the thread. A person is their
  principal id (lowercase), a bot is `bot:<botId>`. `Store.markRead` only
  moves a position forward, onto a message of that thread, and emits the
  `thread.read` store change, broadcast as the `thread.read` frame. Never the
  transcript, the canonical event log (`bus.publish` tees to it, so it is not
  used) nor the admin audit.
- A person: `POST /api/threads/<id>/read { messageId }` from the renderer
  (`useReportRead` in `src/lib/read-receipts-feed.ts`): the last stored
  `[data-mid]` row on screen, debounced, only while the window has focus and
  is visible. `GET` answers `{ reads, self }` filtered for the viewer. In a
  room only its listed people, owner or creator leave one (403
  `not_member`); a bot-to-bot channel has none; the usual thread gates
  (bot visibility, private threads, people DMs) answer 404 first. Client
  scope and the companion allowlist carry both methods.
- A bot: set by the server at prompt build, before `sendTurn`
  (`noteBotRead`). A direct turn: the newest of the person's lines the turn
  carries (`userMessage` and drained queue lines); a card continuation, the
  newest text line of the context it resumes. A room turn: the newest text
  line of `roomContextRows` (never a digest or a teammate's report: a summary
  is not seeing it), marked once the turn is dispatched. A line steered into
  a running turn counts when the next prompt carries it. Delivery to a peer
  bot through ask_bot keeps its own receipt (`peerDeliveryReceipt`).
- Privacy: in a conversation between two people, a person whose preference
  `sagax.readReceipts.v1` is `off` (Settings > Privacy > Send read receipts,
  organization server only, synced through `/api/me/preferences`) is shown
  to nobody, sees nobody's, and leaves no new position. Rooms and bots always
  show. Changing the choice sends `{ kind: "thread.read", threadId, reset }`
  to those conversations so clients fetch again.
- UI: a room or a people DM draws a `SeenByRow` (16px overlapping avatars,
  oldest reader first, on the viewer's side under their own line, tooltip
  "Seen by Alice at 14:02, Nova at 14:03") under the newest drawn bubble
  at or before each position that the reader did not write; the viewer is
  never drawn. A 1:1 with a bot draws only a `SeenCaption` ("Seen", or "Seen
  at 14:03" a minute or more later) under the last line the bot consumed,
  until it answers below it.

## People's labels (2026-10-08)

A person can carry one custom label ("CTO", "Dispatch"), shown the way a
bot's label is. Keep these rules, each covered by
`shared/person-label.test.ts`, `server/routes/person-labels.test.ts`,
`server/auth/principals.test.ts`, `server/person-labels.e2e.test.ts` (PL-1 to
PL-4), `src/lib/person-labels.test.ts`, `src/components/PersonLabel.test.ts`,
`src/components/PersonLabel.edit.test.ts` or `PersonPanel.test.ts`:

- Free text, one line, trimmed, at most 40 characters
  (`normalizePersonLabel`, `PERSON_LABEL_MAX` in `shared/person-label.ts`);
  blank or null clears it.
- Stored by Sagax on the principal (`Principal.label`,
  `PrincipalRegistry.setLabel`), never in Perspicax. Absent means no label;
  a malformed stored value reads as absent and never drops the person. No
  migration.
- `GET /api/people/labels` lists every listed person's label (the
  directory's people on an organization server, the operator on a solo one);
  `GET /api/org/directory` carries `label` too. `PUT
  /api/people/<principalId>/label` `{ label }` lets the person change their
  own, an organization admin (the operator at this computer) anyone's and a
  Perspicax manager the people of a team they manage; anyone else gets 403
  `person_label_forbidden`, an unknown or merged person 404, a bad label 400
  `label_too_long`, `label_one_line` or `label_type`. Both are in
  `CLIENT_ALLOW`; the handler decides (`personLabelRight`).
- Each change goes to every stream as `{ kind: "person.label", principalId,
  label }` (null cleared it); the renderer patches `src/lib/person-labels.ts`
  from it. A change made for someone else (admin or manager) is written to
  the admin activity log (`people.label`, `after.by`); a person's own is not.
- One tag for both (`src/components/LabelTag.tsx`), `tone` sidebar or
  surface. It is for people's labels only: a bot's title is
  plain secondary-grey text under the name, never a tag, a pill or an outline (the owner's rule of 2026-11-06; see "Titre du bot" in docs/design/ux-reference-grokbot-cursor.md).
  A person's label shows beside the name in the
  sidebar people rows (not in quiet rows), the direct conversation's header
  chip, a room's member list and the people pickers (To:, add to a group). The
  Team map has no people. Empty renders nothing; "Add a label" appears only
  where it can be edited: under the name on the person sheet (the person, an
  admin, their team's manager; `canEditPersonLabel`) and in Settings >
  General for your own (`settings/MyLabelField.tsx`).

## Presence: online, away, offline (organization server, 2026-10-08)

The maintainer asked for an online / away / offline indicator on people. Keep these
rules, covered by `shared/presence.test.ts`, `server/people/presence.test.ts`,
`server/routes/presence.test.ts`, `server/people/presence.e2e.test.ts`,
`src/lib/presence.test.ts`, `src/components/PresenceDot.test.ts` and
`electron/system-idle.node-test.mjs`:

- The thresholds and the state machine are one module,
  `shared/presence.ts`: online (a client of the person is connected and
  they used it within 5 minutes, `PRESENCE_AWAY_AFTER_MS`), away (connected
  but idle longer, or the desktop says the computer is idle or the screen is
  locked), offline (no client: every event stream closed and the 20 s
  reconnect grace passed, or no sign of a client for 10 minutes,
  `PRESENCE_OFFLINE_AFTER_MS`). A person is as present as their most
  present client. Change a threshold there, nowhere else.
- Server (`server/people/presence.ts`, `PresenceTracker`, in memory only): one
  connection per signed-in session, from its `/api/events` streams
  (`connect` on open, `touch` on each keepalive, close on close) and its
  pages' heartbeats. `presenceViewer` in index.ts decides who counts: a
  session of this issuer whose person is in the directory, not disabled,
  not a `service` account. The loopback and a solo server never count. A
  sweep every 15 s turns crossed thresholds into news.
- Routes (`server/routes/presence.ts`, CLIENT_ALLOW with `orgDirectory`):
  `GET /api/org/presence` lists every active person of the directory with
  `state` and `lastSeenAt`; `POST /api/presence/heartbeat`
  `{ pageId, kind: "desktop" | "web", idleMs, systemIdle? }`. A solo server
  answers 404, a service account or another issuer 403, no session 401.
  An admin sees exactly what a member sees.
- Live: a change is broadcast as `presence.changed` (`shared/wire.ts`).
  `sseFrameFor` passes it only to streams of the organization's people
  (`presenceFrameAllowed`); the copy with `audience` (the person's own real
  state) reaches that person only. Presence is never written to a chat, the
  journal, a backup or a package.
- Privacy: Settings > Privacy (`src/components/PrivacySettings.tsx`, next
  to "Send read receipts") > "Show when I am online" (on by default) is the
  synced preference `sagax.presenceVisible.v1` ("0" hides). A hidden
  person reads as offline with no last-seen time for everyone else; they
  still see their own state, "(hidden from others)". Saving the preference
  re-announces the person at once (the preferences route calls
  `presence.refresh`).
- Renderer (`src/lib/presence.ts`, started from `src/main.tsx` for a
  signed-in session): reads the list, applies the frames, re-reads every 5
  minutes and when the page comes back into view, and beats every 60 s with
  the page's idle time. The desktop app adds `window.ogb.systemIdle()`
  (`desktop:system-idle`, `electron/system-idle.mjs`,
  `powerMonitor.getSystemIdleState(300)` and the idle seconds; main window,
  top frame only, safe on an organization page); using the computer counts
  as being there. Coming back after an idle spell beats at once.
- The dot is `StatusDot` (`src/components/StatusDot.tsx`), the same
  component as a bot row's working / waiting / teammate / queued dots;
  `PresenceDot` and `WithPresence` (`src/components/PresenceDot.tsx`) give
  it the person's state, an accessible name and a tooltip ("Online",
  "Away", "Offline, last seen 2 h ago"). `PersonAvatar` takes
  `presenceId`. It shows on the sidebar's people rows, the direct
  conversation's header chip, the person panel, a room's people list
  (`ChannelMembers`), the To: picker, the sharing picker (`GrantEditor`),
  the room's people picker (`GroupPeoplePicker`) and your own account row.
  The Team map holds bots only and has no person to mark; there is no
  @mention of people and no run-as picker yet: give them the dot when they
  exist. Nothing shows where presence does not exist.
- The phone apps neither send heartbeats nor show the dot yet; a phone's
  open stream counts as connected (online for 5 minutes, then away).

## Group settings

A group has no setup dialog and no pending setup state. Every group setting
lives in its side panel (`src/components/GroupPanel.tsx`, the bot panel
shell): the name is edited in place at its top (its owner) and the (i)
beside it shows the instructions; Details holds the people and bots; Instructions holds the
group instructions (`bulletin`); Advanced holds the default responder (a
specific lead, Auto with Jev, everyone, or only when mentioned) and the
working folder (empty means each bot's own folder). Keep these rules:

- A new group is usable at once: `store.createGroup` stamps
  `setupCompletedAt` at creation and the composer is never locked.
- A group an older build left pending (`setupCompletedAt: null` and no
  `setupSkippedAt`) is migrated to set up when the store loads.
- There is no `PATCH /api/groups/:id/setup`; edits go through
  `PATCH /api/groups/:id`. `POST /api/groups` still takes an optional
  `setup` (`bulletin`, `defaultResponder`) to create a group in one call.
- A remote client sees no Advanced tab and the instructions read-only.

### Group owner (organization server)

On an organization server (`SAGAX_IDENTITY=perspicax`) only a group's owner
changes its settings (`server/groups/group-ownership.ts`, client
`src/lib/group-owner.ts`; covered by `server/groups/group-ownership.test.ts` and
PT-4 in `server/org/org-private-threads.e2e.test.ts`):

- The owner is `createdBy`, else the first person in `humanIds`, else
  nobody, and then the organization admins act as owner. The wire group
  carries it as `ownerId` (absent on a solo server, where nothing changes).
- Only the owner changes the name, instructions, working folder, default
  responder, bots and people (`PATCH /api/groups/:id` answers 403
  `not_group_owner`). Anyone listed may remove only themselves (leave),
  and add or remove their own bots (never another person's, never a
  reorder). The owner removes any bot or person.
  Marking read, pins and section moves are not settings.
- An admin has no override on content. `DELETE /api/groups/:id` is the
  owner's, or an admin's for moderation (`channel.moderate` on a room in
  `server/auth/authz.ts`). A client-scope session may delete only there.
- The owner of a client-scope session also picks the default responder.
  The working folder keeps the admin scope (it touches the host or sandbox
  filesystem): a non-admin owner sees it read-only with a note.
- The panel shows the settings read-only to everyone else, with "Seul le
  propriétaire du groupe peut modifier ces réglages", a Leave button,
  "Ajouter mon robot" and a remove button on their own bots only.
