# Achievements: the Mastery tier (Maîtrise)

Achievements (`shared/achievements.ts`, catalog in `shared/achievements-catalog.ts`,
server store in `server/achievements/achievements.ts`) already teach the first habits:
send a message, create a routine, answer an approval. The Mastery tier is
the next step. Its 24 achievements are hard on purpose: each one proves real
mastery of working with AI and of Sagax, never a vanity count (no "send 500
messages"). They unlock the four Mastery characters (Shiba, Grump, Ogre,
Frog) and every one of their skins.

## The rules of the tier

- **Measured by the server only.** Every rule reads facts the server saw
  (a routine run that ended, an approval denied, a turn completed on a
  model). The app cannot post one: a client event of type `mastery` is
  refused like any server event.
- **Best value, never taken back.** A measure keeps the best value it ever
  reached (`shared/achievements-mastery.ts`), so a good stretch that ended
  still counts, and an unlock is forever.
- **Idempotent.** A fact that carries an id (a routine run, an approval, a
  delegation) counts once, however often it is replayed.
- **Harder than the rest.** 100 to 300 points (the other tiers stop at 100).
  The points count toward the points tiers (Bronze to Gold) like any others;
  Platinum ("every achievement that is not a secret") leaves Mastery aside.
- **Two weeks of real use for a character.** Each character's own
  achievement (100 points) is reachable in about two weeks of daily work;
  the named skins come on three harder rungs; the premium skins on the
  hardest achievements of the tier.
- **The points tiers moved.** Bronze, Silver, Gold and Platinum leave the
  old "mastery" category for their own, "Tiers" ("Paliers"); "Mastery"
  ("Maîtrise") is now this tier. Categories are not stored, so nothing
  migrates.

## The 24 achievements

Secret ones keep their name and rewards hidden until unlocked, with a hint.
Every Mastery achievement also gives a title (its own name).

| # | id | Titre (fr) | Title (en) | Título (pt-br) | Rule, in plain words | Points | Secret | Facts that advance it | Unlocks |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `hands-off` | Déléguer sans surveiller | Hands Off | Delegar sem vigiar | One of your routines completes 10 runs in a row without a failure | 100 | no | `routine.outcome` | Shiba |
| 2 | `second-wind` | Second souffle | Second Wind | Segundo fôlego | Twice, a routine failed, you changed it, and its next 3 runs completed | 100 | no | `routine.outcome`, `routine.edited` | Shiba rung 1: Cream, Black and Tan |
| 3 | `common-thread` | Fil conducteur | Common Thread | Fio condutor | A routine that builds on its previous report completes 14 runs | 150 | no | `routine.outcome` (continuity) | Shiba rung 2: Red, Sesame |
| 4 | `quiet-nights` | Nuit calme | Quiet Nights | Noites tranquilas | 30 finished days in a row where your routines ran and none failed | 150 | no | `routine.outcome`, nightly pass | Shiba rung 3: White |
| 5 | `pack-leader` | Chef de meute | Pack Leader | Líder da matilha | Routines on 3 different bots each complete 20 runs | 200 | no | `routine.outcome` | Shiba Retro 98, Gold |
| 6 | `reviewer` | Relecteur | Reviewer | Revisor | Deny 5 approvals that would have written to a system; each time the bot still completes the turn another way | 100 | no | `approval.answered` (write), `turn.done` | Grump |
| 7 | `prompter` | Souffleur | Prompter | Ponto | 15 times, correct a bot while it works (a message steered into its running turn) and the turn completes | 100 | no | `message.sent` (steered), `turn.done` | Grump rung 1 |
| 8 | `red-pen` | Stylo rouge | Red Pen | Caneta vermelha | On 5 different days, revise a bot's standing instructions and see it complete 5 turns with them | 150 | no | `persona.saved`, `turn.done` | Grump rung 2 |
| 9 | `not-so-fast` | Pas si vite | Not So Fast | Calma lá | Stop a bot 10 times, and each time its next turn completes | 150 | yes | `bot.stopped`, `turn.done` | Grump rung 3 |
| 10 | `justice-of-peace` | Juge de paix | Justice of the Peace | Juiz de paz | Answer 100 approvals, at least 20 of them denials | 200 | no | `approval.answered` | Grump Retro 98, Gold |
| 11 | `conductor` | Chef d'orchestre | Conductor | Maestro | 3 times, a bot hands work to two other bots, both come back done, and its turn completes | 100 | no | `delegation.done`, `turn.done` | Ogre |
| 12 | `ten-hands` | Dix mains | Ten Hands | Dez mãos | 10 open conversations in 5 folders, none left untouched for 30 days | 100 | no | `threads.census` (nightly, and on each conversation change) | Ogre rung 1 |
| 13 | `plugged-in` | Branché | Plugged In | Conectado | Your bots use tools from 3 different integrations (MCP servers, Perspicax APIs) within one week | 150 | no | `tool.used` (integration) | Ogre rung 2 |
| 14 | `swarm` | Essaim | Swarm | Enxame | One turn puts 3 sub-agents to work and completes | 150 | no | `tool.used` (sub-agent), `turn.done` | Ogre rung 3 |
| 15 | `full-house` | Salle comble | Full House | Casa cheia | 3 of your bots work at the same time, and all of them finish well | 200 | no | `turn.started`, `turn.done` | Ogre Retro 98, Gold |
| 16 | `polyglot` | Polyglotte | Polyglot | Poliglota | One conversation runs on models from 3 different providers | 100 | no | `turn.done` (model family) | Frog |
| 17 | `thrifty` | Économe | Thrifty | Econômico | A week of at least 20 Auto turns where Auto picked a cheaper model than the bot's own for more than half | 100 | no | `turn.done` (Auto, list prices) | Frog rung 1 |
| 18 | `translator` | Traducteur | Translator | Tradutor | 5 conversations of at least 6 turns entirely in French, your messages and the answers | 150 | no | `message.sent`, `reply`, `turn.done` | Frog rung 2 |
| 19 | `skill-smith` | Forgeron de skills | Skill Smith | Ferreiro de skills | A skill a bot wrote from your conversation (/learn) is used in 20 turns | 150 | no | `skill.learned`, `tool.used` (skill) | Frog rung 3 |
| 20 | `total-recall` | Mémoire vive | Total Recall | Memória viva | Write a bot's memory yourself, then see it recalled in 10 different conversations | 200 | no | `memory.written`, `memory.recalled` | Frog Retro 98, Gold |
| 21 | `ferryman` | Passeur | Ferryman | Barqueiro | Publish a bot to your organization's catalogue, and 3 people import it | 250 | no | `catalog.imported` | Neon, on all four |
| 22 | `second-opinion` | Deuxième avis | Second Opinion | Segunda opinião | 10 times, a bot hands work to a bot on another model family and it comes back done | 250 | yes | `delegation.done` (cross-model) | Chrome, on all four |
| 23 | `clean-slate` | Table rase | Clean Slate | Tudo em dia | 20 finished days where every approval asked of you was answered the same day and none of your routines failed | 250 | no | `approval.requested`, `approval.answered`, `routine.outcome`, nightly pass | Glitch, on all four |
| 24 | `sagax-master` | Sagax accompli | Sagax Master | Mestre Sagax | Unlock 20 other Mastery achievements | 300 | no | the other unlocks | Holo and Molten, on all four, and the title "Sagax Master" |

