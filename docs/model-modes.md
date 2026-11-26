# Composer modes: Auto, Fast, Expert, Heavy, Reasoning, All models (#4900, #5088)

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
( + )  Message <bot>                                   ( mic v )
  [ Expert · High ^ ]                          [ o 42%  |  o 89% ]
```

- The message box holds the +, the field and one voice button. Under it, a
  quiet row in small text: the model chip at the left, the context and usage
  meter at the right (`Composer.tsx-parts/ComposerUnderRow.tsx`).
- The chip reads the mode then the reasoning level ("Expert · High"), or the
  model the person pinned. Its menu: Auto, Fast, Expert, Heavy; then
  "Favorites" (the starred models); then Reasoning; then All models (the
  cascade); then Manage models. A star in All models adds or removes a
  favorite (`src/lib/model-favorites.ts`).
- Build is no row of the chat bar, and no mode at all (D-20261126-005, above).
  `shared/mode-menu.ts` is unchanged and still names it (the console's copy is
  byte-identical); Sagax's own list is `MODEL_MODES` (`shared/model-mode.ts`),
  which the desktop draws as `CHAT_BAR_MODES` (`src/lib/model-mode.ts`).
- The usage pill (`src/components/ComposerMeter.tsx`; the pill itself
  `src/components/UsagePill.tsx`, reusable outside the chat bar; rules
  `src/lib/usage-pill.ts`, the context measure `src/lib/composer-meter.ts`)
  replaces the limit dot in the chat bar (M-20261126-095, M-20261126-096,
  M-20261126-099, #5406): a small shape of three measures and a named
  percentage always in sight. The week and the short session are a sum of
  every account that can serve the bot, never the serving account alone: the
  engines the usage-limit takeover may move a turn to (`serves` of GET
  `/api/bots/<id>/auto-model`, `limitServingPool` in
  `server/usage/limit-failover.ts`), their windows from the plan report and
  their holds from the limit report; an older server names no pool and the
  serving provider's accounts answer. The sum is weighted by plan when every
  account's plan size is known on one scale (Claude Pro 1, Max 5x 5, Max 20x
  20), else it is the mean of the percentages; an account with no 5-hour
  limit counts as 0% of that window; an engine with no window is in no sum
  but keeps the pill from saying "blocked". The third measure is the share of
  the model's window the conversation uses. The text names the fuller account
  limit ("wk 44%", "5h 20%") and adds "back <day> <hour>" only when every
  account refuses work. A measure is quiet, warning from 75%, danger when
  full. `usagePill` is the pure function a place outside the chat bar reads
  (the three values and the text). A click opens the detail
  (`src/components/UsageAccountsDetail.tsx`): one row per account, the
  session and the week as columns, the return time once and only for a limit
  that is hit, the serving account marked, the free accounts first, three
  rows then a fold, the accounts at their limit folded below, a fixed height;
  then the context's tokens with Compact now; the limit's actions (Continue,
  Try again now, Switch engine, See usage) only when everything is blocked.
  The figures are read when the detail opens and every minute while it is
  open. The account menu's Usage draws the same detail for every signed-in
  account. Settings > Appearance > Conversation holds the person's choices
  (`src/lib/usage-pill-preferences.ts`): the pill in the message bar
  (`sagax.usagePillInBar.v1`, on), its shape (`sagax.usagePillShape.v1`: bars,
  circles, battery, dots, text; circles) and the context indicator
  (`sagax.contextIndicator.v1`, on); with the pill off the context keeps its
  own ring. With no plan window for the engine the pill draws from the
  engine's own limit once it is near, with its line. The conversation's
  header shows no token figure any more.
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
`src/lib/usage-pill.test.ts`, `src/lib/usage-pill-preferences.test.ts`,
`src/components/ComposerVoiceButton.dom.test.ts`, `src/lib/composer-voice.test.ts`,
`src/components/settings/ModesSettings.dom.test.ts`,
`server/models/model-mode.person.test.ts`, `server/routes/model-switches.test.ts`,
`src/components/SidebarProfileMenu.usage-rows.dom.test.ts`,
`src/components/Composer.tsx-parts/ComposerUnderRow.dom.test.ts`.

## The mode menu

The chat bar's model button opens the mode menu. Since the owner's decision of
2026-11-23 (M-20261123-040, M-20261123-045, M-20261123-047) it is the same
menu, row for row, in the Sagax app and in the Perspicax console:

```
Auto / Fast / Expert / Heavy
──────────
Reasoning        <level>  ›   (the levels of the model in use)
──────────
All models                ›   (provider › account › model)
```

The rows and their rules are one definition, `shared/mode-menu.ts`, which
imports nothing; the console keeps a byte-identical copy
(`console/src/lib/mode-menu.ts`) pinned by its hash, and each side runs the
same cases.

The button reads the mode's name ("Expert ⌄"), or the model the person pinned
in All models. A hovered or focused mode opens a small tooltip beside the
menu: what the mode does, then which model backs it ("Quick responses · Grok
4.7", "Thinks hard · Grok 4.7", "Team of Experts · GPT-6 Astra, Claude Opus
5.5"). Auto never names a model: it reads each request.

Sagax maps every mode, on every turn, to the best models the person can use:
their connected providers and accounts, and their local models.

**Reasoning** and **All models** open cascading submenus (owner 2026-11-25,
M-20261125-035, D-20261125-011, D-20261125-012, #5338): the menu stays on
screen and each level opens beside the row that opened it, so the whole path
reads at once (menu, providers, accounts, models). Nothing replaces the menu
and there is no back row. A click, a rest of the pointer or the right arrow
opens a level; Escape or the left arrow closes the deepest one and the focus
returns to the row that opened it. The first level picks the side for the
whole path (the left when the right cannot hold it and the left has more
room) and the next levels keep going that way; in a window too narrow for
the path a level stops at the window's margin, over a part of the one before
it. One shell draws a level (`src/components/ModeMenuLevel.tsx`), placed by
the menu family's submenu positioner (`submenuPlace`). On iPhone and iPad the
same path is the system's nested menus (see `ios/App/Features/Chat`).

**Reasoning** is a row that shows the level in use and opens, beside the menu, the
levels the model in use takes (`modelEffortLevels`, so they follow the model).
Under a mode that sets its own level (Fast, Expert, Heavy) the row is greyed
and shows the level the mode imposes. A model that takes no level has no row.
Under Auto, the row reads Auto until the person chooses a level. Choosing Auto again lets each turn use its mode's level.

**All models** is the person's own model. Its row names the pinned model while
it runs and opens a cascade of three levels, each beside the one before: the
provider, then the account, then the model. A provider with a single account
goes straight to its models. Only what can run a turn now is listed: an
account signed out or not responding, a model turned off and a provider left
with nothing are absent, and no state is written in the menu. "Local" is a
provider: the models of this computer and of the local servers, each server
(or the person who shares it) where an account would be. A model two accounts
offer is listed under each, and the copy under an account the menu does not
lead with forces that account (as the Account line does). The starred
favorites lead the provider level and the star still adds or removes one,
synced across the person's devices. Nothing else of the panel is lost (one
component, `src/components/ModelPanel.tsx` with `modes`): the Account and Runs
with lines and "Manage models" stay in the footer. Auto's "Optimize for" is no
row of the mode menu (owner, D-20261124-002: the menu has the console's rows
only); it is set where it already was, under Auto in the Manage models window
and in a bot's Model cell (Settings, Providers, Models and context size). The menu no longer counts the models turned off: turning one back on
is done in Manage models. The other places the model menu opens (the bot's
Model row, the wizard, team settings) keep the panel's own short view.

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
- **Heavy**: Expert's model leads. The team is the best model of each provider
  (at most five, strongest first). With one provider, `HEAVY_SINGLE_PROVIDER_AGENTS`
  agents on its strongest model.
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

## Heavy: a team of read-only experts (#5089)

Owner's request M-20261119-077, answers D-20261119-084 and D-20261119-085:
Heavy works the Grok way. One engine, in the Sagax server, for every client
(`server/index-leaves/runHeavyTeam.ts`, the pure half `server/heavy-team.ts`),
called from `startTurn` before the leader's prompt is built.

- **The team.** The bot is the leader (the turn itself, on Expert's pick). A
  short hidden ask lets it choose how many experts the task needs, 2 to 5, and
  a persona for each (a skeptic, security, cost, the user's advocate, or what
  the task calls for). A reply that does not read gives three default personas.
- **Seats.** `heavySeats` (server/models/model-mode.ts) lists the person's own
  accounts, each one's strongest model, then each one's second strongest;
  `assignSeats` gives the experts different accounts first, then different
  models of the same provider. An account at its usage limit is already out
  (#5031); only this person's accounts are offered.
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
