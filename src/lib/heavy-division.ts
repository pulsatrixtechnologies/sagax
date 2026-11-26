// The cell division of a Heavy run (owner 2026-11-26, M-20261126-116,
// M-20261126-119 to M-20261126-122): in the chat's row the bot's mascot
// divides in place into one cell per expert. A cell loses its eyes, elongates,
// pinches in the middle and lets go; each daughter gets its eyes back, takes
// its expert's colour, and the experts close up into the row's tight pile.
// When many are needed several cells divide at once.
//
// This is the motion alone, with no drawing: positions, radii, how open the
// eyes are and how far the expert's colour has come, stepped by the clock it
// is given (HeavyDivision.tsx draws it). The numbers are the validated
// mock-up's, scaled from its 20 px cell to the row's avatar size.

/** The mock-up's one speed (M-20261126-120): every wait and every spring is stretched by it. */
export const DIVISION_SPEED = 1.25;
/** The longest step a spring takes, in seconds. */
const SPRING_STEP = 1 / 60;
/** The mock-up's cell radius: its other lengths are written against it. */
const MOCK_RADIUS = 10;
/** How far apart two neighbours of the finished pile sit, per pixel of avatar size (the row's 22 px avatars overlap by 6). */
const STACK_RATIO = 16 / 22;

export interface DivisionCell {
  /** Stable for the cell's life: the drawing keys its elements on it. */
  id: number;
  x: number;
  r: number;
  /** Where the springs pull x and r. */
  tx: number;
  tr: number;
  vx: number;
  vr: number;
  /** 0 to 1: how open the eyes are, and where they go. */
  face: number;
  tface: number;
  /** 0 to 1: from the bot's colour to the expert's. */
  tint: number;
  ttint: number;
  /** Which expert the cell became (its place in the pile); -1 before it has one. */
  expert: number;
  /** The phase of its idle wobble. */
  phase: number;
}

export interface DivisionGeometry {
  /** A cell's radius at rest. */
  radius: number;
  /** The first cell's centre. */
  x0: number;
  /** Between two cells while they divide: room for a whole daughter. */
  spread: number;
  /** Between two experts of the finished pile. */
  stack: number;
  /** One unit of the mock-up, in pixels. */
  unit: number;
}

export function divisionGeometry(size: number): DivisionGeometry {
  const radius = size / 2;
  const unit = radius / MOCK_RADIUS;
  return { radius, x0: radius, spread: 21 * unit, stack: size * STACK_RATIO, unit };
}

export interface DivisionOptions {
  /** The avatar size of the row, in pixels. */
  size: number;
  /** Start finished: this many experts already in their pile (a run seen before, or read back from history). */
  rest?: number;
  /** Reduced motion: every step lands at once, nothing travels. */
  reduced?: boolean;
  random?: () => number;
}

export class HeavyDivisionSim {
  readonly geometry: DivisionGeometry;
  readonly cells: DivisionCell[] = [];
  reduced: boolean;
  /** 0 to 1: how far the cells have melted into one membrane (the drawing blurs them by it). The bot's own outline at 0; it comes back as the experts take their colours. */
  melt = 0;
  private tmelt = 0;
  private readonly random: () => number;
  private nextId = 1;
  private target = 0;
  private script: Generator<number, void, void> | null = null;
  private wait = 0;

  constructor(options: DivisionOptions) {
    this.geometry = divisionGeometry(options.size);
    this.reduced = options.reduced === true;
    this.random = options.random ?? Math.random;
    const { x0, radius } = this.geometry;
    const rest = Math.max(0, Math.floor(options.rest ?? 0));
    this.target = rest;
    this.make(x0, radius);
    for (let index = 1; index < rest; index += 1) this.make(x0, radius);
    if (rest > 0) {
      this.pile();
      this.land();
    }
  }

  /** The cells from left to right: the order of the pile, and of the drawing. */
  ordered(): DivisionCell[] {
    return this.cells.slice().sort((a, b) => a.x - b.x || a.id - b.id);
  }

  /** How many experts the run now has: the cells divide (or leave) until they are that many. None is the bot alone. */
  setCount(count: number): void {
    const next = Math.max(0, Math.floor(count));
    if (next === this.target) return;
    this.target = next;
    if (!this.script) {
      this.script = this.run();
      this.wait = 0;
    }
    if (this.reduced) this.advance(0);
  }

  /** Whether a division is still under way (its script runs, or a spring still moves). */
  get busy(): boolean {
    return this.script !== null || !this.atRest();
  }

  /** Whether any cell still shows the bot's own colour: those bodies are drawn only then. */
  get untinted(): boolean {
    return this.cells.some((cell) => cell.tint < 0.999);
  }

  /** How wide the row's drawing is now: it follows the rightmost cell, so the text stays against the pile. */
  width(): number {
    let right = 0;
    for (const cell of this.cells) right = Math.max(right, cell.x + cell.r);
    return Math.max(this.geometry.radius * 2, right);
  }

