// ⌘K palette, grouped like Cursor's command palette and Grok Bot's quick
// search: Recent, Conversations, Bots, Messages, Navigation, Settings, Goal,
// Help, each under its heading, with the shortcut at the right edge. The
// rows and the search live in src/lib/palette-commands.ts; this file owns the
// open state, the global chord, the transcript search and the actions, so
// App.tsx only mounts it.
import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AppWindow,
  Bot as BotIcon,
  CalendarClock,
  CircleStop,
  Compass,
  History,
  Keyboard,
  MessageSquare,
  Network,
  Puzzle,
  ScrollText,
  Search,
  SearchX,
  Settings,
  SlidersHorizontal,
  SquarePen,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import { api, openBot, useStore } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { useAdvancedMode } from "@/lib/interface-mode";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { SearchHit } from "@/lib/search-hit";
import { landOnSearchHit } from "@/lib/focus-message";
import { navigate } from "@/lib/view-transitions";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { requestReleaseNotes } from "@/lib/release-notes-ui";
import { setComposerChannelMode } from "@/lib/drafts";
import { useAllArtifacts } from "@/lib/artifacts";
import { openArtifact } from "@/lib/artifact-events";
import { viewerCanCreateBots } from "@/lib/viewer";
import { requestBotHistory } from "@/lib/panel-visibility";
import {
  buildPaletteSections,
  latestGoalRun,
  loadPaletteRecents,
  paletteCategoryLabel,
  rememberPaletteRecent,
  type PaletteAction,
  type PaletteItem,
} from "@/lib/palette-commands";

/** Dispatched on window to open the palette from a control (the sidebar's
 * search field) rather than the ⌘K chord. */
export const OPEN_PALETTE_EVENT = "omb:open-palette";

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

const ICONS: Record<PaletteAction["kind"], LucideIcon> = {
  bot: BotIcon,
  room: Users,
  message: MessageSquare,
  artifact: AppWindow,
  newConversation: SquarePen,
  newBot: UserPlus,
  routines: CalendarClock,
  teamMap: Network,
  connectApps: Puzzle,
  settings: Settings,
  botSettings: SlidersHorizontal,
  botHistory: History,
  goalStart: Target,
  goalStatus: Activity,
  goalStop: CircleStop,
  shortcuts: Keyboard,
  releaseNotes: ScrollText,
  tour: Compass,
};

