// Bot avatar in the sidebar: shared pointer gaze, lean, and tap reactions.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { botMascotLook, completeMascotLook } from "../../shared/mascot-look";
import type { ShapeMove } from "./shape-engine";
import { pointerGazeOffset } from "@/lib/owl/owl-art";
import { pickSidebarReaction, type SidebarMascotReactionKind } from "@/lib/sidebar-mascot/interaction";
import { attachSidebarMascotRoot, registerSidebarMascot, refreshSidebarMascotReducedMotion } from "@/lib/sidebar-mascot/loop";
import { useReducedMotion, type FxMoveRequest } from "./skin-fx/skin-fx";
import { BotAvatar, type BotAvatarProps, type MausAvatarHandle } from "./Avatar";

/** The Shapes move a tap plays on a shape in a row (ShapeMascot plays it at any size, then rests on its still). */
const SHAPE_REACT: Readonly<Record<SidebarMascotReactionKind, ShapeMove>> = {
  wink: "wink",
  blink: "alert",
  hop: "burst",
  wiggle: "swirl",
  squish: "egg",
};

export function SidebarMascotProvider({ rootRef, children }: { rootRef: React.RefObject<HTMLElement | null>; children: ReactNode }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    refreshSidebarMascotReducedMotion();
    attachSidebarMascotRoot(rootRef.current);
    return () => attachSidebarMascotRoot(null);
  }, [rootRef]);
  useEffect(() => {
    attachSidebarMascotRoot(rootRef.current);
  }, [rootRef.current]);
  useEffect(() => {
    // both ways: turning reduced motion back off brings the gaze back without a reload
    refreshSidebarMascotReducedMotion();
  }, [reduced]);
  return children;
}

export function SidebarMascotAvatar(props: BotAvatarProps & { botId: string }) {
  const { botId, ...avatarProps } = props;
  const wrap = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const mascotRef = useRef<MausAvatarHandle>(null);
  const reduced = useReducedMotion();
  const look = completeMascotLook(botMascotLook(avatarProps.bot.mascotLook));
  // a shape in a row is the engine's still (#4145): it joins no pointer loop; a tap plays a move on it
  const [tapMove, setTapMove] = useState<FxMoveRequest | null>(null);
  const alive = !reduced && !avatarProps.animated && look.character !== "shape";

  useEffect(() => {
    if (!alive) return;
    return registerSidebarMascot({
      getBox: () => box.current?.getBoundingClientRect() ?? null,
      leanTarget: wrap.current,
      onRest: () => {},
      onGaze: (gaze) => {
        const rect = box.current?.getBoundingClientRect();
        if (!rect) return;
        const reach = Math.max(rect.width * 3, 240);
        const cx = rect.left + rect.width / 2 + gaze.x * reach;
        const cy = rect.top + rect.height / 2 + gaze.y * reach;
        const nearCenter = Math.abs(gaze.x) < 0.02 && Math.abs(gaze.y) < 0.02;
        mascotRef.current?.setPointerGaze(nearCenter ? null : pointerGazeOffset(rect, cx, cy));
      },
    });
  }, [alive, botId]);

  const react = () => {
    if (reduced) return;
    const kind = pickSidebarReaction(botId);
    if (look.character === "owl") {
      if (kind === "hop") mascotRef.current?.spin();
      else mascotRef.current?.blink();
      return;
    }
    if (look.character === "shape") {
      setTapMove({ clip: SHAPE_REACT[kind], key: Date.now() });
      return;
    }
    // Rigid squish on the wrapper for every other character.
    if (!wrap.current) return;
    wrap.current.animate(
      [
        { transform: "scale(1, 1)" },
        { transform: "scale(1.12, 0.86)", offset: 0.35 },
        { transform: "scale(0.94, 1.06)", offset: 0.65 },
        { transform: "scale(1, 1)" },
      ],
      { duration: 380, easing: "cubic-bezier(0.34, 1.2, 0.64, 1)" },
    );
  };

  return (
    <span
      ref={wrap}
      className="inline-flex origin-center will-change-transform"
      data-sidebar-mascot=""
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        react();
      }}
    >
      <span ref={box} className="inline-flex">
        <BotAvatar
          {...avatarProps}
          fillBox
          sidebarAlive={alive}
          mascotRef={mascotRef}
          characterMove={tapMove ?? avatarProps.characterMove}
        />
      </span>
    </span>
  );
}
