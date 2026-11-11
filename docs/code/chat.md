# Chat and the one conversation

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Background threads stay out of thread mode (#2015, 2026-11-05)

`shared/background-threads.ts` (vectors in `background-threads.vectors.json`,
same cases in CompanionCore `BotTask.isBackground`) is the one rule: routine
runs, results threads, hand-offs (`work`/`pair`), threads a bot opened and
AI-client conversations (`agent`, #291 `hidden`) are background, unless a
person wrote there (`WireTask.personWrote`, from `askedAt`; never for
`agent`). Background threads never show in the bot's one conversation
(unified chat: see "One conversation: THE rule"; the owner's rule of 2026-11-05, #2098). `server/threads/background-sweep.ts` archives finished idle background
threads at start and every 10 min (`SAGAX_BACKGROUND_ARCHIVE_IDLE_MIN`, 30):
never deleted, never one a person wrote in, at work, held, pinned,
confidential or on screen; `autoArchived` marks it and a person's write
restores it. A direct work thread closes once answered, whatever the answer;
an AI client's conversation is archived once await_turn collects its reply.
Scenario: `server/threads/background-sweep.test.ts`. Captures:
`scripts/capture/background-threads.mjs`.

## Traces between bots in a bot's chat (#3581, 2026-11-11)

Every trace between bots is the one quiet names line (`NamesLine` in
`src/components/BotNamesLine.tsx`), in both directions, never the quoted
request: "Asked [faces]" / "Messaged [faces]" for what this bot sent (a
`send_to_bot` receipt joins the Messaged line, `messagedChip`; its state is
the line's tail only when it failed or waits on the person), and "Asked by",
"Message from", "Answer from" for what came in (`src/lib/incoming-line.ts`,
drawn by `IncomingLine` in `src/components/HandoffRow.tsx`): a received
hand-off, a surfaced notice, an answer whose receipt is above the page, and
every stored copy of a background reply from a teammate or an AI client
(`relayVia` `teammate` or `mcp`, written before or after the change; the
server still writes the AI client's copy in the shape the released apps
draw). A run folds into one line, one name per party and "N requests" when
there are more requests than names; a name opens that party's exchanges of
the line, newest first, in the bot-to-bot sheet (a stored copy's request and
reply; a thread's live transcript, one at a time). Two or more teammates'
replies relayed for one request are one step row each (`relayedFrom`), one
stays the bubble. Every card of a chat has the approval card's width.
Quiet mode has no screen left. Tests: `src/lib/incoming-line.test.ts`,
`src/components/ChatView.ask-line.test.ts`,
`src/components/HandoffRow.incoming.dom.test.ts`,
`src/components/chat-rows.guard.test.ts`.

## A result that needs the person reaches the person (2026-11-05, #2014)

A bot's turn that ends outside the person's own conversation with it (a
hand-off, a thread another bot opened, a one-way notice, a routine run's
task after its run ended) and carries a structured signal for the person
(`shared/person-attention.ts`: a `[HUMAIN]`/`[HUMAN]`/`[NEEDS_HUMAN]` item
line, a `needs_human` array in a JSON block, `NEEDS INPUT:`, `RUN_STATUS:
failed|partial`) posts ONE card into the person's conversation with that bot
(`server/turns/person-attention-relay.ts`, called from index.ts
turn.completed): `WireMessage.attention` on a text row, its items with
`Open ticket` (ConnectWise link from `SAGAX_CW_SITE` or the thread's own
CW cards), `Open run` (the run in the bot's one conversation, never a
side panel); the conversation turns unread and a
`needs-you` notification rings (desktop and phone). Never guessed from
words, never in the person's own conversation, once per source message.
A routine run that is still active reports through its own card instead:
`routineReportOutcome` is never quiet with such items, `routineRunReportable`
posts them whatever `postResults` says, and the routine.run row carries
`attention` (RoutineRunCard draws the items). One result, one card, one ring: a run
whose card is already in the chat takes the items on that card (a late
resume included, `onRunCard`), never a second card; the standalone card is
only for a result that reached no card there (a hand-off, another bot's
thread). A routine run's task resumed
after the run ended puts the bot's answer onto the run's own card
(`mirrorLateRunReply` patches the routine.run row, `Message.lateRunReplyOf`
keeps it once), or posts it as any routine result when the run has no card
in the chat (#3581). Desktop
`src/components/AttentionCard.tsx`, iOS `AttentionCardView.swift`.
A failed tool call always carries words: the Claude driver reads
`tool_use_result` when the content block is empty, else `emptyFailureNote`;
the Perspicax relay fills an empty `isError` result from `structuredContent`
or a sentence (`withFailureWords`). Tests: `shared/person-attention.test.ts`,
`server/turns/person-attention-relay.test.ts`,
`server/person-attention.e2e.test.ts`,
`server/drivers/claude/stream-content.test.ts`. Captures
`node scripts/capture/needs-you-card.mjs`.

## Native resumable attachments (2026-10-31)

The iOS composer and Share extension use `CompanionCore/AttachmentUpload.swift`
against the existing authenticated `phase=status|chunk|commit|cancel` routes.
Keep each attachment UUID through retry, validate durable offsets and receipts,
and send cleanup from an independent Task with the original connection. The
server decides whether a committed file is still referenced. Native drafts and
upload states live in `Session`, keyed by connection/thread; pending or failed
chips hold Send, and removal also forgets an obsolete failed-send retry.
`AttachmentTransferJournal.swift` persists protected files, draft text,
offsets, receipts and accepted send envelopes. App Group shares hand off via
`AppShared/SagaxSharedTransfers.swift`; the containing app resumes on foreground.
Use a cross-process lease and cancellation tombstone. Replays preserve the
exact body, SendOptions and sendId, including reply/page/busy routing. Never
restore a total 90-second upload deadline or purge durable jobs with temporary
ShareInbox copies. Picker files are app-owned protected copies. Two
transfers each read at most 4 MiB. Preserve 32 items, the 200 MiB image aggregate,
32/90 MiB shared/solo images, 250 MiB ordinary files and 1 GiB videos.
Transient failures (network, 408/409/425/429, 5xx) retry in place after
1/3/8 s, re-reading the durable offset; local file changes and definitive
4xx refusals do not. A refused outbox delivery is removed (server cancel
sent, composer draft kept) rather than replayed. `SagaxTransferActivity`
holds an expiring-activity assertion (app and extension) while a transfer
runs; past it, the journal resumes on foreground or reconnect.
Quick Look uses message-scoped URLSession disk downloads; automatic thumbnails
keep their separate buffered ceiling. Tests: `AttachmentUploadTests`,
`MessageAttachmentsTests`, `ShareClientTests`, `DemoFilesTests`. Evidence and
physical limits: `docs/plans/grok-convergence-media-evidence.md` (iOS section).

## A reply shows as it is written (2026-10-29)

Settings > Appearance > Conversation > "Show replies as they are written"
(`sagax.streamReplies.v1`, "on" | "off", absent is on; a person's preference
for all their bots, synced through `shared/user-preferences.ts`; a bot sets
it with `sagax_settings` `appearance.streamReplies`, no new tool). The
engines already streamed (Claude Code `--include-partial-messages`, Codex,
Pi, ACP, OpenAI chat and Responses) and the server already sent every
`content.delta` (bus merge 50 ms, `runtime` frame); the desktop and web
stopped at the render: the store buffered the text per frame and nothing
drew it. Now `LiveReply` (`src/components/LiveReply.tsx`, in `ChatView` and
`GroupView` above `TurnPresence`) draws the thread's in-flight text in a bot
bubble: only it re-renders per frame; the Markdown is cut into finished
blocks and the growing one (`src/lib/live-markdown-blocks.ts`), each block
its own memoized `ChatMarkdown`, so a token parses only the last block; an
open fence renders as code. The bottom follow (`useBottomFollowResize`)
keeps up through the transcript's resize. The settled message replaces it
in the same commit, without the pop-in (`liveShown`); `TurnPresence` hides
while the words are on screen. Off: nothing drawn, the reply comes whole.
iOS already drew it (`ChatLiveTail`); it now follows the same key
(`SidebarPrefs.streamReplies`, Appearance and desktop settings). Tests:
`src/components/LiveReply.dom.test.ts`, `src/lib/live-markdown-blocks.test.ts`,
`server/streaming-reply.e2e.test.ts` (fake CLI deltas end to end),
`PersonPreferencesTests`. Captures `node scripts/capture/live-reply.mjs`.

## A reply is never an error (2026-10-29)

A bot's reply always reads as a reply, its Markdown whole. Claude Code can
flag a turn as an error after it answered in full; its `result` then holds
the reply. The driver keeps that reply as the answer (`resultRepeatsReply`,
`server/drivers/claude.ts`): the turn completes and the flag goes to the
Events lens as a `runtime.notice`, never to `claudeResultError` as a cause.
Rows stored before that ("error: <the reply>", or a requester's account that
starts with it) are not drawn: `repeatedFailureIds` (`shared/failure-dedup.ts`,
iOS `FailureDedup`) leaves out a failed row whose cause only repeats a bot
reply of the thread (`failedTurnRepeatsReply`). The red card stays for a real
failure without a reply. A usage limit in its plural words ("You have reached
your usage limits") reads as one (`USAGE_LIMIT`), so the limit failover takes
the turn instead of a raw "HTTP 400" card. Gallery
`src/gallery/reply-flagged-error.html`, captures
`node scripts/capture/reply-flagged-error.mjs`.

## The task sheet, redone (2026-10-29)

The window that opens on a sub-agent, a parallel task or a run
(`ActivityDetailModal`, `ActivityDetailPane`) reads top down: the head, what
waits on the person, then the body. Its pieces are reusable components
under `src/components/task/`, each pure (props in, no fetching), so the
routine run detail and any other sheet of work draw from the same ones.

- `TaskStatusHeader`: the bot's pill (mascot, name), the title, one line in
  plain words (`taskStatusWords`): "Working · Reading clients.csv · 4m so
  far", "Waiting for your approval", "Finished · in 12m". The step is
  named by the working line's table (`currentTaskStep`,
  `shared/working-step.ts`; the plain step name when the table only knows
  "a tool"). Stop and Open conversation sit at the right of the head.
- `WaitingOnYou`: an approval or a question the task, or one of its
  sub-agents, waits on, with its answers: the conversation's own cards
  (`PendingApprovalBox`, `OptionCard`), read off the waiting threads by
  `useWaitingCards` (`src/lib/use-waiting-cards.ts`, `waitingSources`).
  A run that waits without a readable card shows what it asks and opens
  its conversation. Never more than half the sheet; it scrolls on its own.
- `ActivityStepGroups` over `groupActivitySteps`
  (`src/lib/activity-step-groups.ts`): the same step repeated back to back
  reads once with a count ("×12"), a running step, a sub-agent's step or a
  failure never merges in, the place a step ran is marked once and then
  only when it changes, one disclosure per group with every call inside.
  Rows are the chat's `StepRow`: no dot per row, shimmer while it runs,
  the danger tone only on a failure.
- `SubagentList` (`sortSubagents`): mascot, title, state and step, time;
  the waiting one first and marked.
- `TaskFacts` (`taskFacts`): started, ended, duration, started by, bot,
  engine, paid with and the files touched, folded under Details; closed, it
  names who started it and the engine. Nothing of the old facts card is gone.
- `TaskComposer`: the message into a running task, drawn like the chat's
  composer, at the bottom of the summary column.
- Gallery `src/gallery/task-sheet.html` (a long run of the same action, a
  question, four sub-agents of which one waits on an approval); captures
  `node scripts/capture/task-sheet.mjs` (desktop and narrow, light and
  dark). iOS: `BotActivityDetailView` follows the same order (head with
  Stop and Open conversation, "Waiting on you", sub-agents sorted by
  `BotActivitySubagents`, steps grouped by `BotActivityStepGroup`, facts
  folded under Details, the steer box last), both in CompanionCore.

## The working line names the step (2026-10-29)

While a tool call runs, the line under the transcript names the step in
plain words: "Reading your email", "Opening Chrome", "Searching the web",
"Running scrape.py", "Writing a file". Once the step has been quiet for a
minute it adds "last output 2 min ago". Nothing was taken off the line: the
mascot, the dots and the elapsed time stay, and between calls it still reads
Thinking.

- One table, `shared/working-step.ts` (`workingStepFor`), maps a call to a
  key and a short detail, whatever the engine: Claude Code's `Bash` with its
  command, Codex's command line as the name, an ACP agent's own title, an
  OpenAI-compatible function with JSON arguments, MCP mail, calendar, Teams,
  browser, computer and file tools. Same key, same words on every engine.
- The detail is only a file name, an app, a web host or a program (`python
  scrape.py --key x` gives `scrape.py`), never arguments, queries or paths.
  `server/working-step.ts` runs it through the redaction; a detail the
  redaction touches is dropped.
- The server sets `tool.step` on the activity row at `item.started`
  (`server/index.ts`). Older clients ignore it. The desktop words it in
  `src/lib/working-step.ts` (`chat.step.*` in every locale) through
  `liveActivityPhrases`, so the sidebar's working label follows; the phone
  in `ios/App/Features/Chat/WorkingStepText.swift` (String Catalog) from
  `WorkingStepLine.current` in CompanionCore.
- The quiet time counts from the step's row (`currentWorkingStep(...).since`):
  any later output would be a newer row or streaming text, which takes the
  line over.
- End to end: `server/working-step.e2e.test.ts` (fake engine holds a call,
  the event stream carries the step, the turn ends and the line names
  nothing). Captures: `node scripts/capture/working-step.mjs`.

## Split view: several conversations in one window (#1504, 2026-10-28)

- `src/lib/split-view.ts` (layout tree, pure edits, stored copy) and
  `src/components/SplitWorkspace.tsx` (rendering, drop marker, handles).
  App.tsx wraps the main view in `SplitWorkspace`; not split, it renders
  the main view alone. The tree's leaves are sections; one is always the
  main chat (`MAIN_LEAF_ID`, driven by the sidebar selection, never closes).
  A split lays its children in a row or a column with shares (`sizes`).
- Making a section: drag a bot, a group or a thread row of the sidebar
  (payload `application/x-sagax-split`, every row is draggable now) onto
  the conversation area. Near the window's edge (36 px): a section along
  that whole edge. Near a section's edge: a section beside that one. A
  section's middle: it shows the dragged one instead (the main chat's
  middle opens it there). Or Split right / Split down in the "..." menu
  (`ExportTranscriptMenu` `onSplit`): the conversation beside the main chat.
- A bot section is `ChatView` with `side`, a group section `GroupView`
  with `pane` (own header, no calls, no ⌘F, no window banners, no group
  panel), each over its own copy of the thread (`useSideTranscript`), with
  its own composer. Without a threadId it follows the conversation's open
  thread; a thread row (or Split with threads shown) pins one. On screen in
  a section marks it read; the main selection is untouched. Header: Open in
  the main conversation, Close. The handle between two sections resizes
  them (pointer or arrow keys, at least 12 % each).
- The layout is this device's (`sagax.splitView.layout.v1`, try/catch, a
  damaged copy opens whole), not a synced preference: it depends on the
  screen. Below md only the main chat shows; the layout stays.
- Every section's header, a bot's and a group's, is the main chat's
  `BotHeaderPill` (mascot or member faces, name, chevron; ChatView or
  GroupView builds it, `SideChat.header` takes it, `SideChat.panel` drives
  it), centered at the top of the section as in a normal chat; Open in main
  and Close stay in the corner. Its click opens that bot's panel (Activity,
  Library) or that group's panel with `toggleSettings` `owner:
  { leafId, botId }` or `{ leafId, groupId }` (`AppState.panelOwner`): the
  main selection does not move. The panel always opens at the window's
  right edge, wherever the section sits: App.tsx draws the bot's
  (`useBotPanelBot`), a group section's GroupView portals its GroupPanel
  into App's `[data-split-panel-slot]`, past the content frame. One panel
  at a time: the slot is shared, so a section's pill takes it from the main
  chat's and the other sections' (their pills read closed), the main pill
  (`owner: null`) takes it back, a link naming a bot other than the owner
  gives it back to the main chat, a link without a bot (from inside the
  panel) stays with the owner. Closing the panel clears the owner (the
  `reducer` wrapper); closing the section or showing another conversation
  in it closes its panel (SplitWorkspace effect).
- Tests: `src/lib/split-view.test.ts`, `SplitWorkspace.test.ts`,
  `SplitWorkspace.panel.dom.test.ts` (pill centered in every bot and group
  section, panel at the right edge, one panel), `src/state/panel-owner.reducer.test.ts`,
  `ExportTranscriptMenu.test.ts`, `GroupView.test.ts` (pane case).
  Captures: `docs/screenshots/split-view/` (pill and panel:
  `scripts/testing/capture-split-panel.ts`).

## An AI client talks to a bot as another agent (2026-10-29)

A person's AI client over MCP (`send_prompt`, `sagax_send` through
Perspicax) is not the person typing: its turns go to its own conversation
with the bot, drawn like a bot-to-bot one ("<client> ⇆ <bot>", neutral
icon), never into the person's chat, and nothing in it notifies them
(push, watch, banner, sound, red dot) except an approval or a question,
which reaches every device, phones and watches included (#1984,
2026-11-04). One rule, one place: `shared/agent-conversation.ts`
(opener `{ kind: "agent", botId: "agent:<slug>", name }`, the notification
rule); `agentConversationFor` in server/index.ts opens or reuses it per bot,
person and client; the name is the `client_name` Perspicax signs into the
member assertion. The turn still runs as the person. Tests:
`shared/agent-conversation.test.ts`, `server/org/org-member-api.e2e.test.ts`
(M1, M6, M7), `src/components/BotConversations.sheet.test.ts`, iOS
`BotConversationsTests`.

## Shopping cards, order tracking, subscription templates (2026-10-29)

Decision (reference app 0.78 parity, the maintainer): the bot shows products as cards,
follows the order to the door, and offers subscription templates. The
person's Primary Bot does everything on request, payments included; the
bot's approval level is the only barrier (no "a human must click" case).

- Widgets (`shared/widget.ts`): `Carousel` (1 to 8 `Product`, in stock
  first, stable) and `Product` {title, src, price, compareAtPrice,
  currency, store (or seller), rating, reviews, badges (3), inStock, url,
  delivery, buyLabel, buyAction}. The parser writes a Product's children
  itself (whatever the bot put there is replaced): its `Image`, a primary
  `Button` Buy now (`buy_now` with title, price, currency, store, url; off
  when out of stock) and View (`open_url`, on the device). A product's
  buttons are always named after it ("Buy now: <title>"), here and in iOS
  `ChatWidgetRules.actions`. Renderers: desktop
  `src/components/widget/WidgetProduct.tsx`, iOS
  `ios/App/Features/Chat/Widget/ChatWidgetProduct.swift`; an older client
  draws the picture and the buttons. `show_widget` describes them; a press
  arrives as the person's message and the bot then opens the page and calls
  `request_purchase`. Sample `shopping` (`shared/widget-samples.ts`, phone
  fixtures regenerated by `scripts/gen-widget-fixtures.ts`).
- Full approves a purchase at once (`fillResolverFor` option `autoApprove`,
  wired in the browser route from `approvalModeForTurn`): the card shows
  "Allowed" via "Full access". Below Full the card asks as before. A
  person whose security key guards purchases (`purchase.allow`) keeps the
  card: the key is physical.
- Order tracking (`shared/order-tracking.ts`): `record_purchase` takes
  `tracking` and starts every non-flight order at `ordered`;
  `update_order_tracking` (browser tool beside it) moves it (ordered,
  shipped, in_transit, out_for_delivery, delivered, exception; carrier,
  number, url, eta, note), by order number among the bot's orders for this
  person or the latest of the conversation. The purchase card (its own
  conversation) draws four steps (`OrderTrackingView`, desktop and iOS).
  As the bot declared it, never read by Sagax from a page.
- Follow-up (`server/order-follow-ups.ts`, `order-follow-ups.json`, 0600):
  the routine `record_purchase` starts. Every 10 min the due orders wake
  the bot in the purchase's conversation (`outbound.orderFollowUp`); its
  `update_order_tracking` sets the next check (`check_again_hours`, 24 by
  default, 1 to 168); unanswered, it asks again a day later; delivered, or
  30 days after the order, it stops.
- Subscription templates: role `subscriptions` (`src/lib/bot-roles.ts`,
  `shared/bot-wizard.ts` kit, iOS `WizardRole.subscriptions`,
  `NewBotOptions`) with three routines: `trial-watch` (a free trial
  cancelled before it bills, daily), `unused-subscriptions` (weekly) and
  `renewal-prices` (weekly). The bot cancels once the person says so.
- Tests: `shared/widget.test.ts` (products), `shared/order-tracking.test.ts`,
  `server/order-follow-ups.test.ts`, `server/vault/credential-vault.orders.test.ts`,
  iOS `ChatWidgetTests` (fixtures). Gallery: `src/gallery/chat-widgets.html?only=shopping`,
  `src/gallery/outbound-cards.html?only=purchase`.

## The person can always write (2026-10-29)

The composer's box is never disabled by a pending approval: the card waits
in the chat (PendingApprovalBox), the placeholder says it stays open, and a
message sent past it goes out as any message to a working bot (steered in at
the turn's next safe point, routed or queued by the server, never a 409).
The one lock left is a thread's page on its way after a switch
(`Bot.awaitingThreadSnapshot`), bounded to `SNAPSHOT_LOCK_MAX_MS` (8 s) by
`useBoundedLock` (src/lib/composer-lock.ts): a page that never lands (a
server restart, a dropped fetch) gives the box back by itself. The other
states only refuse the send and keep the draft: a certain "no" from the
server (shared/send-state.ts, one line with the one thing to do, asked again
every 15 s and on focus; never with Auto), an attachment still uploading, a
dictation in progress. Tests: `src/components/Composer.approvalOpen.test.ts`,
`src/lib/composer-lock.test.ts`.

## Widgets check themselves before they show (2026-10-19)

Decision: "Le bot doit être capable de se contre-valider et de l'ajuster
dynamiquement quand il le construit." A bot passes the HTML of a ```widget
fence to `check_widget` (`server/drivers/agents-widget-tools.ts`) before it
shows it; the system prompt says so (`WIDGET_SELF_CHECK_PROMPT`).

- `server/widgets/widget-check.ts` renders the chat's own document
  (`buildWidgetDocument`, iframe sandboxed to allow-scripts) at 720 and 360
  px, light and dark, and `server/widgets/widget-check-audit.ts` reports: JS errors,
  horizontal scroll, overflow, clipped, overlapping or crushed text, hidden or
  covered controls, contrast below 3:1, targets under 24 px with a neighbour
  (or under 12 px). The bot gets the list plus a small JPEG as the tool result.
- Three checks per turn (thread + generation); a fourth is refused without a
  render, and the same HTML again costs nothing. After the third failure the
  bot shows its best version in a ```widget-imperfect fence; the chat draws it
  with a discreet "Affichage imparfait".
- One warm headless Chrome over a CDP pipe (no port, no window), closed after
  3 idle minutes, never started while `memoryWatch` is high or critical (#804),
  OOM score 900, 20 s deadline per check, at most 4 checks waiting. No
  network at all (closed proxy, loopback included, plus Fetch interception):
  a widget that navigates its frame away is reported, never audited. Chrome: `SAGAX_WIDGET_CHECK_CHROME` (`off` disables), then
  `AGENT_BROWSER_EXECUTABLE_PATH`, the desktop bundle, a Playwright headless
  shell. Never the person's browser. No Chrome: the tool says "unavailable".
- Tests: `server/widgets/widget-check.test.ts` (fixtures in
  `server/testing/widget-check-fixtures/`, broken ones must fail, healthy ones
  must pass with no defect).

## AI clients' conversations are hidden; reading clears everywhere (2026-10-11, #291)

- An AI client writing through the member API (Pulsatrix `sagax_send`,
  any actor but the Sagax console) uses its own **hidden** conversation
  with the bot (`task.hidden`, `server/org/org-member-routes.ts`): never in the
  person's sidebar, previews, typing dots, unread, badge or notifications,
  and it never moves their selected conversation. It stays reachable from
  the bot's Activity panel and links. The server drops hidden tasks from
  every bot projection unless that thread is the one selected
  (`listedTasks`, `shownBotActivity`, `notify()`), so older clients benefit
  without a rebuild; web and iOS filter too (`taskHiddenFromSidebar`,
  `BotTask.isHiddenFromPerson`). Earlier `newThread` conversations from the
  admin activity log were hidden once at startup (`hideEarlierAgentThreads`,
  marker `agent-threads-hidden.v1`). A card waiting in a hidden
  conversation is answered by the AI client (`sagax_approve`), not shown
  to the person.
- What a ping costs (measured by `server/ai-client-turn-context.e2e.test.ts`,
  `AI_CLIENT_CONTEXT_REPORT=<file>` writes the figures): the engine reads a
  conversation's whole history again every turn, plus the system prompt and
  tool schemas. `send_prompt` from a person's AI client therefore opens a
  fresh hidden conversation by default (about 5 100 tokens instead of 9 300
  after a few jobs); it continues one only when the caller passes
  `thread_id` (one of its own). Bots calling `send_prompt` keep one
  conversation per pair. `sagax_send` continues the hidden thread unless
  `newThread: true`, and honours a `threadId` as given: the one `sagax_bots`
  lists is the person's own visible conversation.
- A conversation that buzzed the phones and is then read anywhere sends
  each phone one silent `read` push; the phone withdraws its banner and
  recounts the badge, and withdraws settled bot banners whenever its unread
  count drops (`docs/ios-push.md`).

## Chat parity leftovers (2026-10-21)

- A visualization (`ArtifactFrame`) says when a script fails and when it
  has not reported a size within 10 seconds. Full screen opens that frame
  over the app. Widgets still appear only when the person asks (#876).
- Cancel reply removes a message that is still only on screen. Once the
  POST has started, the chat says it is already being sent.
- An archived thread shows "Showing saved messages" until dismissed.
- Email drafts can be turned off per bot (`emailDrafts: false`, Permissions).
  The prompt drops the email fence and `POST /email-drafts` answers 409
  `email_drafts_off`. A draft card says who it was created for.
- A goal card in a room with more than one goal says "Goal n of total",
  lists the earlier goals, and can show the full goal text.
- Always allow on a send card (email draft, a plain message send, or
  ask_bot / delegate_bot) adds that recipient to the bot's allowed list.
  It does not replace the Permissions list screen.

## Composer: one bar in Simple and Advanced (2026-10-08)

the decision: the chat bar is the same in both modes, and it is the
Advanced one. `src/components/Composer.tsx` reads no interface mode. Keep
these rules, covered by `src/components/ChatView.controls.test.ts` ("renders
the same composer row in Simple and Advanced mode"),
`src/components/ApprovalModeSelector.simple.test.ts` and
`src/components/ModelPicker.simple.test.ts`:

- One row: the + menu, the message field, voice and send. The + menu holds
  attach, teach, voice note, the modes, then this conversation's rows: Model
  (the model in use, effort included, at the row's end), the approval level
  and its full menu (a warning sign for Full access, the command allowlist
  for an owner or admin). No "where the bot works" chip, no model chip and
  no emoji button in the bar (2026-10-18); no approval chip or cards in
  Simple.
- The slash menu lists the same commands in both modes.
- Guards stay where they are, whatever the mode: the Full access and local
  Auto warnings, the packaged-desktop rule for Full and Custom, the
  organization's Full access switch.
- Simple still hides settings sections, bot panel sections and the model
  picker's engine controls (`src/lib/interface-visibility.ts`,
  `ModelPicker.tsx`). Bot settings in Simple keep the two stacked approval
  choices (`ApprovalModeSelector` with `wide`).

## Coding chat: a coding task opens where the chat is (2026-11-03)

Decision (maintainer): a row of Details > Coding no longer opens the task sheet in the
side panel. It opens as a chat over the chat column (`AppState.codingChat`,
actions `openCodingChat` / `closeCodingChat`, drawn by ChatView like
`routineRunSheet`; a routine run, another bot or a closing panel closes it),
the same family as the routine run sheet, drawn for development
(`src/components/coding/CodingChat.tsx`, pure reading in
`src/lib/coding-chat.ts`, UX in `docs/design/ux-reference-grokbot-cursor.md`
2.24). Source: the task's own thread (`useSideTranscript`: the messages'
`tool.input` / `tool.output` previews) and its activity entry (polled every
3 s while it runs, and 30 s after a follow-up; a reload keeps the screen).
A task without a readable thread (a cloud agent, a private run) shows the
entry's steps. Commands are terminal blocks with test counts (vitest, jest,
pytest, cargo, go, node:test, mocha); Edit / MultiEdit / Write, apply_patch
and Codex file changes are diffs per file (`git diff` output too); reads are
file chips. A file edit's arguments keep up to `EDIT_PREVIEW_MAX` (24,000)
characters (`inputPreviewMax`, server/tools/tool-summary.ts) so a modest
edit is not cut in half. Paths read relative to the task's folder, else as
their last two segments; UUIDs are masked. Continue posts to
`/api/bots/:id/messages` with the task's `threadId` (`busyMode: "steer"`
while it runs). Launched coding agents and the history deep link open it
too; routine runs and sub-agents keep their own sheets. Tests:
`src/lib/coding-chat.test.ts`, `src/components/coding/CodingChat.dom.test.ts`,
`ActivitySection.coding.dom.test.ts`. Captures: `node
scripts/capture/coding-chat.mjs` (gallery `src/gallery/coding-chat.html`).

## Parallel tasks (sending while the bot works, 2026-10-02)

A message sent to a busy 1:1 conversation carries `busyMode`
(`shared/parallel-tasks.ts`): `steer` joins the running turn (live steer or
the queue), `after` waits in the queue, `parallel` runs it as its own task.
A send that names no mode joins the running turn (the API, relays, older
builds). Since 2026-10-18 nobody is asked (the bot orchestrates); see
"Busy sends: the bot routes them" below.

## Busy sends: the bot routes them (2026-10-18)

Decision: "Le message est livré au bot tout de suite et le bot (orchestrateur)
décide." No chooser any more, desktop or iOS (`BusySendChooser` and the
iOS `BusySendChooserView` are gone, so are the personal `sagax.busySend.v1`
default and the bot editor's busy-send row; `busySend` is still stored,
exported and read by older builds, no client reads it). Rules, covered by
`server/busy-routing.test.ts`, `server/busy-routing.e2e.test.ts`,
`src/components/Composer.busySend.test.ts`,
`server/drivers/agents-catalog-route-message.test.ts` and the iOS
`ComposerSendTests`:

- The apps send `routeWhileBusy: true` (a field an older server ignores,
  so it steers as before) when the 1:1 conversation is busy and not on a
  call; `busyMode: "auto"` means the same. The server reads it as
  `BusySendRequest` `auto`; guarded relays and voice calls stay `steer`;
  a thread that is itself a parallel task, a routine run or a room never
  routes (`autoRoutableThread`) and joins the running turn.
- Engine that steers live: the words are steered in behind a short note
  (`orchestratedSteerText`: "[Sent while you work · route <handle> ...]",
  the handle is the steer id). THREADS_PROMPT (`server/system-prompt.ts`)
  tells the bot: a precision or a correction, use it now; an independent
  request, `route_message` `parallel` (it becomes a parallel task, the
  person's row turned into its request line, no second row,
  `startParallelTask` `existingRequestId`, `parallelOf.routed`); a request
  that needs the current result or the same files or records,
  `route_message` `after` (the row stays, a queue item with
  `existingMessageId` starts the next turn on that row, no pending chip,
  and the bot says so in one line). `handoffs.routedAway` keeps a routed
  message from being offered again as unseen.
- `route_message` (agents MCP, `threads:route`, tier own, member scope
  conversation) is offered only in a person's 1:1 turn
  (`SAGAX_ROUTE_MESSAGES`, depth 0, `autoRoutableThread`); its internal
  route (`server/routes/route-message-internal.ts`) re-checks depth, the
  bot and the thread the words were steered into (`RoutableSteers`, in
  memory, 6 h), and is idempotent per handle.
- Engine that cannot steer, or a refused steer (images, a pending computer
  choice, someone else's words on an organization server): the server
  routes (`classifyWithoutSteer`): the rule (`classifyBusySend`: a short
  correction or a dependency or a file or record named by the running
  request too means `after`) decides what it is sure of, else the bot's
  tool-free model (`busyClassifyEngine`, same gates as a segment digest,
  6 s), else the queue (2026-11-01: was `parallel`; an engine with no
  one-shot model, Grok over ACP, gave the bot no say and every unsure line
  became a second session answering beside the running turn). Never an
  error, never a chooser. A turn being
  stopped keeps the words for the next turn, as before. Log lines start
  with `[busy-route]`.
- One line per resource: a parallel task may name the files or records it
  writes (`route_message` `resources`, `parallelOf.resources`); it waits
  while a pending task asked before it, or a running one, names the same
  key (`parallelResourceBlocked`, in `parallelBlocked` and at start), then
  the drain starts it. Worktrees already keep two tasks off the same files.
- Unchanged: approvals and security keys, confidential threads (a parallel
  task of a confidential conversation is confidential and its owner's), the
  per-person limit (`threads.maxParallelPerPerson`, default 3), Stop on each
  task, its card in the conversation.

- A parallel task is a thread of the same bot (`TaskRecord.parallelOf`,
  never a TASK_PATCH_FIELD): its own engine session, the conversation's
  model, approval level and owner (private threads), the asker's payer
  (trigger and speaker of the send). Its first prompt is a brief
  (`parallelBrief`): who asked, recent lines of the conversation as context,
  never another parallel request.
- Working folder: a worktree of the conversation's git repository on
  `sagax/parallel-<id>` (`prepareParallelWorkspace`, under
  `DATA_DIR/parallel-worktrees`); otherwise its own private task folder,
  reading the conversation's project folder only. Two turns never share a
  folder (the workspace resource refuses the second).
- The conversation shows the request line (`parallelTask.role: request`),
  a live card (`card`: state from the task's busy/activity, Stop, Open) and,
  when the first turn settles, the answer as a reply to the request
  (`result`, `settleParallelTask`, once: `reportedAt`). In the unified chat
  (#3581) the live card is one step row (`StepRow`, "Working in the
  background", the title, the elapsed time, Stop) and draws nothing once the
  task ended; the answer to the person's request is the whole bubble under
  its quote; the answer of a task the bot opened itself (no `replyToId`) is
  one step row with its first sentence (`reportBrief(text, "start")`) that
  unfolds to the whole answer. A coding job is the chat's compact card
  (`CodingJobCard` on `AskCard`), "Details" opening the coding chat. Later turns in the
  task's own thread stay there. A done task closes (`closedBy`), a failed
  or stopped one stays.
- Limits: `threads.maxParallelPerPerson` (default 3) running per person per
  bot; more queue (`parallelTaskBlocked` in the drain), past twice the
  limit waiting a send answers 409 `parallel_limit`. The bot's thread limit
  still applies. A task of a task is refused (`parallel_nested`).
- Stop one: `POST /api/bots/:id/parallel/:threadId/stop` (client scope,
  thread.post), or Stop in its thread; either reads as stopped.
- Approvals stay in the task's thread and are answered there; the
  conversation's approval stepper lists them tagged with the task
  (`useParallelApprovals`, `Pending.threadId`), and its cancel stops that
  task only.
- The bot may fork itself: `start_thread` with `report_back: true` on itself.
- Org: `task.parallel_start` and `task.parallel_settle` in the admin
  activity log. Routines are unaffected (no busyMode).
- Activity lists a parallel task once (its own entry, `parallel: true`) and
  as a child of its conversation. The detail names steps in words
  (`src/lib/activity-steps.ts`, reusing the approval naming), keeps the raw
  id under Technical details, nests a Claude sub-agent's calls under its
  Agent step (`tool.parentItemId` from `parent_tool_use_id`) with its
  request and report, and a running task takes a message (steer). Claude's
  own sub-agents cannot be steered or stopped apart from their turn.

## Single stream when threads are off (2026-10-17)

With Show threads off, a bot is one continuous conversation; each topic runs
in its own engine context (`docs/single-stream-orchestration.md`). Rules,
none optional:

- A segment is a thread a person had with the bot (`shared/single-stream.ts`
  `isStreamSegment`): never a routine run, hidden AI-client conversation,
  confidential thread, bot-opened thread or parallel task. Segments are the
  threads themselves: nothing is copied, so switching threads on and off is
  the whole migration.
- The client's send says `singleStream` (`singleStreamTurnField`); the server
  marks the thread `streamSegment` (server-private) or clears it on `false`;
  `POST .../tasks { stream: true }` is "New topic". Never mark a non-segment;
  `makeTaskConfidential` drops the mark and `segmentDigest`.
- A person's turn in a marked segment gets the "Earlier topics" block
  (volatile section `stream`, at most 6,000 chars, newest 8 with digests)
  and `recall_topic` (`SAGAX_SINGLE_STREAM`, permission `topics:recall`).
  Candidates always go through `streamCandidates` (privateRecallFilter, Cloud
  home owner filter); a new path that reads segments must use it too.
- Digests are extractive and free by default; the bot's `generateText`
  writes at most one model digest per stream turn, in the background, and
  one when a new topic starts. Both are redacted.
- Desktop (`src/lib/single-stream.ts`, `ChatView` `StreamEarlierTopics`):
  the bot opens at its newest segment (`botOpensTo`); earlier topics sit
  folded behind one "Earlier topics" line once the live one is read back to
  its start (since 2026-10-18, section "Fresh topic on return"); opened, the
  previous one loads at once, older ones on scroll or click, each under a
  "New topic" divider; a
  link or search hit in an earlier topic opens the stream and loads back to
  it at once (`isEarlierSegment`, `useSegmentTranscript` with `around`), a
  notification opens the stream and the activity pill points at the topic;
  once drawn, earlier topics stay mounted for that live topic
  (`useStreamAnchor` keeps the reader still as they grow); ⌘F searches the
  newest 20 topics. An earlier topic is read in place (its own rows context, drawn
  busy: no edit, regenerate or version switch); Reply quotes it into the
  live composer as a citation. New topic: the header button
  (`data-new-topic`) and the bot row menu. Threads outside the stream
  (confidential, bot-opened, hidden) open alone with the way back.
- Tests: `shared/single-stream.test.ts`, `server/streams/single-stream.test.ts`,
  `server/streams/single-stream.e2e.test.ts`, PT-5 in
  `server/org/org-private-threads.e2e.test.ts`,
  `server/drivers/agents-catalog-single-stream.test.ts`,
  `src/lib/single-stream.test.ts`, `src/components/ChatView.stream.test.ts`,
  `src/lib/use-segment-transcript.test.ts`.

## One conversation: THE rule (2026-10-28)

The maintainer, 2026-10-28, after several fixes that did not hold: with threads
hidden a bot is ONE continuous conversation, as in the reference design (one
transcript per bot; "threads" there are tasks opened beside it). The rule is
`shared/single-stream.ts` and nowhere else: `conversationThread(tasks)` is
the newest open segment (never a routine run, a results thread, a hidden
AI-client conversation, a confidential thread, a bot-opened thread, a
parallel task, an archived or closed thread). Cases in
`shared/single-stream.vectors.json`, run by `shared/single-stream.test.ts`
and `ios/Tests/CompanionCoreTests/SingleStreamTests.swift`.

- Server: `conversationThreadFor(bot, person)` (`server/index.ts`) is the
  only reader. It feeds `WireBot.mainThreadId` (per viewer on an organization
  server, `server/threads/thread-privacy.ts`), `personMainThread`,
  `agentUnifiedThread` (`send_prompt`, `sagax_send`), `peerThreadFor`
  (`ask_bot`, `delegate_bot`, asides), a routine's report
  (`resolveResultsThread`; a run whose destination is gone reports there
  too, `syncRoutineRunToSource`), a webhook's post (`resolvePostThread`), a
  call that names no thread (voice `target`), a send without a thread
  (`routeThreadId`), and the Primary Bot's incident answer (mirrored into
  its conversation at turn end, `incidentsReport`). `server/threads/main-thread.ts`
  delegates to it. A webhook's run works in its own task like a scheduled
  run (never the live chat); a run's task is tagged `routineRunId` at
  creation; a turn continuation is a bot-opened job; a legacy "<name> ·
  Results" thread is marked `routineResults` when met. Do not add a thread
  chooser of your own: call `conversationThreadFor`.
- Desktop: `botOpensTo` reads the server's `mainThreadId` first, else
  `streamHomeThread` (the same rule); `openBotThread` is THE gate for every
  way into a thread (notification, chip, link, search hit, activity row,
  routine run, a bot's remote command): an earlier topic scrolls the one
  conversation back (`focusMessage` with `segment`), a thread outside the
  stream opens in the main chat area, never in a side panel beside it
  (unified chat: see "One conversation: THE rule"; the owner's rule of 2026-11-05, #2098). With
  threads hidden the window follows the conversation (a newer topic from
  another device or a reconnect), `newTask` creates a stream topic, and
  `ChatView` draws one timeline: the earlier topics above the live one as
  soon as it is read back (no fold, no empty screen), under quiet time
  dividers, history loading upward.
- Phone: `CompanionCore/SingleStream.swift` mirrors the rule; home is the
  server's `mainThreadId`, else the newest segment; sends carry
  `singleStream`; a thread outside the stream opens in a sheet beside.

## Fresh topic on return (single stream, 2026-10-18; invisible since 2026-10-28)

Decision: coming back to a bot's conversation after a while starts a fresh
engine context; the bot keeps everything (the "Earlier topics" digest and
`recall_topic`). An automatic return stays invisible on screen (timeline
unchanged). An asked-for "New topic" (header pencil) clears the chat to the
empty greeting; "Back to the previous topic" drops the draft and restores
the covered topic; nothing is deleted. Rules, none optional (`shared/fresh-topic.ts`, desktop
`src/lib/fresh-topic.ts`, iOS `ios/Sources/CompanionCore/FreshTopic.swift`
and `ios/App/Session+FreshTopic.swift`; shared cases in
`shared/fresh-topic.vectors.json`, run by both test suites):

- Only with threads hidden and only over a stream segment. A fresh topic
  when the topic the bot opens to has been quiet longer than the threshold
  (Settings > Appearance > Conversation "New topic on return", synced key
  `sagax.freshTopicAfter.v1`, default 4 h, 0 never), or the person comes
  back after leaving the bot or the app (window hidden or blurred, app in
  the background, app closed) for longer than that. A person who left less
  than the threshold ago stays in the topic they just read, however old.
- Never over a live topic: a turn running, an approval or a question
  waiting, an unread answer, teammates working, queued messages, or a topic
  nobody wrote in yet. An automatic draft gives way the moment the topic
  under it comes alive (desktop ChatView effect).
- The fresh topic is a draft on the client (`AppState.freshTopic`,
  `Session.freshTopics`): the server creates it (`POST .../tasks { stream:
  true }`) with the first message, then the message goes there
  (`sendsToFreshTopic`, the store's send effect; `Session.send`). No empty
  topics pile up. New topic (header button, bot row menu) is a draft too.
- Only a "return" asks the rule: `openBot` and `openBotConversationActions`
  (desktop rows, palette, ⌘1 to 9, launch, the window coming back);
  `Session.returning(to:)` on iOS (home rows, iPad sidebar). A notification,
  a link, a search hit or `openBotThread` opens its own thread and clears a
  draft (`focusMessage` drops the draft of the bot that owns the thread).
- On screen: the earlier topics of the live topic load upward once it is
  read back. An asked-for New topic clears the view to the empty greeting
  with "Back to the previous topic" (`FreshTopicDivider` /
  `FreshTopicHeader`); scrolling up does not reveal the covered topic in
  the same view. An automatic fresh topic shows nothing. ⌘F still searches
  the covered topic and the earlier ones.
- New chat sticks (maintainer 2026-11-02, desktop): an asked-for New topic
  (`auto: false`) is the bot's current conversation until the person sends,
  Back, or opens the covered topic by name. Opening the bot itself (rows,
  palette, links to the bot, team map, launch, the follow effect) clears
  only an automatic draft (`keepAsked`), a return after a while never turns
  it into an automatic one, and it is kept on this device
  (`sagax.newChat.v1`) through a reload while it still covers the newest
  segment. Repeated clicks reuse the one draft; an empty newest topic is
  reused as it is. The topic its first message creates, or that empty one,
  opens on its own (`sagax.newChatTopics.v1`, `startedByNewChat`): reading
  it back does not draw the earlier topics above it; a link, a search hit
  or the activity pill still does.
- Tests: `shared/fresh-topic.test.ts`, `src/lib/fresh-topic.test.ts`,
  `src/components/ChatView.stream.test.ts`, `src/components/thread-home.test.ts`,
  `src/state/store/new-chat.test.ts`, `src/components/ChatView.new-chat.dom.test.ts`,
  `server/fresh-topic.e2e.test.ts`, `ios/Tests/CompanionCoreTests/FreshTopicTests.swift`.

## Single stream is the default (thread mode off, 2026-10-17)

Thread mode (Settings > Appearance > Conversation threads: One conversation,
in the header, or in the sidebar) is OFF for a person who never set it (the maintainer,
2026-10-17: "this will be the default mode"; before that it was on). Off is
the single stream: one conversation per bot (section "Single stream when
threads are off" below). The preference is the renderer's `omb-show-threads`
in localStorage (`src/lib/thread-preferences.ts`, `SHOW_THREADS_DEFAULT =
false`, covered by `src/lib/thread-preferences.test.ts`); on an organization
server it travels as a synced key (`shared/user-preferences.ts`,
`/api/me/preferences`), where an absent key means unset. The server holds no
default of its own, so the renderer fallback is the single source of truth.
The switch writes "1" or "0"; unset (key missing, storage unreadable, no
storage) is off, "1" is on, any other stored value is off, so whoever turned
threads on keeps them. Do not seed the key at first run or in onboarding;
leave it unset. The phone apps share the default (`SidebarPrefs.showThreadsDefault
= false`) and the rule (section "One conversation: THE rule").

## Declarative chat widgets (show_widget, ported from upstream 2026-10-14)

A bot shows a card, list, form, table or chart with the agents tool
`show_widget` (and replaces it with `update_widget`): message kind `widget`,
a JSON tree in ChatKit's format, normalised once by `shared/widget.ts`
(`parseWidgetInput`) and stored by `server/widgets/chat-widgets.ts`. The spec is
`docs/superpowers/specs/2026-10-13-chat-widgets-design.md`. The files keep
upstream's paths, names and data format so the next upstream sync merges:
do not rename them or invent another format. Sagax keeps the send route
inline in `server/index.ts` (upstream has `server/routes/bot-messages.ts`),
so a press (`widgetAction` on `POST /api/bots/:id/messages`) is handled
there.

- A press or a submitted form is the person's next message, a reply to the
  widget row, never an approval: a write it leads to still goes through the
  bot's approval cards (`WIDGET_APPROVAL_PROMPT`).
- No script and no network: unknown node types and props are refused or
  dropped, images are https only behind "Load image", `open_url` opens only
  http(s) on a press, and a `Markdown` node renders with
  `<ChatMarkdown inert>` (an HTML ```widget, ```artifact or ```cw fence shows
  as code; a YouTube link stays a link).
- The existing ```cw, ```widget (HTML, `WidgetFrame`), ```artifact and
  YouTube renderers are unchanged and separate.
- Phones: iOS draws them (`ios/App/Features/Chat/Widget/`: `ChatWidgetCard`
  owns the form and the press, `ChatWidgetNodes` and `ChatWidgetFields` every
  node; the shared readers are `ios/Sources/CompanionCore/ChatWidget.swift`).
  A press posts `widgetAction` on the same send route; Swift Charts, SF
  Symbols, system pickers; images wait behind "Load image"; a Markdown node is
  inert (`MarkdownText(inert: true)`). In a room, or with no tree to draw, the
  row shows its text. Tests: `ChatWidgetTests` (against the server's own
  fixtures, regenerated with
  `node --experimental-strip-types scripts/gen-widget-fixtures.ts ios/Tests/CompanionCoreTests/Fixtures`)
  and `ChatWidgetsUITests` (`PARITY_WIDGETS=1 node ios/parity/fixture-server.mjs`).
  Android shows the row's text fallback.

Reusable card: `src/components/widget/WidgetCardFrame.tsx` draws the same
surface, width steps (`size` sm/md/lg/full), header, problem line and footer
as a widget, around any content, inside a `MessageBoundary` that falls back
to `fallbackText`. The MCP Apps host (a `ui://` resource in a sandboxed
iframe) should render in it (`flush` for an edge-to-edge iframe) rather than
build its own bubble. Gallery: `src/gallery/chat-widgets.html`
(`npx vite --config vite.gallery.config.ts`, then
`/src/gallery/chat-widgets.html?skin=<id>&lang=<code>&only=<sample>&narrow=1`).

## Views in the chat only on request (2026-10-20)

Decision: « je veux pas de widget qui pop dans le chat pour aucune raison ».
One rule, `shared/requested-views.ts` (`askedForView`): a view a tool result
would add on its own appears only when the person's message of that turn
asked for that kind of view; views the bot writes itself follow the same rule
through the prompt. Approval, connection and credential cards and attachments
the person asked for are not views.

- ConnectWise tool row widget: `cwToolRowWidget` needs a view tool
  (`cw_psa_show_*`) AND an ask ("view"). `slimMessage` strips the widget of
  any other stored row, for every client.
- Video players from a tool's output (Glitcho `list_followed`, any
  `sagaxVideo`/`url` JSON): `videoMessagesFromTool` needs an ask ("video").
  "is she live?", "play her", "watch", "en direct" count as a video ask
  (2026-11-06).
