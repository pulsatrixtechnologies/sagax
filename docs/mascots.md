# Mascots

The characters a bot can wear (`bot.mascotLook`, `shared/mascot-look.ts`):
the owl, the crab, the Shapes, Trombi, Bunbu, and the Mastery characters (Shiba,
Grump, Ogre, Frog) that the Mastery achievements unlock
(`shared/mascot-unlocks.ts`, [achievements](achievements.md)). Each section
below describes one character: its art, its colors, its skins and its moves.

## Asleep, every character

On the desktop a sleeping mascot must not look idle. The stage carries
`data-asleep` when the mascot naps (`activity` `sleep`) or the brain's pose
is `sleep` while it rests (`src/components/floating-bots/sleep.ts`,
`mascotAsleep`; never while dragged, walking or flying). On top of each
character's own sleep move (closed eyes, a slow breath, a nap pose), the
shared layer dims the character a little (brightness 0.8, opacity 0.86) and
floats bold, outlined "z Z" glyphs beside its head, on the effects lane
(`floating-bots.css`, "asleep"). Under reduced motion the glyphs stand still,
"z Z" side by side, and the character keeps its sleeping face with no bob.
Covered by `src/components/floating-bots/sleep.test.ts`.

## Shiba

The Shiba Inu of direction C ("aplat net", approved by the maintainer on 2026-10-09): two
flat tones (the coat and the cream mask) and a shade crescent, one uniform
outline on the silhouette and the features alike. The body sits; the face is
three layers every expression swaps (eyes, brow spots, mouth) over a nose
that never changes. Three poses: `sit` (the approved art), `stand` (the walk,
four legs, the curled tail on the back) and `lie` (the loaf for naps). Under
48 px the drawing is a bust.

### Files

| What | Where |
|---|---|
| Art as data: parts, paint roles, sixteen faces, the three poses, pivots | `src/components/shiba-art.ts` |
| Skins | `src/components/skin-fx/shiba-skins.tsx` |
| Moves and the rig | `src/components/shiba-moves.ts` |
| The component | `src/components/ShibaMascot.tsx`, `shiba-mascot.css` |
| Desktop: render, menu moves, held activities, event cues, the bark | `src/components/floating-bots/mascots.tsx` (`ShibaRender`, `SHIBA_MENU_MOVES`, `shibaHeldFor`, `cueClipFor`) |
| Unlocks (Mastery) | `shared/mascot-unlocks.ts` (`shiba`), `src/components/achievements/mastery-art.tsx` |
| Phone | `ios/Sources/CompanionCore/ShibaStillArt.swift` (generated), `ShibaArt.swift`, `ios/App/Mascots/ShibaMascotView.swift` |

### Colours and skins

The default colour is orange (`SHIBA_DEFAULT_COLOR`). Thirteen skins
(`SHIBA_SKINS`): Plain (the bot's colour, free with the character), the
breed's coats Cream, Black and Tan, Red, Sesame and White (Rare, each on a
Mastery rung: `second-wind`, `common-thread`, `quiet-nights`), then the
premium set every Mastery character wears (Retro 98 and Gold on
`pack-leader`; Neon, Chrome, Glitch Epic; Holo, Molten Legendary). The
character itself unlocks with `hands-off` ([achievements](achievements.md)).

### Moves

The menu moves: bark, turn in circles, wag, sniff, head tilt, stretch, lie
down, shake off, wave, excited. Held: it walks while the window walks, runs
while it flies, sleeps, dangles while dragged, works, talks while the reply
streams and sits up attentive while its bot waits. Desktop cues: a bark for a
nudge, circles for an achievement, excited when a message lands, lying down
before a snooze. The bark is heard only when the person turns the bark sound
on (Settings > Appearance, off by default). Turn in circles is the owl's
in-place turn four times (hop plus squash-mirror, `Owl25D.flatTurn`), never a
depth spin of the flat drawing, then it sits.

## Grump

The grumpy cat of direction C ("aplat net", approved by the maintainer on 2026-10-09):
cream fur, dark point markings (the mask with its light blaze, the ears, the
tail), a white muzzle and chest, blue almond eyes slanted eight degrees with
a slit pupil, a small pink nose and a mouth whose corners drop very low. Two
flat tones and a shade crescent per part, one uniform outline that never
drops under 1.6 screen px. Under 48 px the drawing is a bust.

