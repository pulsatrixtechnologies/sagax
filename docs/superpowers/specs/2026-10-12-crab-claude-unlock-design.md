# Crab unlock and Claude achievements

Date: 2026-10-12. Owner: Owner. Status: design, sub-project 1 of 3, awaiting review.
Scope: catalog and unlock model, server-detected Claude link, hide locked characters, grandfather people already wearing the crab, desktop and iOS together. Branch: `feat/crab-claude-unlock`.

Sub-project 2 (premium crab emotions and moves) and sub-project 3 (hats and effects layer) ship the art. This spec records the reward keys and hides a reward line until that registry entry exists.

## Context and goals

Today the owl and the crab are free (`DEFAULT_CHARACTERS` in `shared/achievements.ts:421`, iOS `MascotUnlocks.defaultCharacters` in `ios/Sources/CompanionCore/BotPanelRules.swift:182-183`). Shapes waits on a client-reported `grok.linked` (`shared/achievements-catalog.ts:57-64`, `src/lib/grok-account.ts:16-26`, `src/components/achievements/AchievementToaster.tsx:139-148`). Every other character is an achievement reward. The Appearance gallery hides only a locked *secret* character (Trombi); the rest sit on the To unlock shelf (`src/components/floating-bots/MascotLookEditor.tsx:565-569`, `src/components/floating-bots/mascots.test.ts:200-213`). `grandfatheredFromBots` (`shared/achievements.ts:517-537`) runs once (`server/achievements.ts:70-71, 242-250`) and adds a worn non-owl character plus non-common stored skins.

Goals:

- Only the owl is a default character. The crab is a surprise, unlocked by linking the person's own Claude account.
- Locked characters are absent from every picker, menu, gallery and hint until unlocked (desktop and iOS).
- Claude use inside Sagax is a new achievement category, all server events, same on every client.
- People already wearing the crab keep it without linking Claude, from a one-time snapshot at this upgrade.

## Decisions (settled)

1. **Only the owl is default.** Remove `crab` from `DEFAULT_CHARACTERS` (`shared/achievements.ts:421`) and from `MascotUnlocks.defaultCharacters` (`BotPanelRules.swift:182-183`). `characterUnlocked` (`shared/achievements.ts:479-483`) then requires `character:crab`.
2. **Locked characters are surprises.** Any locked character (Shape, Shiba, Grump, Ogre, Frog, Bunbu, Trombi, Crab) is absent from every picker, menu, gallery and hint until unlocked. Achievement cards that reward a still-locked character say "a surprise character" with no name and no art.
3. **Grandfathering.** Anyone with a bot already wearing `character: crab` (any skin, common included) at this upgrade keeps `character:crab` without linking Claude. One-time snapshot, not "any bot that wears it later".
4. **Approach A: server-detected link.** The server records `claude.linked` when the person's own `claude auth login` succeeds, or when they save their own Anthropic API key. An organization-provided key does not count (same rule as `grokAccountLinked` in `src/lib/grok-account.ts:15-26`). Reconcile on achievements load so people already linked today get it. iOS sends nothing. Grok stays client-reported.
5. **Category `claude`.** Every Claude achievement lives there. A turn counts as Claude when `modelFamily(...) === "anthropic"` (`server/achievements-mastery.ts:68-80, 121`). Server events only, from server hooks (`AGENTS.md` Achievements, `server/achievements.ts:8-10`).
6. **Reward ladder.** `claude-linked` unlocks `character:crab`. Every other Claude achievement unlocks one crab item (emotion, move, hat, effect). This sub-project adds the reward kinds, records unlocks, and hides a reward line while the item is missing from the registry.
7. **Desktop and iOS ship together.**

Ids are permanent once shipped (`AGENTS.md` Achievements; `shared/achievements-catalog.ts:18-20`). Never rename; retire by keeping the row.

## Non-goals

- Drawing premium crab emotions, the claw-dance and clone moves (sub-project 2).
- Drawing hats or the fireworks and bubbles effect layers (sub-project 3).
- Moving `grok.linked` to the server (follow-up).
- Changing Grok, Mastery metrics, or non-Claude catalog rows except surprise wording and the crab default.
- Refusing a stored look on the server (the server still never refuses a look: `AGENTS.md` Achievements).

