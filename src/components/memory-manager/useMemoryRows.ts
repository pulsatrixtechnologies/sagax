import { useCallback, useEffect, useMemo, useRef } from "react";
import { t } from "@/lib/i18n";
import { fetchMemoryDoc, type MemoryJournalRow } from "@/lib/memory";
import { openPerspicaxNote, type MemoryBrowse, type MemoryManagerSource, type MemoryNoteRow } from "@/lib/memory-manager";
import { excerptFromBody, journalFacts, RECENT_MS, rowKey, tierColor, type JournalFacts, type PageRow, type PageTier } from "@/lib/memory-page";
import { MEMORY_INDEX } from "@/lib/memory";
import { fetchCollectionItems, type CollectionItem, type CollectionSummary } from "./MemoryCollections";
import type { Dispatch, SetStateAction } from "react";
import type { Place, TrashRow } from "./memory-manager-types";
import { tierSource, pooled, BODY_PREFETCH } from "./memory-manager-data";

interface MemoryRowsInput {
  sources: MemoryManagerSource[] | null;
  overviews: Record<string, MemoryBrowse>;
  journals: Record<string, MemoryJournalRow[]>;
  bodies: Record<string, string>;
  archivedRaw: MemoryNoteRow[];
  trashRaw: TrashRow[];
  pins: string[];
  place: Place;
  openCollection: { id: string; title: string } | null;
  collections: CollectionSummary[];
  collectionItems: Record<string, CollectionItem[]>;
  overviewsReady: boolean;
  setBodies: Dispatch<SetStateAction<Record<string, string>>>;
  bodiesRequested: { current: Set<string> };
  mounted: { current: boolean };
  setCollectionItems: Dispatch<SetStateAction<Record<string, CollectionItem[]>>>;
  setOpenCollection: Dispatch<SetStateAction<{ id: string; title: string } | null>>;
}