### Files

| What | Where |
|---|---|
| Art as data: parts, paint roles, sixteen faces, four stances, jointed tail, two-bone IK legs | `src/components/grump-art.ts` |
| Skins: palettes, gradients, the Shapes treatments, Void's lit eyes, the flat palettes the phone draws | `src/components/skin-fx/grump-skins.tsx` |
| Moves, the rig, the desktop clip map | `src/components/grump-moves.ts` |
| The component: CSS idle, the live rig writing poses onto the groups | `src/components/GrumpMascot.tsx`, `grump-mascot.css` |
| Desktop: render, menu moves, held activities, event cues | `src/components/floating-bots/mascots.tsx` (`GrumpRender`, `GRUMP_CUES`, `grumpHeldFor`) |
| Desktop behavior: the prowl, the cat's idle actions | `floating-bots/behavior.ts` (`cat`, trip phase `stalk`), `scheduler.ts` (`cat: true` actions) |
| Unlocks (Mastery) | `shared/mascot-unlocks.ts` (`grump`), `src/components/achievements/mastery-art.tsx` |
| Phone | `ios/Sources/CompanionCore/GrumpStillArt.swift` (generated), `GrumpArt.swift`, `ios/App/Mascots/GrumpMascotView.swift` |

### Colours

The markings are the bot colour deepened like a colourpoint cat's (42 % toward
a dark brown); a light colour is darkened further until the mask reads on the
fur (contrast 2.2 or more). The cream fur takes 8 % of the markings. Where no
bot gives a colour, Grump is a warm brown.

### Faces

The sixteen Shapes ids. The approved moods are five of them: idle is
`neutral` (half lids sloping out, pinched brows, the deep arc), happy is
`happy`, thinking is `curious`, alert is `surprised`, sleepy is `sleepy`.
The pupil is a slit at rest and dilates (scared, excited, sad, shy). The
app's states map to faces through the same table as the Shiba
(`shibaExpressionFor` in Avatar.tsx).

### Skins

