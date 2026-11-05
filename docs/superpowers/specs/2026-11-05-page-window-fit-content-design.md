# Page window fit-to-content (#2051)

## Intent

When a published page opens in its own desktop window, the window sizes itself to the page content so empty space below a small page goes away.

## Goals

- Automatic fit on open for page windows (`page:<pageId>`).
- Measure after fonts and images settle; keep observing with ResizeObserver / the existing page size postMessage until the person resizes by hand.
- Clamp to a sensible minimum and to the current display work area.
- Remember a hand-chosen size per page id and stop auto-fitting that page.
- No visual jump: fit before show (timeout fallback), or one resize before the window appears.

## Non-goals

- Always-on-top (#2046).
- Hiding the header until hover.
- Fitting ordinary artifact windows (only page windows).
- Changing in-app page layout over a conversation.

## Approaches

1. **Page-only preload + fit IPC (chosen).** Mirror floating-bot / retro-assistant: a narrow preload on page windows calls `artifact-window:fit-content`. Main clamps, applies `setBounds`, delays show until the first fit. Places store gains `personSized`.
2. **Main-only guess.** Open at a fixed compact size with no content measure. Rejected: does not match content.
3. **Route fit through the main window bridge.** Rejected: the artifact window has no `window.ogb` today; a self-preload is the existing pattern for windows that size themselves.

## Builder calls

- Continuous refit while `personSized` is false (ResizeObserver + `sagax-page-size`).
- Default first width for an unsized page window: 720 CSS px; height from content.
- Show delay timeout: 2 s if no measure arrives.
- Auto-fit updates bounds in the store with `personSized: false`; a person `resize` sets `personSized: true`.
