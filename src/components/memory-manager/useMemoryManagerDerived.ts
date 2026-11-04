import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { api } from "@/state/store";
import type { MemoryJournalRow } from "@/lib/memory";
import {
  openPerspicaxNote,
  pxMemory,
  type MemoryManagerSource,
  type MemoryNoteDetail,
  type MemoryTierRow,
  type MemoryVocabulary,
} from "@/lib/memory-manager";
import {
  activeSeries,
  backlinksTo,
  linksOut,
  qualityStats,
  tagStats,
  writeSeries,
  type PageLink,
  type PageRow,
  type PageTier,
} from "@/lib/memory-page";
import type { ImportWriters } from "@/lib/memory-import";
import type { ImportDestination } from "./MemoryImportDialog";
import type { ListTemplate } from "./MemoryNotesList";
import type { Place } from "./memory-manager-types";
import type { Target } from "./useMemoryManagerActions";

export interface MemoryDerivedInput {
  place: Place;
  tiers: PageTier[];
  tierByKey: Map<string, PageTier>;
  rows: PageRow[];
  botSources: MemoryManagerSource[];
  rowByKey: Map<string, PageRow>;
  defaultTarget: () => { target?: Target; folder?: string };
  startCreate: (target?: Target, folder?: string, options?: { newFolder?: boolean; title?: string; body?: string }) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  note: MemoryNoteDetail | null;
  noteEntry: PageRow | null;
  preview: { entry: PageRow; detail: MemoryNoteDetail | null } | null;
  bodies: Record<string, string>;
  placeRows: PageRow[];
  vocabulary: MemoryVocabulary | null;
  journals: Record<string, MemoryJournalRow[]>;
  pxSource: MemoryManagerSource | null;
  pxTiers: MemoryTierRow[];
  archivedRows: PageRow[];
  counts: { review: number };
  openCollection: { id: string; title: string } | null;
  targets: Target[];
  sources: MemoryManagerSource[] | null;
  overviewsReady: boolean;
  createTarget: string;
}

