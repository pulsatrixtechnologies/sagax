// Bot avatar in the sidebar: shared pointer gaze and lean. A click to open
// the bot must not poke, wink or morph the drawing (M-20261127-080); the
// row or pinned tile keeps the click for navigation. Manual turn stays on
// the bot page and the mascot picker (#5389).
import { useEffect, useRef, type ReactNode } from "react";
import { botMascotLook, completeMascotLook } from "../../shared/mascot-look";
import { pointerGazeOffset } from "@/lib/owl/owl-art";
import { attachSidebarMascotRoot, registerSidebarMascot, refreshSidebarMascotReducedMotion } from "@/lib/sidebar-mascot/loop";
import { useReducedMotion } from "./skin-fx/skin-fx";
import { BotAvatar, type BotAvatarProps, type MausAvatarHandle } from "./Avatar";
import { AliveSeatAskContext, type AliveSeatAsk } from "./shape-alive";

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

export function SidebarMascotAvatar(props: BotAvatarProps & { botId: string; seat?: AliveSeatAsk }) {
  const { botId, seat, ...avatarProps } = props;
  const wrap = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const mascotRef = useRef<MausAvatarHandle>(null);
  const reduced = useReducedMotion();
  const look = completeMascotLook(botMascotLook(avatarProps.bot.mascotLook));
  // a shape joins no pointer loop of the sidebar's: it lives on the engine's own (#5404: its idle life and
  // the six states, as the large mascot, only while on screen)
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

  return (
    <span
      ref={wrap}
      className="inline-flex origin-center will-change-transform"
      data-sidebar-mascot=""
    >
      <span ref={box} className="inline-flex">
        {/* a pinned tile keeps its seat, the faces of a group's stack share one (shape-alive.ts) */}
        <AliveSeatAskContext.Provider value={seat ?? null}>
          <BotAvatar
            {...avatarProps}
            fillBox
            sidebarAlive={alive}
            shapeAlive
            mascotRef={mascotRef}
          />
        </AliveSeatAskContext.Provider>
      </span>
    </span>
  );
}
