# Virtual cursor on secondary monitors (#1915)

## Problem

Cua Driver's macOS agent-cursor overlay still covers only `NSScreen.mainScreen`
(trycua/cua#5336). When the agent point is on another display, the native cursor
is invisible there.

## Fix in Sagax

On darwin with more than one display, Electron paints a small click-through
overlay on the display that contains `get_cursor_position`, while the primary
display keeps Cua's native overlay.

- Placement: `electron/agent-cursor-displays.mjs`
- Overlay host: `electron/agent-cursor-overlay.mjs`
- Wired from `electron/main.mjs` on Cua connection and display changes

Coordinates are global DIP (Electron `display.bounds`, including negative
origins). `scaleFactor` converts screenshot physical pixels on a display into
that DIP space; overlay `setBounds` stays in DIP so mixed-DPI layouts place
correctly.

## Proofs

Schematic before/after (headless; live multi-display OS overlay needs a real
macOS multi-monitor session with Cua connected):

- `docs/verification/evidence/cursor-secondary-monitors/before.svg`
- `docs/verification/evidence/cursor-secondary-monitors/after.svg`
- PNG renders of the same diagrams beside them

## Tests

```bash
node --test electron/agent-cursor-displays.node-test.mjs electron/agent-cursor-overlay.node-test.mjs
```

## Remains

Upstream trycua/cua#5336 is still open. When Cua ships a per-display overlay,
bump `@trycua/cua-driver` and drop or gate this Sagax helper. Until then, a
clipped ghost can still appear on the primary edge while the real point is on a
secondary to the right or below; the Sagax cursor on that secondary is the
visible follow mark.
