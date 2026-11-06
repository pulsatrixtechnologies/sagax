// The fades at a chat's edges (JC 2026-11-06, Grok Bot reference): the
// transcript scrolls under the header pill and under the composer, and a
// message left sharp there reads as a collision. Each edge carries the chat's
// own ground (--color-app, every skin, light and dark) and fades it out over
// the transcript, so a message dissolves before it reaches the pill or the
// composer. Never takes a click: the transcript under it stays usable.
//
// top: a child of the chat header (positioned, stacked over the transcript).
//   The header has no ground of its own (Grok Bot, JC 2026-11-06): the
//   transcript runs under the pill, still readable, and this light veil
//   behind the pill fades it from the panel's top edge down to a little past
//   the header's bottom edge. No opaque band.
// bottom: a child of the composer dock (positioned, stacked over the
//   transcript); it sits behind the dock's content and rises above it.
//   Its fade is short: it must fit the gap the transcript already keeps
//   above the dock, so the latest message, scrolled to the end, stays sharp.
export const CHAT_EDGE_FADE_PX = { top: 24, bottom: 16 } as const;

export function ChatEdgeFade({ edge }: { edge: "top" | "bottom" }) {
  const top = edge === "top";
  return (
    <div
      aria-hidden
      data-chat-edge-fade={edge}
      className={
        top
          ? "pointer-events-none absolute inset-x-0 top-0 -z-10"
          : "pointer-events-none absolute inset-x-0 bottom-0 -z-10"
      }
      style={
        top
          ? {
              height: `calc(100% + ${CHAT_EDGE_FADE_PX.top}px)`,
              background: "linear-gradient(to bottom, var(--color-app), color-mix(in srgb, var(--color-app) 55%, transparent) 50%, transparent)",
            }
          : {
              height: `calc(100% + ${CHAT_EDGE_FADE_PX.bottom}px)`,
              background: `linear-gradient(to top, var(--color-app) calc(100% - ${CHAT_EDGE_FADE_PX.bottom}px), transparent)`,
            }
      }
    />
  );
}
