// The seats of the small mascots that live (#5404): a shape in the sidebar
// breathes, blinks, follows the pointer and plays the bot's state, as the
// large mascot does, on the same loop. A sidebar may hold dozens of bots, and
// every live mascot is redrawn thirty times a second (a body in a material by
// the engine's shared WebGL painter, a flat one as SVG), so the page gives
// out a fixed number of seats:
// - only a mascot on screen asks for one, with no margin (in a closed drawer,
//   off the left edge, it has none); the others are the still image;
// - while there are seats for all of them, all of them live, all the time:
//   a window of the usual height (860 to 1000 px), the account menu closed,
//   shows 10 to 12 mascots in comfortable rows and 12 to 15 in compact ones,
//   under the twenty seats, so it never takes a turn (nor does a window up
//   to 1440 px tall in comfortable rows, 1250 px in compact ones);
// - a pinned tile sits first and never takes turns (`keep`); then a bot that
//   is doing something; past the seats, the mascots at rest take turns: one
//   seat changes hands at a time, from the mascot that lived longest to the
//   one that waited longest, which rests as its still;
// - the faces of one group's stack share one seat (`share`);
// - while the window is hidden, the turns stop.
//
// Measured with thirty bots, headless Chrome at a device pixel ratio of 2,
// the account menu closed (scripts/capture/sidebar-mascot-quality.mjs
// --seats; every figure in docs/mascots.md, "The seats"). In a window 2400
// px tall, the thirty on screen: with the thirty alive, flat holds 60 frames
// a second but takes 57% of a core for the page (dark skin; 35% with 16
// alive, 43% with 20), Fluffy and Glass hold 60 in a dark skin (the GPU
// process at 40%, against 28 to 29% with 20 alive), and in a light skin
// Fluffy falls to 18 frames a second (23 with 20 alive) and Glass to 26:
// every live canvas makes the compositor draw again the drop shadow of the
// canvases near it (#5414); one alive holds 60, eight already fall to 34 and
// 29, so no number of seats fixes it. Past twenty on screen, the turns keep
// the cost where it is with twenty.
import { createContext, useContext, useEffect, useRef, useState, type RefObject } from "react";

/** How many small mascots live at once on a page: more than any window of the usual height shows. */
export const ALIVE_SEATS = 20;
/** How often the mascots at rest take turns, while more of them are on screen than there are seats (ms). */
export const ALIVE_TURN_MS = 1500;
/** How many seats change hands on a turn. */
export const ALIVE_TURN_SEATS = 1;

export interface AliveSeat {
  /** On screen. */
  visible: boolean;
  /** The bot is doing something (any state but idle): it sits before a mascot at rest. */
  busy: boolean;
  /** A pinned tile: it sits before anyone and never takes turns. */
  keep: boolean;
  seated: boolean;
  /** When it last sat down, and when it last had a seat (ms; 0 never). */
  since: number;
  last: number;
}

/** How a mascot asks for its seat (SidebarMascotAvatar `seat`). */
export interface AliveSeatAsk {
  /** A pinned tile: it always has its seat while on screen. */
  keep?: boolean;
  /** The mascots asking with the same key hold one seat together (the faces of a group's stack). */
  share?: string;
}

/** A pinned tile's mascot (SidebarPinnedGrid). */
export const PINNED_TILE_SEAT: AliveSeatAsk = { keep: true };

/** What the mascots under it ask for (SidebarMascotAvatar provides it, ShapeMascot reads it). */
export const AliveSeatAskContext = createContext<AliveSeatAsk | null>(null);

/** Who sits first: a pinned tile, then a bot at work, then a mascot at rest. */
const rank = (seat: AliveSeat) => (seat.keep ? 2 : seat.busy ? 1 : 0);

/**
 * Who sits now. Off screen nobody does; a free seat goes to a pinned tile,
 * then to a bot at work, then to the mascot that waited longest; a pinned
 * tile or a bot at work with no seat takes the one of the lowest mascot that
 * lived longest; and on a turn (`rotate`) the mascots at rest that waited
 * longest take a few seats from the ones at rest that lived longest. Returns
 * the seats that sit; changes nothing.
 */
export function seatedNow<T extends AliveSeat>(all: readonly T[], seats: number, rotate: boolean, turnSeats = ALIVE_TURN_SEATS): Set<T> {
  const visible = all.filter((seat) => seat.visible);
  const seated = visible.filter((seat) => seat.seated);
  const waiting = visible.filter((seat) => !seat.seated);
  // the first to stand up: the lowest, then the one that lived longest
  const standing = () => [...seated].sort((a, b) => rank(a) - rank(b) || a.since - b.since);
  while (seated.length > Math.max(0, seats)) waiting.push(...seated.splice(seated.indexOf(standing()[0]!), 1));
  // the first to sit: the highest, then the one that waited longest
  waiting.sort((a, b) => rank(b) - rank(a) || a.last - b.last);
  while (seated.length < seats && waiting.length) seated.push(waiting.shift()!);
  const swap = (out: T, into: T) => {
    seated.splice(seated.indexOf(out), 1, into);
    waiting.splice(waiting.indexOf(into), 1);
  };
  for (const seat of waiting.filter((entry) => rank(entry) > 0)) {
    const out = standing()[0];
    if (out && rank(out) < rank(seat)) swap(out, seat);
  }
  if (rotate) {
    const next = waiting.filter((seat) => rank(seat) === 0).slice(0, turnSeats);
    const out = standing().filter((seat) => rank(seat) === 0);
    for (let i = 0; i < next.length && i < out.length; i += 1) swap(out[i]!, next[i]!);
  }
  return new Set(seated);
}

