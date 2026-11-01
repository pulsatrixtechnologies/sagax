# Grok convergence UI captures

Synthetic gallery captures with headless installed Chrome. No live user data.
Not a measured Grok Bot visual parity qualification.

## Lot 1: partial skill-discovery receipt

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
Use `skin=daylight` for the light capture.

## Lot 5: Pages and chat, real ChatView

All in [`real-chatview/`](real-chatview/). The gallery
`src/gallery/page-chat-real.html` mounts the real `ChatView` (real
`Composer`, `PageSurface`, page cards, reducer) on synthetic data; the
script `scripts/capture-page-chat-real.mjs` drives it like a person (scroll
the transcript, open the v1 card from the keyboard, Show conversation, send,
Escape / Back to chat) and records the DOM facts in `before-capture.json`
and `after-capture.json`. Before = the same gallery served from a checkout of
the lot's base `81e0dd358`; after = this branch.

| Viewport / theme | Before | After |
| --- | --- | --- |
| 1338 x 809 / Pulsatrix, chat | [before](real-chatview/before-desktop-dark-chat.png) | [after](real-chatview/after-desktop-dark-chat.png) |
| 1338 x 809 / Pulsatrix, page (stage) | [before](real-chatview/before-desktop-dark-stage.png) | [after](real-chatview/after-desktop-dark-stage.png) |
| 1338 x 809 / Pulsatrix, back to chat | [before](real-chatview/before-desktop-dark-stage-closed.png) | [after](real-chatview/after-desktop-dark-stage-closed.png) |
| 1338 x 809 / Daylight, page | [before](real-chatview/before-desktop-light-stage.png) | [after](real-chatview/after-desktop-light-stage.png) |
| 1338 x 809 / Pulsatrix, Show conversation | [before](real-chatview/before-desktop-dark-beside.png) (not offered) | [after](real-chatview/after-desktop-dark-beside.png) |
| 1338 x 809 / Pulsatrix, French | [before](real-chatview/before-desktop-dark-stage-fr.png) | [after](real-chatview/after-desktop-dark-stage-fr.png) |
| 700 x 809 / Pulsatrix, page and back | [before](real-chatview/before-w700-dark-stage.png) | [after](real-chatview/after-w700-dark-stage.png), [closed](real-chatview/after-w700-dark-stage-closed.png) |
| 390 x 844 / Daylight, page and back | [before](real-chatview/before-w390-light-stage.png) | [after](real-chatview/after-w390-light-stage.png), [closed](real-chatview/after-w390-light-stage-closed.png) |
| 390 x 844 / Pulsatrix, page | [before](real-chatview/before-w390-dark-stage.png) | [after](real-chatview/after-w390-dark-stage.png) |

What changed between the two, per the JSON: the composer docked on the page
is named "Message about <title>" (placeholder still "Message Scout"); the
close button says Back to chat; Escape in the empty docked composer goes
back (before: nothing, the composer had focus); focus returns to the card
that opened the page (before: lost to the body); the superseded v1 card
opens the latest page, so the send no longer pins version 1; Show
conversation exists on a wide host; at 390 px the title pill no longer runs
under « … » (Share keeps its icon). The stage look itself was already the
base's: the page over the mounted chat with the floating composer. The
transcript's scroll place is identical after a page closed without a send;
after a send the transcript follows the new message, as any send does.
Only the ChatView is mounted: the app's sidebar is not in these shots.