| Skin | Rarity | Unlock (Mastery) | Look |
|---|---|---|---|
| Plain | Common | with Grump (`reviewer`) | the bot colour on the points |
| Tuxedo | Rare (named) | `prompter` | black, white bib and socks, green eyes |
| Calico | Rare (named) | `prompter` | the mask split orange and black down the blaze |
| Tabby | Rare (named) | `red-pen` | striped all over, green eyes |
| Siamese | Rare (named) | `red-pen` | seal points on pale fur, deep blue eyes |
| Void | Rare (named) | `not-so-fast` | all black, eyes glowing in the bot colour (or a cat's yellow green) |
| Retro 98, Gold | Rare | `justice-of-peace` | 64-colour coat with a dithered shade; a lucky gold figurine with emerald eyes |
| Neon, Chrome, Glitch | Epic | the shared Mastery premium rungs | the Shapes treatments per part |
| Holographic, Molten | Legendary | the shared Mastery premium rungs | the Shapes treatments per part |

Legacy ids (`tux`, `tortie`, `tiger`, `colourpoint`, `black`, `retro`, `royal`,
`metal`, `cyber`, `holographic`, `lava`...) read as the current ones.

### Moves

Thirty-one moves, pure functions of time (`grumpMoveAt`). The fourteen every
character plays: idle, blink, look, nod, shake, bounce, wave (reluctant),
think, celebrate, sleep (curled), alert, talk, listen, work. The cat's own:

| Move | What it does |
|---|---|
| walk | a cat's lateral sequence, eight keyframes of the paw's path (0.88 s), IK legs that never slide into the ground, head steady, ears and tail trailing |
| stalk | low and slow, the body sunk over bent legs, head forward, tail low with a twitching tip |
| sitUp, loaf | from the loaf to sitting tall; the loaf with half lids and one slow blink a cycle |
| stretch | the front (chest down, rump up, a yawn), then the back (a hind leg out behind) |
| groom | licks the paw, rubs it over the face and behind the ear |
| tailFlick, earsFlat, slowBlink | annoyed; an error; content |
| knead | the front paws press in turn, eyes half shut |
| pounce | crouch, rump wiggle, spring, land |
| ledge | hops up onto a ledge, sits there a moment, hops down |
| curl | turns once on the spot, then the ball with the tail around the front |
| yawn, hiss, bonk, drag | a yawn and a head shake; puffed with ears flat and fangs; two head bonks; dangling, unimpressed |

The rig (`GrumpRig`) blends the idle life, one held activity and one
one-shot move; a stance change lands with a small squash. Reduced motion
never runs it: a move only shows its face (`grumpReducedFace`). Two live
Grumps hold 60 fps in Chrome.

### On the desktop

It walks while the window walks. Every few minutes it prowls: it stalks low
and slow to a spot within its room and loafs there (never while the chat is
open or its bot waits for an approval, never under reduced motion). When
idle it grooms, flicks its tail, slow blinks, kneads, loafs and hops onto a
ledge. Events: a head bonk at a nudge, kneading for an achievement, a pounce
on a new message, curled up before a snooze, a hiss at a refused approval,
ears flat on an error. The Appearance gallery and the mascot's Moves menu offer
stretch, groom, knead, pounce, ledge, hiss, bonk, slow blink, tail flick,
yawn, curl and wave.

### Keyframe renders

`grumpPoseSvg` draws any frame of a move as SVG (the tests use it). To look at
a move, render a few frames of `grumpMovePose(move, t)` to a page and take a
headless Chrome screenshot.

## Ogre

The big green ogre, direction C ("aplat net"), approved on 2026-10-09: a
bald inverted-pear head, trumpet ears, a heavy brow, a three-lobed nose, a
wide mouth with two upper incisors on the idle smile, a massive neck, a cream
tunic under an open vest. Two flat tones
and one shade crescent per part, one uniform outline (1.9 units, never under
1.6 screen px), geometric shapes, the same family as Shiba.

### Files

| File | What it holds |
|---|---|
| `src/components/ogre-art.ts` | The art as data: paths, paint roles, the sixteen faces, the mouths, the colors, the limbs (two bones placed by a hand or a boot), the marks (Lava's cracks, Armor's rivets). |
| `src/components/ogre-rig.ts` | One moment of the drawing (`OgreFrame`) and the drawing at that moment as nested groups (`ogreFrameLayers`), shared by the component, the tests and the renders. |
| `src/components/ogre-moves.ts` | The moves (frames over time), `OgreRig` (idle life, held activity, one-shot, blending), the clip map, the desktop mapping. |
| `src/components/OgreMascot.tsx`, `ogre-mascot.css` | The component: the still drawing with a CSS idle, the rig while a move plays. |
| `src/components/skin-fx/ogre-skins.tsx` | The thirteen skins. |
| `ios/Sources/CompanionCore/OgreStillArt.swift` | Generated from the art by `src/components/ios-mascot-export.test.ts`: the phone's still frames. |
| `ios/App/Mascots/OgreMascotView.swift` | The phone's drawing. |

### Stances and crop

- `rest`: the approved head and shoulders, what every avatar shows.
- `stand`: the whole ogre (the same head at 0.58 on a barrel body with a
  belt, two arms, two legs) for the walk and the moves that need hands.
- `log`: the whole ogre sitting on a log, for the nap.
- Under 48 px the drawing is the bust (`5 12 90 90`), the trumpets kept.

### Faces

The sixteen ids of the Shapes (`SHAPE_EXPRESSIONS`), so a state or a clip
names one face for every character. The approved moods are five of them:
idle is `neutral`, happy is `happy`, thinking is `curious`, alert is
`surprised`, sleepy is `sleepy`. The app's states map as Shiba's do
(`ogreExpressionFor` in `Avatar.tsx`).

### Colors

- Skin: the ogre green `#9DBE4A` a quarter (24 %) toward the bot color,
  in HSL so the hue and lightness move while the saturation stays an
  ogre's (`tintColor`).
- Vest: the bot color worn as leather (42 % toward brown, as approved);
  a light color (white, the pastels) is darkened until the cream tunic
  reads against it (contrast 1.6 or more).
- Without a bot color: the archetype's green and brown vest.

### Skins

| Skin | Rarity | Look |
|---|---|---|
| Plain | Common | The bot's color. |
| Swamp | Common | Deep bog green, a mud vest. |
| Moss | Common | Bright spring green, a moss vest. |
| Stone | Common | A grey granite ogre, a slate vest. |
| Lava | Rare | A basalt ogre whose cracks glow, embers for eyes, heat over the head. |
| Armor | Rare | Riveted plate steel for a vest, the chrome sweep on the plates. |
| Retro 98 | Rare | The sixteen colors, a black outline, a dithered shade. |
| Gold | Rare | A solid gold ogre in a royal vest. |
| Neon | Epic | Tubes of light on a dark ogre. |
| Chrome | Epic | A mirror ogre. |
| Glitch | Epic | Split channels and scan lines. |
| Holographic | Legendary | Pearl and rainbow foil. |
| Molten | Legendary | Rock and flowing magma. |

Unlocks come from the Mastery registry: Conductor unlocks Ogre; Swamp and
Moss come with Ten Hands, Stone and Lava with Plugged In, Armor with Swarm;
Full House gives Retro 98 and Gold; the five hardest skins come from the
cross-character achievements.

### Moves

The fourteen moves every character plays, ported to an ogre, then its own:

| Move | What it does | Desktop trigger |
|---|---|---|
| idle | Standing at ease: a heavy breath, the weight shifting between the boots, seeded slow blinks. | Always under the rest. |
| blink, look, nod, shake | The small ones; the head and the trumpets follow the eyes. | Clips (look, bob, headSpin, wink). |
| bounce | A crouch, a short heavy hop, a squashed landing that shakes the ground. | hop, jump, land. |
| wave | The right arm up, the open hand swinging from the elbow. | wave. |
| think | The head scratch: one hand at the side of the head, the other fist on the hip, thought bubbles. | The bot thinks (pose `think`), scratch, confused. |
| celebrate | Two heavy hops, fists pumping. | Moves menu. |
| sleep | Sits on a log, the head nodding, a snore bubble that swells under the nose and pops, z's. | The mascot sleeps; a snooze. |
| alert | Startled: a jump back, the eyes wide, the trumpets straight up. | surprised, startled. |
| talk, listen, work | Talking with a gesturing hand; a hand cupped behind a trumpet; a fist pounding a palm. | A reply streams; the bot works. |
| walk | The heavy walk: eight keys per stride pair on a periodic spline (contact, down, passing, up on each foot), the body dropping on each landing, the belly, the head and the trumpets following a beat late, dust and a ground shake on every contact. | The window travels (idle wander). |
| laugh | The belly laugh: rocked back, the hands on a bouncing belly, the face thrown up. | love (many strokes), Moves menu. |
| crossArms | Arms crossed, a boot tapping, a sceptical head tilt now and then. | An approval or an error waits on the person (pose `alert`). |
| roar | A crouch, then the roar: the jaw dropped, the lower tusks out, the trumpets flat back, shock lines, the air shaking. | A task failed or refused (sad), angry. |
| flex | The double biceps flex, the biceps swelling, sparkles. | A task done (celebrate). |
| earWiggle | The trumpets wiggle left and right, quick then settling. | A nudge, a stroke (petted). |
| stomp | Stomps around a small circle, fists up, the ground shaking. | An achievement, dance. |
| stretch | Up from the log, arms overhead, a huge yawn, a shake out. | Waking. |
| chomp | A message flies in; the ogre grabs it and eats it in three bites, crumbs flying, then pats its belly. | A reply lands. |
| drag | Dangling: arms up, the boots kicking slowly. | Dragged. |

The rig blends a move in over 0.15 s and out over 0.22 s; a change of
stance lands with a squash. The desktop runs it at most 60 frames a second
and not while hidden; each step and stomp jolts the drawing by a pixel or
two. Under reduced motion nothing moves: a move only shows its face.

The Moves menu names Ogre's moves (Belly laugh, Roar, Flex, Stomp, Chomp,
Ear wiggle, Head scratch, Stretch, Wave, Hop) and plays them through the
shared clips.

