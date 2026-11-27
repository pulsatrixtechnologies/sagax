# Composer modes: Auto, Fast, Expert, Heavy, Custom, Effort (#4900, #5088, #5408)

## The chat bar of the desktop app (owner 2026-11-25, #5372)

M-20261125-070 to M-20261125-076, M-20261125-084. Desktop only for now: the
iPhone, the iPad and the console's chat keep the menu described further down
until their own lots.

Build stopped everywhere (owner 2026-11-26, D-20261126-005, #5398): it is no
mode of Sagax. The server never picks it (Auto included), answers no `build`
in `modes`, and stores it nowhere; the iPhone and iPad menus no longer offer
it. A bot or a conversation still stored on Build loads as Auto (the mode is
dropped, the model kept), and an app that still sends `mode: "build"` gets
Auto without an error (`RETIRED_MODEL_MODE`, `shared/model-mode.ts`).

```
( + )  Message <bot>                 [ * Expert · High ^ ]  ( mic v )
                                               [ o 42%  |  o 89% ]
```

- The message box holds the +, the field, the model chip and one voice
  button, the chip just before the voice button (owner 2026-11-26,
  M-20261126-104, #5408; `Composer.tsx-parts/ComposerActionBar.tsx`). Under
  the box, a quiet row in small text keeps the context and usage meter, at
  the right (`Composer.tsx-parts/ComposerUnderRow.tsx`).
- The chip reads the icon of the mode, the mode, then the effort ("Expert ·
  High"), or the model the person picked by hand (Custom's icon). Its menu,
  280 px wide (M-20261126-104, M-20261126-103): Auto, Fast, Expert,
  Heavy, Custom, then Effort; no "All models" row, no footer. See "The mode
  menu" below. A star on a model adds or removes a favorite
  (`src/lib/model-favorites.ts`).
- Build is no row of the chat bar, and no mode at all (D-20261126-005, above).
  `shared/mode-menu.ts` is unchanged and still names it (the console's copy is
  byte-identical); Sagax's own list is `MODEL_MODES` (`shared/model-mode.ts`),
  which the desktop draws as `CHAT_BAR_MODES` (`src/lib/model-mode.ts`).
- The meter (`src/components/ComposerMeter.tsx`, rules
  `src/lib/composer-meter.ts`) replaces the limit dot in the chat bar: two
  halves, each a ring and its percentage. Left: the share of the model's
  window this conversation uses. Right: the most advanced limit (5-hour
  session or week) of the account that serves the bot; only this half takes
  the dot's warning and danger colours, by the dot's own thresholds. A half
  with no data is absent. In a narrow box the figures fold and the rings
  stay. A click opens a detail: the tokens of the total and Compact now; or
  the account's row (the row of Settings > Usage limits, `AccountLimits` in
  `PlanUsage.tsx`: provider and address, both windows side by side, its star
  once), then Continue or Switch engine and See usage. The figures are read
  when a detail opens and every minute while it is open. The account menu's
  Usage draws the same row, one per account. The conversation's header shows
  no token figure any more.
- The voice button (`src/components/ComposerVoiceButton.tsx`,
  `src/lib/composer-voice.ts`): the mic for dictation or the waves for the
  voice conversation; a click does the mode the person used last
  (D-20261126-006, #5399): a dictation (the mic, a hold, its shortcut) or a
  voice conversation they start in a bot's chat is the next click's mode
  (`noteVoiceModeUsed`). Its arrow opens a menu that reaches the other one,
  then the microphone with its live level and the dictation's language. The
  mode and the language are the person's preferences
  (`sagax.composerVoiceMode.v1`, `sagax.dictationLanguage.v1`), so they follow
  the person. Dictation is the mode before any use (an agent's choice), and a
  dictation in a group, where no conversation can start, changes nothing kept.
- Settings > Providers > Models > Modes (`settings/ModesSettings.tsx`): the
  person chooses the model and the reasoning of Fast and Expert, and Heavy's
  experts; favorites first; one button puts the defaults back. Per person, no
  admin (`modeModels` of GET/PUT `/api/me/models`, `shared/mode-models.ts`).
  `pickModeModel` reads it: the chosen model leads and what the mode resolves
  by itself follows in the chain; a choice that cannot run now leaves the
  mode on what it resolves by itself; Heavy keeps its leader and seats the
  chosen experts. With nothing set every mode runs as before. Auto has no
  setting.

Tests: `src/components/ComposerMeter.dom.test.ts`, `src/lib/composer-meter.test.ts`,
`src/components/ComposerVoiceButton.dom.test.ts`, `src/lib/composer-voice.test.ts`,
`src/components/settings/ModesSettings.dom.test.ts`,
`server/models/model-mode.person.test.ts`, `server/routes/model-switches.test.ts`,
`src/components/SidebarProfileMenu.usage-rows.dom.test.ts`,
`src/components/Composer.tsx-parts/ComposerUnderRow.dom.test.ts`.

## The mode menu

The chat bar's model button opens the mode menu. On the desktop (owner
2026-11-26, M-20261126-104, M-20261126-103, #5408) it is 280 px wide (the
mockup says "about 240 px"; 280 is an agent's choice so a model's name reads
whole on Custom's row):

```
Auto / Fast / Expert / Heavy
Custom           <model>  ›   (favorites, providers › account › model, Manage models)
──────────
Effort           <level>  ›   (the levels of the model in use)
```

The modes and their order are one definition shared with the Perspicax
console, `shared/mode-menu.ts`, which imports nothing; the console keeps a
byte-identical copy (`console/src/lib/mode-menu.ts`) pinned by its hash, and
each side runs the same cases. The file is unchanged: the console, the iPhone
and the iPad keep its rows (Reasoning, All models) until their own lots; the
Custom and Effort rows are the desktop's (`src/components/ModeMenu.tsx`).

The button reads the mode's name ("Expert ⌄"), or the model the person picked
by hand. A hovered or focused mode opens a small tooltip beside the
menu: what the mode does, then which model backs it ("Quick responses · Grok
4.7", "Thinks hard · Grok 4.7", "Team of Experts · GPT-6 Astra, Claude Opus
5.5"). Auto never names a model: it reads each request.

Sagax maps every mode, on every turn, to the best models the person can use:
their connected providers and accounts, and their local models.

**Custom** and **Effort** open cascading submenus (owner 2026-11-25,
M-20261125-035, D-20261125-011, D-20261125-012, #5338): the menu stays on
screen and each level opens beside the row that opened it, so the whole path
reads at once (menu, list, accounts, models). Nothing replaces the menu
and there is no back row. A click, a rest of the pointer or the right arrow
opens a level; Escape or the left arrow closes the deepest one and the focus
returns to the row that opened it. The first level picks the side for the
whole path (the left when the right cannot hold it and the left has more
room) and the next levels keep going that way; in a window too narrow for
the path a level stops at the window's margin, over a part of the one before
it. One shell draws a level (`src/components/ModeMenuLevel.tsx`), placed by
the menu family's submenu positioner (`submenuPlace`). On iPhone and iPad the
path is the system's nested menus (see `ios/App/Features/Chat`).

**Effort** is the one name everywhere: it replaces "Reasoning" in the menu, in
the model panel's other places and in the short menu a working bot opens
elsewhere. Its row shows the level in use and opens, beside the menu, one
explaining sentence and the levels the model in use takes
(`modelEffortLevels`, so they follow the model), "Recommended" beside the
model's own level, an info mark on Max (and on Ultracode). Under a mode that
sets its own level (Fast, Expert, Heavy) the row is greyed and shows the level
the mode imposes. A model that takes no level has no row. The row never reads
"Auto".

Under Auto, the person's choice always holds (owner, D-20261126-017). Any
Effort level she clicks, even the "Recommended" one, is sent and the selection
keeps it. The server runs each of her own turns under Auto at that level,
whatever model and engine Auto takes for the turn (a continuation, and the
lead of a turn Auto hands to Heavy, included), wherever that engine takes the
level (`server/index-leaves/autoPickForTurn.ts`). Work handed out (a routine
or another automation, a peer bot's question or hop, a goal run's step, a room
hand-off) does not keep it: such work takes the level only when it runs on the
bot's own engine (`server/models/model-auto.ts`).
Heavy's experts do not keep it either: they run at their own level
(`server/index-leaves/runHeavyTeam.ts`). Until she clicks one, the Effort
row shows no value and no level is checked: Auto decides turn by turn.
Clicking the checked level again hands it back to Auto. The levels listed are
the model's alone: no "Auto" and no "Default" row (the shared rule keeps
"Auto" for the console).

Off the modes (a model picked by hand, Custom), with no level chosen the row
shows the model's own level, and picking that level sends none. Fast, Expert
and Heavy set their own level every turn. While the bot works the chat bar still opens this menu, its modes
and models locked and its Effort row open: a level chosen mid-turn applies
from the next turn. There is no Effort window of its own in the chat bar.

**Custom** is the person's own model. Its row names the model picked by hand
(the one the selection keeps under a mode too), is checked while that model
runs, and opens the model list. No name is cut short: the model's name takes
all the room "Custom" leaves, the check and the chevron after it; a name
longer than that is cut in its middle, its start and its end kept, the whole
name in the tooltip. The list is as wide as the menu, each option with an
icon before it: a thread's "Use <bot>'s model" row first (its sentence whole,
the model it means on a line under it), the starred favorites under
"Favorites" (an outline star; one click runs the model; one that cannot run
now is absent; a favorite that names its account says it on a line of its
own under its name), then "All models", a cascade of three levels,
each beside the one before: the provider (its mark), then the account, then
the model. A provider with a single account goes straight to its models. Only
what can run a turn now is listed: an account signed out or not responding, a
model turned off and a provider left with nothing are absent, and no state is
written in the menu. "Local" is a provider: the models of this computer and of
the local servers, each server (or the person who shares it) where an account
would be. A model two accounts offer is listed under each, and the copy under
an account the menu does not lead with forces that account (as the Account
line does). The star of a model still adds or removes a favorite, synced
across the person's devices. "Manage models" (a gear) is the foot of this
list. The menu has no footer: the lines that exist only for a model picked by
hand (Account, Runs with, Fast, Context size) sit over Manage models, in the
same list (one component, `src/components/ModelPanel.tsx` with `modes`).
Auto's "Optimize for" is no row of the mode menu (owner, D-20261124-002); it
is set where it already was, under Auto in the Manage models window and in a
bot's Model cell (Settings, Providers, Models and context size). The menu no
longer counts the models turned off: turning one back on is done in Manage
models. The other places the model menu opens (the bot's Model row, the
wizard, team settings) keep the panel's own short view, footer included.

## The rules (server/models/model-mode.ts)

The ranking is Auto's (`TIER_TABLE` per family, the catalogue's facts,
`ENGINE_ORDER`); a mode adds the best model of each provider and a ranking of
providers against each other.

- A provider is a vendor. Two sign-ins of one vendor are one provider; an engine
  that serves several vendors (pi, OpenCode) counts once per vendor.
- Providers are ranked by what the catalogue says their best model costs, then
  how new it is, then the engine order. Everything the catalogue ranks comes
  before a local or server row, which ranks by its own size (read from its name:
  `122B-A10B` is 122 billion parameters, 10 active).
- **Fast**: the person's own fast model when they set one, else the quickest good
  model (the cheapest of the fast tier). Effort low.
- **Expert**: the strongest model of the strongest provider. Effort high.
- **Heavy**: Expert's model leads. The team's seats are each account's best
  model, strongest first, then each one's second (at most eight,
  `HEAVY_MAX_EXPERTS`); with fewer seats than experts they share them.
- A mode with no usable model is not shown. A mode with nothing to run falls back
  on Auto.

## Where it lives

- `ModelSelection.mode` (`fast | expert | heavy`) rides `auto: true`, so
  routines, hand-offs, recovery and call turns keep treating it as Auto.
  Absent means plain Auto; a pinned model has none. `checkedModelSelection`
  validates it; the bot or the thread stores it like a model choice
  (`switchTaskModel`), so it survives a restart. A stored value that is no
  mode is dropped on load: the bot keeps its model and Auto.
- A mode's pick goes through the person's account strategy (#5031): among
  their accounts of the picked provider, the strategy says which one runs it.
- `autoPickForTurn` picks for a typed turn and a call turn alike. A call turn
  keeps the rule of #4888: a bot pinned to a model runs on it; a person who chose
  a mode or Auto has asked Sagax to choose among their engines. Work a bot hands
  out (a peer hop, a routine) stays Auto's.
- `GET /api/bots/:id/auto-model` also answers `modes`: what each mode runs for this
  person now (the menu's tooltips).
- `sameModelSelection` now compares Auto and the mode: a thread pinned to the
  model an Auto bot falls back on is its own pin, not the bot's selection.
- Google's "-pro" ids are no longer taken for variants (Pro is Google's strongest
  model; Auto had no top model for Google whenever Flash was listed).

Tests: `server/models/model-mode.test.ts` (one provider, several, only local, the
Heavy team), `server/models/model-mode-persistence.test.ts` (a new `Store` reads the
mode back), `server/index-leaves/autoPickForTurn.mode.test.ts`,
`server/model-mode.e2e.test.ts`, `server/models/model-mode-load.test.ts`,
`src/components/ModeMenu.dom.test.ts`, `src/components/ModelPanel.modes.test.ts`,
`src/components/ModelPicker.interaction.test.ts`. Captures:
`scripts/capture/mode-menu.mjs`.

On iPhone and iPad, `ModelMenuSheet.swift` and `DesktopModelMenu.swift` use
the same `ComposerModes` selection, reasoning and navigation rules. The
server preview is scoped to the open thread. All models preserves the bot
model and favorites above the runnable providers. `ComposerModesTests` covers
a selection still on Build reading as Auto, mode availability and the cascade
(#5245, #5398).
The Heavy row (`HeavyTeamRowView.swift`, the state
`HeavyTeamLine.swift`) draws the server's Heavy run (#5089) like the
desktop's (#5090); the engine stays on the server. Tests:
`ComposerModesTests.swift`; capture: `-mascotGallery heavy` in the
simulator (`HeavyTeamGallery.swift`).

## A model at its limit is never a mode's pick (#5403)

Owner's request M-20261126-101. One list feeds the turn's pick and the
menu's preview (`autoPickForTurn`, so `GET /api/bots/:id/auto-model` and its
`modes` say what the turn would run). An account is out of that list while it
cannot serve the person: signed out, no key, engine off or not responding
(`autoEnginesFor`), a refusal Sagax saw, and an account whose 5-hour or weekly
window the person's usage report shows used up with no extra usage left
(`limitFailover.autoExcluded(payer, engines, "report")`, the verdict of
`spentPlanUntil` that the quick pick already read; no second one).

- Each account on its own: a model several accounts serve stays while one of
  them has room, and the person's account strategy picks among those.
- Auto, Fast and Expert take the next available model. Heavy seats only
  available models: with fewer left the team is smaller.
- A model the person set for a mode (Settings > Modes) is skipped the same
  way for the turn; the setting is kept and runs again once the limit resets.
- With every account at its limit the turn's pick keeps its list, as before:
  the turn's refusal says when the limit resets. The menu's preview then names
  no model (`modesAtLimit`: every mode's `pick` is null, with
  `limited: { until }`, the first account expected back,
  `limitFailover.limitedUntil`). The modes stay in the menu and each tooltip
  reads "No model you can use right now · resets 3:40 PM", from the texts the
  app already had (`model.cascade.none`, `limits.resets`).
  The preview's own `pick` and its sentence are empty then too
  (`server/routes/bots-mutate-small.ts`), so Auto's chip names no model either.
  The route takes that verdict from the turn's answer (`modes.auto.limited`,
  never a second test): its `chain` is empty and each account is in
  `excluded` with `limit`. Settings > Models, "What Auto would choose now",
  shows no order of choice, only the tooltip's line read from
  `modes.auto.limited` (`limitedLine`), and lists each account under "Left out".
- A report at 100 % is read again by the server, with no app asking: while a
  payer has a live entry from the report (`spentPlans`), that payer's limit
  clock (`LimitResetClock`, the timer that already reads usage every 5 minutes
  while a refusal holds an engine) reads usage too, and the reading is noted
  by the same `notePlanLimits` as an app's (`server/usage/plan-report-watch.ts`).
  An early reset or extra usage bought since brings the account back within
  about 5 minutes on an iPhone alone, in a routine or an unattended bot;
  before, only a desktop app asking for the report did (every 10 minutes).
- Every turn Sagax starts takes its model here, so all of this holds for a
  routine's run (role `worker`, `routineReadinessBot` and the routine's
  `startTurn`), a bot talking to another bot and every started turn
  (`server/turns/start-turn-prepare-validate.ts`), a group room
  (`server/turns/group-member-turn-prepare.ts`) and workers. A continued
  conversation leaves its earlier pick while that account is flagged.
- The desktop reads the preview again each time the menu opens
  (`useAutoModelStatus`, `open`), the last answer staying on screen meanwhile.

Tests: `server/index-leaves/autoPickForTurn.limit.test.ts`,
`server/usage/limit-failover-host.test.ts`, `server/routes/bots-mutate.test.ts`,
`src/lib/auto-model-preview.dom.test.ts`, `server/usage/plan-report-watch.test.ts`,
`src/lib/model-mode.chatbar.test.ts`, `src/components/settings/AutoModelSettings.test.ts`.

## Heavy: a team of read-only experts (#5089)

Owner's request M-20261119-077, answers D-20261119-084 and D-20261119-085:
Heavy works the Grok way. One engine, in the Sagax server, for every client
(`server/index-leaves/runHeavyTeam.ts`, the pure half `server/heavy-team.ts`),
called from `startTurn` before the leader's prompt is built.

- **The team.** The bot is the leader (the turn itself, on Expert's pick). A
  short hidden ask lets it choose how many experts the task needs, 2 to 8
  (D-20261126-023, `HEAVY_MAX_EXPERTS`): the fewest that suffice, 2 for a
  simple question, more only for a big, risky or many-part request; and a
  persona for each (a skeptic, security, cost, the user's advocate, or what
  the task calls for). Its count is held between 2 and 8 (9 reads as 8, 1 as
  2 with a default persona beside it); a reply that does not read gives three
  default personas. The seats, the person's Heavy experts in Settings > Modes
  and a solo server's stored modes keep up to 8 too. The experts of a round
  speak at once: a round lasts as long as its slowest expert (4 minutes at
  most), whatever the team's size; a team of 8 makes 8 calls per round and
  each critique reads the 7 others.
- **Seats.** `heavySeats` (server/models/model-mode.ts) lists the person's own
  accounts, each one's strongest model, then each one's second strongest;
  `assignSeats` gives the experts different accounts first, then different
  models of the same provider. An account at its usage limit is already out
  (#5031, #5403); only this person's accounts are offered.
- **Read-only, held by the server.** Each expert is a hidden thread of the same
  bot, confined before its first turn (`store.confineHeavyExpert`): the
  conversation's tool scope of #4993 keeps only reviewed reads of Sagax's own
  tools and of Perspicax (`expertToolScope`), its turns withhold every host
  tool (no shell, no file write, no fetch: each driver's tested organization
  mode) at the Ask level, and the server refuses each permission request it
  opens, with no card (`createHeavyExpertFence`). Never a prompt hint alone.
- **Rounds.** Round 1: every expert proposes, in parallel. Then cross
  critiques: each one reads the others' latest words, critiques, revises and
  ends with `VERDICT: AGREE` or `VERDICT: DISAGREE: <points>`. The leader stops
  at the first round where every expert still answering agrees, and after
  `HEAVY_MAX_ROUNDS` (5) at most; without agreement it decides and shows the
  points still in dispute beside its plan.
- **Execution.** The leader's prompt carries the team's notes; the bot carries
  the plan out ONCE, in the same turn, with its usual writes and approval
  cards. Nothing is done twice.
- **Auto** (D-20261119-086) takes Heavy on its own for a big or risky request
  (`heavyWorthy`: a long or many-part request, or one about deleting,
  migrating, production, security, money or contracts); the team's row says
  so in one line. The bot's own choice stays Auto.
- **Cost.** No banner. What the experts and the plan spent is carried onto the
  leader's turn (`heavyUsage`), so Heavy's cost reads in that turn's usage;
  the month's ledger holds each expert's own turns.
- **The row.** One activity row of the conversation (`shared/heavy-team.ts`)
  keeps the whole run: the experts, their personas and seats, every round,
  who speaks, each verdict, the outcome and the disagreements.
- **The animation** (#5090, `src/components/HeavyOrbit.tsx`, drawn by
  `HeavyTeamRow.tsx`): while the team works the experts' avatars turn around
  the bot's; the one speaking pulses; during a critique round lines link every
  two experts still in it; on agreement they merge into the bot while it
  writes. Transform and opacity only, at rest under reduced motion. Beside it:
  "Experts thinking · round 2 of 5 · 6s" and a live line per expert ("Expert
  1 · Skeptic"). After: "Thought for 8s · agreed in round 2" (or "no agreement
  after 5 rounds, the leader decided"), which opens the Thoughts panel (#4924):
  the leader's steps, the disputed points, each expert's persona, seat and
  one message per round. Auto's choice of Heavy reads in one line above.
  Tests: `src/components/HeavyTeamRow.dom.test.ts`; captures:
  `scripts/capture/heavy-team.mjs`.

Tests: `server/heavy-team.test.ts` (an expert's write is refused by the server;
the leader stops at 5 rounds at most; agreement stops early; the plan, the
seats, the verdicts, the notes, the usage), `server/heavy-team.e2e.test.ts`
(the real server and the fake Claude CLI: read-only expert launches, 5 rounds,
one row, the leader's reply), `server/models/model-mode.test.ts` (seats),
`server/index-leaves/autoPickForTurn.mode.test.ts` (Auto takes Heavy).

Perspicax: the console's own mode menu (#4936, Perspicax #2206) stays where it
is; it should call this engine (one implementation) rather than its own team
(`crates/px-chat/src/turn/heavy.rs`).
