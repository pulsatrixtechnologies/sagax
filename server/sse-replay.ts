// Port de OpenMausBot #3127 (réécrit pour Sagax) : the replay buffer of the
// event stream is capped by size as well as by count.

export interface ReplayFrame {
  seq: number;
  kind: string;
  frame: string | null;
  clientFrame: string | null;
  payload: Record<string, unknown> | null;
}

export const REPLAY_MAX_FRAMES = 500;
/** A bot frame carries every thread the bot has, so a few hundred of them
 * could hold hundreds of megabytes; past this many characters the oldest
 * frames go and a reconnecting client gets a fresh snapshot instead. */
export const REPLAY_MAX_CHARS = 8_000_000;

/** What one entry keeps alive: its frame, its member frame when that is a
 * separate string, and its payload object (about the frame's size again). */
function retainedChars(entry: ReplayFrame): number {
  const frame = entry.frame?.length ?? 0;
  const clientFrame = entry.clientFrame !== null && entry.clientFrame !== entry.frame ? entry.clientFrame.length : 0;
  return frame + clientFrame + (entry.payload ? frame : 0);
}

/** The newest frames, oldest first. The newest frame always stays, even
 * when it alone is over the size cap. */
export class ReplayBuffer implements Iterable<ReplayFrame> {
  private frames: ReplayFrame[] = [];
  private chars = 0;
  private readonly maxFrames: number;
  private readonly maxChars: number;

  constructor(maxFrames = REPLAY_MAX_FRAMES, maxChars = REPLAY_MAX_CHARS) {
    this.maxFrames = maxFrames;
    this.maxChars = maxChars;
  }

  push(entry: ReplayFrame): void {
    this.frames.push(entry);
    this.chars += retainedChars(entry);
    while (this.frames.length > 1 && (this.frames.length > this.maxFrames || this.chars > this.maxChars)) {
      this.chars -= retainedChars(this.frames.shift()!);
    }
  }

  /** True when every frame after `since` is still held, so a stream that
   * resumes from it misses nothing. */
  covers(since: number, lastSeq: number): boolean {
    const oldest = this.frames[0];
    return oldest === undefined ? since === lastSeq : oldest.seq <= since + 1;
  }

  get length(): number {
    return this.frames.length;
  }

  get retained(): number {
    return this.chars;
  }

  [Symbol.iterator](): Iterator<ReplayFrame> {
    return this.frames[Symbol.iterator]();
  }
}