## Data model

### Catalog

Add `"claude"` to `ACHIEVEMENT_CATEGORIES` (`shared/achievements.ts:114`). Modal nav follows that array (`src/components/achievements/AchievementsModal.tsx:20`). Add `CATEGORY_LABEL.claude` (`AchievementsPage.tsx:27-37`) and iOS `AchievementCategory.claude` plus `AchievementWording.categoryLabel` (`ios/Sources/CompanionCore/Achievements.swift:34-36`, `ios/App/Features/Achievements/AchievementWording.swift:42-54`).

### Events

Add to `SERVER_EVENTS` (`shared/achievements.ts:32-55`), never to `CLIENT_EVENTS`:

| event | meaning |
|---|---|
| `claude.linked` | own Claude login or own Anthropic key |
| `claude.turn` | a completed turn with `modelFamily === "anthropic"`; `key` is `opus`, `sonnet` or `haiku` when the model id names one |
| `claude.subagent` | a sub-agent tool line on such a turn |
| `claude.routine` | a completed routine run whose model family is anthropic |
| `claude.computer` | a Computer Use tool line (`computer_use`, `computer_exec`, `mcp__computer__*`) on such a turn |
| `claude.voice` | a voice call send on a thread whose model family is anthropic |

`POST /api/me/achievements/events` still refuses server events (`server/routes/achievements.ts:49-64`, `server/achievements.ts:318`).

### Rule kind

`claw-streak` needs consecutive days of `claude.turn`. `days` counts distinct days (`shared/achievements.ts:337-338`); `streak` walks `activeDays` (any activity, `:343-344`). Add `{ kind: "eventStreak"; event; target }` that runs `longestStreak` (`shared/achievements.ts:305-316`) on `progress.days[event]` (already filled in `server/achievements.ts:348`).

### Rewards

Extend `AchievementReward` (`shared/achievements.ts:156-160`) and `rewardKey` (`:407-417`):

| kind | `rewardKey` |
|---|---|
| `character` / `skin` / `appIcon` / `title` | unchanged |
| `{ kind: "emote", character, id }` | `emote:<character>:<id>` |
| `{ kind: "move", character, id }` | `move:<character>:<id>` |
| `{ kind: "accessory", id }` | `accessory:<id>` |
| `{ kind: "effect", id }` | `effect:<id>` |

Same keys on iOS `AchievementReward` (`Achievements.swift:48-62`).

Registry (new small table next to the catalog, empty entries allowed): which emote, move, accessory and effect ids this build can draw. `rewardLineVisible(reward)` is false until the id is registered. Sub-projects 2 and 3 fill it. Common skins still come with the character (`skinUnlocked`, `shared/achievements.ts:489-494`). The four base crab faces already used for mood (`crabExpressionForMood` in `src/components/CrabMascot.tsx:19`, `src/components/crab.test.ts:122-129`) ship with `character:crab` the same way; their `emote:crab:*` keys are recorded so a later editor can require them.

### Draft ladder (owner to confirm at review)

Points from the existing 5..300 scale (`shared/achievements.ts:118`). Category is `claude` for every row.

| id | points | condition | event / rule | reward |
|---|---|---|---|---|
| `claude-linked` | 10 | link own Claude account | count `claude.linked` 1 | `character:crab` + `emote:crab:neutral`, `happy`, `curious`, `sleepy` |
| `first-pinch` | 5 | first Claude turn done | count `claude.turn` 1 | `emote:crab:proud` |
| `claude-regular` | 50 | 100 Claude turns | count `claude.turn` 100 | `move:crab:claw-dance` |
| `claude-devotee` | 100 | 1000 Claude turns | count `claude.turn` 1000 | `effect:fireworks` |
| `crab-army` | 20 | first sub-agent on Claude | count `claude.subagent` 1 | `move:crab:clone` |
| `tide-keeper` | 50 | 25 successful Claude routines | count `claude.routine` 25 | `accessory:captain` |
| `three-tides` | 20 | used Opus, Sonnet and Haiku | distinct `claude.turn` 3 | `accessory:crown` |
| `claw-streak` | 20 | 7 days in a row with a Claude turn | eventStreak `claude.turn` 7 | `effect:bubbles` |
| `hands-on-claw` | 20 | first Computer Use with Claude | count `claude.computer` 1 | `accessory:hard-hat` |
| `shell-talk` | 20 | first voice conversation with Claude | count `claude.voice` 1 | `emote:crab:laughing` |

