# Composer modes: Auto, Fast, Expert, Heavy, Build (#4900)

The chat bar's model button opens five modes, as the reference app's does, not a list of
engines and models. The button reads the mode's name ("Expert ⌄"). A hovered or
focused row opens a small tooltip beside the menu: what the mode does, then
which model backs it ("Quick responses · Grok 4.7", "Thinks hard · Grok 4.7",
"Team of Experts · Grok 4.7"). Auto never names a model: it reads each request.

Sagax maps every mode, on every turn, to the best models the person can use:
their connected providers and accounts, and their local models. The raw list
never shows in this menu. "All models" at its foot opens the models window
(engines, models, effort, Runs with, favorites, on/off switches, Auto's
Optimize), and a model pinned there shows as the checked first row until a mode
is picked again. Nothing was removed: it moved one step away.

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
- **Build**: a model made for code first ("for Coding", Codex), then the strongest
  coding-tier model. The bot's own effort stays.
- A mode with no usable model is not shown. A mode with nothing to run falls back
  on Auto.

## Where it lives

- `ModelSelection.mode` (`fast | expert | heavy | build`) rides `auto: true`, so
  routines, hand-offs, recovery and call turns keep treating it as Auto.
  Absent means plain Auto; a pinned model has none. `checkedModelSelection`
  validates it; the bot or the thread stores it like a model choice
  (`switchTaskModel`), so it survives a restart.
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
`server/model-mode.e2e.test.ts`, `src/components/ModeMenu.dom.test.ts`,
`src/components/ModelPicker.interaction.test.ts`. Captures:
`scripts/capture/mode-menu.mjs`.

## Heavy: the Team of Experts (#4901)

A Heavy turn runs the team before the Leader (the turn's own model, Expert's
pick) answers. `server/index-leaves/runHeavyTeam.ts`, called from `startTurn`
before the prompt is built:

- Each agent is a hidden thread of the same bot, for the same person (the turn's
  speaker, so their sign-ins, keys and connectors apply), at the bot's approval
  level (Ask where the agent's engine cannot carry it), run through
  `askBotAndWait` like `run_with_engine`. The agents run all at once, each with
  its own angle (`HEAVY_ANGLES`), at a step less effort than the Leader, and are
  told to take no outward action: the Leader does those.
- The agents do not count toward the bot's limit of parallel threads
  (`heavyAgentThreads`): they are one turn's work, and the Leader plus five agents
  would never fit under the default three.
- The Leader's prompt gets a "Team of Experts" section with each agent's findings
  (`leaderNotes`). An agent that fails or times out (4 minutes,
  `SAGAX_HEAVY_AGENT_WAIT_MS`) is left out and counted; with nothing usable the
  Leader answers alone. The person's Stop stops the agents.
- Only the person's own typed turn runs a team. A call turn, work a bot hands out,
  a card continuation, a confidential conversation and a thread that is itself an
  agent's answer with the Leader alone.

The whole run lives on one activity row of the conversation (`tool.team`,
`shared/heavy-team.ts`), patched at most every 400 ms. The chat draws it
(`HeavyTeamRow`): "Agents thinking · 6s" with the agents' owls and a live preview
(Agent 1, Agent 2, the Leader's "Sent to All" or "Processing…"), then "Thought
for 8s", which opens the Thoughts panel (`ThoughtsPanel`, the right-hand detail
panel): the Leader's steps with their time, then each agent, collapsible. The
final answer is the Leader's ordinary reply.

Tests: `server/heavy-team.test.ts`, `server/heavy-team.e2e.test.ts` (real server:
hidden threads, the row, the Leader's notes), `src/components/HeavyTeamRow.dom.test.ts`.
Captures: `scripts/capture/heavy-team.mjs`.