- Video cards the bot writes (2026-11-06): one `video` code fence holding
  `{"sagaxVideos":[{"kind":"live"|"vod","url":"https://.../index.m3u8",
  "title","streamer","format"?:"hls"|"mp4"}]}` (`RICH_OUTPUT_PROMPT`). The
  server (`videoMessagesFromText`, `server/runtime-events/preamble.ts`) takes
  it out of the reply and adds a proxied player row; the same envelope in a
  `json` fence, an unlabeled fence or bare JSON is accepted too
  (`extractSagaxVideoBlocks`, `fenceBareSagaxVideos`). `ChatMarkdown` draws a
  fence still in the text as the player (`SagaxVideoFenceView`); invalid JSON
  or no URL shows a note with the link, never raw JSON; a stream that fails to
  play keeps an "Open in new tab" link.
- Video player parity (2026-11-06): optional, backward-compatible fields
  `id`, `avatarUrl`, `category` (alias `game`), `tags`, `startedAt` (alias
  `started_at`, uptime), `recording` (REC badge), `chapters`
  `[{startMs,title}]`, `channelUrl`, `expiresAt` (ms; `wireVideoFromEmit`
  also reads a share link's `exp` param). `VideoPlayerWidget`: live DVR
  scrubber with "Back to live", VOD drag scrub with chapter marks, ±10 s,
  quality menu (hls.js levels) and zoom/pan, expand (top-layer popover),
  PiP, keyboard map and resume position (`video-player-state.ts`), stall
  recovery with backoff. An expired link (401/403/410 or `expiresAt`) shows
  "Request a new link", which sends the bot a message asking for a fresh
  link (`onRequestRefresh`). Gallery `?expanded=1`; captures
  `scripts/capture/video-widgets.mjs`.
- Settled screenshot at the end of a computer turn: needs an ask ("screen");
  the live screen panel is unchanged.
- Video and screen rows the server lets through carry `requested: true`;
  web (ChatView, GroupView) and iOS (`MessageRow`) draw only those, so older
  rows stay hidden.
- Prompt (`RICH_OUTPUT_PROMPT`, `WIDGET_PROMPT`): chart, csv, widget and cw
  fences, show_widget and an inline YouTube player only when asked
  or when the request cannot be answered without one; show_widget forms only
  to book, schedule or pick, never to display data.
- Sagax renders no MCP Apps `ui://` resource itself: nothing to gate there.
- Captures: `docs/screenshots/views-on-request/` (before, after).

### ConnectWise views on demand only (2026-10-20)

- A ConnectWise tool row draws its widget (`CwWidgetView`, iOS
  `CwWidgetCard`) only for a Perspicax view tool `cw_psa_show_<view>`
  (`isCwViewTool`, `cwToolRowWidget`, `shownCwWidget`; iOS
  `CwWidgets.isViewTool`). Perspicax serves those tools only when the
  profile's "Vues interactives" is on (Perspicax #386). Every other read or
  write (`cw_psa_query`, `find_*`, `*_write`) is an ordinary row and the bot
  answers in prose or a short list; a table only under the one table rule
  (`TABLE_RULE`, `shared/output-style.ts`, #3293). Rows stored earlier keep a `widget` field
  and still draw as rows.
- The bot writes a ```cw fence only when the person explicitly asks for an
  interactive view (`CW_FENCE_PROMPT`, `server/system-prompt.ts`).
- Test: `server/widgets/cw-widget-actions.test.ts`, `server/cw-widgets.e2e.test.ts`.

## Conversation events: routines turned on or off, Connect apps (2026-10-15)

- A turn that turns routines on or off leaves ONE line per action and per
  turn in that conversation, "Disabled · 5 routines" (kind `routines`,
  `routineToggle`, `server/routines/routine-chat-events.ts`). It is written from
  `RoutineManager.update` (`onEnabledChanged`) when the change names its
  conversation: a routine card (its request), its Undo, or the person's own
  switch while the routine's bot conversation is open (the client sends
  `x-sagax-conversation`; the server keeps it only for that bot's thread the
  person may read). The console, a deleted bot and the calendar write none.
  It is a stored row (stays after a reload), never model context, a receipt
  for previews (`src/lib/receipts.ts`). Every read and live frame keeps only
  the routines the viewer can see (`routineSeenBy`); a line with none of
  theirs is not sent, and the fallback text never names a routine.
- The Capabilities page opens with the apps a conversation needs first
  (`pluginsFocusApps`, section "needed").

## Bot reactions to the person's message (2026-10-18)

Decision: "make sure the bots use, when needed, reactions to the user message".
`react_to_message` and `remove_reaction` (docs/messages-reactions.md) are in
every engine's agents catalogue and in rooms. Keep:

- The emoji is one of `BOT_REACTIONS` (`shared/reactions.ts`, schema `enum`,
  route refusal `reaction_emoji`); a person's picker is not limited.
- `REACTION_PROMPT` is its own system prompt part: sparingly, never instead
  of an answer, never a reaction plus a sentence that says the same thing.
- A reply that only repeats the reaction (same emoji, or a bare aside such
  as "*(no further text needed)*") is not written (`echoesOwnReaction`).
- On a live voice call: no tools, no guidance, route `reaction_call`.
- Tests: `shared/reactions.test.ts`, `server/drivers/agents-catalog-reactions.test.ts`,
  `server/bot-reactions.e2e.test.ts` (idempotence, list, confidential thread,
  echo).

## Replies without em or en dashes (2026-10-26, #1208)

The final text of a bot reply is cleaned in `pushAssistantText`
(`dashFreeReply`, `server/index.ts`) by `replaceDashes`
(`shared/voice-dashes.ts`): a range word between two times, dates or tight
numbers, a colon after a list label, a comma elsewhere; code, inline code and
links stay as they are; tool calls and reasoning never go through it. The
setting is the person's own (`sagax.voiceDashes.v1`, Settings > Models and
voice > Voice), on by default for French. A solo server cannot read the
browser's choice, so it follows the server language there.
