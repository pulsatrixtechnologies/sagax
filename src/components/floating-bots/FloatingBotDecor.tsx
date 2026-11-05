// Small drawn pieces the floating bot stage wears: emotes, bursts, the away
// badge, and the memoized character (mascot body + optional medallion).
import { lazy, memo, Suspense, useMemo } from "react";
import type { MascotActivity, MascotTask } from "./behavior";
import { mascotMotion } from "./behavior";
import { completeMascotLook, type MascotLook } from "../../../shared/mascot-look";
import { mascotFor } from "./mascots";
import type { FloatingPose, FloatingSnapshot } from "./protocol";
import type { EffectSide } from "./placement";
import { MASCOT_STAGE, OWL_SIZE } from "./stage-size";
import { emoteFor } from "./view-helpers";

const RetroDecor = lazy(() => import("./RetroDecor"));

const STAGE = MASCOT_STAGE;

export function Emote({ activity, hoot }: { activity: MascotActivity; hoot?: string }) {
  const kind = emoteFor(activity);
  if (!kind) return null;
  if (kind === "confetti") {
    return (
      <span className="fb-confetti" aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => <span key={index} style={{ "--i": index } as React.CSSProperties} />)}
      </span>
    );
  }
  if (kind === "thought") return <span className="fb-thought" aria-hidden="true"><span /><span /><span /></span>;
  const text = kind === "question" ? "?" : kind === "bang" ? "!" : kind === "hoot" ? (hoot || "Hoot!") : "";
  return (
    <span className="fb-emote" data-kind={kind} aria-hidden="true">
      {kind === "anger" ? (
        <svg viewBox="0 0 20 20" width="18" height="18"><path d="M3 7 Q7 7 7 3 M13 3 Q13 7 17 7 M17 13 Q13 13 13 17 M7 17 Q7 13 3 13" fill="none" stroke="#e5484d" strokeWidth="2.4" strokeLinecap="round" /></svg>
      ) : text}
    </span>
  );
}

/** Hearts after a game or a stroke, sparkles after a finished task. */
export function Burst({ kind, reduced }: { kind: "hearts" | "sparkles"; reduced: boolean }) {
  const glyph = kind === "hearts" ? "\u2665" : "\u2726";
  const count = reduced ? 2 : 6;
  return (
    <span className="fb-burst" data-kind={kind} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} style={{ "--i": index, "--n": count } as React.CSSProperties}>{glyph}</span>
      ))}
    </span>
  );
}

/** While the bot works away from its spot: a small owl at the screen edge with a turning ring. */
export function AwayBadge({ snapshot, onOpen, onMenu, hover }: { snapshot: FloatingSnapshot; onOpen: () => void; onMenu: (x: number, y: number) => void; hover: (on: boolean) => void }) {
  const label = snapshot.hints.working || snapshot.name;
  return (
    <button
      type="button"
      className="fb-away"
      data-task={snapshot.task}
      aria-label={label}
      title={label}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
    >
      <span className="fb-away-ring" aria-hidden="true" />
      <svg className="fb-away-owl" viewBox="0 0 32 32" aria-hidden="true" style={{ color: `var(--fb-owl, currentColor)` }}>
        <path d="M8 6 L11 11 L21 11 L24 6 L25 14 C26 22 22 28 16 28 C10 28 6 22 7 14 Z" fill="currentColor" />
        <circle cx="12.5" cy="15" r="3" fill="#F8CA48" />
        <circle cx="19.5" cy="15" r="3" fill="#F8CA48" />
        <circle cx="12.5" cy="15" r="1.4" fill="#0E0B0E" />
        <circle cx="19.5" cy="15" r="1.4" fill="#0E0B0E" />
        <path d="M15 18 L17 18 L16 20.5 Z" fill="#ACA09C" />
      </svg>
    </button>
  );
}

interface CharacterProps {
  color: string;
  skin: string;
  avatarSrc: string | null;
  avatarX: number;
  avatarY: number;
  look: string;
  pose: FloatingPose;
  activity: MascotActivity;
  prowling?: boolean;
  task?: MascotTask;
  mascot: {
    frame: (at: number) => ReturnType<typeof mascotMotion>;
    fps: () => number;
    onHitTest: (test: ((x: number, y: number) => boolean) | null) => void;
  };
}

/**
 * The character redraws only when its own looks change: a streaming reply
 * sends a new snapshot many times a second, and none of them concern it.
 */
export const Character = memo(function Character({ color, skin, avatarSrc, avatarX, avatarY, look: lookJson, pose, activity, prowling = false, task, mascot }: CharacterProps) {
  const look = useMemo(() => (lookJson ? (JSON.parse(lookJson) as MascotLook) : undefined), [lookJson]);
  const complete = useMemo(() => completeMascotLook(look), [look]);
  const entry = mascotFor(look);
  return (
    <>
      {avatarSrc && (
        <span className="fb-medallion" aria-hidden="true">
          <img src={avatarSrc} alt="" draggable={false} style={{ objectPosition: `${avatarX * 100}% ${avatarY * 100}%` }} />
        </span>
      )}
      <entry.Render
        key={entry.id}
        color={color}
        skin={skin}
        look={complete}
        size={OWL_SIZE}
        activity={activity}
        prowling={prowling}
        pose={pose}
        task={task}
        frame={mascot.frame}
        fps={mascot.fps}
        onHitTest={mascot.onHitTest}
        stage={STAGE}
      />
    </>
  );
});

export function StageEffects({
  snapshot,
  activity,
  burst,
  reduced,
  asleep,
  fxSide,
  lane,
  controlsShown,
}: {
  snapshot: FloatingSnapshot;
  activity: MascotActivity;
  burst: { kind: "hearts" | "sparkles"; key: number } | null;
  reduced: boolean;
  asleep: boolean;
  fxSide: EffectSide;
  lane: { x: number; y: number; width: number; height: number };
  controlsShown: boolean;
}) {
  const retro = snapshot.retro || snapshot.mascot?.character === "trombi";
  return (
    <span
      className="fb-fx"
      data-character={snapshot.mascot?.character ?? "owl"}
      data-side={fxSide}
      data-controls={controlsShown ? "" : undefined}
      aria-hidden="true"
      style={{ left: lane.x, top: lane.y, width: lane.width, height: lane.height }}
    >
      {snapshot.pose === "think" && activity !== "flyOut" && activity !== "think" && (
        <span className="fb-thought"><span /><span /><span /></span>
      )}
      {asleep && (
        <span className="fb-zzz" data-sleep-glyphs=""><span>z</span><span>z</span><span>Z</span></span>
      )}
      <Emote activity={activity} hoot={snapshot.hints.hoot} />
      {burst && <Burst key={burst.key} kind={burst.kind} reduced={reduced} />}
      {retro && (
        <Suspense fallback={null}>
          <RetroDecor sparkle={snapshot.sparkle} reduced={snapshot.reduced} />
        </Suspense>
      )}
    </span>
  );
}
