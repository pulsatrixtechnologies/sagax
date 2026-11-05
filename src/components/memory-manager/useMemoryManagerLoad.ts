import { useCallback, type Dispatch, type SetStateAction } from "react";
import { readableError } from "@/lib/plain-error";
import { fetchMemoryJournal, type MemoryJournalRow } from "@/lib/memory";
import { ApiError } from "@/state/store";
import {
  browseBotSource, browsePerspicax, browseTeamSource, fetchMemoryManagerSources,
  fetchPerspicaxArchived, fetchPerspicaxVocabulary, pxMemory,
  type MemoryBrowse, type MemoryManagerSource, type MemoryNoteRow, type MemoryVocabulary,
} from "@/lib/memory-manager";
import { fetchCollections, type CollectionSummary } from "./MemoryCollections";
import type { TrashRow } from "./memory-manager-types";

export interface MemoryLoadSetters {
  setSources: Dispatch<SetStateAction<MemoryManagerSource[] | null>>;
  setOverviews: Dispatch<SetStateAction<Record<string, MemoryBrowse>>>;
  setOverviewsReady: Dispatch<SetStateAction<boolean>>;
  setJournals: Dispatch<SetStateAction<Record<string, MemoryJournalRow[]>>>;
  setArchivedRaw: Dispatch<SetStateAction<MemoryNoteRow[]>>;
  setVocabulary: Dispatch<SetStateAction<MemoryVocabulary | null>>;
  setTrashRaw: Dispatch<SetStateAction<TrashRow[]>>;
  setCollections: Dispatch<SetStateAction<CollectionSummary[]>>;
  setPxReason: Dispatch<SetStateAction<string | undefined>>;
  setError: Dispatch<SetStateAction<string | null>>;
  bodiesRequested: { current: Set<string> };
}

/** Loads Memory page sources, overviews, journals and Perspicax side lists. */
export function useMemoryManagerLoad(setters: MemoryLoadSetters, sources: MemoryManagerSource[] | null) {
  const {
    setSources, setOverviews, setOverviewsReady, setJournals, setArchivedRaw, setVocabulary,
    setTrashRaw, setCollections, setPxReason, setError, bodiesRequested,
  } = setters;

  const loadOverviews = useCallback(async (list: MemoryManagerSource[]) => {
    // A bot whose memory routes refuse this person (404 "no such bot", 403)
    // is not theirs to open: it leaves the page. The server already leaves such bots out.
    const refused = new Set<string>();
    const entries = await Promise.all(list.map(async (source) => {
      try {
        if (source.kind === "bot" && source.botId) return [source.id, await browseBotSource(source.botId)] as const;
        if (source.kind === "team") return [source.id, await browseTeamSource(source.section ?? "")] as const;
        if (source.kind === "perspicax") return [source.id, await browsePerspicax()] as const;
      } catch (cause) {
        if (source.kind === "bot" && cause instanceof ApiError && (cause.status === 404 || cause.status === 403)) refused.add(source.id);
      }
      return null;
    }));
    const next: Record<string, MemoryBrowse> = {};
    for (const entry of entries) if (entry) next[entry[0]] = entry[1];
    if (refused.size) setSources((current) => current?.filter((source) => !refused.has(source.id)) ?? current);
    setOverviews(next);
    setOverviewsReady(true);
    // The bots' journals: who wrote each file last, when it was created, its versions.
    const botIds = list.filter((source) => source.kind === "bot" && source.botId && !refused.has(source.id)).map((source) => source.botId!);
    const journalEntries = await Promise.all(botIds.map(async (botId) => {
      try { return [botId, (await fetchMemoryJournal(botId, 200)) ?? []] as const; } catch { return [botId, []] as const; }
    }));
    setJournals(Object.fromEntries(journalEntries));
    const px = list.find((source) => source.kind === "perspicax");
    if (px && next[px.id]) {
      void fetchPerspicaxArchived().then(setArchivedRaw).catch(() => setArchivedRaw([]));
      void fetchPerspicaxVocabulary().then(setVocabulary).catch(() => setVocabulary(null));
      void pxMemory<{ notes?: TrashRow[] }>("/trash").then((result) => setTrashRaw(result.notes ?? [])).catch(() => setTrashRaw([]));
      void fetchCollections().then(setCollections).catch(() => setCollections([]));
    }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const result = await fetchMemoryManagerSources();
      setSources(result.sources);
      setPxReason(result.perspicax.available ? undefined : result.perspicax.reason);
      setError(null);
      void loadOverviews(result.sources);
    } catch (cause) {
      setError(readableError(cause));
      setSources([]);
    }
  }, [loadOverviews]);

  const refresh = useCallback(() => {
    bodiesRequested.current.clear();
    if (sources) void loadOverviews(sources);
  }, [sources, loadOverviews]);

  return { loadOverviews, loadSources, refresh };
}