`proud` and `laughing` already have eye draws (`src/components/crab-art.ts:74-79`). `claw-dance` and `clone` are not in `CRAB_MOVES` (`src/components/crab-moves.ts:101`). Hats and effects have no registry yet.

Existing feeders: `subagent.used` (`server/achievements.ts:518-523`, catalog `delegator` at `shared/achievements-catalog.ts:261-268`), `routine.ran` (`:513-516`), `voice.call` (`:489-510`), `computer.control` (`:462`, that is the person taking the screen, catalog `hands-on` at `:270-277`). Claude rows do not reuse those events: they need the anthropic family on the same hook.

Draft names (en / fr), the owner to confirm with the table:

| id | name.en | name.fr |
|---|---|---|
| `claude-linked` | Claude Linked | Compte Claude lié |
| `first-pinch` | First Pinch | Premier pincement |
| `claude-regular` | Regular Claw | Pince régulière |
| `claude-devotee` | Devotee | Dévoué |
| `crab-army` | Crab Army | Armée de crabes |
| `tide-keeper` | Tide Keeper | Gardien de la marée |
| `three-tides` | Three Tides | Trois marées |
| `claw-streak` | Claw Streak | Série de pinces |
| `hands-on-claw` | Hands on Claw | Pince aux commandes |
| `shell-talk` | Shell Talk | Parler dans la coquille |

Descriptions follow the condition column in the table. Icons: reuse lucide names already mapped in `src/components/achievements/icons.ts` (Link, MessageCircle, Repeat, Flame, Network, CalendarClock, Layers, CalendarCheck, MousePointerClick, Phone). `icons.test.ts` fails if a catalog icon is missing.

## Server

### Link detection

`claudeAccountLinked(person)` is true when any of:

- Org: `PrincipalEngineLogins.signedIn(person, "claudeAgent")` (`server/engines/principal-engine-logins.ts:10-11, 30, 113-116`), the marker `.pulsabot-login.json` written from `onAuthenticated` (`:134, 172-176`).
- Solo: the same marker in that install's Claude config dir. Today's solo `ClaudeLoginController` only refreshes models on success (`server/drivers/claude.ts:2842-2844`, `server/drivers/claude-login-auth.ts:80, 411`). Write the marker there too.
- Own Anthropic key: solo `cfg.anthropic?.key` (the public flag is `config.anthropic.configured`, `server/index.ts:19978`); org the person's Perspicax `anthropic` key (`myKey` via `providersOfDriver("claudeAgent")` which is `["anthropic"]`, `server/engines/engine-credentials.ts:91, 23256-23257`). `orgKey` / Settings > Connections does not count.

Record `{ type: "claude.linked" }` from those write paths (login success, own-key save). Idempotent: the achievement unlocks once (`server/achievements.ts:12, 352-353`).

Data flow:

1. Person finishes `claude auth login` or saves their Anthropic key.
2. Server writes the marker or the key, then `record(person, [{ type: "claude.linked" }], "server")`.
3. Store unlocks `claude-linked`, adds `character:crab` (and the four base emote keys) to `snapshot.rewards`.
4. Live frame `kind: "achievements"` with `audience` that person (`server/achievements.ts:529-533`) reaches desktop streams; iOS notices on the next GET.
5. Desktop toast reveals the crab (`AchievementToaster.tsx:76-101`). iOS banner does the same (`AchievementToast.swift`).
6. Gallery and iOS character row include crab.

### Reconciliation