export function useMemoryRows({ sources, overviews, journals, bodies, archivedRaw, trashRaw, pins, place, openCollection, collections, collectionItems, overviewsReady, setBodies, bodiesRequested, mounted, setCollectionItems, setOpenCollection }: MemoryRowsInput) {
  const pxSource = useMemo(() => sources?.find((source) => source.kind === "perspicax") ?? null, [sources]);
  const pxTiers = useMemo(() => (pxSource ? overviews[pxSource.id]?.tiers ?? [] : []), [pxSource, overviews]);
  // A temporary agent's memory folder stays until it is deleted; emptied, it leaves the page.
  const allBotSources = useMemo(() => (sources ?? []).filter((source) => source.kind === "bot" && overviews[source.id]), [sources, overviews]);
  const botSources = useMemo(() => allBotSources.filter((source) => {
    if (source.linked !== false) return true;
    const browse = overviews[source.id]!;
    return (browse.indexBytes ?? 1) > 0 || browse.notes.some((row) => row.path !== MEMORY_INDEX);
  }), [allBotSources, overviews]);
  const teamSources = useMemo(() => (sources ?? []).filter((source) => source.kind === "team" && overviews[source.id]), [sources, overviews]);
  const meTier = pxTiers.find((tier) => tier.kind === "me");

  const tiers = useMemo<PageTier[]>(() => {
    const out: PageTier[] = [];
    if (botSources.length > 0 || meTier) out.push({ key: "mine", name: t("memoryManager.tierMine"), kind: "mine", color: tierColor("mine") });
    let team = 0;
    // A sidebar section with no team note is not a tier of its own (General always is).
    for (const source of teamSources) {
      if (source.section && !(overviews[source.id]?.notes.length)) continue;
      out.push({ key: source.id, name: source.name, kind: "team", color: tierColor("team", team++) });
    }
    for (const tier of pxTiers) {
      if (tier.kind === "me") continue;
      const kind = tier.kind === "org" ? "org" : "team";
      out.push({ key: `perspicax:${tier.scope}`, name: tier.kind === "org" ? t("memoryManager.tierOrg") : tier.name, kind, color: tierColor(kind, kind === "team" ? team++ : 0) });
    }
    return out;
  }, [botSources.length, meTier, teamSources, pxTiers, overviews]);
  const tierByKey = useMemo(() => new Map(tiers.map((tier) => [tier.key, tier])), [tiers]);
  const pxTierKey = useCallback((scope: string | undefined) => {
    const tier = pxTiers.find((entry) => entry.scope === scope);
    return !tier || tier.kind === "me" ? "mine" : `perspicax:${tier.scope}`;
  }, [pxTiers]);

  const factsByBot = useMemo(() => {
    const out: Record<string, Map<string, JournalFacts>> = {};
    for (const [botId, rows] of Object.entries(journals)) out[botId] = journalFacts(rows);
    return out;
  }, [journals]);

  const actorName = useCallback((actor: MemoryJournalRow["actor"] | undefined, botName: string) => {
    if (!actor) return undefined;
    if (actor === "person") return t("memoryManager.authorYou");
    if (actor === "import") return t("memoryManager.authorImport");
    return botName;
  }, []);

  const rows = useMemo<PageRow[]>(() => {
    const out: PageRow[] = [];
    for (const source of botSources) {
      const facts = factsByBot[source.botId ?? ""];
      for (const row of overviews[source.id]!.notes) {
        if (source.linked === false && row.path === MEMORY_INDEX && (overviews[source.id]!.indexBytes ?? 1) === 0) continue;
        const key = rowKey(source, row);
        const fact = row.path ? facts?.get(row.path) : undefined;
        const body = bodies[key];
        const sub = row.folder === "logs" ? t("memoryManager.folderLogs") : row.folder ? t("memoryManager.folderTopics") : "";
        out.push({
          key,
          source,
          tier: "mine",
          folderKey: row.folder ? `${source.id}/${row.folder}` : source.id,
          folderPath: sub ? `${source.name} / ${sub}` : source.name,
          row: {
            ...row,
            updatedAt: row.updatedAt ?? fact?.lastAt,
            createdAt: fact?.createdAt,
            author: actorName(fact?.lastActor, source.name),
            excerpt: body != null ? excerptFromBody(body) || undefined : row.excerpt,
          },
        });
      }
    }
    for (const source of teamSources) {
      for (const row of overviews[source.id]!.notes) {
        out.push({ key: rowKey(source, row), source, tier: source.id, folderKey: `${source.id}/${row.folder || "term"}`, folderPath: row.folder || "term", row });
      }
    }
    if (pxSource && overviews[pxSource.id]) {
      for (const row of overviews[pxSource.id]!.notes) {
        const tier = pxTiers.find((entry) => entry.scope === row.scope);
        const source = tier ? tierSource(pxSource, tier) : pxSource;
        out.push({ key: rowKey(pxSource, { id: `${row.scope}/${row.id}` }), source, tier: pxTierKey(row.scope), folderKey: `px:${row.scope}/${row.folder}`, folderPath: row.folder ?? "", row });
      }
    }
    return out;
  }, [botSources, teamSources, pxSource, pxTiers, overviews, factsByBot, bodies, actorName, pxTierKey]);
  const rowByKey = useMemo(() => new Map(rows.map((entry) => [entry.key, entry])), [rows]);

  const pxRows = useCallback((list: MemoryNoteRow[], archived: boolean): PageRow[] => {
    if (!pxSource) return [];
    return list.map((row) => {
      const tier = pxTiers.find((entry) => entry.scope === row.scope);
      return {
        key: `${archived ? "archived" : "trash"}|${row.scope}/${row.id}`,
        source: tier ? tierSource(pxSource, tier) : pxSource,
        tier: pxTierKey(row.scope),
        folderKey: `px:${row.scope}/${row.folder}`,
        folderPath: row.folder ?? "",
        row,
      };
    });
  }, [pxSource, pxTiers, pxTierKey]);
  const archivedRows = useMemo(() => pxRows(archivedRaw, true), [pxRows, archivedRaw]);
  // A bot's deleted notes: the journal keeps their text, a revert puts them back.
  const botTrashRows = useMemo<PageRow[]>(() => {
    const out: PageRow[] = [];
    for (const source of allBotSources) {
      const present = new Set(overviews[source.id]!.notes.map((row) => row.path));
      const seen = new Set<string>();
      for (const entry of journals[source.botId ?? ""] ?? []) {
        if (seen.has(entry.path)) continue;
        seen.add(entry.path);
        if (entry.kind !== "deleted" || !entry.canRevert || present.has(entry.path)) continue;
        const title = entry.path.split("/").pop()?.replace(/\.md$/i, "") || entry.path;
        out.push({
          key: `trash|bot:${source.botId}|${entry.id}`,
          source,
          tier: "mine",
          folderKey: source.id,
          folderPath: source.name,
          row: { id: entry.id, title, path: entry.path, updatedAt: entry.at, archived: true },
        });
      }
    }
    return out;
  }, [allBotSources, overviews, journals]);
  const pxTrashRows = useMemo(() => pxRows(trashRaw.map((row) => ({
    id: row.id,
    title: row.title,
    scope: row.scope,
    folder: row.topic,
    tags: row.tags ?? [],
    author: row.author_name || undefined,
    updatedAt: row.deleted_at ? Date.parse(row.deleted_at) : undefined,
    archived: true,
    status: row.may_manage === false ? "locked" : undefined,
  })), false), [pxRows, trashRaw]);
  const trashRows = useMemo(() => [...pxTrashRows, ...botTrashRows], [pxTrashRows, botTrashRows]);

  // Bodies, in the background: excerpts of the bots' notes, [[links]] for the map and the backlinks.
  useEffect(() => {
    if (!overviewsReady) return;
    const fromTeams: Record<string, string> = {};
    for (const source of teamSources) {
      const teamBodies = overviews[source.id]?.bodies ?? {};
      for (const row of overviews[source.id]!.notes) if (teamBodies[row.id] != null) fromTeams[rowKey(source, row)] = teamBodies[row.id]!;
    }
    // Only a team text that changed is set again: an unchanged one would loop rows → bodies → rows.
    if (Object.entries(fromTeams).some(([key, text]) => bodies[key] !== text)) setBodies((current) => ({ ...current, ...fromTeams }));
    const wanted = rows.filter((entry) => entry.source.kind !== "team" && !bodiesRequested.current.has(entry.key)).slice(0, BODY_PREFETCH);
    if (!wanted.length) return;
    for (const entry of wanted) bodiesRequested.current.add(entry.key);
    let batch: Record<string, string> = {};
    const flush = () => {
      if (!mounted.current || !Object.keys(batch).length) return;
      const ready = batch;
      batch = {};
      setBodies((current) => ({ ...current, ...ready }));
    };
    void pooled(wanted, 6, async (entry) => {
      try {
        if (entry.source.kind === "bot" && entry.source.botId && entry.row.path) batch[entry.key] = (await fetchMemoryDoc(entry.source.botId, entry.row.path)).text;
        else if (entry.source.kind === "perspicax" && entry.row.scope) batch[entry.key] = (await openPerspicaxNote(entry.row.scope, entry.row.id)).body;
      } catch {
        /* one note that does not answer keeps the others */
      }
      if (Object.keys(batch).length >= 24) flush();
    }).then(flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `bodies` is read to skip a set, not a trigger
  }, [overviewsReady, rows, teamSources, overviews]);

  // ---- places --------------------------------------------------------------------------

  const counts = useMemo(() => {
    const cutoff = Date.now() - RECENT_MS;
    return {
      all: rows.length,
      teams: rows.filter((entry) => tierByKey.get(entry.tier)?.kind === "team").length,
      pinned: rows.filter((entry) => pins.includes(entry.key)).length,
      recent: rows.filter((entry) => (entry.row.updatedAt ?? 0) >= cutoff).length,
      review: rows.filter((entry) => entry.row.status === "proposed").length + pxTiers.reduce((sum, tier) => sum + (tier.pending ?? 0), 0),
    };
  }, [rows, tierByKey, pins, pxTiers]);

  const placeRows = useMemo<PageRow[]>(() => {
    if (place.kind === "all") return rows;
    if (place.kind === "teams") return rows.filter((entry) => tierByKey.get(entry.tier)?.kind === "team");
    if (place.kind === "pinned") return rows.filter((entry) => pins.includes(entry.key));
    if (place.kind === "recent") {
      const cutoff = Date.now() - RECENT_MS;
      return rows.filter((entry) => (entry.row.updatedAt ?? 0) >= cutoff);
    }
    if (place.kind === "review") return rows.filter((entry) => entry.row.status === "proposed");
    if (place.kind === "archived") return archivedRows;
    if (place.kind === "trash") return trashRows;
    if (place.kind === "collections") {
      // The union of every collection's notes, or the opened collection's only.
      const ids = openCollection ? [openCollection.id] : collections.map((entry) => entry.id);
      const keys = new Set(ids.flatMap((id) => (collectionItems[id] ?? []).map((item) => `perspicax|${item.note_scope}/${item.note_id}`)));
      return rows.filter((entry) => keys.has(entry.key));
    }
    if (place.kind === "tier") return rows.filter((entry) => entry.tier === place.tier);
    if (place.kind !== "folder") return rows;
    const folder = place.folder;
    return rows.filter((entry) => entry.folderKey === folder || entry.folderKey.startsWith(`${folder}/`));
  }, [place, rows, tierByKey, pins, archivedRows, trashRows, openCollection, collections, collectionItems]);

  // The Collections scope: every collection's notes not loaded yet.
  // 2026-11-03 (audit N-6): each collection is asked once, four at a time;
  // a select while they load (it stores the picked one's items) used to
  // cancel the batch and ask every missing collection again.
  const collectionsLoading = useRef(new Set<string>());
  useEffect(() => {
    if (place.kind !== "collections") return;
    const missing = collections.filter((entry) => !(entry.id in collectionItems) && !collectionsLoading.current.has(entry.id));
    if (missing.length === 0) return;
    for (const entry of missing) collectionsLoading.current.add(entry.id);
    void pooled(missing, 4, async (entry) => {
      const items = await fetchCollectionItems(entry.id).catch(() => [] as CollectionItem[]);
      collectionsLoading.current.delete(entry.id);
      // a select meanwhile stored a fresher copy: it stays
      setCollectionItems((current) => (entry.id in current ? current : { ...current, [entry.id]: items }));
    });
  }, [place.kind, collections, collectionItems]);
  useEffect(() => { if (place.kind !== "collections") setOpenCollection(null); }, [place.kind]);

  return { pxSource, pxTiers, botSources, teamSources, meTier, tiers, tierByKey, pxTierKey, factsByBot, rows, rowByKey, archivedRows, pxTrashRows, trashRows, counts, placeRows };
}
