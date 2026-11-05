// Artifacts on the client (docs/superpowers/specs/2026-10-16-artifacts-design.md):
// the reads and the few changes the person may make (favorite, pop out,
// delete; refresh now), and hooks that stay current from the server's
// `artifacts` frame. The settings themselves are the bot's.
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/state/store";
import { ARTIFACTS_EVENT, type ArtifactsEventDetail } from "@/lib/artifact-events";
import { sortArtifacts, type Artifact, type ArtifactSummary } from "../../shared/artifacts";

const base = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/artifacts`;
const one = (botId: string, id: string) => `${base(botId)}/${encodeURIComponent(id)}`;

export function fetchBotArtifacts(botId: string): Promise<ArtifactSummary[]> {
  return api<{ artifacts?: ArtifactSummary[] }>(base(botId)).then((body) => Array.isArray(body.artifacts) ? body.artifacts : []);
}

export function fetchAllArtifacts(): Promise<ArtifactSummary[]> {
  return api<{ artifacts?: ArtifactSummary[] }>("/api/artifacts").then((body) => Array.isArray(body.artifacts) ? body.artifacts : []);
}

export function fetchArtifact(botId: string, id: string): Promise<Artifact> {
  return api<{ artifact: Artifact }>(one(botId, id)).then((body) => body.artifact);
}

export function setArtifactFlags(botId: string, id: string, flags: { favorite?: boolean; popped?: boolean }): Promise<ArtifactSummary> {
  return api<{ artifact: ArtifactSummary }>(one(botId, id), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(flags) })
    .then((body) => body.artifact);
}

export function deleteArtifact(botId: string, id: string): Promise<void> {
  return api(one(botId, id), { method: "DELETE" }).then(() => undefined);
}

export function refreshArtifact(botId: string, id: string): Promise<Artifact> {
  return api<{ artifact: Artifact }>(`${one(botId, id)}/refresh`, { method: "POST" }).then((body) => body.artifact);
}

/** Runs `onChange` whenever the server says an artifact changed; `botId`
 * narrows it to one bot. */
export function useArtifactsChanged(onChange: (detail: ArtifactsEventDetail) => void, botId?: string): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<ArtifactsEventDetail>).detail;
      if (!detail || (botId && detail.botId !== botId)) return;
      latest.current(detail);
    };
    window.addEventListener(ARTIFACTS_EVENT, listener);
    return () => window.removeEventListener(ARTIFACTS_EVENT, listener);
  }, [botId]);
}

export interface ArtifactList {
  /** null while the first load is in flight. */
  artifacts: ArtifactSummary[] | null;
  error: boolean;
  reload: () => void;
  /** Apply a change the person just made before the server's frame lands. */
  patch: (id: string, change: Partial<ArtifactSummary> | null) => void;
}

function useArtifactList(load: () => Promise<ArtifactSummary[]>, key: string, botId?: string): ArtifactList {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(() => {
    const id = ++request.current;
    void loadRef.current().then((list) => {
      if (id !== request.current) return;
      setArtifacts(sortArtifacts(list));
      setError(false);
    }).catch(() => {
      if (id === request.current) setError(true);
    });
  }, []);
  useEffect(() => {
    setArtifacts(null);
    reload();
    return () => { request.current++; };
  }, [key, reload]);
  useArtifactsChanged(() => reload(), botId);
  const patch = useCallback((id: string, change: Partial<ArtifactSummary> | null) => {
    setArtifacts((current) => current && sortArtifacts(change === null
      ? current.filter((artifact) => artifact.id !== id)
      : current.map((artifact) => artifact.id === id ? { ...artifact, ...change } : artifact)));
  }, []);
  return { artifacts, error, reload, patch };
}

/** One bot's artifacts, newest first with favorites on top. */
export function useBotArtifacts(botId: string): ArtifactList {
  const load = useCallback(() => fetchBotArtifacts(botId), [botId]);
  return useArtifactList(load, `bot:${botId}`, botId);
}

/** Every artifact this viewer may see, across bots (palette, pop-outs). */
export function useAllArtifacts(enabled = true): ArtifactList {
  const load = useCallback(() => enabled ? fetchAllArtifacts() : Promise.resolve([]), [enabled]);
  return useArtifactList(load, enabled ? "all" : "off");
}

/** The open artifact with its document and data, kept current. */
export function useArtifact(botId: string, id: string): { artifact: Artifact | null; error: boolean; gone: boolean } {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState(false);
  const [gone, setGone] = useState(false);
  const request = useRef(0);
  const load = useCallback(() => {
    const ticket = ++request.current;
    void fetchArtifact(botId, id).then((next) => {
      if (ticket !== request.current) return;
      setArtifact(next);
      setError(false);
    }).catch((reason: unknown) => {
      if (ticket !== request.current) return;
      if ((reason as { status?: number } | null)?.status === 404) setGone(true);
      else setError(true);
    });
  }, [botId, id]);
  useEffect(() => {
    setArtifact(null);
    setGone(false);
    load();
    return () => { request.current++; };
  }, [load]);
  useArtifactsChanged((detail) => {
    if (detail.artifactId && detail.artifactId !== id) return;
    if (detail.deleted && detail.artifactId === id) setGone(true);
    else load();
  }, botId);
  return { artifact, error, gone };
}

// ---------------------------------------------------------------------------
// Watch leases: an artifact refreshes while it is open somewhere (its dialog
// or its window) or a favorite (server/artifacts/artifact-refresh.ts). Every mounted
// frame registers here; one request every 45 seconds renews them all.

export const WATCH_RENEW_MS = 45_000;
const watched = new Map<string, number>();
let watchTimer: ReturnType<typeof setInterval> | null = null;

function sendWatch(): void {
  const ids = Array.from(watched.keys());
  if (!ids.length) return;
  void api("/api/artifacts/watch", { method: "POST", body: JSON.stringify({ ids }) }).catch(() => {});
}

/** Holds a lease on `id` while the calling component is mounted. */
export function useArtifactWatch(id: string | null): void {
  useEffect(() => {
    if (!id) return;
    const first = !watched.has(id);
    watched.set(id, (watched.get(id) ?? 0) + 1);
    if (first) sendWatch();
    if (!watchTimer) watchTimer = setInterval(sendWatch, WATCH_RENEW_MS);
    return () => {
      const left = (watched.get(id) ?? 1) - 1;
      if (left > 0) watched.set(id, left);
      else watched.delete(id);
      if (!watched.size && watchTimer) {
        clearInterval(watchTimer);
        watchTimer = null;
      }
    };
  }, [id]);
}

/** Ids with a lease from this window (tests). */
export function watchedArtifactIds(): string[] {
  return Array.from(watched.keys());
}
