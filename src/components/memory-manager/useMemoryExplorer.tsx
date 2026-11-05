import { useMemo } from "react";
import { Archive, BookOpen, Clock3, CircleCheck, FileText, FolderInput, Loader2, NotebookText, Pin, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { MemoryBrowse, MemoryManagerSource, MemoryTierRow } from "@/lib/memory-manager";
import type { PageRow } from "@/lib/memory-page";
import { botSourceLink, isLinked, pxFolderLink, teamFolderLink, type LinkBot, type LinkRoutine } from "@/lib/memory-folders";
import type { CollectionSummary } from "./MemoryCollections";
import { LinkMark } from "./memory-manager-helpers";
import type { Place } from "./memory-manager-types";
import type { Target } from "./useMemoryManagerActions";
import { FIELD, Swatch } from "./memory-ui";
import type { MemoryFolderMenu, MemoryRowAction, MemorySidebarFolder, MemorySidebarNav, MemorySidebarTier } from "./MemorySidebar";

export interface MemoryExplorerInput {
  sources: MemoryManagerSource[] | null;
  overviews: Record<string, MemoryBrowse>;
  overviewsReady: boolean;
  pxSource: MemoryManagerSource | null;
  pxTiers: MemoryTierRow[];
  botSources: MemoryManagerSource[];
  teamSources: MemoryManagerSource[];
  meTier: MemoryTierRow | undefined;
  tiers: Array<{ key: string; name: string; kind: string; color: string }>;
  tierByKey: Map<string, { key: string; name: string; kind: string; color: string }>;
  rows: PageRow[];
  counts: Record<string, number>;
  archivedRows: PageRow[];
  trashRows: PageRow[];
  collections: CollectionSummary[];
  place: Place;
  pins: string[];
  targets: Target[];
  switcherOpen: boolean;
  switcherQuery: string;
  switcherRef: { current: HTMLInputElement | null };
  linkBots: LinkBot[];
  linkRoutines: LinkRoutine[];
  pxReason: string | undefined;
  goPlace: (next: Place, toNotes?: boolean) => void;
  startCreate: (target?: Target, folder?: string, options?: { newFolder?: boolean; title?: string; body?: string }) => void;
  setRenaming: (key: string | null) => void;
  setImportOpen: (open: boolean) => void;
  setSwitcherOpen: (open: boolean) => void;
  setSwitcherQuery: (q: string) => void;
  openNote: (entry: PageRow, edit?: boolean) => void | Promise<void>;
  renamePxFolder: (scope: string, from: string, to: string) => void | Promise<void>;
  deletePxFolder: (scope: string, folder: string) => void | Promise<void>;
  deleteBotFolder: (source: MemoryManagerSource) => void | Promise<void>;
  folderMenu: (link: import("@/lib/memory-folders").FolderLink, remove: (() => void) | null, blocked?: string) => MemoryFolderMenu;
  linkTitle: (link: import("@/lib/memory-folders").FolderLink) => string;
}

/** Sidebar explorer model and note switcher for the Memory page. */
export function useMemoryExplorer(input: MemoryExplorerInput) {
  const {
    sources, overviews, overviewsReady, pxSource, pxTiers, botSources, teamSources, meTier, tiers, tierByKey,
    rows, counts, archivedRows, trashRows, collections, place, pins, targets, switcherOpen, switcherQuery,
    switcherRef, linkBots, linkRoutines, pxReason, goPlace, startCreate, setRenaming, setImportOpen,
    setSwitcherOpen, setSwitcherQuery, openNote, renamePxFolder, deletePxFolder, deleteBotFolder, folderMenu, linkTitle,
  } = input;

  // ---- the explorer --------------------------------------------------------------------

  // The folder stays selected while one of its notes is read.
  const current = (next: Place) => JSON.stringify(next) === JSON.stringify(place);
  const lists: MemorySidebarNav[] = [
    { id: "all", label: t("memoryManager.nav.all"), icon: NotebookText, count: counts.all, current: current({ kind: "all" }), onOpen: () => goPlace({ kind: "all" }) },
  ];
  if (counts.teams > 0 || tiers.some((tier) => tier.kind === "team")) lists.push({ id: "teams", label: t("memoryManager.nav.teams"), icon: Users, count: counts.teams, current: current({ kind: "teams" }), onOpen: () => goPlace({ kind: "teams" }) });
  lists.push(
    { id: "pinned", label: t("memoryManager.nav.pinned"), icon: Pin, count: counts.pinned, current: current({ kind: "pinned" }), onOpen: () => goPlace({ kind: "pinned" }) },
    { id: "recent", label: t("memoryManager.nav.recent"), icon: Clock3, count: counts.recent, current: current({ kind: "recent" }), onOpen: () => goPlace({ kind: "recent" }) },
    { id: "review", label: t("memoryManager.nav.review"), icon: CircleCheck, count: counts.review, dot: counts.review > 0, current: current({ kind: "review" }), onOpen: () => goPlace({ kind: "review" }) },
  );
  const tidy: MemorySidebarNav[] = [
    ...(pxSource ? [
      { id: "collections", label: t("memoryManager.collections.title"), icon: BookOpen, count: collections.length, current: current({ kind: "collections" }), onOpen: () => goPlace({ kind: "collections" }) },
      { id: "archived", label: t("memoryManager.nav.archived"), icon: Archive, count: archivedRows.length, current: current({ kind: "archived" }), onOpen: () => goPlace({ kind: "archived" }) },
    ] : []),
    ...(pxSource || trashRows.length ? [{ id: "trash", label: t("memoryManager.nav.trash"), icon: Trash2, count: trashRows.length, current: current({ kind: "trash" }), onOpen: () => goPlace({ kind: "trash" }) }] : []),
    ...(sources?.length ? [{ id: "import", label: t("memoryManager.import.open"), icon: FolderInput, count: null, current: false, onOpen: () => setImportOpen(true) }] : []),
  ];

  const folderCount = (key: string) => rows.filter((entry) => entry.folderKey === key || entry.folderKey.startsWith(`${key}/`)).length;
  const folderPlace = (tier: string, folder: string): Place => ({ kind: "folder", tier, folder });

  const pxFolders = (tier: MemoryTierRow, tierKey: string): MemorySidebarFolder[] => {
    if (!pxSource) return [];
    const target = targets.find((entry) => entry.id === `px:${tier.scope}`);
    return tier.folders.map((folder) => {
      const key = `px:${tier.scope}/${folder.name}`;
      const link = pxFolderLink(folder.name, linkBots, linkRoutines);
      const actions: MemoryRowAction[] = tier.mayWrite ? [
        { kind: "new", label: t("memoryManager.newIn", { folder: folder.name }), onClick: () => startCreate(target, folder.name) },
        { kind: "rename", label: t("memoryManager.renameFolder", { folder: folder.name }), onClick: () => setRenaming(key) },
      ] : [];
      return {
        key,
        name: folder.name,
        title: linkTitle(link),
        icon: "folder",
        leading: isLinked(link) ? <LinkMark bot={link.bots[0]!} /> : undefined,
        unlinked: !isLinked(link),
        menu: folderMenu(link, tier.mayWrite ? () => void deletePxFolder(tier.scope, folder.name) : null, t("memoryManager.deleteFolderReadOnly")),
        count: folder.count,
        current: current(folderPlace(tierKey, key)),
        onOpen: () => goPlace(folderPlace(tierKey, key)),
        actions,
        onRename: (next) => void renamePxFolder(tier.scope, folder.name, next),
        data: { "data-memory-folder": folder.id },
      };
    });
  };

  const explorerTiers: MemorySidebarTier[] = tiers.map((tier) => {
    const tierPlace: Place = { kind: "tier", tier: tier.key };
    const base = { key: tier.key, name: tier.name, color: tier.color, count: rows.filter((entry) => entry.tier === tier.key).length, current: current(tierPlace), onOpen: () => goPlace(tierPlace), data: { "data-memory-tier": tier.key } };
    if (tier.key === "mine") {
      const botFolders: MemorySidebarFolder[] = botSources.map((source) => {
        const link = botSourceLink(source, linkBots, linkRoutines);
        return {
        key: source.id,
        name: source.name,
        title: linkTitle(link),
        icon: isLinked(link) ? "bot" as const : "folder" as const,
        leading: isLinked(link) ? <LinkMark bot={link.bots[0]!} /> : undefined,
        unlinked: !isLinked(link),
        menu: folderMenu(link, source.mayWrite ? () => void deleteBotFolder(source) : null, t("memoryManager.deleteFolderReadOnly")),
        count: folderCount(source.id),
        current: current(folderPlace("mine", source.id)),
        onOpen: () => goPlace(folderPlace("mine", source.id)),
        actions: source.mayWrite ? [{ kind: "new", label: t("memoryManager.newIn", { folder: source.name }), onClick: () => startCreate(targets.find((target) => target.id === source.id)) }] : [],
        children: (overviews[source.id]?.folders ?? []).map((folder) => {
          const key = `${source.id}/${folder.id}`;
          return {
            key,
            name: folder.id === "logs" ? t("memoryManager.folderLogs") : t("memoryManager.folderTopics"),
            icon: "folder" as const,
            count: folder.count,
            current: current(folderPlace("mine", key)),
            onOpen: () => goPlace(folderPlace("mine", key)),
            actions: [],
            data: { "data-memory-folder": key },
          };
        }),
        data: { "data-memory-source": source.id },
        };
      });
      const meTarget = meTier ? targets.find((target) => target.id === `px:${meTier.scope}`) : undefined;
      return {
        ...base,
        title: t("memoryManager.tierMineHint"),
        actions: meTarget ? [
          { kind: "new", label: t("memoryManager.newNote"), onClick: () => startCreate(meTarget) },
          { kind: "newFolder", label: t("memoryManager.newFolder"), onClick: () => startCreate(meTarget, undefined, { newFolder: true }) },
        ] : [],
        folders: [...(meTier ? pxFolders(meTier, "mine") : []), ...botFolders],
      };
    }
    const team = teamSources.find((source) => source.id === tier.key);
    if (team) {
      const target = targets.find((entry) => entry.id === team.id);
      return {
        ...base,
        title: team.detail,
        actions: target ? [{ kind: "new", label: t("memoryManager.newIn", { folder: team.name }), onClick: () => startCreate(target) }] : [],
        folders: (overviews[team.id]?.folders ?? []).map((folder) => {
          const key = `${team.id}/${folder.id}`;
          const link = teamFolderLink(team.section ?? "", linkBots);
          return {
            key,
            name: folder.name,
            title: linkTitle(link),
            icon: "folder" as const,
            unlinked: true,
            menu: folderMenu(link, null, t("memoryManager.deleteFolderTeamKind")),
            count: folder.count,
            current: current(folderPlace(team.id, key)),
            onOpen: () => goPlace(folderPlace(team.id, key)),
            actions: target ? [{ kind: "new" as const, label: t("memoryManager.newIn", { folder: folder.name }), onClick: () => startCreate(target, folder.id) }] : [],
            data: { "data-memory-folder": key },
          };
        }),
        data: { ...base.data, "data-memory-source": team.id },
      };
    }
    const pxTier = pxTiers.find((entry) => `perspicax:${entry.scope}` === tier.key)!;
    const target = targets.find((entry) => entry.id === `px:${pxTier.scope}`);
    return {
      ...base,
      actions: target ? [
        { kind: "new", label: t("memoryManager.newIn", { folder: tier.name }), onClick: () => startCreate(target) },
        { kind: "newFolder", label: t("memoryManager.newFolder"), onClick: () => startCreate(target, undefined, { newFolder: true }) },
      ] : [],
      folders: pxFolders(pxTier, tier.key),
      data: { ...base.data, "data-memory-source": tier.key },
    };
  });

  const switcherHits = useMemo(() => {
    const words = switcherQuery.trim().toLowerCase();
    const list = words ? rows.filter((entry) => entry.row.title.toLowerCase().includes(words) || entry.folderPath.toLowerCase().includes(words)) : rows.filter((entry) => pins.includes(entry.key)).concat(rows).slice(0, 8);
    return [...new Map(list.map((entry) => [entry.key, entry])).values()].slice(0, 8);
  }, [switcherQuery, rows, pins]);

  const switcher = switcherOpen ? (
    <div className="absolute left-2 top-full z-40 mt-1.5 w-[360px] max-w-[calc(100vw-32px)] rounded-xl border-[0.5px] border-border bg-elevated p-1.5 popover-surface" data-memory-switcher="">
      <input
        ref={switcherRef}
        type="search"
        value={switcherQuery}
        onChange={(event) => setSwitcherQuery(event.target.value)}
        onBlur={() => setTimeout(() => setSwitcherOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setSwitcherOpen(false); }
          if (event.key === "Enter" && switcherHits[0]) { event.preventDefault(); setSwitcherOpen(false); void openNote(switcherHits[0]); }
        }}
        placeholder={t("memoryManager.switcherPlaceholder")}
        aria-label={t("memoryManager.openNote")}
        className={cn(FIELD, "mb-1")}
        data-memory-switcher-input=""
      />
      {switcherHits.map((entry) => (
        <button key={entry.key} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setSwitcherOpen(false); void openNote(entry); }} className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover" data-memory-switcher-hit="">
          <FileText size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{entry.row.title}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-ink-tertiary"><Swatch color={tierByKey.get(entry.tier)?.color ?? ""} />{entry.folderPath}</span>
        </button>
      ))}
      {switcherHits.length === 0 && <p className="px-2 py-2 text-[12.5px] text-ink-secondary">{t("memoryManager.listNone")}</p>}
    </div>
  ) : null;

  const explorerLoading = sources === null || (sources.length > 0 && !overviewsReady) ? (
    <div className="flex min-h-[80px] items-center justify-center text-ink-secondary">
      <Loader2 size={18} className="animate-spin" aria-label={t("memoryManager.loading")} />
    </div>
  ) : null;
  const explorerFooter = (
    <>
      {sources && sources.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-ink-secondary">{t("memoryManager.emptySources")}</p>}
      {pxReason === "link" && <p className="mt-3 px-2 text-[12px] text-ink-secondary">{t("memoryManager.pxLinkHint")}</p>}
      {pxReason === "sign_in" && <p className="mt-3 px-2 text-[12px] text-ink-secondary">{t("memoryManager.pxSignInHint")}</p>}
    </>
  );

  return { lists, tidy, explorerTiers, switcherHits, switcher, explorerLoading, explorerFooter };
}