/** One mascot that asks. */
interface Member {
  visible: boolean;
  busy: boolean;
  keep: boolean;
  /** What it was last told. */
  on: boolean;
  set: (on: boolean) => void;
}

/** One seat's holder: a mascot, or the faces that share one. */
interface Party extends AliveSeat {
  members: Set<Member>;
  share: string | null;
}

const parties = new Set<Party>();
const shared = new Map<string, Party>();
let seats = ALIVE_SEATS;
let timer: ReturnType<typeof setInterval> | null = null;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const hidden = () => typeof document !== "undefined" && document.hidden;
// a hidden window takes no turn: the turns stop, and start again when it shows
const onVisibility = () => reseat();

function join(member: Member, share: string | null): Party {
  let party = share === null ? undefined : shared.get(share);
  if (!party) {
    party = { visible: false, busy: false, keep: false, seated: false, since: 0, last: 0, members: new Set(), share };
    if (parties.size === 0 && typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    parties.add(party);
    if (share !== null) shared.set(share, party);
  }
  party.members.add(member);
  return party;
}

function leave(member: Member, party: Party) {
  party.members.delete(member);
  if (party.members.size > 0) return;
  parties.delete(party);
  if (party.share !== null && shared.get(party.share) === party) shared.delete(party.share);
  if (parties.size === 0 && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
}

function reseat(rotate = false) {
  const all = [...parties];
  for (const party of all) {
    const members = [...party.members];
    party.visible = members.some((member) => member.visible);
    party.busy = members.some((member) => member.busy);
    party.keep = members.some((member) => member.keep);
  }
  const sitting = seatedNow(all, seats, rotate);
  const at = now();
  for (const party of all) {
    const next = sitting.has(party);
    if (next !== party.seated) {
      party.seated = next;
      if (next) party.since = at;
      else party.last = at;
    }
    // a face of a shared seat off screen lives no more than any other
    for (const member of party.members) {
      const on = next && member.visible;
      if (on === member.on) continue;
      member.on = on;
      member.set(on);
    }
  }
  // the turns run only while the window shows and a mascot at rest on screen waits for the seat of another
  const turns = !hidden()
    && all.some((party) => party.visible && !party.seated && rank(party) === 0)
    && all.some((party) => party.seated && rank(party) === 0);
  if (turns && timer === null) {
    timer = setInterval(() => reseat(true), ALIVE_TURN_MS);
  } else if (!turns && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Whether this mascot lives now: `wanted` (a small mascot asked alive, and
 * one that would move), on screen, and holding one of the page's seats.
 * False on the first draw: a mascot is its still image until it is seen on
 * screen. What it asks for (a pinned tile, a shared seat) comes from
 * `AliveSeatAskContext`.
 */
export function useAliveSeat(ref: RefObject<Element | null>, wanted: boolean, busy: boolean): boolean {
  const ask = useContext(AliveSeatAskContext);
  const keep = ask?.keep === true;
  const share = ask?.share ?? null;
  const [seated, setSeated] = useState(false);
  const member = useRef<Member | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!wanted || !el) return;
    const watched = typeof IntersectionObserver !== "undefined";
    const mine: Member = { visible: !watched, busy, keep, on: false, set: setSeated };
    member.current = mine;
    const party = join(mine, share);
    // no margin: a mascot only just off screen (a closed drawer slides the
    // sidebar off the left edge) gives its seat back and its loop stops
    const intersect = watched
      ? new IntersectionObserver((entries) => {
        const next = entries[entries.length - 1]!.isIntersecting;
        if (next === mine.visible) return;
        mine.visible = next;
        reseat();
      })
      : null;
    intersect?.observe(el);
    reseat();
    return () => {
      intersect?.disconnect();
      leave(mine, party);
      member.current = null;
      setSeated(false);
      reseat();
    };
    // the bot's activity is followed below, without taking the seat away
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, ref, keep, share]);
  useEffect(() => {
    if (!member.current || member.current.busy === busy) return;
    member.current.busy = busy;
    reseat();
  }, [busy]);
  return wanted && seated;
}

/** For the cost measure and tests: another number of seats (none puts the page's own back). */
export function setAliveSeats(count: number | null = null) {
  seats = count === null ? ALIVE_SEATS : Math.max(0, Math.floor(count));
  reseat();
}
