// Live resource samplers: one per card. A sampler runs the read-only loop of
// scripts.ts on its target, turns each block into a frame (parse.ts) and
// hands frames to whoever watches the card. Bounded on every side: a run
// lasts `runMs` (the computer's own loop ends too), it pauses when nobody
// watches for `idleMs`, a person has at most `maxLive` running (a new one
// pauses the oldest), and a stream that floods is dropped. Only the person
// who asked sees it; resuming opens the target again, so the target's own
// permission check runs again.
import { randomBytes } from "node:crypto";

import {
  RESOURCE_CADENCE_MS,
  RESOURCE_IDLE_MS,
  RESOURCE_MAX_LIVE_PER_PERSON,
  RESOURCE_RUN_MS,
  windowFrames,
  type ResourceFrame,
  type ResourceHost,
  type ResourcePauseReason,
  type ResourceState,
  type ResourceStreamEvent,
  type ResourceUsageSnapshot,
} from "../../shared/resource-usage.ts";
import { deriveFrame, hostOf, parseBlock, splitBlocks, type RawSample } from "./parse.ts";

/** A running loop on the target. */
export interface SampleStream {
  stop(): void;
}

/** Where samples come from: this computer, an SSH host, a Tailcat session. */
export interface SampleSource {
  /** Runs `iterations` samples; text arrives in chunks; `onExit` once at the end. */
  start(iterations: number, onText: (chunk: string) => void, onExit: (error?: string) => void): SampleStream;
  /** Per-core CPU measured here instead (this computer on macOS, whose top gives a total only). */
  cpuOverlay?(): { total: number; cores: number[] } | null;
}

/** Opens the target for this person, checking their access each time. */
export type OpenSource = () => Promise<SampleSource | { error: string }>;

/** Error codes the card translates. Never a transport's own words. */
export type ResourceErrorCode = "forbidden" | "unreachable" | "no-data" | "dropped" | "gone";

const BUFFER_MAX = 512 * 1024;
/** Samplers kept per person (paused ones answer Reprendre). */
const KEPT_PER_PERSON = 12;

interface Sampler {
  id: string;
  principalId: string;
  botId: string;
  threadId: string;
  open: OpenSource;
  state: ResourceState;
  reason?: ResourcePauseReason;
  error?: ResourceErrorCode;
  host: ResourceHost;
  frames: ResourceFrame[];
  prev: { raw: RawSample; t: number } | null;
  buffer: string;
  stream: SampleStream | null;
  source: SampleSource | null;
  /** Bumped on every run: callbacks of an older run are ignored. */
  run: number;
  startedAt: number;
  endsAt?: number;
  watchers: Set<(event: ResourceStreamEvent) => void>;
  runTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  waiting: Array<(frame: ResourceFrame | null) => void>;
  createdAt: number;
}

