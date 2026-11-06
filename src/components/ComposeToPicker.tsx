import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Command, Plus, Users, X } from "lucide-react";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { viewerActorId, viewerBotsReadOnly, viewerCanCreateBots } from "@/lib/viewer";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import { useStore, type Bot } from "@/state/store";
import { useOrgPeople, type OrgDirectoryPerson } from "@/lib/perspicax-org";
import { personAvatarSrc } from "@/lib/profile-management";
import { BotAvatar } from "./Avatar";
import { PersonAvatar } from "./MessageAuthor";
import { personInitials } from "@/lib/people-dm";
import { useCaptionChrome } from "./DesktopCapabilities";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBotConversationActions } from "./thread-home";
import { PersonLabelTag } from "./LabelTag";
import { botsReadOnlyText } from "@/lib/permissions";
import { popoverClosesOnPointer } from "@/hooks/use-popover-dismiss";

type ComposeMode = "browse" | "group";
type ComposeRow = { kind: "create-bot" } | { kind: "create-group" } | { kind: "bot"; bot: Bot } | { kind: "person"; person: OrgDirectoryPerson };

function isExternalBot(bot: Bot, viewer: string): boolean {
  const owner = bot.ownerUserId?.trim().toLowerCase();
  if (!owner || owner === "local-owner") return false;
  return owner !== viewer.trim().toLowerCase();
}

function matches(bot: Bot, query: string): boolean {
  if (!query) return true;
  return `${bot.name} ${bot.title} ${bot.description ?? ""}`.toLowerCase().includes(query);
}

/** The organization's people one may write to directly: active persons of
 * the Perspicax directory, never a service account and never oneself. */
export function composePeople(people: Iterable<OrgDirectoryPerson>, viewer: string, query: string): OrgDirectoryPerson[] {
  const self = viewer.trim().toLowerCase();
  return [...people].filter((person) => !person.disabled && !person.service && person.principalId.toLowerCase() !== self &&
    (!query || `${person.name} ${person.login} ${person.email ?? ""}`.toLowerCase().includes(query)));
}

/** A picked person is stored in the group's picked set under this prefix, so a
 * bot id and a principal id never collide. */
const PERSON_PICK = "person:";

/** The two lists a group create request carries from the picked set. */
export function splitPicked(picked: Iterable<string>): { memberIds: string[]; humanIds: string[] } {
  const memberIds: string[] = [];
  const humanIds: string[] = [];
  for (const id of picked) {
    if (id.startsWith(PERSON_PICK)) humanIds.push(id.slice(PERSON_PICK.length));
    else memberIds.push(id);
  }
  return { memberIds, humanIds };
}

/** At most this many results (bots and people together) under the create rows. */
export const COMPOSE_RESULT_LIMIT = 6;

/** How well a name answers the query: 0 the name starts with it, 1 a word
 * of the name does, 2 it only matches elsewhere (inside a word, the title,
 * the login or the email). */
function matchRank(name: string, query: string): number {
  const text = name.trim().toLowerCase();
  if (text.startsWith(query)) return 0;
  if (text.split(/[\s._@-]+/).some((word) => word.startsWith(query))) return 1;
  return 2;
}

/** Rows under the To: field. The create rows always come first: group mode
 * keeps the confirm row, browse mode offers "New bot" (only when the server
 * lets this viewer create one) and "Create group chat". Then come at most
 * COMPOSE_RESULT_LIMIT results: the bots, then on an organization server the
 * people (browse mode only; choosing one opens the direct conversation with
 * them). With a query the matches are ranked best first, ties keeping that
 * order. Shortcuts follow the visible rows, so they never skip a number. */
