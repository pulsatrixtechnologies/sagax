# iOS: Grok Bot visual parity (2026-11-01)

Sagax iOS demo mode (synthetic data), iPhone 17 Pro simulator, iOS 27.0,
created for the run and deleted after it. Launched with
`-demo -demo-clock 1793800000 -demo-skip-terms` (the last flag is DEBUG only),
English and French. Only Sagax captures are committed here. The Grok Bot
references stay private and untracked in the worktree's `.ref/` folder; each
row below names the reference it was compared with.

| Screen | Before | After (en) | After (fr) | Grok Bot reference (private) |
| --- | --- | --- | --- | --- |
| Home | `before-home.png` | `after-home.png` | `after-fr-home.png` | `.ref/ios/001 home.png` |
| Chat | `before-chat.png` | `after-chat.png` | `after-fr-chat.png` | `.ref/macos/grok-macos-authenticated.png` (no iOS chat capture) |
| Composer + menu | `before-composer-menu.png` | `after-composer-menu.png` | `after-fr-composer-menu.png` | `.ref/macos/grok-macos-composer-menu.png` |
| Bot panel, Details | `before-panel.png` | `after-panel.png` | `after-fr-panel.png` | `.ref/macos/grok-macos-authenticated.png` |
| Bot panel, Library and Computer | none | `after-panel-library.png`, `after-panel-computer-asleep.png`, `after-panel-computer-waking.png` | same with `after-fr-` | `.ref/macos/grok-macos-library.png`, `.ref/macos/grok-macos-computer.png` |
| Settings (account sheet) | `before-settings.png` | `after-settings.png` | `after-fr-settings.png` | `.ref/ios/002 home__Account.png` |
| Settings > Bots | none | `after-settings-bots.png` | `after-fr-settings-bots.png` | `.ref/ios/007 home__Account__Permissions…png` |

`compare-*.png` puts before, after and after in French side by side.

## What changed

- **Home**: the photo at the top left, **+** at the top right; the bottom row
  is the apps button (Grok Bot's grid with a +) and a Search pill, 28 pt from
  the screen edges. Rows and the primary bot read "Name · Role" in place of the
  role chip. The photo opens Settings; touch and hold, or the apps button, opens
  the account menu (Team map, Automations, Achievements, Release notes, About,
  Help), with Updates, Connect apps and Templates. "Search at top" and the
  Updates pill still work.
- **Chat**: Black (the default skin, the Grok look) draws your bubble in a neutral
  grey a step above the bot's, never the accent or the bot's colour. Other skins
  keep the accent and bot-colour rule. The **+** sits inside the composer capsule
  with the field, dictation and voice.
- **Composer + menu**: a compact popover over the +, one line per action,
  attachments set apart. Each action's explanation is its VoiceOver hint.
- **Bot panel**: Details, Library and Computer pill tabs under the name. Details
  lists routines with their switches ("N on" opens the full list with folders,
  sort and run logs). Computer shows the mascot asleep ("z Z"), then "Waking
  up…", then only the live screen.
- **Settings**: shown as a sheet with rounded top corners over a dimmed strip.
  Cards have a hairline edge and sub-page titles are centred. The root shows
  the X alone, with search behind a round button. The Vault sits with the
  profile, then Connect apps (plugins, tools and skills), then a Bot card. No
  row was removed (`SettingsTreeTests`).
- **Routine run**: opens as a bot-to-bot exchange, "Routine ⇄ Bot", showing
  the instruction and then the bot's result. Steps and configuration follow
  below.
- **Object shape mascots**: the still SVG export and the iOS evidence stills
  (`../shape-engine-v2/ios-object-*.png`) draw the engine's pill eyes, like the
  desktop, instead of round touching dots (`ShapeObjectPillEyesTests`).

## Still different, and why

- Settings sheet colours: Grok Bot's sheet is `#1E1E1E` with `#2C2C2E` cards.
  Sagax keeps Black's measured `#141414` and `#202020`, because the theme is
  global and other pages share these cards. The contrast between the two is
  about the same.
- The "needs you" island, the demo banner, mascots and themes are Sagax's own
  and stay.
- Grok Bot iOS chat, composer and bot panel were not captured on the phone, so
  they follow the macOS references.