### Checking the animation

`ogreFrameSvg(ogreMoveFrame(move, t), { size })` draws any frame as an SVG
string; render six frames of a move to PNG with headless Chrome to look at
it. The keyframes of the heavy walk and the belly laugh were checked that
way while tuning.

## Frog

The smug sad frog, approved by the maintainer on 2026-10-09 in direction C ("aplat net":
two flat tones plus a shade crescent, one uniform outline, never under 1.6 px
on screen). An original drawing: the head's outline carries the two eye
domes, heavy lids and wide flat lips carry every face, the shoulders hunch up
along the cheeks. Full drawings keep palmate hind legs (fat thighs, shorter
shins, webbed feet as one silhouette) in a sitting squat that kicks out on a
hop. No meme pose, no text, no clothing.

| Piece | Where |
|---|---|
| Art (paths, paint roles, sixteen faces, bust crop under 48 px) | `src/components/frog-art.ts` |
| Component (CSS idle, rig, skins, effects) | `src/components/FrogMascot.tsx`, `frog-mascot.css` |
| Moves (keyframe tracks, rig, desktop mapping) | `src/components/frog-moves.ts` |
| Skins | `src/components/skin-fx/frog-skins.tsx`, `shared/mascot-look.ts` (`FROG_SKINS`, `FROG_SKIN_TIER`, `LEGACY_FROG_SKINS`) |
| Phone | `ios/Sources/CompanionCore/FrogStillArt.swift` (generated by `src/components/ios-mascot-export.test.ts`), `FrogArt.swift` (palettes, fixture-checked), `ios/App/Mascots/FrogMascotView.swift` |