export function composeRows(mode: ComposeMode, bots: Bot[], canCreateBots = true, people: OrgDirectoryPerson[] = [], query = ""): ComposeRow[] {
  const results: ComposeRow[] = [
    ...bots.map((bot): ComposeRow => ({ kind: "bot", bot })),
    ...people.map((person): ComposeRow => ({ kind: "person", person })),
  ];
  const q = query.trim().toLowerCase();
  const ranked = q
    ? results
      .map((row, index) => ({ row, index, rank: matchRank(row.kind === "bot" ? row.bot.name : row.kind === "person" ? row.person.name || row.person.login : "", q) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(({ row }) => row)
    : results;
  const shown = ranked.slice(0, COMPOSE_RESULT_LIMIT);
  if (mode === "group") return [{ kind: "create-group" }, ...shown];
  return [
    // #2092: the quick creation only; the guided wizard stays in New bot
    ...(canCreateBots ? [{ kind: "create-bot" } as const] : []),
    { kind: "create-group" },
    ...shown,
  ];
}

function KeyHint({ n }: { n: number }) {
  return (
    <kbd aria-hidden className="flex shrink-0 items-center gap-0.5 rounded-md border border-hairline/50 px-1.5 py-0.5 text-[11px] leading-none text-ink-secondary">
      {isMacPlatform() ? <Command size={11} /> : <span>Ctrl</span>}
      <span>{n}</span>
    </kbd>
  );
}

/**
 * Inline "To:" picker in the main column. Creating a bot or a group stays
 * here: no centered dialog. With threads on, a bot row starts a new thread
 * (the previous one stays in the thread list). With threads off there is one
 * conversation per bot, so a bot row opens it exactly like the sidebar row
 * and never creates a thread. Group mode collects members in the same list,
 * then creates the channel.
 */
export function ComposeToPicker({ onClose, startInGroup = false }: { onClose: () => void; startInGroup?: boolean }) {
  const { state, dispatch } = useStore();
  const { dragStyle, noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const showThreads = useShowThreads();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ComposeMode>(startInGroup ? "group" : "browse");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const viewer = viewerActorId(state.config);
  const canCreateBots = viewerCanCreateBots(state.config);
  const botsReadOnly = viewerBotsReadOnly(state.config);
  const q = query.trim().toLowerCase();
  const bots = state.bots.filter((bot) => !bot.hidden && !isExternalBot(bot, viewer) && matches(bot, q));
  const orgPeople = useOrgPeople();
  const people = useMemo(() => composePeople(orgPeople.values(), viewer, q), [orgPeople, viewer, q]);
  const rows = useMemo(() => composeRows(mode, bots, canCreateBots, people, q), [mode, bots, canCreateBots, people, q]);
  const active = rows.length ? Math.min(cursor, rows.length - 1) : 0;

  useEffect(() => setCursor(0), [q, mode]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, rows.length]);

  const togglePicked = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setQuery("");
    // keep the focus in the search field after each selection (#1797)
    searchRef.current?.focus();
  };

  const activate = (row: ComposeRow | undefined) => {
    if (!row) return;
    if (row.kind === "create-bot") {
      if (state.botCreationPending || !canCreateBots) return;
      dispatch({ type: "newBot" });
      onCloseRef.current();
      return;
    }
    if (row.kind === "create-group") {
      if (mode === "browse") {
        setMode("group");
        setQuery("");
        // keep the focus in the search field when entering group mode (#1797)
        searchRef.current?.focus();
        return;
      }
      // A group holds a bot, or at least one other person (people-only group, #1150).
      const { memberIds, humanIds } = splitPicked(picked);
      if (!memberIds.length && !humanIds.length) return;
      dispatch({ type: "createGroup", memberIds, ...(humanIds.length ? { humanIds } : {}) });
      track("room_created", { members: picked.size, context: false });
      onCloseRef.current();
      return;
    }
    if (row.kind === "person" && mode === "group") {
      togglePicked(PERSON_PICK + row.person.principalId);
      setCursor(0);
      return;
    }
    if (row.kind === "person") {
      dispatch({ type: "openPeopleDm", principalId: row.person.principalId });
      onCloseRef.current();
      return;
    }
    if (mode === "group") {
      togglePicked(row.bot.id);
      setCursor(0);
      return;
    }
    if (showThreads) dispatch({ type: "newTask", botId: row.bot.id });
    else for (const action of openBotConversationActions(row.bot, false)) dispatch(action);
    onCloseRef.current();
  };

  const activateRef = useRef(activate);
  activateRef.current = activate;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const inside = target instanceof Node && Boolean(rootRef.current?.contains(target));
      if (event.key === "Escape") {
        if (!inside && target instanceof HTMLElement && target.closest("[role=dialog], [role=alertdialog]")) return;
        event.preventDefault();
        event.stopPropagation();
        if (mode === "group") {
          setMode("browse");
          setPicked(new Set());
          setQuery("");
          return;
        }
        onCloseRef.current();
        return;
      }
      if (!inside) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && /^[1-9]$/.test(event.key)) {
        const row = rows[Number(event.key) - 1];
        if (!row) return;
        event.preventDefault();
        event.stopPropagation();
        activateRef.current(row);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setCursor((current) => {
          const index = rows.length ? Math.min(current, rows.length - 1) : 0;
          if (!rows.length) return 0;
          return event.key === "ArrowDown" ? (index + 1) % rows.length : (index - 1 + rows.length) % rows.length;
        });
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLButtonElement)) {
        event.preventDefault();
        event.stopPropagation();
        activateRef.current(rows[rows.length ? Math.min(active, rows.length - 1) : 0]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, rows, active]);

  // A press outside the picker closes it, like the other popovers. The + button
  // is left to its own toggle (pressing it would close, then reopen).
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-sidebar-new]")) return;
      if (popoverClosesOnPointer(target, rootRef.current)) onCloseRef.current();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  const groupLabel = mode === "group" && picked.size > 1
    ? t("sidebar.newChannel.createMany", { count: picked.size })
    : mode === "group" && picked.size === 1
      ? t("sidebar.newChannel.createOne")
      : t("compose.createGroup");

  return (
    <div ref={rootRef} data-compose-to className="pointer-events-none absolute inset-x-0 top-0 z-20 text-ink">
      <div className="pointer-events-auto flex min-h-12 items-center gap-3 border-b border-hairline/40 bg-app px-4 py-2" style={dragStyle}>
        <span className="shrink-0 text-[15px] text-ink-secondary" style={noDragStyle}>{t("compose.to")}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" style={noDragStyle}>
          {mode === "group" && [...picked].map((id) => {
            if (id.startsWith(PERSON_PICK)) {
              const person = orgPeople.get(id.slice(PERSON_PICK.length));
              const label = person?.name || person?.login || "";
              if (!label) return null;
              return (
                <span key={id} className="flex max-w-full items-center gap-1 rounded-full bg-raised py-0.5 pl-1 pr-1 text-[13px]">
                  <PersonAvatar avatarUrl={personAvatarSrc(person?.avatarUrl)} initials={personInitials(label)} size={18} />
                  <span className="max-w-[8rem] truncate">{label}</span>
                  <button
                    type="button"
                    aria-label={`${t("compose.remove")} ${label}`}
                    // keep the focus in the search field
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => togglePicked(id)}
                    className="flex size-5 items-center justify-center rounded-full text-ink-secondary hover:bg-app hover:text-ink"
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            }
            const bot = state.bots.find((item) => item.id === id);
            if (!bot) return null;
            return (
              <span key={id} className="flex max-w-full items-center gap-1 rounded-full bg-raised py-0.5 pl-1 pr-1 text-[13px]">
                <BotAvatar bot={bot} state="idle" size={18} animated={false} />
                <span className="max-w-[8rem] truncate">{bot.name}</span>
                <button
                  type="button"
                  aria-label={`${t("compose.remove")} ${bot.name}`}
                  // keep the focus in the search field
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => togglePicked(id)}
                  className="flex size-5 items-center justify-center rounded-full text-ink-secondary hover:bg-app hover:text-ink"
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
          <input
            ref={searchRef}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === "group" ? t(orgPeople.size ? "compose.placeholderGroupPeople" : "compose.placeholderGroup") : t("compose.placeholder")}
            aria-label={mode === "group" ? t(orgPeople.size ? "compose.groupAriaPeople" : "compose.groupAria") : t("compose.placeholder")}
            aria-controls="compose-to-list"
            aria-activedescendant={rows[active] ? `compose-row-${active}` : undefined}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            className="min-w-[10rem] flex-1 bg-transparent py-1 text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </div>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          style={{ ...noDragStyle, ...controlsShiftStyle }}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>
      <div className="relative">
        <div
          id="compose-to-list"
          role="listbox"
          aria-label={t("compose.placeholder")}
          className="pointer-events-auto absolute left-3 top-2 z-10 max-h-[min(440px,70vh)] w-[min(440px,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-hairline/50 bg-menu py-1.5 shadow-2xl shadow-black/50"
        >
          {botsReadOnly && (
            <p role="note" data-bots-read-only className="px-3 py-2 text-[12.5px] leading-snug text-ink-secondary">{botsReadOnlyText(state.config)}</p>
          )}
          {rows.map((row, index) => {
            const shortcut = index < 9 ? index + 1 : undefined;
            const selected = index === active;
            if (row.kind === "create-bot") {
              return (
                <button
                  key="create-bot"
                  id={`compose-row-${index}`}
                  ref={selected ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-compose-action="create-bot"
                  disabled={state.botCreationPending}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => activate(row)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] text-ink disabled:opacity-40",
                    selected ? "bg-raised/80" : "hover:bg-raised/60",
                  )}
                >
                  <Plus size={16} className="shrink-0 text-ink-secondary" />
                  <span className="flex-1 truncate">{t("compose.createBot")}</span>
                  {shortcut && <KeyHint n={shortcut} />}
                </button>
              );
            }
            if (row.kind === "create-group") {
              const disabled = mode === "group" && picked.size === 0;
              return (
                <button
                  key="create-group"
                  id={`compose-row-${index}`}
                  ref={selected ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-compose-action="create-group"
                  disabled={disabled}
                  onMouseEnter={() => setCursor(index)}
                  // keep the focus in the search field when entering group mode
                  onMouseDown={(event) => { if (mode === "browse") event.preventDefault(); }}
                  onClick={() => activate(row)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] text-ink disabled:opacity-40",
                    selected ? "bg-raised/80" : "hover:bg-raised/60",
                  )}
                >
                  <Users size={16} className="shrink-0 text-ink-secondary" />
                  <span className="flex-1 truncate">{groupLabel}</span>
                  {shortcut && <KeyHint n={shortcut} />}
                </button>
              );
            }
            if (row.kind === "person") {
              const person = row.person;
              const pickedPerson = mode === "group" && picked.has(PERSON_PICK + person.principalId);
              const personHint = mode === "group" ? (pickedPerson ? t("compose.remove") : t("compose.add")) : t("compose.directMessage");
              return (
                <button
                  key={`person:${person.principalId}`}
                  id={`compose-row-${index}`}
                  ref={selected ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected || pickedPerson}
                  data-compose-person={person.principalId}
                  onMouseEnter={() => setCursor(index)}
                  // keep the focus in the search field after each selection (#1797)
                  onMouseDown={(event) => { if (mode === "group") event.preventDefault(); }}
                  onClick={() => activate(row)}
                  className={cn(
                    "group flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] text-ink",
                    selected ? "bg-raised/80" : "hover:bg-raised/60",
                  )}
                >
                  <PersonAvatar avatarUrl={personAvatarSrc(person.avatarUrl)} initials={personInitials(person.name || person.login)} size={28} presenceId={person.principalId} />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5"><span className="min-w-0 truncate">{person.name || person.login}</span><PersonLabelTag principalId={person.principalId} tone="surface" className="max-w-[46%] shrink" /></span>
                  {pickedPerson && !selected && <Check size={14} className="shrink-0 text-ink-secondary group-hover:hidden" />}
                  <span className={cn("shrink-0 text-[13px] text-ink-secondary", selected ? "inline" : "hidden group-hover:inline")}>{personHint}</span>
                  {shortcut && (
                    <span className={cn(selected ? "hidden" : "group-hover:hidden")}>
                      <KeyHint n={shortcut} />
                    </span>
                  )}
                </button>
              );
            }
            const bot = row.bot;
            const member = picked.has(bot.id);
            const hint = mode === "group"
              ? (member ? t("compose.remove") : t("compose.add"))
              : showThreads ? t("task.newShort") : t("compose.openChat");
            return (
              <button
                key={bot.id}
                id={`compose-row-${index}`}
                ref={selected ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={selected || member}
                data-compose-bot={bot.id}
                onMouseEnter={() => setCursor(index)}
                // keep the focus in the search field after each selection (#1797)
                onMouseDown={(event) => { if (mode === "group") event.preventDefault(); }}
                onClick={() => activate(row)}
                className={cn(
                  "group flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] text-ink",
                  selected ? "bg-raised/80" : "hover:bg-raised/60",
                )}
              >
                <BotAvatar bot={bot} primary={isViewersPrimaryBot(bot, viewer)} primaryRingClassName="ring-elevated" state="idle" size={28} animated={false} />
                <span className="min-w-0 flex-1 truncate">{bot.name}</span>
                {mode === "group" && member && !selected && <Check size={14} className="shrink-0 text-ink-secondary group-hover:hidden" />}
                <span className={cn(
                  "shrink-0 text-[13px] text-ink-secondary",
                  selected ? "inline" : "hidden group-hover:inline",
                )}>{hint}</span>
                {shortcut && (
                  <span className={cn(selected ? "hidden" : "group-hover:hidden")}>
                    <KeyHint n={shortcut} />
                  </span>
                )}
              </button>
            );
          })}
          {q && bots.length === 0 && people.length === 0 && (
            <div className="px-3 py-2 text-[13px] text-ink-secondary">{t("sidebar.noMatch", { query: query.trim() })}</div>
          )}
          {!q && bots.length === 0 && (
            <div className="px-3 py-2 text-[13px] text-ink-secondary">{t("sidebar.newChannel.emptyHint")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
