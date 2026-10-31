# Partial skill-discovery receipt

Synthetic `capabilityFixture` data, French, captured with headless installed
Chrome through the real Capabilities gallery. No live user data.

| Viewport / theme | Before | After |
| --- | --- | --- |
| 700 x 850 / Pulsatrix | [before](capabilities-before-desktop.png) | [after](capabilities-after-desktop.png) |
| 390 x 844 / Daylight | [before](capabilities-before-mobile.png) | [after](capabilities-after-mobile.png) |

Both renderers receive the same partial-only `promptIndex` fixture:
`incomplete: true`, `omitted: 0`. Before uses the actual Capabilities renderer
and helper source from `8035bbf55`, with import paths remapped to the gallery.
That renderer ignores the new partial flag and shows no diagnostic. After
uses the current renderer and displays the partial-scan notice. Styles are
unchanged. Browser assertions check the notice and horizontal overflow.

Reopen the after state with `pnpm exec vite --config vite.gallery.config.ts`
and `/src/gallery/bot-capabilities.html?partial=1&lang=fr&skin=pulsatrix`.
Use `skin=daylight` for the light capture. These are renderer fixture
captures, not Grok Bot comparison screenshots or a physical iPhone test.