**Faces.** The sixteen Shapes ids (`neutral` ... `sleepy`). The brow layer
exists and stays empty: a frog has no brows, the lids do that work. The
approved moods: idle is the half-lidded side glance (lids sloping down
outward), thinking is two different lids with the gaze up and away, alert the
wide round eyes and the small round mouth, happy the arches and the smile,
sleepy the closed curves and the z.

**Color.** The skin is the frog green `#74AE48` taking 24 % of the bot's
color (`tintTone`: hue and lightness move, saturation never drops under the
green's), darkened just enough for a light color to keep the pale belly
readable (`SKIN_MIN_CONTRAST`). The lips stay brick red.

**Skins.** Plain (the bot's tint) comes with the character. The real frogs
are Rare, each on a Mastery rung (`shared/mascot-unlocks.ts`, docs/achievements.md):
Leaf and Tree frog (red eyes, orange toes, a blue flank) on `thrifty`, Poison
dart (cobalt, black spots) and Bullfrog (brown, mottled, a yellow throat) on
`translator`, Ghost (the see-through glass frog) on `skill-smith`. Retro 98
and Gold come with `total-recall`; Neon, Chrome, Glitch (Epic), Holographic
and Molten (Legendary) with the cross-character achievements, with the
Shapes, Trombi and Shiba treatments. `polyglot` unlocks Frog itself.

**Moves.** The fourteen every character plays (idle, blink, look, nod, shake,
bounce, wave, think, celebrate, sleep, alert, talk, listen, work), then the
frog's own: walk (a hop each cycle), hop (a real jump arc in ten keys:
crouch, push with the legs out, rise, apex, fall, touch down, landing squash,
overshoot, settle), long jump, puff (the throat sac), tongue (catches a fly,
the gulp shuts both eyes), blinkOne (one lid at a time), smug nod, sink (the
pond hides the lower third), lily nap, leg stretch, croak (the sac past full
and a shake), shiver, side-eye, drag (legs dangling). Shakes stay at 4 Hz or
less.

**Desktop.** `frogHeldFor` keeps an activity going: hopping along while the
window walks, a run of long jumps while it flies (the idle long jump to a
random spot every few minutes), the lily nap while asleep, dangling while
dragged, sunk while its bot waits for an approval, the throat puff while it
works, talking while the reply streams. `frogCueFor` plays a one-shot on a
change: side-eye on an approval request, shiver on a refusal or an error,
smug nod when a task succeeds, leg stretch after a nap. A nudge croaks, a new
message flicks the tongue. The rig runs at the display's rate up to 60 fps,
pauses off screen, and under reduced motion only shows a move's face (and the
pond or the pad, still).