Ferryman needs an organization server (a catalogue and colleagues). The
capstone asks for 20 of the 23 others, so a solo server can still reach it.

## The unlock map (`shared/mascot-unlocks.ts`)

The registry is the only place that names the Mastery characters. It
imports no art, so it holds before the characters land and after.

| Character | Character unlock | Named rung 1 | Named rung 2 | Named rung 3 | Retro 98, Gold | Neon | Chrome | Glitch | Holo, Molten |
|---|---|---|---|---|---|---|---|---|---|
| `shiba` | `hands-off` | `second-wind` (cream, blacktan) | `common-thread` (red, sesame) | `quiet-nights` (white) | `pack-leader` | `ferryman` | `second-opinion` | `clean-slate` | `sagax-master` |
| `grump` | `reviewer` | `prompter` | `red-pen` | `not-so-fast` | `justice-of-peace` | `ferryman` | `second-opinion` | `clean-slate` | `sagax-master` |
| `ogre` | `conductor` | `ten-hands` | `plugged-in` | `swarm` | `full-house` | `ferryman` | `second-opinion` | `clean-slate` | `sagax-master` |
| `frog` | `polyglot` | `thrifty` (leaf, tree) | `translator` (poison, bullfrog) | `skill-smith` (ghost) | `total-recall` | `ferryman` | `second-opinion` | `clean-slate` | `sagax-master` |

- The base skin (`plain`, or `classic`) comes with the character.
- Named skins are spread over the three rungs in the order the character
  registers them (skin i of n falls on rung floor(3i/n)). A mascot branch
  registers its named skins by appending to `namedSkins` in its entry. A
  named skin not registered yet is locked behind the last rung, never free.
