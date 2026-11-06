// The fades at a chat's edges (JC 2026-11-06, Grok Bot reference): the
// transcript scrolls under the header pill and under the composer, and a
// message left sharp there reads as a collision. Each edge carries the chat's
// own ground (--color-app, every skin, light and dark) and fades it out over
// the transcript, so a message dissolves before it reaches the pill or the
// composer. Never takes a click: the transcript under it stays usable.
//
// top: a child of the chat header (positioned, stacked over the transcript);
//   it hangs below the header's bottom edge.
// bottom: a child of the composer dock (positioned, stacked over the
//   transcript); it sits behind the dock's content and rises above it.
//   Its fade is short: it must fit the gap the transcript already keeps
//   above the dock, so the latest message, scrolled to the end, stays sharp.
export const CHAT_EDGE_FADE_PX = { top: 56, bottom: 16 } as const;

export function ChatEdgeFade({ edge }: { edge: "top" | "bottom" }) {
  const top = edge === "top";
  return (
    <div
      aria-hidden
      data-chat-edge-fade={edge}
      className={
        top
          ? "pointer-events-none absolute inset-x-0 top-full"
          : "pointer-events-none absolute inset-x-0 bottom-0 -z-10"
      }
      style={
        top
          ? { height: CHAT_EDGE_FADE_PX.top, background: "linear-gradient(to bottom, var(--color-app), transparent)" }
          : {
              height: `calc(100% + ${CHAT_EDGE_FADE_PX.bottom}px)`,
              background: `linear-gradient(to top, var(--color-app) calc(100% - ${CHAT_EDGE_FADE_PX.bottom}px), transparent)`,
            }
      }
    />
  );
}