**Checks.** `src/components/frog.test.ts` (art, faces, color, skins, look),
`src/components/frog-moves.test.ts` (moves table, the hop arc, the throat,
the tongue, one lid at a time, the pond, the pad, the rig's layering, the
desktop mapping), `MascotLookFixtureTests` on the phone (palettes and faces).

## Crab

The pixel-rect crab: only axis-aligned rectangles, one coral fill
(`#DD775B`) and two black square eyes, two stub arms and four legs. The idle
sprite is a 15-cell grid mapped into the 0..100 drawing box
(`shape-rendering="crispEdges"`). It is a free default character with the
owl (`DEFAULT_CHARACTERS`), not a Mastery character. Do not brand it Claude
or Clawd in product strings.

| Piece | Where |
|---|---|
| Art (rects, pivots, bust crop under 48 px) | `src/components/crab-art.ts` |
| Component (CSS idle, rig) | `src/components/CrabMascot.tsx`, `crab-mascot.css` |
| Moves (keyframe tracks, rig, desktop mapping) | `src/components/crab-moves.ts` |
| Skins | `src/components/skin-fx/crab-skins.tsx`, `shared/mascot-look.ts` (`CRAB_SKINS`, `CRAB_SKIN_TIER`, `LEGACY_CRAB_SKINS`) |
| Phone | `ios/Sources/CompanionCore/CrabArt.swift`, `ios/App/Mascots/CrabMascotView.swift` |

**Color.** Plain takes 45 % of the bot colour into the coral (`crabFill` /
`mixColor`). Named skins keep their own fill: Coral, Sand, Ink (cream eyes),
Mint. All five skins are common.

**Moves.** Idle bob, blink, look, wave (right arm), walk (a looping scuttle
on opposite leg pairs), scuttle (three walk cycles side to side, the Moves
menu), hop (crouch, lift, landing squash, min sy under 0.94), celebrate,
sleep, talk, listen, work, alert, drag. No GSAP: CSS idle on avatars, the JS
rig on the desktop mascot.

**Asleep.** The face `asleep` draws the eyes closed: a 4x1 dash on the eye's
lower row (`crabEyeDraw`), wider than the eye so it never reads as the happy
squint or the sleepy lid, and never squashed by a blink. The sleep move
breathes slowly (4.2 s): the whole sprite rises one cell on the inhale and
settles back, rigid like every crab move. The app's avatars do the same in
CSS (`crab-mood-sleeping`, `crab-breathe`). Under reduced motion the eyes
stay closed and nothing moves.

**Desktop.** `crabHeldFor` keeps an activity going: scuttling while the
window walks, hopping while it flies, sleeping, dangling while dragged,
working, talking while the reply streams, listening while its bot waits.
Cues: a wave on a nudge, a hop for an achievement, a look when a message
lands, sleep before a snooze. The Moves menu: Wave, Hop, Look, Scuttle /
Trotter, Celebrate.

**Checks.** `src/components/crab.test.ts` (art, skins, look, drawing),
`src/components/crab-moves.test.ts` (moves table, hop squash, scuttle,
wave, the rig, the desktop mapping), `MascotLookFixtureTests` on the phone
(palettes).

## Shapes

The clay Shape character (`character: "shape"`): one soft body with two pill
eyes, thirteen skins, fourteen moves, volume extrusion (`shape-volume.ts`) and
pointer gaze (`shape-engine.ts`). Geometry lives in
`shared/mascot-geometry.json` (64 radii per body). Portable avatar definitions
(`shared/shape-avatar-def.ts`, schema v1) add object silhouettes (pad, cup,
bulb, say, sprout, tin, tome, ship), import/export/share JSON, and
`generate_shape_avatar` for chat. Colour stays on the bot. Custom definitions
store on `mascotLook.avatarDef`. Bodies never render disassembled
(`shape-set.regression.test.ts`, `scripts/capture-shapes.mjs`).

### Files

| What | Where |
|---|---|
| Geometry (radii, faces, skins) | `shared/mascot-geometry.json` |
| Portable definition schema | `shared/shape-avatar-def.ts` |
| Object presets | `shared/shape-avatar-presets.ts` |
| Generate from a description | `shared/shape-avatar-generate.ts`, `server/shape-avatar.ts` |
| Engine, volume, motion, moves | `src/components/shape-*.ts`, `ShapeMascot.tsx` |
| Editor import/export/generate | `src/components/floating-bots/ShapeAvatarPanel.tsx` |
| Phone | `ios/Sources/CompanionCore/ShapeEngine*.swift`, `ShapeMascotView.swift` |
| Screenshots | `docs/screenshots/shapes`, `docs/screenshots/shape-engine-v2` |

