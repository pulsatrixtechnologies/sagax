// Shared types for FloatingBotView and its stage / life hooks.
import type { Ref } from "react";
import type { BalloonSide } from "./Balloon";
import type { LevelSource } from "./MascotCall";
import type { FloatingPilot } from "./pilot";
import type { ChatPlacement, EffectSide, PillSide } from "./placement";
import type { FloatingEvent, FloatingSnapshot } from "./protocol";
import type { Size } from "./window-frame";

export interface FloatingMover {
  /** "screen" in a desktop window that moves under the pointer; "client" in the app. */
  coords: "screen" | "client";
  moveBy(dx: number, dy: number): void;
  moved(): void;
}

export interface FloatingBotViewProps {
  snapshot: FloatingSnapshot;
  onEvent: (event: FloatingEvent) => void;
  mover: FloatingMover;
  /** Desktop: let clicks reach the art and balloon, pass through elsewhere. */
  interactive?: (on: boolean) => void;
  /** Desktop: the window may take the keyboard while the input is used. */
  wantsKeyboard?: (on: boolean) => void;
  rootRef?: Ref<HTMLDivElement>;
  className?: string;
  style?: React.CSSProperties;
  /** The overlay's balloon folds under the bot when it stands near the top. */
  below?: boolean;
  /** Desktop: lets the mascot move its own window (fly off, come back, wander). */
  pilot?: FloatingPilot | null;
  /** Desktop: which way the balloon opened, so the window keeps the mascot's corner in place. */
  onSide?: (side: BalloonSide) => void;
  /** Desktop: the room the open balloon may take, so the window is sized once rather than per frame. */
  onReserve?: (reserve: Size | null, exact: boolean) => void;
  /** The voice call's levels as they come (its waveform, the mascot's bounce). */
  onLevels?: LevelSource;
  /** Desktop: the menu opens natively at this point of the page (the pointer); the drawn menu otherwise. */
  menuAt?: (x: number, y: number) => void;
  /** Desktop: a move picked in the native menu's "Moves" (the drawn menu plays its own). */
  onMove?: (listener: (clip: string) => void) => () => void;
  /**
   * Desktop: where the chat goes, from where the character stands on its
   * display (placement.ts). The window holds the chat's room on that side.
   */
  layout?: MascotLayout | null;
}

/** The desktop mascot's layout around its character: the chat's side and room. */
export interface MascotLayout {
  side: BalloonSide;
  chat: ChatPlacement | null;
  /** Where the effects go: beside the character, never over it. */
  fx?: EffectSide;
  /** Where the input pill goes: under the feet, or over the head when the work area's bottom (the Dock, the taskbar) is too near. */
  pill?: PillSide;
}
