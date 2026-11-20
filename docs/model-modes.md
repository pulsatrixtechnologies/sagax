# Composer modes: Auto, Fast, Expert, Heavy, Manual (#4900, #5088)

The chat bar's model button opens the modes, as the reference app's does
(owner, 2026-11-19, M-20261119-077; it came back after #4936 moved it out).
The button reads the mode's name ("Expert ⌄"), or the pinned model under
Manual. A hovered or focused row opens a small tooltip beside the menu: what
the mode does, then which model backs it ("Quick responses · Grok 4.7",
"Thinks hard · Grok 4.7", "Team of Experts · GPT-6 Astra, Claude Opus 5.5").
Auto never names a model: it reads each request. Build is gone.

Sagax maps every mode, on every turn, to the best models the person can use:
their connected providers and accounts, and their local models.

**Manual** (D-20261119-083) is the person's own model. Its row names the
pinned model while it runs and opens every model: the starred favorites first,
then each provider, then each of its accounts with its state ("Signed out",
"Not responding"); a model two accounts offer is listed under each, and the
copy under an account the menu does not lead with forces that account (as the
Account line does). The star still adds or removes a favorite, synced across
the person's devices. Nothing of the panel is lost (one component,
`src/components/ModelPanel.tsx` with `modes`): Auto's Optimize sits under
Auto, the whole reasoning levels of #5054 show under Auto and Manual (Fast,
Expert and Heavy set their own), the Account and Runs with lines and "Manage
models" with how many are off stay in the footer. The other places the model
menu opens (the bot's Model row, the wizard, team settings) keep the panel's
own short view.

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
  mode (Build) is dropped on load: the bot keeps its model and Auto.
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
