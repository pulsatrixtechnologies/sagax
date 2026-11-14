# Proactive bots and Pulsatrix watches

A bot's proactive mode is one switch per bot (`proactiveMode`, Edit bot >
Permissions > Proactive, `sagax_settings` `bot.proactiveMode`). No stored
mode reads as `proactive` (the old `follow-rules`, `propose` and `read-auto`
read the same); a chosen `off` is stored and kept; any other value fails
closed to off. The selector shows the effective value. Since #3423 a change
of the switch records who set it (`proactiveModeSet: {principalId, at}`);
absent means the server wrote the default, which is never a choice.

## Two families

- **Addressed**: someone or something aimed an event at one bot: email,
  calendar, a failed run, a bot's post that names it, a teammate's message,
  a webhook, a text. It reaches that bot; the switch and the direct triggers
  govern it, as before.
- **Ambient**: the server goes looking on the person's behalf. The
  **Pulsatrix watches** are ambient: they never run until the person said
  yes to their domain (#3423).

## The person's choices (`server/proactive/proactive-choices.ts`)

`DATA_DIR/proactive-choices.json` (mode 0600), one row per person
(`shared/proactive-choices.ts`). Per watch domain: `on`, `off` or `never`;
the one bot of the person that carries it; the watches switched off inside
it; `coversReads` (the yes covers the domain's read-only tools inside its
alerts, decision 3); when, how (`card`, `settings`, `words`, `alert`) and by
whom it was set. Also the ask ledger and when the first question was asked
(used by the card, below; also when each bot asked its first question). Absent is off: nothing in it is ever filled
from a default or from a stored `proactiveMode` (`createBot` and the startup
both write `proactive`).

- `GET /api/me/proactive[?botId=]`: the session person's choices
  (`domains`) and the domains they can choose (`available`, from the watch
  loop's listing on that bot, else their main bot): each with its slug,
  label, audience, `eligible`, and its watches (id, summary, cadence,
  products, `runs`, `missing: product|skill|read`; `read` (#3408): the
  connection does not serve the watch's observe tool as a read, so it is
  never offered). When none can be listed,
  `unavailable` says why. With `?view=all` (#3432) it adds `receive`, what
  Settings, Notifications, « Ce que je reçois » and each bot's « Ce que ce
  bot suit pour toi » draw: `bots` (the person's own visible bots, main bot
  first, with `brief` (on while the bot's brief routine is on), `screen` only on the desktop app and `checklist` only
  when HEARTBEAT.md has items) and `domains` (only eligible ones, each with
  `carriers`, the bots that can carry it, and its running watches with
  `runsOn` and `lastAlertAt`, the last time the watch woke its bot).
- `PUT /api/me/proactive`: `{domain, state: on|off|never, botId?}` (a yes
  without `botId` goes to the person's main bot, else another bot of
  theirs; the bot must be the person's own, visible and not temporary) or
  `{domain, watch, on}`. A yes to a domain that is unknown (404) or that
  cannot run on that bot (409) is answered, with the list, never stored. A
  no to a domain the listing does not have is stored only when it cannot be
  checked or is already in the choices. Client scope, the person only, no
  admin.
- A person chooses in Settings, Notifications, « Ce que je reçois » (What
  I receive), on each bot's page (Permissions, Proactive), or in words by
  asking any of their bots: the bot reads `available` and writes through
  `sagax_settings` `notifications.proactiveChoices`. On those pages each
  switch acts at once; the checklist switch is the checklist routine's
  own on and off (`PUT /api/bots/:id/background-brief` `{checklist}`):
  off pauses the routine, on turns it on and clears a mute left by the
  person's votes, with no memory line. Pausing the routine in the
  routines list shows it off there too (#4250). A domain stored on with a bot that can no longer carry it
  runs nowhere: those pages draw it off with its pause stated, and turning
  it on there moves it to a bot that can.
- One bot per person and domain, by construction. A carrying bot that is
  deleted hands its domains to the person's main bot, else another bot of
  theirs, which says so in one line with the domain's label; without any
  bot, the domain pauses.
- The "never" of a watch alert's row stops those watches for good, in the
  person's choices, so the reads stop too. It no longer mutes every watch of
  the bot.
- Every watch alert's run card carries two exits for the bot's owner
  (#3457, `src/components/WatchAlertExits.tsx`): « Arrêter cette veille »
  (`{domain, watch, on: false, via: "alert"}`) and « Arrêter ce domaine »
  (`{domain, state: "off", via: "alert"}`), both through `PUT
  /api/me/proactive`, at once, with no confirmation. One quiet line under
  the card then says what stopped, by its label. Those two replace the row's
  "never" on a watch alert; the thumbs and « Moins de ça » stay.

## The bot asks, and proposes one domain (`server/proactive/proactive-ask.ts`)

Decided by the server, no model. Only an organization server linked to
Perspicax has watches: elsewhere nothing below runs and nothing is shown.

- **One proposer per person and domain.** Among the person's bots that can
  carry a domain (the watch loop's listing, `offered`), the one whose title
  and description share the most words with the domain's "who it is for"
  line; on a tie or with no match, the person's main bot. The other bots stay
  silent on that domain. The person can still turn it on for any eligible bot
  in Settings or by asking in words.
- **The first question**, one sentence in the bot's own chat that names up to
  three domains it proposes and asks what the person does, their
  responsibilities and their team's, and what they would like to receive. A
  new bot adds it to the closing line of its intro. After the upgrade (the
  store's `since`), the person's main bot writes it once, first saying that
  nothing is sent on its own any more; every other bot asks the first time the
  person writes to it. A bot with nothing to offer asks nothing.
- **The prompt section** (`proactive-ask`, volatile), in the owner's
  one-to-one turns only: at most three domains not yet decided, each with its
  "who it is for" line and watches, ranked by words shared with About me,
  then with the bot's title. Empty when nothing is eligible, and
  `propose_proactive` is then not listed (`SAGAX_PROACTIVE_ASK`).
- **Coverage first** (#3458, decision 5: no administrator's page): the server
  knows, per organization, which eligible domains nobody follows (no person
  has them on). Among the domains that share words with the person's About
  me, such a domain comes first in the prompt section, and its choice card
  adds « Personne ne suit encore ce domaine dans ton organisation. » Only
  that fact is used: never who follows what, and nothing is shown to an
  administrator. A domain that does not match the person keeps its place; a
  server of one person changes nothing. Known limit: a domain every matching
  person refused stays without a follower, and nobody is told.
- **`propose_proactive`** (`POST /api/internal/proactive/propose`):
  `about_person` appends what the person said about their work to their
  About me (the learned list, Remove in Settings); `domain` (with `watches`,
  and `quote` for a second card) posts one choice card on the proposal
  plumbing (`proactiveProposal` plus `proactiveChoice`, the folded details).
  A refusal is one line for the bot (200, `applied: false`), nothing shown.
- **Bounds**: the owner's own one-to-one turn only (never a wake, a routine,
  a room, a call or another person's turn); one open card per person; one
  bot-initiated ask per person per local day (a card or a first question);
  two cards per domain at most, the second after "Not now", 14 days later,
  when the quote is in the person's own message of that turn and is about the
  domain; "Ne plus proposer" final for bots; an unanswered card ends after
  three days and counts as "Not now"; no push.
- **The answer** (`POST /api/bots/:id/proactive/:proposalId`, `{accept,
  watches?}`): a yes writes the person's choice with the proposing bot, the
  watches it named on and the domain's others off (`watches` is the card's
  switches when sent); "Pas maintenant" is kept in the ledger; "Ne plus
  proposer" (`/feedback` `never`) stores `never`.
- **The card on screen** (#3457, `src/components/ProactiveChoiceCard.tsx`):
  the compact card of the approval card (#3414): a bell, the title, the one
  or two plain lines, « Oui » and « Pas maintenant », and the row « Ne plus
  proposer » (no thumbs). Folded details list each watch with its cadence,
  its switch and the read-only tools it uses, by label (a tool name stays in
  a tooltip). The yes sends the switches as `watches`, so a watch turned off
  there stays off; a yes with every switch off cannot be sent. Answered, it
  folds to one quiet row.
- **Reads covered by the yes** (decision 3): inside a watch wake, a tool the
  watch declares and the connection marks read-only runs without a card
  (`watch-read`), while the domain is on, on that bot, with that watch on.
  The organization's Refuse and Ask first rules and the person's own come
  first; a write keeps the ordinary approval path.

## The daily brief is a routine (`server/proactive/brief-routine.ts`, #3456)

The brief is ambient too: it never runs because of a default or a stored
mode, a main bot included (owner's decision 2 of #3408: "a routine, on your
yes").

- **A routine of the bot**, created only on the person's yes: the brief's
  switch on the bot page (`PUT /api/bots/:id/background-brief`
  `{enabled: true}`) or the card below. It is listed in
  the bot's routines, where it is paused, edited or deleted like any routine.
  Its schedule is a daily cron at the brief's time in the brief's own time
  zone (a weekday expression picked in the routines list is kept); its
  instructions name the person's subjects; `postResults` is off (the brief
  posts itself).
- **No turn, no model call.** Its pre-check is code (`{kind: "code", check:
  "daily_brief"}`, `server/routines/routine-precheck.ts`): at the routine's
  time it reads the connected apps (reads only) and delivers what is new
  (`background-brief-schedule.ts` `runBrief`): the brief message, the main
  bot's daily suggestions, the "Me joindre" notice. The run is recorded as
  nothing to report, with one line ("Brief du jour envoyé : 3 points."). There
  is no minute timer of the brief any more, so no routine means no brief and
  no daily suggestions.
- **The bot page** reads the brief as on only while its routine is on, at the
  routine's time. Off on the page pauses the routine; on resumes or creates
  it. Every page sends its time zone with each change, so the schedule moves
  only when the time is in the change or the zone differs from the routine's
  (from the routine's own time), and the instructions are rewritten only when
  the subjects are in the change: an edit made in the routines list is kept.
- **The upgrade, once** (`BriefRoutines.upgrade`, the file's `routinesAt`):
  saved brief settings stay (the person chose them); those that were on become
  the routine, same time and subjects. A main bot that had the brief only by
  default (an install that ran it, no saved settings) stops and owes its person
  one card « Garder le brief du jour ? » (`cardOwed`). A fresh install owes
  nothing.
- **The card** goes through the ask ledger and its bounds
  (`ProactiveAsk.offerBrief`, ledger key `sagax.daily-brief`): one open card
  per person and one bot-initiated ask per person per local day, so it waits
  while another card is open or the person was asked today (checked each
  minute, no model); once ever per person; no push. "Oui" creates the routine
  and saves the brief as the person's choice (in their time zone when they had
  none); "Pas maintenant" is kept in the ledger; "Ne plus proposer" is kept as
  `never` in the ledger and writes no watch domain.

## Pulsatrix watches (`server/proactive/flow-watches.ts`)

Every product skill of Pulsatrix Flow declares what to watch
(`px-proactive`). The server reads them with the organization's Flow plugin
helper, `px_flow.py proactive [--product p ...]`, which prints
`{"watches":[{id, skill, products, domain, summary, observe, when, cadence, propose, kind, prompt, tools?}], "domains"?: {<slug>: {label, for}}}`.
Without `domains` a domain's label is its slug; without `tools` the observe
tool stands for the reads the yes covers.

Since #4250 (S5 `one-probe-engine`, step a) each watch a person turned on
is a **routine of the carrying bot**: listed, paused, edited and deleted in
its routines like any other, with the watch's summary as its name and its
consigne as its instructions. There is no watch loop and no timer of its own:
the routine scheduler runs the checks. The person's choices stay the one store
of what is on; `FlowWatches.sync` makes the routines follow them, after each
change of a person's choices (`ProactiveChoices.onChange`), once at start (a
server before #4250 ran its own loop: its chosen watches become routines then)
and within the hour on the brief cards pass (a watch the organization added or
removed, a domain that can run again). No choice: no routine, no session, no
helper call, no read. For each chosen domain:

1. **Eligibility** (no model): the carrying bot is the person's own,
   visible, not temporary, and its turns mount the person's account
   connection; the connection serves **every** product a watch names; the
   bot holds the watch's skill (the resolution of a turn's Skills index).
   What is not eligible has no routine.
2. **Products**: the APIs the person's Pulsatrix connection serves
   (`api_list`) are matched to the Flow products, once a day per person.
3. **Watches** of those products, cached one hour, kept when their domain is
   chosen and the watch is not switched off. A new watch the organization
   adds to a chosen domain is on.
4. **Routine**: one per person and watch, on the carrying bot, run as the
   person, `overlap: skip`, with the code check `flow_watch`. Its schedule is
   the cadence: `15m`, `1h` as an interval (5 minutes to a day, the routine
   bounds), `daily@HH:MM` and `weekly:sun..sat@HH:MM` as a cron in the
   tenant's time zone (the person's, else the server's). A watch switched off,
   its domain turned off or never, or a watch the organization removed,
   pauses its routine; the yes again turns it back on. A routine the person
   paused or deleted after their yes stays so. The domain moved to another bot
   pauses the old routine and gives the new bot its own. A domain that cannot
   be read now (no Flow, no access, Flow failed) keeps its routines as they
   are: their check says why.
5. **Tokens** of `args`, `params` and `when` are resolved at each check:
   `{{fact:<topic>.<key>}}` from `px_flow.py reference <topic>` (first two
   columns of its tables), `{{today_date_only}}`, `{{days_ago:N}}`,
   `{{days_ahead:N}}`, `{{months_ago:N}}`, `{{hours_ago:N}}`,
   `{{hours_ahead:N}}` (local, no offset). A token the organization does not
   set skips the check, logged in Events; no call ever carries a raw template.
6. **Observe** runs as a read through the one probe engine
   (`server/routines/routine-watch.ts`, the routine tool pre-check), with the
   person's routine credentials: a tool Perspicax marks read-only, `flow_run`
   (or `flow`) `read`, or `flow_action` without `confirm` (no write is sent;
   `routine-watch-tools.ts` reads those as reads for every routine). An
   observe that is not a read is skipped and logged. A read that fails fails
   the routine's check, as any routine's.
7. **When** (JMESPath) on the observed value: a built pre-check of the engine
   (`BuiltWatchPrecheck`, never stored). Its result is the key: the routine's
   run starts the first time it holds, never twice for the same key, again
   once it turned false or its result changed. The state is the engine's, per
   routine (`DATA_DIR/routine-watch/<routine>.json`), keyed on the watch's
   template, so a date that moves with the day keeps the condition.
8. **Run**: the routine's run, as the person, with the watch's consigne and
   what the watch read as fenced data (`watchNoteBlock`). Its results are
   posted like any routine's. The person's choice passes the bot's switch, as
   a direct trigger does. A write goes through the ordinary approval path of a
   routine run.

A chosen domain that cannot run (the bot is gone or no longer eligible, no
Flow plugin or one that does not answer, no Pulsatrix access, no watch of
the domain eligible, a domain the organization's Flow does not have) pauses
and says so once in the carrying bot's chat (the person's main bot, else
another bot of theirs, when the carrier is gone), with its cause; it resumes
by itself once the cause is gone. Every watch switched off on purpose is no
pause. A skipped watch (a token not set, an observe that is not a read)
posts its line in Events once per cause.

A watch wake of a server before #4250 still pending in
`DATA_DIR/proactive-pending.json` (replay ref `{kind: "watch", watchId}`)
makes the watch's routine read its condition as new at its next check.

Per person: `DATA_DIR/proactive-watch-memory.json` (version 2, the shape a
server before #4250 reads) keeps, per watch, its routine, bot, domain and
cadence, whether the person's yes was applied, its last alert (`alertAt`,
« Ce que je reçois ») and the skip cause already told; and the pauses told.
The helper runs only from an organization plugin folder on a Perspicax
server, isolated (`python3 -I`, minimal environment, 20 s timeout), with the
organization's tenant plugins in `PX_FLOW_TENANTS`.

The turn prompt no longer names the watches: they are the person's choice,
not a property of the mode.

Tests: `server/proactive/flow-watches.test.ts`,
`server/proactive/flow-watches-wiring.test.ts` (with the count of the
server's intervals), `server/routines/routine-watch.test.ts`,
`server/proactive/proactive-choices.test.ts`,
`server/routes/proactive-choices.test.ts`,
`server/proactive/watch-tokens.test.ts`, `server/proactive/proactive-wake.test.ts`,
`server/proactive/proactive-default.test.ts`.

## Signal ledger (`server/proactive/signal-ledger.ts`, #4250)

One store per person, on disk under `DATA_DIR/signal-ledger/` (one file per
person, named by a hash of the person, mode 0600), of what was noticed and
told: `{key, kind, level, bot, firstAt, lastAt, count, toldAt, channels,
state, answer}` with `state` one of `open`, `told`, `answered`, `retired`,
`expired`, plus the reminder steps already told. The key is the one the
writer already used. It holds what were separate memories, so a restart
neither wakes twice, rings twice nor starts a reminder clock over:

- the waker's event keys (kind `event`): a second offer of a key is a
  duplicate, a restart included; a dropped watch event is forgotten so its
  cadence offers it again;
- the engine sign-in notices (kind `engine-sign-in`, key
  `engine-sign-in:<engine>`), retired when the engine works again;
- a bot's owner notices (kind `owner-notice`, key `owner-notice:<cause>`),
  once per bot and cause until a run of that bot completes;
- the reach-me open cards and their reminder steps (kind `reach-card`) and
  the notices sent (kind `reach-notice`);
- the routine fix card's told state and its reminder steps (kind
  `routine-problem`, key `routine-problem:<routineId>`);
- the morning line told each day (kind `morning-line`, key
  `morning-line:<day>`).

`tellPerson` (`createTellPerson`) is the one way a proactive item reaches
`notify`: a run's failure, wait or away skips, a wake item's needs-you
and a run's own needs-you card (key `needs-you:run:<runId>:<cardId>`), a
routine paused (key `routine-suspended:<routineId>:<reason>:<at>`, once per
pause), a daily suggestion (key `proposal:<proposalId>`), an engine's fix
card, the fix card's reminder steps. The fix card's first ring goes through the
question card path, whose frame the one attention policy rules like every
other (next section). It rings once per key and step, records the item as
told, and ends in one `[signal]` log line. An item's `level` rides its
frame (`withItemLevel`).

The routines file still carries `ownerNotices` and `engineReconnectNotified`,
written from the ledger, so the previous version reads them for one release;
a file of the previous version moves into the ledger at load.

Tests: `server/proactive/signal-ledger.test.ts` (one restart test per moved
memory).

## Escalation ladder (`server/proactive/escalation-ladder.ts`, #4250 S3)

What still waits on the person is told again on a clock that depends on its
level, read from the signal ledger (the steps already told are on disk), so
a restart neither repeats a step nor starts a clock over. A step missed
while the server was down rings once, as the last step due.

- urgent (a card a bot is blocked on, kind `reach-card`): again on the phone
  after 2 h and after 24 h, where a push is among the bot's channels the
  person allows for urgent; quiet hours do not hold it. Then the morning
  line.
- the morning line: once per local day, from the end of the person's quiet
  hours (read in the quiet hours' own time zone; none set: 08:00 in their
  time zone), one push that names the urgent
  cards still open since before that morning (at most three by name, then a
  count, kept apart by " · "). Nothing waits: nothing goes. Told in the
  ledger before it rings.
  A card is named only where its bot's own "Me joindre" channels allow a
  push for urgent (as its reminders), and a confidential conversation's
  card names only its bot, never its words.
- card (a fix item: the routine fix card, and the engine fix card
  "Reconnect <engine>" or "<engine> is out of credit", key
  `engine-sign-in:<engine>`, kind `engine-fallback`): told again after a
  day, then weekly while it stays open, one `tellPerson` step per ring
  (`RoutineProblemCards.remindDue`, `remindEngineFallbacks` in
  `server/engines/engine-fallback-card.ts`; a server engine's card rings in
  each administrators' home). The reach-me ladder leaves the routine fix card
  to it, and the morning line does not name it. A card closed (the engine
  works again, the person took it out) is not told again.
- the ladder of a reach card is its writer's level: today every approval and
  question a bot is blocked on is urgent. A writer that sets level `card` on
  one would give it the fix ladder (a day, then weekly, no 2 h step) and
  leave it out of the morning line.
- fyi: never reminded.

Never an automatic text message (the owner's decision): the card itself goes
once, when raised, by the channels the person chose for that bot; its
reminders and the morning line ring the phone only. A card the ledger
already follows (a fix card's needs-you rung again at a step, or a replay)
never goes through those channels again, even once its reply code expired
(`ReachMe.cardRaised`). The card's own mark
(`remindedAt`) is still written, so the previous version reads it back.

Tests: `server/proactive/escalation-ladder.test.ts`,
`server/reach-me/service.test.ts` (a restart in the middle),
`server/engines/engine-fallback-card.test.ts` (a restart in the middle),
`server/routines/routine-problem-card.test.ts`.

## One attention policy (`shared/attention-policy.ts`, #4250 S2)

Whether something reaches the person now, and by which channels, is ONE
decision (`decideAttention`), in this order:

1. the writer: `notify: false` never rings; a frame marked FYI waits for
   "While you were quiet" and the brief;
2. the kind rule (`NOTIFY_KIND_INTERRUPTS`, #3719): an ask rings, an answer
   only for the person's own line, a quiet kind never (even urgent);
3. the level: the writer's (`Notification.level`: `fyi`, `card`, `urgent`;
   a proactive event's `level` rides its wake to what the wake tells), else
   the kind's (a bot blocked on the person, or a person's own message, is
   urgent; the rest is a card). Urgent passes the next two steps;
4. the person's ONE quiet-hours setting, obeyed by the desktop, the phones
   and every "Me joindre" channel (a bot keeps only its channels; the
   per-bot hours a previous version saved stay in its file, unread);
5. the person's day budget;
6. presence: the person looks at that conversation in a focused window
   (the desktop), or a client of theirs marked it read during the push
   hub's grace;
7. the channels: the bot's own ("Me joindre", none saved: a push) that the
   person allows for that level (`sagax.notifyChannels.v1`, every channel
   by default; FYI never leaves the app).

The server applies steps 1 to 3 to every notify frame (`ruleNotifyFrame`),
asks each person's signal gate for 4 and 5 (`PersonSignalGate.verdict`),
and writes one `[notify]` line with the level, the reason and, when held,
`held_by=`. The desktop follows the frame's verdict and adds its focus; the
push hub adds its grace; "Me joindre" reads the person's quiet hours and
channels (`ReachMe.channelsFor`). A card (urgent) goes out at once, its
reminders too; a notice (card level) waits for the end of quiet hours.

Settings > Notifications shows it on one page: quiet hours, the day budget,
and the channels for urgent and for the other signals. On a personal
computer they are saved through `/api/me/signals`; on an organization server
they are person preferences.

Tests: one table of cases, `shared/attention-policy.vectors.json`, run by
the server (`shared/attention-policy.test.ts`) and the desktop
(`src/lib/attention.vectors.test.ts`); the phone reads the same file next.

## Answer learning (`server/proactive/answer-learning.ts`, #4250 S7)

The signal ledger keeps the person's answer to each keyed card (an
`ask_choice` with a key) a routine's run raised, by kind: the key without
its item id (`ticket-1012` and `ticket-1013` are the kind `ticket`; a key the
server made from the question's words is its own kind). Each answer is one
ordinary ledger entry (kind `card-answer`, state `answered`, the words in
`answer`), the newest ten per person, routine and card kind. Only the
person's own answer counts: a card skipped, put away, expired, applied
without them or answered by a worker teaches nothing, and a room's cards
never teach a routine.

From those answers:

- a run's prompt carries "the person's last answers" on each card kind of
  that routine, with the usual one (the most frequent), and tells the bot
  to ask as usual: never answer a card for the person;
- a keyed card of that routine shows the usual answer first among its
  options;
- after three identical answers in a row, the card also offers
  "<answer> (always for this routine)". Only the person's click on it writes
  one line into the routine's instructions (`Always for "<question>" (key
  <kind>): <answer>`), through the routine's own update, so the routine's
  history says it. The offer is not made again once the line is there.

Never an automatic answer: every card stays the person's to answer.

Tests: `server/proactive/answer-learning.test.ts` (prompt section, the
card's order and offer, the click that writes the line, a restart).

## Usefulness metrics (`server/proactive/proactive-metrics.ts`, #4250 S9)

The Proactivity group of the bot's Analytics tab (`GET
/api/bots/:id/proactive-metrics`, same range, same readers) also says
whether the bot's signals were worth the person's attention. Nothing is
counted twice: `ProactiveMetricsLedger.read` takes these figures, when it is
asked, from the signal ledger, the routine runs and the usage ledger
(`usefulnessSources`), for the bot and per routine:

- signals told: ledger entries told to the person (a `toldAt`), by the start
  of their spell; an answer record of answer learning (`card-answer`) is not
  one, nor an approval's reach entry (`reach-card`: the reminder ladder of a
  card whose own entry already speaks for it, and an approval of a live chat
  is not a proactive signal);
- answered and ignored count only the items that wait on the person's
  answer (`signalAwaitsAnswer`: a proposal, a "needs you" card or attention
  row, a keyed or fix card, an entry pointing at a card's request). A notice
  told for information (a run's problem, a reach notice, runs skipped while
  away, a paused routine) counts as told, never as answered or ignored;
- answered: the person answered the item (a choice, a skip, "handled"). A
  card or an attention row that ends ends the items told about it
  (`cardSignalEnding`, then `settleCardSignals`: the item's `ref`, its own
  "needs you" key, or the keyed card's own key), and a proposal points at
  its card, so its yes, no, skip or expiry ends it. A card the server or the
  bot closed without the person (a stalled turn, an interrupt, a restart, a
  newer proposal, an automatic apply, a passive card put away) ends its items
  retired; an approval resolved by the driver, a rule or Full access ends
  retired too (`requestOutcome`). The ledger keeps `answeredAt`; a new spell
  of the same key starts it over;
- ignored: expired, or still unanswered 24 h after it was raised (`firstAt`);
  an item whose cause went away by itself, or that was closed without the
  person (retired), is neither;
- median time to answer, from raised (`firstAt`) to answered;
- turns avoided by pre-checks: runs a pre-check ended with nothing to do
  (`nothing_to_report`, no model turn);
- tokens per answered signal: input plus output of the routine turns over
  the answered signals.

An entry's routine is the one its key names (`routine-problem:`,
`away-skips:`, `routine-suspended:`), the run its key names (`run-problem:`,
`run-access:`, `run-deferred:`, `needs-you:run:`), else the run whose
conversation it points at; its name is the routine store's, else a kept
run's. The routines group lists the twenty busiest.
`answeredAt` is one more field of an entry: the previous version reads the
file and leaves it out.

Tests: `server/proactive/proactive-metrics.test.ts`,
`server/reach-me/service.test.ts`,
`src/components/bot-settings/BotProactiveMetricsGroup.test.ts`.
