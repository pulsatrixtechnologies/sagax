// Browser and phone: the bot floats inside the app window, dragged with the pointer.
import { useEffect, useMemo, useRef, useState } from "react";
import { setFloatingBotPosition } from "@/lib/floating-bots";
import { clampOverlayPosition, defaultOverlayPosition } from "./brain";
import { FloatingBotView, MASCOT_SIZE, type FloatingMover } from "./FloatingBotView";
import type { FloatingCallLevels, FloatingEvent, FloatingSnapshot } from "./protocol";

const STAGE = { width: MASCOT_SIZE.width + 8, height: MASCOT_SIZE.height + 8 };

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function FloatingOverlay({ botId, index, saved, snapshot, onEvent, onLevels }: {
  botId: string;
  index: number;
  saved?: { right: number; bottom: number };
  snapshot: FloatingSnapshot;
  onEvent: (event: FloatingEvent) => void;
  onLevels: (listener: (levels: FloatingCallLevels) => void) => () => void;
}) {
  const [pos, setPos] = useState(() => clampOverlayPosition(saved ?? defaultOverlayPosition(index, STAGE), viewport(), STAGE));
  const [view, setView] = useState(viewport);
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    const onResize = () => {
      setView(viewport());
      setPos((current) => clampOverlayPosition(current, viewport(), STAGE));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const mover = useMemo<FloatingMover>(() => ({
    coords: "client",
    moveBy: (dx, dy) => setPos((current) => clampOverlayPosition({ right: current.right - dx, bottom: current.bottom - dy }, viewport(), STAGE)),
    moved: () => setFloatingBotPosition(botId, posRef.current),
  }), [botId]);

  // Near the top the balloon folds under the bot; near the left edge it opens to the right.
  const top = view.height - pos.bottom - STAGE.height;
  const left = view.width - pos.right - STAGE.width;
  const below = top < 300;
  const onLeft = left + STAGE.width / 2 < view.width / 2;
  const style: React.CSSProperties = {
    ...(below ? { top } : { bottom: pos.bottom }),
    ...(onLeft ? { left, alignItems: "flex-start" } : { right: pos.right }),
  };
  return (
    <FloatingBotView
      className={onLeft ? "fb-overlay fb-left" : "fb-overlay"}
      style={style}
      below={below}
      snapshot={snapshot}
      onEvent={onEvent}
      mover={mover}
      onLevels={onLevels}
    />
  );
}
