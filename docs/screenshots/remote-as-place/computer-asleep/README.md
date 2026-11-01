# Calm Computer asleep / waking / running (2026-11-01)

Follow-up: every Computer place (Cloud, person's Mac, Browser, enrolled host)
uses the Grok Bot calm style when off or waking. Place rename lives in the
dropdown.

## Before (ours)

  ("Your server environment is off. It starts by itself…"), play/pause/stop
  transport bar always visible (`.ref/` 11.36.54).

## Grok Bot references


## After (headless gallery)

`src/gallery/remote-as-place.html?view=calm|rename`, captured with
`node scripts/capture-remote-as-place.mjs`.

- [after-asleep.png](after-asleep.png): bot mascot sleep pose (closed eyes),
  z Z glyphs, one line "Cloud is asleep", no badge, no transport bar.
- [after-waking.png](after-waking.png): awake mascot, "Waking up…", no z.
- [after-running-open.png](after-running-open.png): live frame edge to edge,
  centered "Open" pill, "Melonie's screen" caption, no badge overlay.
- [after-place-rename.png](after-place-rename.png): inline rename in the place
  dropdown ("MacBook de JC"; technical name as placeholder / tooltip).

Looked at by the implementing agent on 2026-11-01.
