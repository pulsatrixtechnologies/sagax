// The card's live state: one EventSource while the card is on screen and its
// run is live, nothing otherwise. Leaving the screen closes the stream, and
// the server pauses a run nobody watches (server/resource-usage/sampler.ts).
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { ResourceStreamEvent, ResourceUsageSnapshot } from "../../../shared/resource-usage";
import { api } from "@/state/store";
import { applyEvent } from "./resource-usage-model";

const path = (id: string, action?: string) => `/api/resource-usage/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;

/** True while the element is (even partly) on screen. No observer: always true. */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setVisible(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}

export function useResourceUsage(id: string, visible: boolean) {
  const [snapshot, setSnapshot] = useState<ResourceUsageSnapshot | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = !snapshot || snapshot.state === "starting" || snapshot.state === "live";
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!visible || gone || !running || typeof EventSource === "undefined") return;
    const source = new EventSource(path(id, "live"));
    source.onmessage = (message) => {
      let event: ResourceStreamEvent;
      try {
        event = JSON.parse(String(message.data)) as ResourceStreamEvent;
      } catch {
        return;
      }
      if (event.kind === "state" && event.error === "gone") {
        // an ended card, or someone else's: same answer, and no reconnect loop
        source.close();
        setGone(true);
        return;
      }
      setSnapshot((current) => applyEvent(current, event));
    };
    return () => source.close();
  }, [id, visible, gone, running]);

  const act = useCallback(async (action: "resume" | "pause") => {
    setBusy(true);
    try {
      const answer = await api(path(id, action), { method: "POST" }) as { snapshot?: ResourceUsageSnapshot };
      if (alive.current && answer?.snapshot) setSnapshot(answer.snapshot);
    } catch (error) {
      if (!alive.current) return;
      const status = (error as { status?: number }).status;
      const code = error instanceof Error ? error.message : "";
      if (status === 404 || code === "gone") setGone(true);
      else setSnapshot((current) => current ? { ...current, state: "error", error: code === "forbidden" ? "forbidden" : "unreachable" } : current);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [id]);

  return {
    snapshot,
    gone,
    busy,
    resume: () => act("resume"),
    pause: () => act("pause"),
  };
}