function focusComposer(): void {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-tour="composer"] textarea')?.focus());
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 pl-3" aria-hidden="true">
      {keys.map((key) => (
        <kbd
          key={key}
          className="min-w-[20px] rounded-md border border-hairline/40 px-1.5 py-0.5 text-center font-sans text-[11px] leading-none text-ink-secondary"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

export function CommandPalette({
  onOpenChange,
  onNewConversation,
}: {
  onOpenChange?: (open: boolean) => void;
  /** ⌘N's "new conversation" picker lives in App.tsx. */
  onNewConversation?: () => void;
}) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const advanced = useAdvancedMode();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [messageHits, setMessageHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // The chord fires from anywhere: Shell's app-wide shortcuts (⌘N, ⌘1 to ⌘9)
  // set the precedent of not guarding against focused inputs, and a
  // modifier chord never collides with typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    // the sidebar's search field asks for the palette without a chord
    const onRequest = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onRequest);
    };
  }, []);

  // fresh palette every open; stale queries from last time would flash
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setMessageHits([]);
    setSearching(false);
    setCursor(0);
    setRecents(loadPaletteRecents());
  }, [open]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  const q = query.trim().toLowerCase();

  // Same debounce pattern as the sidebar search: names answer instantly
  // from local state, transcript hits arrive a beat later, and a stale
  // response for an outdated query is dropped.
  useEffect(() => {
    if (!open || !q) {
      setMessageHits([]);
      setSearching(false);
      return;
    }
    // Results for the previous query must not remain clickable while the
    // debounce and request for this query are pending.
    setMessageHits([]);
    setSearching(true);
    let alive = true;
    const timer = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(q)}&limit=12`)
        .then((result: { hits?: SearchHit[] }) => alive && setMessageHits(result.hits ?? []))
        .catch(() => alive && setMessageHits([]))
        .finally(() => alive && setSearching(false));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, q]);

  useEffect(() => setCursor(0), [q]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor, messageHits]);

  const selectedGroup =
    state.activeView === "chat" ? state.groups.find((group) => group.id === state.selectedId) : undefined;
  const selectedBot =
    state.activeView === "chat" ? state.bots.find((bot) => bot.id === state.selectedId) : undefined;
  const goalGroup = selectedGroup && !selectedGroup.dm && !selectedGroup.peopleDm ? selectedGroup : undefined;
  const isMac = useMemo(() => isMacPlatform(), []);
  // Favorites of every bot, fetched while the palette is open.
  const { artifacts } = useAllArtifacts(open);

  const sections = useMemo(
    () =>
      open
        ? buildPaletteSections({
          bots: state.bots.filter((bot) => !bot.hidden),
          groups: state.groups,
          artifacts: artifacts ?? [],
          query,
          messageHits: q ? messageHits : [],
          recents,
          isMac,
          desktop: Boolean(window.ogb),
          canCreateBots: viewerCanCreateBots(state.config),
          advanced,
          ...(selectedBot ? { currentBotId: selectedBot.id } : {}),
          ...(goalGroup
            ? { goal: { groupId: goalGroup.id, threadId: goalGroup.threadId, latest: latestGoalRun(goalGroup) } }
            : {}),
        })
        : [],
    [open, state.bots, state.groups, artifacts, state.config, query, q, messageHits, recents, isMac, advanced, selectedBot, goalGroup],
  );

  if (!open) return null;

  // flat cursor across sections; each row needs its absolute index
  const entries: PaletteItem[] = sections.flatMap((section) => section.items);
  // hits arriving or rows filtering away can strand the cursor past the end
  const selected = entries.length ? Math.min(cursor, entries.length - 1) : 0;

  const run = async (action: PaletteAction) => {
    switch (action.kind) {
      case "message":
        try {
          await landOnSearchHit(action.hit, state, dispatch, showThreads);
        } catch (error) {
          dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
        return;
      case "bot":
        navigate(() => openBot(dispatch, action.bot, showThreads));
        return;
      case "artifact":
        openArtifact({ botId: action.botId, artifactId: action.artifactId, title: action.title });
        return;
      case "room":
        navigate(() => dispatch({ type: "select", id: action.group.id }));
        return;
      case "newConversation":
        onNewConversation?.();
        return;
      case "newBot":
        dispatch({ type: "toggleNewBot", open: true });
        return;
      case "routines":
        dispatch({ type: "showRoutines" });
        return;
      case "teamMap":
        dispatch({ type: "showTeamMap" });
        return;
      case "connectApps":
        dispatch({ type: "togglePlugins", open: true });
        return;
      case "settings":
        dispatch({ type: "toggleAppSettings", open: true, ...(action.section ? { section: action.section } : {}) });
        return;
      case "botSettings":
        dispatch({ type: "toggleSettings", open: true, botId: action.botId });
        return;
      case "botHistory":
        dispatch({ type: "toggleSettings", open: true, botId: action.botId });
        requestBotHistory(action.botId);
        return;
      case "goalStart":
        setComposerChannelMode(`group:${action.groupId}:${action.threadId}`, "goal");
        focusComposer();
        return;
      case "goalStatus":
        dispatch({ type: "focusMessage", threadId: action.threadId, messageId: action.messageId });
        return;
      case "goalStop":
        dispatch({ type: "interruptGroup", groupId: action.groupId, threadId: action.threadId });
        return;
      case "shortcuts":
        dispatch({ type: "toggleShortcuts", open: true });
        return;
      case "releaseNotes":
        requestReleaseNotes("browse");
        return;
      case "tour":
        dispatch({ type: "toggleTour", open: true });
        return;
    }
  };

  const activate = (item: PaletteItem) => {
    setRecents(rememberPaletteRecent(item.id));
    setOpen(false);
    void run(item.action);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      // shield the window listeners other modals hang their own Esc on
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(entries.length ? (selected + 1) % entries.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(entries.length ? (selected - 1 + entries.length) % entries.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = entries[selected];
      if (entry) activate(entry);
    }
  };

  const row = (item: PaletteItem, index: number, recent: boolean) => {
    const Icon = ICONS[item.action.kind];
    const hit = item.action.kind === "message" ? item.action.hit : null;
    const label = recent ? paletteCategoryLabel(item) : item.label;
    return (
      <button
        key={`${recent ? "recent:" : ""}${item.id}`}
        type="button"
        role="option"
        aria-selected={index === selected}
        ref={index === selected ? selectedRef : undefined}
        onClick={() => activate(item)}
        // mousemove, not mouseenter: rows shifting under a resting pointer
        // (hits arriving) must not steal the keyboard selection
        onMouseMove={() => setCursor(index)}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
          hit && "flex-col items-stretch gap-0.5",
          index === selected ? "bg-raised" : "hover:bg-raised/50",
        )}
      >
        {hit ? (
          <>
            <span className="flex items-center gap-2 truncate text-[13px] font-medium text-ink">
              <Icon size={13} className="shrink-0 text-ink-secondary" />
              {hit.name}
              {hit.task ? <span className="font-normal text-ink-secondary"> · {hit.task}</span> : null}
            </span>
            <span className="line-clamp-2 text-[12.5px] text-ink-secondary">
              {hit.snippet.slice(0, hit.matchStart)}
              <mark className="rounded-sm bg-accent/25 px-0.5 text-ink">
                {hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)}
              </mark>
              {hit.snippet.slice(hit.matchStart + hit.matchLength)}
            </span>
          </>
        ) : (
          <>
            <Icon size={16} className="shrink-0 text-ink-secondary" />
            <span className="truncate text-[14px] text-ink">{label}</span>
            {item.detail && !recent && (
              <span className="min-w-0 truncate text-[12.5px] text-ink-secondary">{item.detail}</span>
            )}
            {item.shortcut && <Keys keys={item.shortcut} />}
          </>
        )}
      </button>
    );
  };

  let index = 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-[14vh]"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.aria")}
        className="flex max-h-[min(520px,72vh)] w-full max-w-[600px] flex-col overflow-hidden rounded-xl border border-hairline/50 bg-card shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-3 border-b border-hairline/40 px-4 py-3">
          <Search size={16} className="shrink-0 text-ink-secondary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            aria-controls="command-palette-list"
            className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          <kbd className="shrink-0 rounded-md border border-hairline/40 px-1.5 py-0.5 text-[11px] text-ink-secondary">
            esc
          </kbd>
        </div>
        <div id="command-palette-list" role="listbox" aria-label={t("palette.aria")} className="min-h-0 flex-1 overflow-y-auto p-2">
          {entries.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
              {q && searching ? (
                <span className="text-[13px] text-ink-secondary">{t("palette.searching")}</span>
              ) : (
                <>
                  <SearchX size={20} className="text-ink-secondary" aria-hidden="true" />
                  <span className="text-[13px] text-ink">
                    {q ? t("palette.empty.query", { query: query.trim() }) : t("palette.empty.none")}
                  </span>
                  {q && <span className="text-[12px] text-ink-secondary">{t("palette.empty.hint")}</span>}
                </>
              )}
            </div>
          )}
          {sections.map((section, sectionIndex) => (
            <div key={section.group} role="group" aria-label={section.label}>
              <div
                className={cn(
                  "px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary",
                  sectionIndex === 0 ? "pt-1.5" : "mt-1 border-t border-hairline/30 pt-2.5",
                )}
              >
                {section.label}
              </div>
              {section.items.map((item) => row(item, index++, section.group === "recent"))}
            </div>
          ))}
          {q && searching && entries.length > 0 && (
            <div className="px-3 py-2 text-[12px] text-ink-secondary">{t("palette.searching")}</div>
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-hairline/40 px-4 py-2 text-[11.5px] text-ink-secondary">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-hairline/40 px-1 text-[10.5px]">↑</kbd>
            <kbd className="rounded border border-hairline/40 px-1 text-[10.5px]">↓</kbd>
            {t("palette.footer.move")}
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-hairline/40 px-1 text-[10.5px]">↵</kbd>
            {t("palette.footer.open")}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <kbd className="rounded border border-hairline/40 px-1 text-[10.5px]">{isMac ? "⌘" : "Ctrl"}</kbd>
            <kbd className="rounded border border-hairline/40 px-1 text-[10.5px]">K</kbd>
            {t("palette.footer.toggle")}
          </span>
        </div>
      </div>
    </div>
  );
}