## HD mascots (painted art, pilot: Shiba)

A character may ship painted art beside its vector drawing. Only the Shiba
does for now; every other character, the Trombi and the Shapes included, is
unchanged. Settings > Appearance > Mascots > "HD mascots" ("Mascottes HD",
"Mascotes HD"; key `sagax.hdMascots.v1`, `on` or `off`, absent is on) turns
the art on or off for the person, everywhere, live, and travels with their
preferences on an organization server. The row shows only while a character
has HD art (`HD_CHARACTERS`). A bot can set it with `sagax_settings`
(`appearance.hdMascots`).

**Files.** `src/components/hd-mascots/manifest.ts` (manifest type, state
mapping, asset choice), `shiba-hd.ts` (the Shiba's manifest),
`HdMascot.tsx` (`HdMascot`, `HdOrVector`), `src/lib/hd-mascots-preference.ts`,
assets in `src/assets/mascots/shiba/` built by
`scripts/mascots/build-hd-mascot.py` from the art pack (stills from its
transparent PNGs; loops from its opaque MP4 clips, each frame matted with
rembg so the dog sits on any surface, soft at the fur; 256 px squares, one
framing and feet line for every asset). Loops are animated WebP with alpha
(WebM with alpha is not decoded by Safari, and an `<img>` needs no player);
the walk is cut to one repeating stride, the sad clip plays once and rests
lying down. About 4.3 MB in all.

**Where it draws.** `BotAvatar` (every bot avatar of the app) and the
desktop mascot (`ShibaRender`, `ShibaThumb`) wrap the vector Shiba in
`HdOrVector`. Skins and the bot color do not tint painted art: they apply to
the classic look. The skin pickers keep the vector look.

**Mapping.** An app state (`MausState`) or a desktop clip and pose becomes
a loop or a still (`HD_STATE_MAP`, `hdKeyForActivity`):

| App state | HD art |
|---|---|
| idle, spawning | idle loop |
| walking (desktop walk, fly, return, scuttle) | walk loop |
| celebrate, bouncing; desktop jump, hop, dance | jump loop |
| desktop turn, spin, backflip | turnaround loop |
| happy, excited; desktop wag | happy loop |
| sad | sad clip (plays once) |
| thinking, working, writing, loading, uploading, curious, progress, orbit | thinking still |
| sleeping, waking, drowsy, bored, powering-down | sleepy still |
| surprised, scared, notifying, alerting, dragging | surprised still |
| angry | angry still |
| confused | confused still |
| laughing | laughing still |
| shy | love still |
| playful | wave still |
| proud | front view |
| suspicious | sitting pose |
| searching, radar | three-quarter view |
| listening, humming, dictating, sending, receiving | neutral still |

The thinking and writing indicators of the avatar and the desktop mascot
are drawn around the mascot and stay as they are. A still breathes a little
while motion is allowed.

**Motion and size.** A loop plays only when the avatar is animated, its box
is 48 px or more and neither the system nor Settings > Accessibility asks
for reduced motion; otherwise the loop's still shows (`loopStill`). Under
48 px the still is cropped to head and shoulders, as the vector bust.

**Loading.** Nothing downloads until a mascot draws it (`loading="lazy"`).
The vector Shiba fills the same box until the first asset decodes, so there
is no blank and no layout shift; the next asset of a change of state loads
hidden behind the shown one and swaps in once decoded. A loop that fails
falls back on its still, a still that fails on the vector drawing, for good.

**Phones.** iOS and Android keep the vector Shiba; the art and the switch
are desktop and web only in this pilot.

**Checks.** `src/components/hd-mascots/hd-mascots.test.ts` (manifest,
mapping, asset choice, fallback, switch on and off),
`src/components/settings/HdMascotsGroup.test.ts`. Screenshots:
`node scripts/capture-hd-mascots.mjs --out <dir>` (gallery
`src/gallery/hd-mascots.html`).
