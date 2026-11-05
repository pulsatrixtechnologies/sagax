// Pure helpers the floating bot view and its hooks share: owl pose, balloon
// side, menu rows, task while chatting, frame rate and emotes.
import type { OwlState } from "@/lib/owl/owl-art";
import type { MascotActivity } from "./behavior";
import { BALLOON_MAX_W, type BalloonSide } from "./Balloon";
import { CHAT_BALLOON } from "./window-frame";
import type { ChatPlacement } from "./placement";
import type { FloatingMenuItem, FloatingPose, FloatingSnapshot } from "./protocol";

/** The flat owl's state when the 3D one cannot be drawn: the mascot's activity first, then the brain's pose. */
export function owlStateFor(pose: FloatingPose, activity: MascotActivity): OwlState {
  if (activity === "sleep") return "sleepy";
  if (activity === "spin" || activity === "celebrate" || activity === "petted") return "success";
  if (activity === "sad") return "alert";
  if (activity === "working" || activity === "flyOut" || activity === "return") return "working";
  return owlStateForPose(pose);
}

export function owlStateForPose(pose: FloatingPose): OwlState {
  if (pose === "think") return "thinking";
  if (pose === "speak") return "working";
  if (pose === "celebrate") return "success";
  if (pose === "alert") return "alert";
  if (pose === "sleep") return "sleepy";
  return "idle";
}

/** The balloon's room from a placement: as big as that side of the display allows, and how far it may be dragged away. */
export function chatRoomFor(chat: ChatPlacement): { x: number; y: number; w: number; h: number } {
  return { x: Math.max(0, chat.room.w - CHAT_BALLOON.w), y: Math.max(0, chat.room.h - CHAT_BALLOON.h), w: chat.room.w, h: chat.room.h };
}

/** The drawn menu's rows: a submenu's items follow its title, indented. */
export function drawnMenuRows(items: readonly FloatingMenuItem[]): { item: FloatingMenuItem; depth: 0 | 1 }[] {
  return items.flatMap((item) => [{ item, depth: 0 as const }, ...(item.items ?? []).map((child) => ({ item: child, depth: 1 as const }))]);
}

/**
 * Which way the balloon opens and how much room it has: on the desktop from
 * where the window stands on its screen, in the app from the overlay's own
 * placement.
 */
export function balloonSide(where: "desktop" | "overlay", below: boolean, stageHeight: number): { side: BalloonSide; room: { x: number; y: number; w: number; h: number } } {
  if (typeof window === "undefined") return { side: { below, right: false }, room: { x: 0, y: 0, w: BALLOON_MAX_W, h: 420 } };
  const screenH = window.screen?.availHeight ?? window.innerHeight;
  const top = (window.screen as Screen & { availTop?: number })?.availTop ?? 0;
  const left = (window.screen as Screen & { availLeft?: number })?.availLeft ?? 0;
  const maxH = Math.round(screenH * 0.6);
  if (where === "overlay") return { side: { below, right: false }, room: { x: 0, y: 0, w: Math.min(BALLOON_MAX_W, window.innerWidth - 16), h: Math.min(maxH, window.innerHeight - stageHeight - 24) } };
  // The desktop balloon always opens above and to the left, into the room the
  // window already holds. Flipping it below or to the right moves the window's
  // origin, and the character jumps for a frame. A short screen just scrolls.
  const spaceAbove = window.screenY + window.innerHeight - stageHeight - top;
  const spaceLeft = window.screenX + window.innerWidth - left;
  return {
    side: { below: false, right: false },
    room: {
      x: Math.max(0, spaceLeft - 300),
      y: Math.max(0, spaceAbove - 220),
      w: Math.max(280, spaceLeft - 16),
      h: Math.max(160, Math.min(maxH, spaceAbove - 24)),
    },
  };
}

/**
 * The bot's work as the mascot takes it: while its balloon is open (the
 * person is chatting, the reply streams in it) it stays home rather than fly
 * off to the screen's edge, which would hide the balloon mid-reply; it flies
 * off once the balloon closes if the work goes on.
 */
export function mascotTaskFor(task: FloatingSnapshot["task"], chatOpen: boolean): FloatingSnapshot["task"] {
  return chatOpen && task === "working" ? "idle" : task;
}

/** The mascot's frame rate while its balloon is open: at most 30 fps (it keeps its life, at half the repaints). */
export function chatFrameRate(fps: number, chatting: boolean): number {
  return chatting ? Math.min(fps, 30) : fps;
}

/** A small sign over the owl for some clips: a question mark, a hoot, a surprise, a temper, confetti. */
export function emoteFor(activity: MascotActivity): "question" | "hoot" | "bang" | "anger" | "confetti" | "thought" | null {
  if (activity === "confused") return "question";
  if (activity === "hoot") return "hoot";
  if (activity === "surprised" || activity === "startled") return "bang";
  if (activity === "angry") return "anger";
  if (activity === "celebrate") return "confetti";
  if (activity === "think") return "thought";
  return null;
}