  /** Step the motion by `dt` seconds: the script keeps the real time, the springs take it in short steps (a late frame never throws a cell). */
  advance(dt: number): void {
    if (this.reduced) {
      // every step at once: the script runs to its end and each state lands
      while (this.script) {
        if (this.script.next().done) this.script = null;
        this.land();
      }
      this.land();
      return;
    }
    this.wait -= dt * 1000;
    while (this.script && this.wait <= 0) {
      const step = this.script.next();
      if (step.done) this.script = null;
      else this.wait += step.value * DIVISION_SPEED;
    }
    const stiffness = 70 / (DIVISION_SPEED * DIVISION_SPEED);
    const damping = 2 * Math.sqrt(stiffness);
    for (let left = dt; left > 1e-6; left -= SPRING_STEP) {
      const step = Math.min(SPRING_STEP, left);
      const ease = Math.min(1, (step * 8) / DIVISION_SPEED);
      for (const cell of this.cells) {
        cell.vx += (stiffness * (cell.tx - cell.x) - damping * cell.vx) * step;
        cell.x += cell.vx * step;
        cell.vr += (stiffness * (cell.tr - cell.r) - damping * cell.vr) * step;
        cell.r += cell.vr * step;
        cell.face += (cell.tface - cell.face) * ease;
        cell.tint += (cell.ttint - cell.tint) * ease;
      }
      this.melt += (this.tmelt - this.melt) * ease;
    }
    if (!this.script && this.atRest()) this.land();
  }

  private make(x: number, r: number): DivisionCell {
    const cell: DivisionCell = { id: this.nextId++, x, r, tx: x, tr: r, vx: 0, vr: 0, face: 1, tface: 1, tint: 0, ttint: 0, expert: -1, phase: this.random() * 6.28 };
    this.cells.push(cell);
    return cell;
  }

  private atRest(): boolean {
    return this.cells.every((cell) =>
      Math.abs(cell.tx - cell.x) < 0.02 && Math.abs(cell.vx) < 0.05 && Math.abs(cell.tr - cell.r) < 0.02 && Math.abs(cell.vr) < 0.05
      && Math.abs(cell.tface - cell.face) < 0.004 && Math.abs(cell.ttint - cell.tint) < 0.004)
      && Math.abs(this.tmelt - this.melt) < 0.004;
  }

  /** Every cell exactly where it is going. */
  private land(): void {
    for (const cell of this.cells) {
      cell.x = cell.tx;
      cell.r = cell.tr;
      cell.vx = 0;
      cell.vr = 0;
      cell.face = cell.tface;
      cell.tint = cell.ttint;
    }
    this.melt = this.tmelt;
  }

  private spreadOut(gap: number, r: number, face?: number): void {
    this.ordered().forEach((cell, index) => {
      cell.tx = this.geometry.x0 + gap * index;
      cell.tr = r;
      if (face !== undefined) cell.tface = face;
    });
  }

  /** The finished pile: each cell its expert's colour, close against its neighbour. */
  private pile(): void {
    this.ordered().forEach((cell, index) => {
      cell.expert = index;
      cell.ttint = 1;
    });
    this.spreadOut(this.geometry.stack, this.geometry.radius, 1);
    this.tmelt = 0;
  }

  private *run(): Generator<number, void, void> {
    const { x0, radius, spread, unit } = this.geometry;
    for (;;) {
      const want = this.target;
      // the bot alone again (the run has no expert yet, or lost them all): one cell in its own colour
      if (want === 0) {
        while (this.cells.length > 1) this.cells.splice(this.cells.indexOf(this.ordered().at(-1)!), 1);
        const one = this.cells[0]!;
        one.tx = x0;
        one.tr = radius;
        one.tface = 1;
        one.ttint = 0;
        one.expert = -1;
        this.tmelt = 0;
        if (this.target === want) return;
        continue;
      }
      // an expert left the team (its seat refused and no other was free): the pile closes up
      while (this.cells.length > want) this.cells.splice(this.cells.indexOf(this.ordered().at(-1)!), 1);
      if (this.cells.length < want && this.cells.some((cell) => cell.ttint > 0)) {
        // the pile divides again: back to the bot's colour first, the membrane is drawn in it
        for (const cell of this.cells) cell.ttint = 0;
        yield 280;
      }
      // rounds of division: as many cells as needed divide at once, after the row made room for the daughters
      while (this.cells.length < want && this.target === want) {
        const row = this.ordered();
        const dividing = row.slice(0, Math.min(row.length, want - row.length));
        let slot = 0;
        for (const cell of row) {
          if (dividing.includes(cell)) {
            cell.tx = x0 + spread * slot + (spread / 2 - 4 * unit);
            slot += 2;
          } else {
            cell.tx = x0 + spread * slot;
            slot += 1;
          }
        }
        yield 280;
        // one division, in place: the eyes fade, the body elongates, pinches, then the daughters part
        for (const cell of dividing) cell.tface = 0;
        this.tmelt = 1;
        yield 220;
        const pairs = dividing.map((parent) => {
          const child = this.make(parent.x, parent.r);
          child.face = child.tface = 0;
          return { parent, child, mid: parent.x + 4 * unit };
        });
        for (const { parent, child, mid } of pairs) {
          parent.tx = mid - 3.4 * unit;
          child.tx = mid + 3.4 * unit;
          parent.tr = child.tr = 9.2 * unit;
        }
        yield 380;
        for (const { parent, child, mid } of pairs) {
          parent.tx = mid - 7.6 * unit;
          child.tx = mid + 7.6 * unit;
          parent.tr = child.tr = 8.6 * unit;
        }
        yield 420;
        this.spreadOut(spread, 9.2 * unit, 1);
        yield 480;
      }
      if (this.target !== want) continue;
      this.pile();
      return;
    }
  }
}