On `GET /api/me/achievements` (`server/routes/achievements.ts:44-46`), before `snapshot(person)`, if `claudeAccountLinked(person)` then `record(person, [{ type: "claude.linked" }], "server")`. Covers people already signed in or keyed today. iOS only GETs (`ios/Sources/CompanionCore/Achievements.swift:377-381`, `ios/App/Features/Achievements/AchievementStore.swift:62-70`); it never posts `claude.linked`.

### Claude activity hooks

Extend `observeAchievementFrame` (`server/index.ts:1194-1216`) and the send site (`:33920`):

- `runtime` `turn.completed` with `modelFamily(threadModel) ?? modelFamily(provider) === "anthropic"` (`server/achievements-mastery.ts:111-126`): `claude.turn`, `key` from a small `claudeTide(model)` (`opus` / `sonnet` / `haiku` by id substring; other anthropic ids still count the turn).
- `activityEvents` already emits `subagent.used` (`server/achievements.ts:518-523`): when the thread's family is anthropic, also `claude.subagent`.
- `routine.run` completed (`:513-516, 1202-1211`): when that run's bot/thread family is anthropic, also `claude.routine`.
- Tool line named `computer_use` / `computer_exec` / `mcp__computer__*` (`server/desktop/desktop-bridge-tools.ts:81-85`, `server/achievements-mastery.ts:61`) on an anthropic turn: `claude.computer`. This is not `computer.control` (`server/achievements.ts:462`).
- `achievementSendEvents` when `voiceCall` is set (`:500-508`) and the thread family is anthropic: `claude.voice`.

Auto-picked Claude counts (the completed turn's model, not the bot's fallback).

### Catalog test

`shared/achievements-catalog.test.ts:51-66` requires every non-default character to be rewarded exactly once. After crab leaves `DEFAULT_CHARACTERS`, `character:crab` must appear once (`claude-linked`). `src/components/crab.test.ts:116` currently asserts crab is free: invert that.

## Desktop UI

### Hide locked characters

| Surface | Today | Change |
|---|---|---|
| Appearance gallery list | Hides locked *secret* only (`MascotLookEditor.tsx:565-569`) | `listed` keeps a character only if unlocked or currently worn |
| To unlock shelf / chip | Locked non-secrets (`wardrobe.ts:7-11, 48-52`) | Empty: drop the locked chip when no listed row is locked |
| Character tile hint | `lockHint` (`src/lib/achievements.ts:295-305`, editor `:508, :751`) | No tile, no hint, no achievement name |
| Worn character | Always usable (`MascotLookEditor.tsx:557, :564`) | Unchanged |
| Skin cards of the shown character | Locked skins stay out (`mascots.test.ts:219-223`) | Unchanged (skins of an owned character) |
| App icon picker | Hides locked icons (`AppIconPicker.tsx:169-171`) | Unchanged; a crab icon stays out while `character:crab` is locked (`src/lib/achievements.ts:283-291`) |
| Reward filter | Every `MASCOT_CHARACTERS` (`achievement-filters.ts:11, 37-41`) | Owl plus unlocked characters only |
| New bot / reset | Owl (`AppearancePane.tsx` reset to `character: "owl"`) | Unchanged |
| Debug / registry | `MASCOTS` still includes crab (`mascots.tsx:644-646`) | Registry stays complete; pickers filter |

Shapes no longer appear on To unlock while Grok is unlinked. The `grokLinked` preview injection (`MascotLookEditor.tsx:558-563`) goes away; Shapes appears when `character:shape` is in the snapshot (still via client `grok.linked` until the follow-up).

### Achievement cards and toasts

`AchievementCard` prints `rewardLabel(rewards[0])` (`AchievementsPage.tsx:92, 126`) and Mastery draws look art (`:62-80`). `rewardLabel` names the character (`src/lib/achievements.ts:224-227`). `RewardPreview` draws it (`src/components/achievements/RewardPreview.tsx:19-30`).

While the rewarded character is locked (or the reward is a skin of a locked character):

- Copy: "a surprise character" (character) or "a surprise look" (skin). No name, no `RewardPreview` art.
- Search must not match "Crab", "Shapes", or any other locked character name (`achievement-filters.ts:49-54`).
- Mastery preview uses the same placeholder (`AchievementsPage.tsx:62-80`).

