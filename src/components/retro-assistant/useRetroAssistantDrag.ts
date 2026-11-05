import { useCallback, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import { clampPosition, type RetroPrefs, type RetroTip } from "./logic";
import type { createRetroSounds } from "./sounds";
import type { Balloon } from "./retro-assistant-shared";

type Sounds = ReturnType<typeof createRetroSounds>;

/** Pointer drag of the character, click-to-talk, and the context menu. */
export function useRetroAssistantDrag(args: {
  position: { right: number; bottom: number };
  size: number;
  balloon: Balloon | null;
  bulb: RetroTip | null;
  sounds: Sounds;
  setBalloon: Dispatch<SetStateAction<Balloon | null>>;
  setMenu: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setPrefs: (update: (current: RetroPrefs) => RetroPrefs) => void;
  openTip: (tip: RetroTip | null) => void;
  openBalloon: (next: Balloon, sound?: "pop" | null) => void;
}) {
  const { position, size, balloon, bulb, sounds, setBalloon, setMenu, setPrefs, openTip, openBalloon } = args;
  const drag = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean; id: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ right: number; bottom: number } | null>(null);

  const clickCharacter = useCallback(() => {
    sounds.play("click");
    if (balloon) setBalloon(null);
    else if (bulb) openTip(bulb);
    else openBalloon({ kind: "welcome" });
  }, [balloon, bulb, openBalloon, openTip, setBalloon, sounds]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, right: position.right, bottom: position.bottom, moved: false, id: event.pointerId };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 5) return;
    start.moved = true;
    setDragPos(clampPosition({ right: start.right - dx, bottom: start.bottom - dy }, { width: window.innerWidth, height: window.innerHeight }, size));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start || start.id !== event.pointerId) return;
    if (start.moved && dragPos) {
      const spot = dragPos;
      setPrefs((current) => ({ ...current, position: spot }));
      setDragPos(null);
      return;
    }
    setDragPos(null);
    clickCharacter();
  };
  const onPointerCancel = () => { drag.current = null; setDragPos(null); };
  const onContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    sounds.play("click");
    setBalloon(null);
    setMenu({ x: event.clientX, y: event.clientY });
  };
  const onCharacterKey = (event: ReactKeyboardEvent) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ x: rect.left, y: rect.top });
    }
  };

  return {
    dragPos,
    clickCharacter,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onContextMenu,
    onCharacterKey,
  };
}
