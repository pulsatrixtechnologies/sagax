// Live SSE + initial snapshot hydration for StoreProvider (#1383).
import { useEffect } from "react";
import { flushSync } from "react-dom";
import type { ServerFrame } from "../../../shared/wire";
import { openLiveEvents, publishLiveFrame, publishMissedFrames } from "@/lib/live-events";
import { loadServerFeatures, noteRoutinesListing } from "@/lib/server-features";
import { readLastConversation } from "@/lib/last-conversation";
import { foldLiveFrame } from "./fold-live-frame";
import {
  liveCallFromFrame,
  nextLiveCallLookup,
  type Action,
  type AppState,
  type BotAnnouncement,
} from "./model";
import {
  MESSAGE_PAGE_SIZE,
  api,
  loadSnapshotBoundary,
  normalizeSnapshotFailure,
} from "./api";

export type UseStoreLiveArgs = {
  stateRef: { current: AppState };
  rawDispatch: (action: Action) => void;
  dispatch: (action: Action) => void;
  clearStream: (threadId: string) => void;
  flushDeltas: () => void;
  resetStreams: () => void;
  deltaBuffer: {
    push: (threadId: string, kind: string, delta: string) => void;
    dispose: () => void;
  };
  withTaskWrites: (bot: BotAnnouncement) => BotAnnouncement;
  botPatchQueue: {
    overlayFor: (botId: string) => Partial<BotAnnouncement>;
    cancel: (botId: string) => void;
  };
  showThreadsRef: { current: boolean };
};