export function createResourceSamplers(options: {
  now?: () => number;
  runMs?: number;
  idleMs?: number;
  maxLive?: number;
  cadenceMs?: number;
} = {}) {
  const now = options.now ?? (() => Date.now());
  const runMs = options.runMs ?? RESOURCE_RUN_MS;
  const idleMs = options.idleMs ?? RESOURCE_IDLE_MS;
  const maxLive = options.maxLive ?? RESOURCE_MAX_LIVE_PER_PERSON;
  const cadenceMs = options.cadenceMs ?? RESOURCE_CADENCE_MS;
  const samplers = new Map<string, Sampler>();

  const running = (sampler: Sampler) => sampler.state === "starting" || sampler.state === "live";

  function snapshotOf(sampler: Sampler): ResourceUsageSnapshot {
    return {
      id: sampler.id,
      state: sampler.state,
      ...(sampler.reason ? { reason: sampler.reason } : {}),
      host: { ...sampler.host },
      frames: windowFrames(sampler.frames),
      ...(sampler.endsAt && running(sampler) ? { endsAt: sampler.endsAt } : {}),
      ...(sampler.error ? { error: sampler.error } : {}),
    };
  }

  function emit(sampler: Sampler, event: ResourceStreamEvent) {
    for (const watcher of sampler.watchers) {
      try {
        watcher(event);
      } catch {
        sampler.watchers.delete(watcher);
      }
    }
  }

  function emitState(sampler: Sampler) {
    emit(sampler, {
      kind: "state",
      state: sampler.state,
      ...(sampler.reason ? { reason: sampler.reason } : {}),
      ...(sampler.endsAt && running(sampler) ? { endsAt: sampler.endsAt } : {}),
      ...(sampler.error ? { error: sampler.error } : {}),
    });
  }

  function clearTimers(sampler: Sampler) {
    if (sampler.runTimer) clearTimeout(sampler.runTimer);
    if (sampler.idleTimer) clearTimeout(sampler.idleTimer);
    sampler.runTimer = undefined;
    sampler.idleTimer = undefined;
  }

  function halt(sampler: Sampler) {
    clearTimers(sampler);
    sampler.run += 1;
    const stream = sampler.stream;
    sampler.stream = null;
    sampler.source = null;
    sampler.buffer = "";
    sampler.prev = null;
    try {
      stream?.stop();
    } catch {
      /* already gone */
    }
    for (const resolve of sampler.waiting.splice(0)) resolve(null);
  }

  function pause(sampler: Sampler, reason: ResourcePauseReason) {
    if (!running(sampler)) return;
    halt(sampler);
    sampler.state = "paused";
    sampler.reason = reason;
    delete sampler.error;
    emitState(sampler);
  }

  function fail(sampler: Sampler, code: ResourceErrorCode) {
    halt(sampler);
    sampler.state = "error";
    sampler.error = code;
    delete sampler.reason;
    emitState(sampler);
  }

  function armIdle(sampler: Sampler, ms: number) {
    if (sampler.idleTimer) clearTimeout(sampler.idleTimer);
    sampler.idleTimer = setTimeout(() => {
      sampler.idleTimer = undefined;
      if (sampler.watchers.size === 0) pause(sampler, "idle");
    }, ms);
  }

  function onBlock(sampler: Sampler, block: string) {
    const raw = parseBlock(block);
    if (!raw) return;
    const t = now();
    const frame = deriveFrame(sampler.prev, raw, t);
    sampler.prev = { raw, t };
    const overlay = sampler.source?.cpuOverlay?.();
    if (overlay) frame.cpu = overlay;
    sampler.host = { ...sampler.host, ...hostOf(raw) };
    sampler.frames.push(frame);
    if (sampler.frames.length > 64) sampler.frames.splice(0, sampler.frames.length - 64);
    if (sampler.state === "starting") {
      sampler.state = "live";
      emitState(sampler);
    }
    emit(sampler, { kind: "frame", frame, host: { ...sampler.host } });
    // the tool waits for a frame with every rate known
    if (frame.cpu && sampler.waiting.length) {
      for (const resolve of sampler.waiting.splice(0)) resolve(frame);
    }
  }

  function makeRoom(principalId: string, except: string) {
    const live = [...samplers.values()]
      .filter((sampler) => sampler.principalId === principalId && sampler.id !== except && running(sampler))
      .sort((a, b) => a.startedAt - b.startedAt);
    while (live.length >= maxLive) pause(live.shift()!, "replaced");
    const kept = [...samplers.values()]
      .filter((sampler) => sampler.principalId === principalId && sampler.id !== except && !running(sampler))
      .sort((a, b) => a.createdAt - b.createdAt);
    while (kept.length && samplers.size > 0 && kept.length + live.length + 1 > KEPT_PER_PERSON) {
      const old = kept.shift()!;
      halt(old);
      samplers.delete(old.id);
    }
  }

  async function begin(sampler: Sampler): Promise<{ error: string } | null> {
    halt(sampler);
    const run = sampler.run;
    let opened: SampleSource | { error: string };
    try {
      opened = await sampler.open();
    } catch {
      opened = { error: "unreachable" };
    }
    if (run !== sampler.run) return { error: "gone" };
    if ("error" in opened) {
      fail(sampler, (opened.error as ResourceErrorCode) || "unreachable");
      return { error: opened.error };
    }
    makeRoom(sampler.principalId, sampler.id);
    sampler.source = opened;
    sampler.state = "starting";
    delete sampler.reason;
    delete sampler.error;
    sampler.startedAt = now();
    sampler.endsAt = sampler.startedAt + runMs;
    const iterations = Math.ceil(runMs / cadenceMs) + 2;
    try {
      sampler.stream = opened.start(
        iterations,
        (chunk) => {
          if (run !== sampler.run) return;
          sampler.buffer += chunk;
          if (sampler.buffer.length > BUFFER_MAX) {
            fail(sampler, "no-data");
            return;
          }
          const { blocks, rest } = splitBlocks(sampler.buffer);
          sampler.buffer = rest;
          for (const block of blocks) {
            if (run !== sampler.run) return;
            onBlock(sampler, block);
          }
        },
        () => {
          if (run !== sampler.run || !running(sampler)) return;
          if (sampler.state === "starting") fail(sampler, "unreachable");
          else if (now() >= (sampler.endsAt ?? 0) - 10_000) pause(sampler, "time");
          else fail(sampler, "dropped");
        },
      );
    } catch {
      fail(sampler, "unreachable");
      return { error: "unreachable" };
    }
    sampler.runTimer = setTimeout(() => {
      sampler.runTimer = undefined;
      pause(sampler, "time");
    }, runMs);
    // nobody opened the card yet: give the chat time to draw it
    armIdle(sampler, sampler.watchers.size ? idleMs : idleMs * 3);
    emitState(sampler);
    return null;
  }

  const owned = (id: string, principalId: string) => {
    const sampler = samplers.get(id);
    return sampler && sampler.principalId === principalId ? sampler : null;
  };

  return {
    async start(input: { principalId: string; botId: string; threadId: string; open: OpenSource }): Promise<{ id: string } | { error: string }> {
      const sampler: Sampler = {
        id: `ru_${randomBytes(9).toString("hex")}`,
        principalId: input.principalId,
        botId: input.botId,
        threadId: input.threadId,
        open: input.open,
        state: "starting",
        host: {},
        frames: [],
        prev: null,
        buffer: "",
        stream: null,
        source: null,
        run: 0,
        startedAt: now(),
        watchers: new Set(),
        waiting: [],
        createdAt: now(),
      };
      samplers.set(sampler.id, sampler);
      const failed = await begin(sampler);
      if (failed) {
        halt(sampler);
        samplers.delete(sampler.id);
        return failed;
      }
      return { id: sampler.id };
    },
    snapshot(id: string, principalId: string): ResourceUsageSnapshot | null {
      const sampler = owned(id, principalId);
      return sampler ? snapshotOf(sampler) : null;
    },
    subscribe(id: string, principalId: string, listener: (event: ResourceStreamEvent) => void): (() => void) | null {
      const sampler = owned(id, principalId);
      if (!sampler) return null;
      sampler.watchers.add(listener);
      if (sampler.idleTimer) {
        clearTimeout(sampler.idleTimer);
        sampler.idleTimer = undefined;
      }
      try {
        listener({ kind: "snapshot", snapshot: snapshotOf(sampler) });
      } catch {
        sampler.watchers.delete(listener);
      }
      return () => {
        sampler.watchers.delete(listener);
        if (sampler.watchers.size === 0 && running(sampler)) armIdle(sampler, idleMs);
      };
    },
    async resume(id: string, principalId: string): Promise<ResourceUsageSnapshot | { error: string } | null> {
      const sampler = owned(id, principalId);
      if (!sampler) return null;
      if (running(sampler)) return snapshotOf(sampler);
      const failed = await begin(sampler);
      return failed ?? snapshotOf(sampler);
    },
    pause(id: string, principalId: string): ResourceUsageSnapshot | null {
      const sampler = owned(id, principalId);
      if (!sampler) return null;
      pause(sampler, "person");
      return snapshotOf(sampler);
    },
    /** The first frame with CPU known, for the bot's short answer. */
    firstFrame(id: string, timeoutMs: number): Promise<ResourceFrame | null> {
      const sampler = samplers.get(id);
      if (!sampler) return Promise.resolve(null);
      const ready = [...sampler.frames].reverse().find((frame) => frame.cpu);
      if (ready) return Promise.resolve(ready);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const index = sampler.waiting.indexOf(done);
          if (index >= 0) sampler.waiting.splice(index, 1);
          resolve(null);
        }, timeoutMs);
        const done = (frame: ResourceFrame | null) => {
          clearTimeout(timer);
          resolve(frame);
        };
        sampler.waiting.push(done);
      });
    },
    /** How many are running now (all people). */
    liveCount(): number {
      return [...samplers.values()].filter(running).length;
    },
    close() {
      for (const sampler of samplers.values()) halt(sampler);
      samplers.clear();
    },
  };
}

export type ResourceSamplers = ReturnType<typeof createResourceSamplers>;
