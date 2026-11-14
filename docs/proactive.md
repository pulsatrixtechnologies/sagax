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
  switch acts at once; the checklist switch sets or clears the checklist
  mute (`PUT /api/bots/:id/background-brief` `{checklist}`), with no
  memory line. A domain stored on with a bot that can no longer carry it
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

Every minute, on an organization server, the loop walks the people's
choices, not the bots. No choice: no session, no helper call, no read, no
offer. For each chosen domain:

1. **Eligibility** (no model): the carrying bot is the person's own,
   visible, not temporary, and its turns mount the person's account
   connection; the connection serves **every** product a watch names; the
   bot holds the watch's skill (the resolution of a turn's Skills index).
   What is not eligible is not run.
2. **Products**: the APIs the person's Pulsatrix connection serves
   (`api_list`) are matched to the Flow products, once a day per person.
3. **Watches** of those products, cached one hour, kept when their domain is
   chosen and the watch is not switched off. A new watch the organization
   adds to a chosen domain is on.
4. **Cadence**: `15m`, `1h`, `daily@HH:MM`, `weekly:sun..sat@HH:MM`, in the
   tenant's local time (the person's time zone, else the server's). A
   calendar cadence never catches up on the first sight or after a restart.
5. **Tokens** of `args`, `params` and `when` are resolved first:
   `{{fact:<topic>.<key>}}` from `px_flow.py reference <topic>` (first two
   columns of its tables), `{{today_date_only}}`, `{{days_ago:N}}`,
   `{{days_ahead:N}}`, `{{months_ago:N}}`, `{{hours_ago:N}}`,
   `{{hours_ahead:N}}` (local, no offset). A token the organization does not
   set skips the watch, logged in Events; no call ever carries a raw template.
6. **Observe** runs as a read on a short-lived connection with the person's
   routine credentials: a tool Perspicax marks read-only, or `flow_action`
   without `confirm` (no write is sent). An observe that is not a read is
   skipped and logged.
7. **When** (JMESPath) on the observed value. True and new (watch id plus a
   key of the result, per person) goes through `ProactiveEngine.consider`
   (12 watch steps per bot per hour) and `decideProactiveStep`. A condition
   that stays true with the same key never fires twice; it fires again once
   it turned false or its result changed.
8. **Wake**: one proactive turn of the carrying bot (source `watch`, run
   name "Proactive: Pulsatrix watch"), with the watch's consigne, in the
   bot's one conversation. The person's choice passes the bot's switch, as a
   direct trigger does. A read step runs. A write is planned as a dry run
   and goes through the ordinary approval path. The proactive layer never
   runs a write on its own and adds no card of its own.

A chosen domain that cannot run (the bot is gone or no longer eligible, no
Flow plugin or one that does not answer, no Pulsatrix access, no watch of
the domain eligible, a domain the organization's Flow does not have) pauses
and says so once in the carrying bot's chat (the person's main bot, else
another bot of theirs, when the carrier is gone), with its cause; it resumes
by itself once the cause is gone. Every watch switched off on purpose is no
pause. A skipped watch (a token not set, an observe that is not a read or
that failed) posts its line in Events once per cause.

A fired watch waiting for its wake is kept in
`DATA_DIR/proactive-pending.json` (replay ref `{kind: "watch", watchId}`,
no observed data). After a restart the watch is observed again at the next
tick and fires again if its condition still holds. A gathered watch event
no wake runs for (dropped) is released and fires again at its cadence.

Memory of runs, fired conditions, posted skip causes and told pauses, per
person: `DATA_DIR/proactive-watch-memory.json`. The per-bot file of before
(`proactive-watches.json`) is not read: memory restarts per person.
The helper runs only from an organization plugin folder on a Perspicax
server, isolated (`python3 -I`, minimal environment, 20 s timeout), with the
organization's tenant plugins in `PX_FLOW_TENANTS`.

The turn prompt no longer names the watches: they are the person's choice,
not a property of the mode.

Tests: `server/proactive/flow-watches.test.ts`,
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
- the routine fix card's told state and its day reminder (kind
  `routine-problem`, key `routine-problem:<routineId>`).

`tellPerson` (`createTellPerson`) is the one way a proactive item reaches
`notify`: a run's failure, wait or away skips, a wake item's needs-you
and a run's own needs-you card (key `needs-you:run:<runId>:<cardId>`), a
routine paused (key `routine-suspended:<routineId>:<reason>:<at>`, once per
pause), a daily suggestion (key `proposal:<proposalId>`), an engine's fix
card, the fix card's reminder. The fix card's first ring still goes through
the question card path (lot S2 folds it in). It rings once per key and step,
records the item as told, and ends in one `[signal]` log line.

The routines file still carries `ownerNotices` and `engineReconnectNotified`,
written from the ledger, so the previous version reads them for one release;
a file of the previous version moves into the ledger at load.

Tests: `server/proactive/signal-ledger.test.ts` (one restart test per moved
memory).