export function useStoreLive(args: UseStoreLiveArgs): void {
  const {
    stateRef,
    rawDispatch,
    dispatch,
    clearStream,
    flushDeltas,
    resetStreams,
    deltaBuffer,
    withTaskWrites,
    botPatchQueue,
    showThreadsRef,
  } = args;

  // ── initial load + SSE fold ──────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    type PeripheralKey = "instances" | "config" | "routines" | "serverFeatures" | "webhooks";
    type PeripheralPart = {
      key: PeripheralKey;
      request: () => Promise<() => void>;
    };
    type PeripheralRefresh = {
      attempt: number;
      generation: number;
      timer: ReturnType<typeof setTimeout> | null;
      version: number;
    };
    const peripheralRefresh = new Map<PeripheralKey, PeripheralRefresh>();
    const refreshState = (key: PeripheralKey) => {
      let current = peripheralRefresh.get(key);
      if (!current) {
        current = { attempt: 0, generation: 0, timer: null, version: 0 };
        peripheralRefresh.set(key, current);
      }
      return current;
    };
    const peripheralParts: PeripheralPart[] = [
      {
        key: "instances",
        request: async () => {
          const { instances } = await api("/api/instances");
          return () => rawDispatch({ type: "instances", instances });
        },
      },
      {
        key: "config",
        request: async () => {
          const config = await api("/api/config");
          return () => rawDispatch({ type: "configStatus", config });
        },
      },
      {
        key: "routines",
        request: async () => {
          const listing = await api("/api/routines");
          const { routines, runs, folders } = listing;
          // A server from before routine folders sends no `folders`.
          noteRoutinesListing(listing);
          return () => rawDispatch({ type: "routinesHydrated", routines, runs, ...(folders && typeof folders === "object" ? { folders } : {}) });
        },
      },
      {
        // What this server serves (its descriptor's feature list), so a
        // newer app hides what an older server lacks (2026-10-28).
        key: "serverFeatures",
        request: async () => {
          await loadServerFeatures();
          return () => {};
        },
      },
      ...(window.ogb?.remoteClient?.active ? [] : [{
        key: "webhooks",
        request: async () => {
          const { webhooks, attempts, ingress, graphConnectors } = await api("/api/webhooks");
          return () =>
            rawDispatch({ type: "webhooksHydrated", webhooks, attempts: attempts ?? [], ingress, graphConnectors: graphConnectors ?? [] });
        },
      } satisfies PeripheralPart]),
    ];
    const partByKey = new Map(peripheralParts.map((part) => [part.key, part]));
    const schedulePeripheralRetry = (part: PeripheralPart, error?: Error) => {
      if (!alive) return;
      const refresh = refreshState(part.key);
      if (refresh.timer) return;
      if (error !== undefined) {
        if (part.key === "routines") rawDispatch({ type: "routinesLoadFailed" });
        console.warn(`snapshot: ${part.key} refresh failed; retrying`, error);
      }
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(refresh.attempt, 5));
      refresh.attempt += 1;
      refresh.timer = setTimeout(() => {
        refresh.timer = null;
        void loadPeripheral(part, true).catch((nextError) => schedulePeripheralRetry(part, nextError));
      }, delay);
    };
    const loadPeripheral = async (part: PeripheralPart, protectLiveFrames: boolean): Promise<void> => {
      const refresh = refreshState(part.key);
      if (refresh.timer) {
        clearTimeout(refresh.timer);
        refresh.timer = null;
      }
      const generation = ++refresh.generation;
      const version = refresh.version;
      try {
        const apply = await part.request();
        if (!alive || refresh.generation !== generation) return;
        // A background retry must never replace a live patch that arrived
        // after its request began. Discard that stale response and try again
        // from the newer event boundary instead.
        if (protectLiveFrames && refresh.version !== version) {
          schedulePeripheralRetry(part);
          return;
        }
        apply();
        refresh.attempt = 0;
      } catch (error) {
        // A newer refresh owns this lane now; its result will decide whether
        // another retry is needed.
        if (!alive || refresh.generation !== generation) return;
        throw normalizeSnapshotFailure(error);
      }
    };
    const bumpPeripheralVersion = (...keys: PeripheralKey[]) => {
      for (const key of keys) refreshState(key).version += 1;
    };
    const loadAll = async (): Promise<boolean> => {
      // The Live call snapshot is its own fire-and-forget request: a server
      // without the route answers 404, and the catch keeps that silent — a
      // running call still arrives moments later over the SSE `live.call`
      // frame, so this is only for the case where one was already live
      // before this window connected.
      // Applied only if no live.call frame lands while it is out (a frame
      // is newer news than this answer), and only if the answer to a later
      // lookup did not come back first. Rendered at once, like a frame.
      const since = stateRef.current.liveCallVersion;
      const seq = nextLiveCallLookup();
      void api<unknown>("/api/live/call")
        .then((body) => {
          const answer = liveCallFromFrame(body);
          if (alive && answer) flushSync(() => rawDispatch({ type: "liveCallLookup", call: answer.call, since, seq }));
        })
        .catch(() => {});
      const chat = () =>
        api(`/api/bots?messages=${MESSAGE_PAGE_SIZE}`).then(({ bots, groups, sections, computerControl, botQueuedMessages }) => {
          if (!alive) return;
          rawDispatch({
            type: "hydrate",
            bots,
            groups: groups ?? [],
            sections: sections ?? [],
            computerControl: computerControl ?? {},
            botQueuedMessages,
            resumeId: readLastConversation() ?? undefined,
          });
        });
      const peripherals = peripheralParts.map((part) => ({
        key: part.key,
        load: () => loadPeripheral(part, false),
      }));
      const chatReady = await loadSnapshotBoundary(chat, peripherals, (failed, error) => {
        const part = partByKey.get(failed.key);
        if (part) schedulePeripheralRetry(part, error);
      });
      return alive && chatReady;
    };

    // A snapshot and the live fold have to meet at a defined boundary. Start
    // hydration only after the stream says hello, queue frames that arrive
    // while the REST snapshot is in flight, then apply them on top. Otherwise
    // a late hydrate can overwrite a newer event, or an event can land between
    // an eager request and the stream opening and disappear entirely.
    let hydrated = false;
    let hydrationPromise: Promise<boolean> | null = null;
    let rehydrateRequested = false;
    const pendingFrames: ServerFrame[] = [];
    let handleFrame: (frame: ServerFrame) => void;
    const hydrate = (): Promise<boolean> => {
      if (hydrationPromise) {
        // A second non-resumable hello means this snapshot may have started
        // before another connection gap. Run one more after it settles.
        rehydrateRequested = true;
        return hydrationPromise;
      }
      hydrated = false;
      // Clear before the REST round-trip: the snapshot replaces transcripts
      // but never the out-of-reducer live map, and pending rAF deltas must
      // not resurrect the truncated answer after we emptied it (#1749).
      resetStreams();
      hydrationPromise = (async () => {
        let loaded = false;
        do {
          rehydrateRequested = false;
          loaded = await loadAll();
        } while (alive && rehydrateRequested);
        if (!alive || !loaded) return false;
        hydrated = true;
        for (const frame of pendingFrames.splice(0)) handleFrame(frame);
        return true;
      })().finally(() => {
        hydrationPromise = null;
      });
      return hydrationPromise;
    };
    // If SSE is unavailable, the app should still show its saved state. A
    // later first hello hydrates again because it cannot prove there was no
    // gap before that connection opened.
    const hydrationFallback = setTimeout(hydrate, 1_000);

    // The hydrate decision belongs to the hello frame, not to onopen: the
    // server replays what we missed when it can, and re-downloading every
    // transcript on a reconnect it already covered is pure waste.
    handleFrame = (frame) => {
      if (frame.kind === "config") bumpPeripheralVersion("config", "instances");
      else if (frame.kind === "routine" || frame.kind === "routine.deleted" || frame.kind === "routine.run" || frame.kind === "routine.folders") {
        bumpPeripheralVersion("routines");
      } else if (
        frame.kind === "webhook" ||
        frame.kind === "webhook.attempt" ||
        frame.kind === "webhook.deleted"
      ) {
        bumpPeripheralVersion("webhooks");
      }
foldLiveFrame(frame, {
        rawDispatch,
        dispatch,
        stateRef,
        clearStream,
        flushDeltas,
        deltaBuffer,
        withTaskWrites,
        botPatchQueue,
        showThreadsRef,
        refreshInstancesPeripheral: () => {
          const instances = partByKey.get("instances");
          if (instances) {
            void loadPeripheral(instances, true).catch((error) =>
              schedulePeripheralRetry(instances, error),
            );
          }
        },
      });
    };
    const stopLive = openLiveEvents({
      onOpen: () => rawDispatch({ type: "connected", value: true }),
      onError: () => rawDispatch({ type: "connected", value: false }),
      onSnapshotRequired: () => {
        clearTimeout(hydrationFallback);
        publishMissedFrames();
        // Frames buffered before this non-resumable stream belong to an
        // abandoned generation. Keep the new generation behind hydrate().
        pendingFrames.splice(0);
        return hydrate();
      },
      onFrame: (frame) => {
        // Open panels read what the store does not keep (live screens, raw
        // runtime events) from this same stream.
        publishLiveFrame(frame as ServerFrame);
        if (hydrated) handleFrame(frame as ServerFrame);
        else pendingFrames.push(frame as ServerFrame);
      },
    });
    return () => {
      alive = false;
      deltaBuffer.dispose();
      clearTimeout(hydrationFallback);
      for (const refresh of peripheralRefresh.values()) {
        if (refresh.timer) clearTimeout(refresh.timer);
      }
      stopLive();
    };
  }, []);
}
