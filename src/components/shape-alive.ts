// The seats of the small mascots that live (#5404): a shape in the sidebar
// breathes, blinks, follows the pointer and plays the bot's state, as the
// large mascot does, on the same loop. A sidebar may hold dozens of bots, and
// every live mascot is redrawn thirty times a second (a body in a material by
// the engine's shared WebGL painter, a flat one as SVG), so the page gives
// out a fixed number of seats:
// - only a mascot on screen (or about to be) asks for one; the others are
//   the still image, as before;
// - while there are seats for all of them, all of them live, all the time
//   (a window of the usual height shows the pinned tile and six rows);
// - past that, a bot that is doing something sits first, and the mascots at
//   rest take turns: one seat changes hands at a time, from the mascot that
//   lived longest to the one that waited longest, which rests as its still.
//
// Measured with thirty bots, headless Chrome at a device pixel ratio of 2
// (scripts/capture/sidebar-mascot-quality.mjs, which also takes --seats to
// try another number). With every one of the thirty on screen and live, the
// page fell from 60 to 17 frames a second in Fluffy and 22 in Glass. A flat
// mascot is the dearest for the page itself: about 2.5% of its main thread
// each (seven alive: 14%, against 2% for seven stills), where a body in a
// material costs under 1% each (its work is on the GPU). Eight seats keep
// the main thread under a quarter and the page at 60 frames a second in the
// three finishes, and cover the usual window with no turn to take.
import { useEffect, useRef, useState, type RefObject } from "react";

/** How many small mascots live at once on a page. */
export const ALIVE_SEATS = 8;
/** How often the mascots at rest take turns, while more of them are on screen than there are seats (ms). */
export const ALIVE_TURN_MS = 1500;
/** How many seats change hands on a turn. */
export const ALIVE_TURN_SEATS = 1;
/** How far outside the window a mascot already asks for its seat (CSS px), as the engine's own loop. */
const VIEW_MARGIN = 100;

export interface AliveSeat {
  /** On screen, or within the margin around it. */
  visible: boolean;
  /** The bot is doing something (any state but idle): it sits before a mascot at rest. */
  busy: boolean;
  seated: boolean;
  /** When it last sat down, and when it last had a seat (ms; 0 never). */
  since: number;
  last: number;
}

const oldest = <T extends AliveSeat>(key: "since" | "last") => (a: T, b: T) => a[key] - b[key];

/**
 * Who sits now. Off screen nobody does; a free seat goes to a bot at work,
 * then to the mascot that waited longest; a bot at work with no seat takes
 * the one of the mascot at rest that lived longest; and on a turn
 * (`rotate`) the mascots at rest that waited longest take a few seats from
 * the ones that lived longest. Returns the seats that sit; changes nothing.
 */
export function seatedNow<T extends AliveSeat>(all: readonly T[], seats: number, rotate: boolean, turnSeats = ALIVE_TURN_SEATS): Set<T> {
  const visible = all.filter((seat) => seat.visible);
  const seated = visible.filter((seat) => seat.seated);
  const waiting = visible.filter((seat) => !seat.seated).sort((a, b) => Number(b.busy) - Number(a.busy) || oldest<T>("last")(a, b));
  while (seated.length > seats) {
    // fewer seats than before: the mascots at rest that lived longest stand up first
    const out = [...seated].sort((a, b) => Number(a.busy) - Number(b.busy) || oldest<T>("since")(a, b))[0]!;
    seated.splice(seated.indexOf(out), 1);
    waiting.push(out);
  }
  while (seated.length < seats && waiting.length) seated.push(waiting.shift()!);
  const resting = () => seated.filter((seat) => !seat.busy).sort(oldest<T>("since"));
  const swap = (out: T, into: T) => {
    seated.splice(seated.indexOf(out), 1, into);
    waiting.splice(waiting.indexOf(into), 1);
  };
  for (const seat of waiting.filter((entry) => entry.busy)) {
    const out = resting()[0];
    if (!out) break;
    swap(out, seat);
  }
  if (rotate) {
    const next = waiting.filter((seat) => !seat.busy).slice(0, turnSeats);
    const out = resting();
    for (let i = 0; i < next.length && i < out.length; i += 1) swap(out[i]!, next[i]!);
  }
  return new Set(seated);
}

interface Held extends AliveSeat {
  set: (seated: boolean) => void;
}

const held = new Set<Held>();
let seats = ALIVE_SEATS;
let timer: ReturnType<typeof setInterval> | null = null;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function reseat(rotate = false) {
  const all = [...held];
  const sitting = seatedNow(all, seats, rotate);
  const at = now();
  let waiting = 0;
  for (const seat of all) {
    const next = sitting.has(seat);
    if (seat.visible && !next) waiting += 1;
    if (next === seat.seated) continue;
    seat.seated = next;
    if (next) seat.since = at;
    else seat.last = at;
    seat.set(next);
  }
  // the turns run only while a mascot on screen waits for a seat
  if (waiting > 0 && timer === null) {
    timer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) reseat(true);
    }, ALIVE_TURN_MS);
  } else if (waiting === 0 && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Whether this mascot lives now: `wanted` (a small mascot asked alive, motion
 * not reduced), on screen, and holding one of the page's seats. False on the
 * first draw: a mascot is its still image until it is seen on screen.
 */
export function useAliveSeat(ref: RefObject<Element | null>, wanted: boolean, busy: boolean): boolean {
  const [seated, setSeated] = useState(false);
  const seat = useRef<Held | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!wanted || !el) return;
    const watched = typeof IntersectionObserver !== "undefined";
    const mine: Held = { visible: !watched, busy, seated: false, since: 0, last: 0, set: setSeated };
    seat.current = mine;
    held.add(mine);
    const intersect = watched
      ? new IntersectionObserver((entries) => {
        const next = entries[entries.length - 1]!.isIntersecting;
        if (next === mine.visible) return;
        mine.visible = next;
        reseat();
      }, { rootMargin: `${VIEW_MARGIN}px` })
      : null;
    intersect?.observe(el);
    reseat();
    return () => {
      intersect?.disconnect();
      held.delete(mine);
      seat.current = null;
      setSeated(false);
      reseat();
    };
    // the bot's activity is followed below, without taking the seat away
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, ref]);
  useEffect(() => {
    if (!seat.current || seat.current.busy === busy) return;
    seat.current.busy = busy;
    reseat();
  }, [busy]);
  return wanted && seated;
}

/** For the cost measure and tests: another number of seats (none puts the page's own back). */
export function setAliveSeats(count: number | null = null) {
  seats = count === null ? ALIVE_SEATS : Math.max(0, Math.floor(count));
  reseat();
}
