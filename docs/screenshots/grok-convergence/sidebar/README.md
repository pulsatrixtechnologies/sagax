# Sidebar by window width (2026-11-01)

JC's decision: the sidebar switches to its icons rail automatically at medium
widths, like Grok Bot's macOS window (700 x 809: icons; 1338 x 809: full).

| Width | Layout | Density drawn |
| --- | --- | --- |
| below 640 px (Tailwind `sm`) | drawer over the chat (menu button, scrim, Escape) | the person's own |
| 640 to 767 px | icons rail in the flow, automatic | always icons; the saved density is not written |
| 768 px and up (Tailwind `md`) | the person's own sidebar | full, compact or a rail they chose |

Real `AppSidebar`, `Sidebar` and `ChatView` (gallery
`src/gallery/app-shell-sidebar.html`), synthetic data, headless Chrome at
device scale 2. Produced by:

```
SAGAX_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node scripts/capture-sidebar-rail.mjs
```

| File | What it shows |
| --- | --- |
| `w1338-{dark,light}-full.png` | 1338 x 809, the person's full sidebar; foot = avatar, name, round apps grid |
| `w1338-{dark,light}-saved-rail.png` | 1338 x 809, a rail the person chose (its edge and "full sidebar" toggle kept) |
| `w700-{dark,light}-auto-rail.png` | 700 x 809, the automatic rail; foot = round apps grid, avatar |
| `w700-{dark,light}-auto-rail-widened-1338.png` | the same page widened to 1338: the saved full sidebar is back |
| `w700-dark-auto-rail-fr.png` | the automatic rail in French |
| `w390-{dark,light}-drawer-closed.png` | 390 x 844, drawer closed, menu button in the corner |
| `w390-{dark,light}-drawer-open.png` | 390 x 844, drawer open over the scrim, the person's density |

`capture.json` records what the DOM said for each shot: `data-sidebar-layout`
(`drawer`, `auto-rail`, `own`), the drawn and saved densities, the aside's
box, the rail items' centring (`railOffCentre`, empty in every shot), the
account and apps buttons with their accessible names, horizontal overflow
(none), GUID-like text (none) and page errors (none). Not a native Electron
or iOS capture.