- `masteryUnlockFor(character, skin?)` names the achievement;
  `masteryLock(keys, character, skin?)` says whether it is locked for a
  person's reward keys; `masteryRewards(achievement)` lists what an
  achievement unlocks (the catalog's rewards come from it).
- An unlocked Mastery achievement adds the key `mastery:<id>` to the
  snapshot's `rewards`, so a skin registered later opens with it.
- A skin's rung earned before the character's own achievement unlocks the
  character too (worn in that skin), here and in the server's save check.

## How the server measures

`server/achievements/achievements-mastery.ts` turns what the server already sees into
facts for a person; `shared/achievements-mastery.ts` keeps the bounded state
and the measures. The hooks in `server/index.ts`:

| Where | Fact |
|---|---|
| `routine.run` frame (completed, failed, missed) | `routine.outcome` (with the routine's continuity) |
| PATCH `/api/routines/:id` | `routine.edited` |
| A new approval card in a thread (`message` frame) | `approval.requested` |
| The card answered allow or deny (`message.patch` frame) | `approval.answered`, with `write` from the tool's name or its MCP hints |
| `runtime` frames `turn.started` and `turn.completed` | `turn.started`, `turn.done` (model family; Auto and whether its pick was cheaper by list price) |
| Activity lines (`message` frames) | `tool.used`: a sub-agent, an integration (`mcp__<server>__...`, a Perspicax API), a skill loaded (`Skill`, `skill_view`) |
| A bot's final answer | `reply` (French or not) |
| POST `/api/bots/:id/messages` | `message.sent` (French or not, steered into the running turn or not) |
| POST `/api/bots/:id/interrupt` | `bot.stopped` |
| PATCH `/api/bots/:id`, `/profile`, SOUL file apply | `persona.saved` (when the standing instructions changed) |
| A delegation's receipt (`finalizeDelegationWatch`) | `delegation.done` (cross-model when the families differ) |
| `/api/internal/skills/stage` create from a conversation | `skill.learned` |
| PUT `/api/bots/:id/memory`, `/memory/file` | `memory.written` |
| Automatic recall with notes (`autoRecallPrompt`) | `memory.recalled` |
| POST `/api/bot-catalog/:id/import` | `catalog.imported` (for the publisher) |
| PATCH `/api/bots/:id/tasks/:threadId`, and the nightly pass | `threads.census` |

French is read from small words only (`looksFrench`): no model, no network.

**Nightly pass.** Once per person per local day (the person's `tzOffset`),
the server looks at their conversations (Ten Hands) and closes the windows
that span days (Quiet Nights and Clean Slate count finished days only;
Plugged In and Thrifty slide over seven days), then announces any unlock
with the usual frame and toast.

Also fixed on the way: an approval answered from a thread
(POST `/api/threads/:id/respond`) now counts for Gatekeeper and Trusted Judge.

## A locked look

- **Server.** PATCH `/api/bots/:id` and PATCH `/api/bots/:id/profile`
  refuse a `mascotLook` that puts on a Mastery character or skin the person
  has not unlocked: 403 `{ code: "look_locked", achievement, character,
  skin? }`. What a bot already wears is never taken back. Until a Mastery
  character lands, the look schema refuses it anyway (400).
- **Look editor.** Every character and every skin stays in the picker
  (2026-10-14), a locked one greyed and not selectable: a padlock, the
  achievement's progress bar, and the hint "Unlock: Hands Off (7/10)" (a
  secret's hint for a secret achievement) as its tooltip and label. Trombi
  alone stays out until found (an easter egg).
- **An earned skin brings its character.** A character counts as unlocked
  once the person earned one of its skins above its base one
  (`characterUnlocked`, `masteryLock`): a skin rewarded on a character still
  locked used to be listed as a reward with no art, and the character stayed
  out of the gallery, so the skin could be neither seen nor worn. Only the
  earned skins (and the Common ones) are wearable; Trombi still waits for
  its command.
- **Achievements modal.** The Mastery category (Maîtrise) shows every card
  with its progress bar from 0 and what it unlocks: the character or its
  skins, greyed until unlocked (a placeholder until the character's art
  registers in `src/components/achievements/mastery-art.tsx`). Unlocks use
  the same toast and chime as every achievement.
- **iOS.** The generated catalog carries the tier
  (`node ios/parity/achievements-catalog.mjs`); the achievements sheet lists
  Mastery and Tiers, shows the bar from 0 and "Locked: N looks to unlock".
  Parity row DC47.

## For the mascot branches

When a character lands (`feat/mascot-shiba`, `-grump`, `-ogre`, `-frog`):

1. Add its id to `MASCOT_CHARACTERS` and its skins as usual; keep its base
   skin `plain` (or `classic`) and the premium ids (`retro98`, `gold`,
   `neon`, `chrome`, `glitch`, `holo`, `molten`).
2. Append its named skins, easiest first, to its entry's `namedSkins` in
   `shared/mascot-unlocks.ts` (Shiba's are already there).
3. Register its art in `MASTERY_ART` (`src/components/achievements/mastery-art.tsx`).
4. Call `skinLock(unlocks, "<id>", skin)` and `characterLock(...)` in its
   picker (`MascotLookEditor.tsx`), as the other characters do: the lock,
   the hint and the progress come with them.
5. Run `node ios/parity/achievements-catalog.mjs` so the phone gets its names.