Once unlocked, the real name and art show. Missing registry items (emote / move / accessory / effect) omit the line entirely, including on the toast.

### Surprise reveal toast

`AchievementToast` (`AchievementToaster.tsx:76-101`) already shows the first reward's art after unlock. For `claude-linked`, that is the reveal: kicker, name, "Character unlocked: Crab", crab art. Queue, typing wait, chime, reduced motion unchanged (`AGENTS.md` Achievements). iOS banner matches (`ios/App/Features/Achievements/AchievementToast.swift`, `AchievementWording.swift:10-20`).

## iOS

Parity with the desktop. The phone already drops locked characters from the editor (`CharacterEditor.swift:125`, `BotPanelAvatarEditor.swift:141`) except defaults and the worn one. Removing crab from `defaultCharacters` (`BotPanelRules.swift:182-183`) hides it until `character:crab` is in `GET /api/me/achievements` rewards. Comment at `BotPanelRules.swift:182` updates.

| File | Change |
|---|---|
| `BotPanelRules.swift` | `defaultCharacters = [.owl]`; `characterUnlocked` follows |
| `MascotLook.swift` | Character enum unchanged (art still decodes a stored crab) |
| `CharacterEditor.swift` | Keep the filter; crab disappears with the default. Copy at `:1-19` ("Owl, Shape, Trombi") is already stale |
| `BotPanelAvatarEditor.swift:141` | Same filter |
| `CreateBotSheet.swift` | Uses `CharacterEditor`; no extra picker |
| `MascotGalleryView.swift` | DEBUG art board (`:1-4, :33`). Not a picker; still lists crab for stills |
| `AchievementCatalog.swift` | Regen from `ios/parity/achievements-catalog.mjs` |
| `Achievements.swift` | Category `claude`; new reward cases; `reward.key` |
| `AchievementWording.swift` | Category label; surprise copy; skip unregistered items |
| `AchievementsPage.swift:325-327` | Same surprise / hide rules as desktop cards |
| `AchievementToast.swift` | Reveal art after `claude-linked` |
| `AchievementStore.swift` | Reload on foreground still GETs; reconciliation is the server's |
| Fixtures `ios/Tests/CompanionCoreTests/Fixtures/mascot-looks.json:3-13` | Character list stays the art catalog (includes `crab`) |
| `MascotLookFixtureTests.swift:309` | Stop expecting crab in `defaultCharacters` |

iOS does not report `grok.linked` (`AchievementEvent` in `Achievements.swift:251-267`: `app.opened`, `achievements.viewed`, `trombi.summoned`, `appicon.changed`). It will not report `claude.linked` either.

### Parity matrix

Update `docs/superpowers/specs/2026-10-03-ios-feature-parity-matrix.md` **in the implementing PR** (this spec only):

- **BP6** (`:285`): iPhone is no longer only "no locks or tiers". Character row: locked characters absent (worn stays). Skin row: locked skins stay unselectable. Claude crab appears after `claude-linked`.
- **ST9** (`:414`): add category `claude`, server-side `claude.linked`, surprise reward copy. Matrix still says MISSING; the screens exist (`AchievementsPage.swift`, `AchievementToast.swift`). Note that drift; do not widen ST9 in this sub-project beyond the Claude rows and surprise copy.

## Migration and grandfathering

`migrated` (`server/achievements.ts:70-71, 242-250`) already ran for existing people. `grandfatheredFromBots` (`shared/achievements.ts:517-537`) adds the *current* non-owl character (`:522`) and non-common *stored* skins (`:525-534`). That pass cannot be replayed: re-running the stored-skins loop would treat editor defaults as use.

Add a second one-time flag on the person record, `migratedCrab` (false until this build). When first false:

1. Same bot set as today (`server/index.ts:1022-1026`): org, bots they own; solo, every bot.
2. If `completeMascotLook(bot.mascotLook).character === "crab"`, push `character:crab`. If that bot's crab skin is not Common, also push `skin:crab:<id>`.
3. Set `migratedCrab: true`. Never run again, including if they later dress a bot as the crab without unlocking.