/** List title, scope stats, links and import destinations for the Memory page. */
export function useMemoryManagerDerived(input: MemoryDerivedInput) {
  const {
    place, tiers, tierByKey, rows, botSources, rowByKey, defaultTarget, startCreate, setError,
    note, noteEntry, preview, bodies, placeRows, vocabulary, journals, pxSource, pxTiers,
    archivedRows, counts, openCollection, targets, sources, overviewsReady, createTarget,
  } = input;

  const placeText = (): [string, string] => {
    switch (place.kind) {
      case "all": return [t("memoryManager.nav.all"), t("memoryManager.nav.allHint")];
      case "teams": return [t("memoryManager.nav.teams"), t("memoryManager.nav.teamsHint")];
      case "pinned": return [t("memoryManager.nav.pinned"), t("memoryManager.nav.pinnedHint")];
      case "recent": return [t("memoryManager.nav.recent"), t("memoryManager.nav.recentHint")];
      case "review": return [t("memoryManager.nav.review"), t("memoryManager.nav.reviewHint")];
      case "archived": return [t("memoryManager.nav.archived"), t("memoryManager.nav.archivedHint")];
      case "trash": return [t("memoryManager.nav.trash"), t("memoryManager.trashHint")];
      case "collections": return [t("memoryManager.collections.title"), t("memoryManager.collections.hint")];
      case "tier": {
        const tier = tierByKey.get(place.tier);
        return [tier?.name ?? "", place.tier === "mine" ? t("memoryManager.tierMineHint") : t("memoryManager.tierHint", { tier: tier?.name ?? "" })];
      }
      case "folder": {
        const tier = tierByKey.get(place.tier);
        const entry = rows.find((row) => row.folderKey === place.folder || row.folderKey.startsWith(`${place.folder}/`));
        const name = place.folder.startsWith("px:") ? place.folder.slice(place.folder.indexOf("/") + 1)
          : botSources.find((source) => source.id === place.folder)?.name
            ?? (entry && place.folder !== entry.folderKey ? entry.source.name : entry?.folderPath)
            ?? place.folder.slice(place.folder.lastIndexOf("/") + 1);
        return [name, t("memoryManager.folderHint", { tier: tier?.name ?? "" })];
      }
    }
  };
  const [listTitle, listLine] = placeText();
  const templates: ListTemplate[] = rows.filter((entry) => entry.source.kind === "perspicax" && entry.row.folder === "templates").map((entry) => ({ key: entry.key, title: entry.row.title }));
  const fromTemplate = async (template: ListTemplate) => {
    const entry = rowByKey.get(template.key);
    if (!entry?.row.scope) return;
    try {
      const detail = await openPerspicaxNote(entry.row.scope, entry.row.id);
      const { target, folder } = defaultTarget();
      startCreate(target, folder, { title: detail.title, body: detail.body });
    } catch (cause) {
      setError(readableError(cause));
    }
  };
  const canNewHere = place.kind === "all" || place.kind === "tier" || place.kind === "folder" ? Boolean(defaultTarget().target) : false;

  const noteTier = noteEntry ? tierByKey.get(noteEntry.tier) : undefined;
  const linksFor = useCallback((note: MemoryNoteDetail | null, noteEntry: PageRow | null): { out: PageLink[]; back: PageLink[] } => {
    if (!note || !noteEntry) return { out: [], back: [] };
    if (noteEntry.source.kind === "perspicax" && (note.linksOut || note.backlinks)) {
      const toKey = (link: { scope?: string; id: string }) => `perspicax|${link.scope}/${link.id}`;
      return {
        out: (note.linksOut ?? []).map((link) => ({ key: toKey(link), title: link.title })),
        back: (note.backlinks ?? []).map((link) => ({ key: toKey(link), title: link.title, context: link.context ?? undefined })),
      };
    }
    return { out: linksOut(note.body, rows, noteEntry.key), back: backlinksTo(note.title, rows, bodies, noteEntry.key) };
  }, [rows, bodies]);
  const noteLinks = useMemo(() => linksFor(note, noteEntry), [linksFor, note, noteEntry]);
  const previewLinks = useMemo(() => linksFor(preview?.detail ?? null, preview?.entry ?? null), [linksFor, preview]);

  const scoped = place.kind !== "all";
  const scopeRows = placeRows;
  const scopeKeys = useMemo(() => new Set(scopeRows.map((entry) => entry.key)), [scopeRows]);
  const scopeTiers = useMemo(() => (scoped ? tiers.filter((tier) => scopeRows.some((entry) => entry.tier === tier.key)) : tiers), [scoped, tiers, scopeRows]);
  const stats = useMemo(() => tagStats(scopeRows, vocabulary), [scopeRows, vocabulary]);
  const allJournal = useMemo(() => Object.values(journals).flat(), [journals]);
  const scopeJournal = useMemo(() => (scoped ? allJournal.filter((row) => scopeKeys.has(`bot:${row.botId}|${row.path}`)) : allJournal), [scoped, allJournal, scopeKeys]);
  const scopeArchived = useMemo<number | null>(() => {
    if (!pxSource) return null;
    if (!scoped) return pxTiers.reduce((sum, tier) => sum + (tier.archived ?? 0), 0);
    if (place.kind === "archived") return archivedRows.length;
    if (place.kind === "tier") return archivedRows.filter((entry) => entry.tier === place.tier).length;
    if (place.kind === "folder") return archivedRows.filter((entry) => entry.folderKey === place.folder || entry.folderKey.startsWith(`${place.folder}/`)).length;
    return null;
  }, [pxSource, scoped, place, pxTiers, archivedRows]);
  const scopeReview = scoped ? scopeRows.filter((entry) => entry.row.status === "proposed").length : counts.review;
  const quality = useMemo(() => qualityStats(scopeRows, scopeArchived, scopeReview, Date.now(), stats), [scopeRows, scopeArchived, scopeReview, stats]);
  const active = useMemo(() => activeSeries(scopeRows, scopeTiers.map((tier) => tier.key), Date.now()), [scopeRows, scopeTiers]);
  const writes = useMemo(() => writeSeries(scopeJournal, Date.now()), [scopeJournal]);
  const scopeLabel = (() => {
    if (place.kind === "collections" && openCollection) return `${listTitle} / ${openCollection.title}`;
    if (place.kind !== "folder") return listTitle;
    const bot = botSources.find((source) => source.id === place.folder);
    if (bot) return bot.name;
    const owner = botSources.find((source) => place.folder.startsWith(`${source.id}/`));
    if (owner) return `${owner.name} / ${listTitle}`;
    const tier = tierByKey.get(place.tier);
    return tier && tier.name !== listTitle ? `${tier.name} / ${listTitle}` : listTitle;
  })();

  const importDestinations = useMemo<ImportDestination[]>(() => targets.filter((target) => target.source.kind !== "team").map((target) => {
    if (target.source.kind === "bot" && target.source.botId) {
      const sourceId = target.source.id;
      return {
        id: target.id,
        label: target.label,
        target: { kind: "bot" as const, botId: target.source.botId },
        folders: [],
        existing: rows.filter((entry) => entry.source.id === sourceId && entry.row.path?.startsWith("memory/")).map((entry) => ({ folder: "", title: entry.row.title, body: bodies[entry.key] })),
      };
    }
    const scope = target.id.slice(3);
    return {
      id: target.id,
      label: target.label,
      target: { kind: "perspicax" as const, scope },
      folders: target.folders,
      existing: rows.filter((entry) => entry.source.kind === "perspicax" && entry.row.scope === scope).map((entry) => ({ folder: entry.row.folder ?? "", title: entry.row.title, body: bodies[entry.key], id: entry.row.id })),
    };
  }), [targets, rows, bodies]);
  const importWriters = useMemo<ImportWriters>(() => ({
    bot: (botId, body) => api(`/api/bots/${botId}/memory/import`, { method: "POST", body: JSON.stringify(body) }),
    pxCreate: (note) => pxMemory("/entry", { method: "POST", body: JSON.stringify(note) }),
    pxUpdate: (note) => pxMemory("/entry", { method: "PUT", body: JSON.stringify(note) }),
  }), []);

  const loading = sources === null || (sources.length > 0 && !overviewsReady);
  const createTargetRow = targets.find((entry) => entry.id === createTarget);

  return {
    listTitle, listLine, templates, fromTemplate, canNewHere, noteTier, noteLinks, previewLinks,
    scoped, scopeRows, scopeTiers, stats, scopeJournal, scopeReview, quality, active, writes, scopeLabel,
    importDestinations, importWriters, loading, createTargetRow,
  };
}
