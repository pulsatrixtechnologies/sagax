// The fades at a chat's edges (JC 2026-11-06, Grok Bot reference): the
// transcript scrolls under the header pill and under the composer, and a
// message left sharp there reads as a collision. Each edge carries the chat's
// own ground (--color-app, every skin, light and dark) and fades it out over
// the transcript, so a message dissolves before it reaches the pill or the
// composer. Never takes a click: the transcript under it stays usable.
//
// top: a child of the chat header (positioned, stacked over the transcript).
//   The band itself is the chat's ground, so a button that has scrolled
//   under the header is hidden, not left looking clickable (#5137). Only
//   the short reach past the header fades out.
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
              background: `linear-gradient(to bottom, var(--color-app) calc(100% - ${CHAT_EDGE_FADE_PX.top}px), transparent)`,
            }
          : {
              height: `calc(100% + ${CHAT_EDGE_FADE_PX.bottom}px)`,
              background: `linear-gradient(to top, var(--color-app) calc(100% - ${CHAT_EDGE_FADE_PX.bottom}px), transparent)`,
            }
      }
    />
  );
}