Worn crab stays in the editor even without the key until they change it (today's worn-stays rule). The snapshot is what keeps it after they switch away.

## Error and edge cases

- **Unlink Claude later** (sign-out, delete own key): `claude.linked` and `character:crab` stay. No second toast.
- **Org key only**: `claudeAccountLinked` false. Turns paid by `org-key` still count as Claude turns if the model family is anthropic (use of Claude, not the link). Linking still requires the person's own login or key.
- **Org server, per principal**: marker and keys live under `principals/<id>/` (`principal-engine-logins.ts:5-8, 108-111`). One person's crab is not another's.
- **Offline iOS**: no new client event. Unlocks arrive on the next `GET` / foreground reload (`AchievementStore.swift:27-29, 62-70`). A crab look already stored still draws.
- **Server without achievement routes**: `enforced: false`, nothing locked (`shared/achievements.ts:461-466`, `BotPanelRules.swift:169-180`). Crab stays pickable there, including after this change.
- **Fable / unnamed anthropic ids**: count as `claude.turn`, no `three-tides` key until the id names opus, sonnet or haiku (open question).
- **Pi or another engine running an anthropic model id**: the turn counts. Linking still looks at the Claude login and the Anthropic key, not pi's.
- **Rate limits**: new events use `DEFAULT_SERVER_LIMIT` (`shared/achievements.ts:109`).

## Testing

Unit (pure where possible):

- `claudeAccountLinked`: own login marker, own anthropic key, org key false, other providers false.
- Reconciliation on snapshot: already linked, already unlocked, not linked.
- `claudeTide` / `modelFamily` on opus, sonnet, haiku, grok, empty.
- Hooks: turn, sub-agent, routine, computer tool, voice; non-anthropic emits none of the `claude.*` events.
- `eventStreak` on `days["claude.turn"]`.
- `rewardKey` new kinds; `rewardLineVisible` false until registered.
- `grandfatheredFromBots` unchanged; `migratedCrab` snapshot: worn crab (plain and gold), owl with a leftover `skins.crab`, second pass no-op.
- `characterUnlocked("crab")` false by default; gallery `listed` omits locked ids; reward filter omits them; card copy is "a surprise character".
- Catalog: `character:crab` rewarded once; `ACHIEVEMENT_CATEGORIES` includes `claude`; every new id uses a known event.
- iOS: `defaultCharacters == [.owl]`; editor filter; fixture `characters` still lists `crab`; catalog generator `--check`.

UITest: extend `ios/UITests/BotPanelDetailsUITests.swift` Character (BP6, `:346-383`) or `NewBotUITests.swift`: with empty rewards, crab is absent from the character row and owl is present; after the fixture's snapshot includes `character:crab`, crab is present. Optional: `AchievementToastUITests.swift` already drives client events (`:21-27`); `claude-linked` is server-side, so the toast assertion belongs on a fixture that records the server event, not a client POST.

## Open questions for the owner

1. Confirm the draft ladder table (ids, copy, points, reward ids). Ids freeze at ship.
2. Four base emote ids: `neutral`, `happy`, `curious`, `sleepy` (today's mood faces). Rename now if the art direction in sub-project 2 will differ.
3. Accessory ids unprefixed (`captain`, `crown`, `hard-hat`) as written above, or `accessory:crab:<id>`?
4. Fable (and other anthropic ids that are not opus/sonnet/haiku): a fourth tide, count as Opus, or ignored by `three-tides` only?
5. Turns on Auto that land on Claude: count (recommended). Local `/v1/messages` models that `modelFamily` does not class as anthropic: ignore (recommended).
6. Existing non-Claude rows that already reward crab skins (`hello-bot` pearl, `dressing-room` gold, and the rest): surprise-look wording until crab is unlocked (recommended), or leave those labels as they are?
7. Org-key Claude turns count toward the ladder (recommended) while the *link* does not. Confirm.
8. To unlock shelf: gone for characters (recommended). Skins of an owned character stay as today.
9. iOS DEBUG `MascotGalleryView` still shows crab stills (recommended: yes, not a picker).
10. `claw-streak` at 20 points to match `week-streak` (`shared/achievements-catalog.ts:417-424`). Raise to 50?
