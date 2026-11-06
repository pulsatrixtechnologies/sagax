// The bot's profile page (#2126, #2173, #2271, Grok Bot's layout): the
// surface that edits one bot, filling the main panel in place of the chat.
// Its top is the bot's appearance, edited in place: a banner in the mascot's
// colour with the mascot over its lower edge, "Name · Label", who sees it
// ("Private to you") and the owner, the description, the colour dots and an
// Appearance pill that unfolds the full appearance pane (mascot, motion,
// desktop) under them. Then four pill tabs, each a page of cards laid out in
// two columns on a wide window and one under 900px:
//
// - General: the bot's channels (Slack, email, Reach me, Mac Messages), each
//   with its state and a Connect / Manage pill, the bot's accounts (its
//   engine and the connectors it receives), What it does, Shared with and
//   Who can see it.
// - Knowledge: Skills, Personality, Rules, the Bot folder (where the memory
//   is managed) and a link to the Memory page.
// - Model & tools: Model, Workspace, Access, Permissions, Voice & alerts.
// - Activity: Usage, Changes.
//
// Nothing of the editor is gone: each section is the same body
// (useBotSectionContent) and saves through the same paths. The magnifier
// beside the tabs searches every setting.
//
// Opened by the store action openPersonaEditor ("..." > Edit bot, a click on
// the mascot, the bot panel's gear, a deep link to a section). A section asked
// for opens its tab and scrolls into view. A section this viewer may not
// change says why (botSectionLock); nothing is hidden for lack of a
// permission. The page itself carries no gear: the bot's settings live here
// and in the right-hand bot panel.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { BellRing, Brain, ChevronDown, ChevronRight, Cpu, LayoutDashboard, Lock, Mail, MessageCircle, Palette, Plug, Search, Star, Users } from "lucide-react";

import { useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { CIRCLE_LABEL } from "@/lib/circle-button";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesBotSection } from "@/lib/interface-visibility";
import { canEditBotField } from "@/lib/bot-capabilities";
import { isViewersPrimaryBot, viewerOwnsBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";
import { personLabel } from "@/lib/human-label";
import { useOrgPeople } from "@/lib/perspicax-org";
import { personaPagesMatching } from "@/lib/persona-search";
import { applySettingsSearch, clearSettingsSearch, settingsQuery } from "@/lib/settings-search";
import { useBotInboundMailState } from "@/lib/bot-inbound-mail";
import { useReachMe } from "@/lib/reach-me";
import { loadMessagesSetup } from "@/lib/mac-messages-setup";
import { capabilityName, orderedCapabilities, stateWord, useBotCapabilities } from "@/lib/capabilities";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import {
  BOT_PROFILE_TABS,
  BOT_PROFILE_TAB_SECTIONS,
  PERSONA_CATEGORIES,
  type BotProfileTab,
  type PersonaCategory,
  botProfileTabFor,
  botProfileTabOf,
  personaCategoryForSection,
} from "@/lib/persona-sections";
import { personaSharingSummary } from "@/lib/bot-sharing";
import { MAUS_COLORS, swatchStyle } from "@/lib/mascot";
import { mascotColorGroup, paletteSwatches } from "../../../shared/mascot-colors";
import type { MessagesSetupStatus } from "../../../shared/mac-messages-setup";
import { BOT_PROFILE_LIMITS } from "../../../shared/bot-profile";
import { WindowDragStrip, useCaptionChrome } from "../DesktopCapabilities";
import { WindowCloseButton } from "../WindowCloseButton";
import { AnchoredPopover, useAnchoredDismissRoot } from "../AnchoredPopover";
import { PILL } from "../SettingsPrimitives";
import { BotProfileAvatarCard } from "../BotProfileAvatarCard";
import { InlineEditableText } from "../bot-settings/InlineEditableText";
import { BOT_SECTIONS } from "../bot-settings/sections";
import { RulesSection } from "../bot-settings/RulesSection";
import { WorkspaceFilesSection } from "../bot-settings/WorkspaceFilesSection";
import { SlackSection } from "../bot-settings/SlackSection";
import { BotEmailAddress } from "../bot-settings/BotEmailAddress";
import { BotReachMe } from "../bot-settings/BotReachMe";
import { botSectionLock, useBotSectionAvailability, useBotSectionContent } from "../bot-settings/useBotSectionContent";

const ENTRY = new Map(BOT_SECTIONS.map((entry) => [entry.id, entry]));

/** A section's name, as the editor's rail named it. */
function sectionLabel(id: BotSettingsSection): string {
  const entry = ENTRY.get(id);
  if (!entry) return id;
  return entry.labelKey ? t(entry.labelKey) : entry.label;
}

/** The four tabs' names (#2271). */
const TAB_LABEL: Record<BotProfileTab, LocaleKey> = {
  general: "botProfile.tab.general",
  knowledge: "botProfile.tab.knowledge",
  tools: "botProfile.tab.tools",
  activity: "botProfile.tab.activity",
};

const REACH_LABEL: Record<string, LocaleKey> = {
  push: "botPanel.reachMe.push.label",
  sms: "botPanel.reachMe.sms.label",
  teams: "botPanel.reachMe.teams.label",
  telegram: "botPanel.reachMe.telegram.label",
  whatsapp: "botPanel.reachMe.whatsapp.label",
};

/** The sections each tab's two columns hold (left, right), in order. The
 * channels and the accounts cards head General's columns; Slack is a row
 * of the channels card. */
const COLUMNS: Record<BotProfileTab, readonly [readonly PersonaCategory[], readonly PersonaCategory[]]> = {
  general: [["summary"], ["sharing", "visibility"]],
  knowledge: [["skills", "rules"], ["soul", "files"]],
  tools: [["model", "permissions"], ["worksOn", "access", "voice"]],
  activity: [["usage"], ["history"]],
};

type Channel = "slack" | "email" | "reachMe" | "messages";

function Note({ children }: { children: ReactNode }) {
  return (
    <p role="note" data-persona-locked="" className="flex items-start gap-2 rounded-lg bg-raised/60 px-3 py-2 text-[12.5px] leading-snug text-ink-secondary">
      <Lock size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** One row of a card: icon, name, state under it, an action on the right,
 * and what the action unfolds under the row. */
function CardRow({ icon, label, state, action, children, rowId }: {
  icon: ReactNode;
  label: string;
  state?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  rowId: string;
}) {
  return (
    <div data-bot-profile-row={rowId} className="flex flex-col">
      <div className={cn("flex items-center gap-3 px-4", action ? "min-h-[56px] py-2.5" : "min-h-[44px] py-2")}>
        <span className="flex size-5 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-5" aria-hidden="true">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] leading-5 text-ink">{label}</span>
          {state !== undefined && state !== null && <span data-bot-profile-state="" className="truncate text-[12px] leading-4 text-ink-secondary">{state}</span>}
        </div>
        {action}
      </div>
      {children && <div className="px-4 pb-3 pt-1">{children}</div>}
    </div>
  );
}

/** A section of a tab's page: its name (and a lock when this viewer may
 * only read it) over its body, the same body as the bot panel's. */
function Block({ id, locked, children }: { id: PersonaCategory; locked: boolean; children: ReactNode }) {
  const Icon = ENTRY.get(id)?.icon ?? LayoutDashboard;
  return (
    <section
      aria-labelledby={`bot-profile-heading-${id}`}
      data-bot-profile-section={id}
      data-persona-section={id}
      data-open=""
      className="flex min-w-0 flex-col gap-2"
    >
      <h3 id={`bot-profile-heading-${id}`} className="m-0 flex items-center gap-2 px-1 text-[15px] font-medium leading-5 text-ink">
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        <span className="min-w-0 truncate">{sectionLabel(id)}</span>
        {locked && <Lock size={12} aria-label={t("persona.lockedBadge")} className="shrink-0 text-ink-tertiary" />}
      </h3>
      {children}
    </section>
  );
}

export function BotProfilePage({ bot, section, onClose }: { bot: Bot; section: BotSettingsSection; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const rootRef = useRef<HTMLElement>(null);
  const { noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const searchRef = useRef<HTMLInputElement>(null);
  const { available, slackUrl } = useBotSectionAvailability(bot.id);
  const viewerId = viewerActorId(state.config);
  const people = useOrgPeople();

  // A page this server does not offer (Slack without an Admin page, Shared
  // with off Perspicax, Who can see it where one person signs in) is not
  // listed; Simple mode hides what it hides in the bot panel. Nothing is
  // hidden for lack of a permission.
  const offered = (id: PersonaCategory) =>
    id === "slack" || id === "sharing" || id === "visibility" ? available(id) : true;
  const shown = (id: PersonaCategory) => (advanced || !simpleHidesBotSection(id)) && offered(id);

  // A link to a section this viewer does not get lands on its stand-in:
  // Who can see it and Shared with stand for each other.
  const resolve = (id: PersonaCategory): PersonaCategory =>
    shown(id) ? id
      : id === "visibility" && shown("sharing") ? "sharing"
        : id === "sharing" && shown("visibility") ? "visibility"
          : id;

  // A tab with nothing to show this viewer (Activity in Simple mode) is not
  // listed; a link to it lands on General.
  const tabShown = (id: BotProfileTab) => BOT_PROFILE_TAB_SECTIONS[id].some(shown);
  const resolveTab = (next: BotProfileTab): BotProfileTab => (tabShown(next) ? next : "general");
  const tabOf = (id: PersonaCategory): BotProfileTab => resolveTab(botProfileTabOf(resolve(id)) ?? "general");

  const [tab, setTab] = useState<BotProfileTab>(() => resolveTab(botProfileTabFor(section)));
  // The appearance pane under the header, unfolded by its pill, the mascot
  // or a link to Appearance.
  const [appearanceOpen, setAppearanceOpen] = useState(() => personaCategoryForSection(section) === "appearance");
  const [channel, setChannel] = useState<Channel | null>(() => (personaCategoryForSection(section) === "slack" ? "slack" : null));
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const q = settingsQuery(query);
  const scrollTo = useRef<string | null>(null);

  // Where a section lives: the header (identity, appearance), a channel
  // row, or a block on its tab.
  const placeOf = (target: BotSettingsSection): { category: PersonaCategory | null; selector: string | null } => {
    const category = personaCategoryForSection(target);
    if (!category) return { category, selector: null };
    if (category === "overview") return { category, selector: "[data-bot-profile-title]" };
    if (category === "appearance") return { category, selector: '[data-bot-profile-section="appearance"]' };
    const id = resolve(category);
    return { category: id, selector: id === "slack" ? '[data-bot-profile-row="slack"]' : `[data-bot-profile-section="${id}"]` };
  };

  // Opens a section where it lives: its tab, unfolded, scrolled into view.
  const reveal = (target: BotSettingsSection) => {
    const { category, selector } = placeOf(target);
    if (!category) return;
    if (category === "appearance") setAppearanceOpen(true);
    else if (category !== "overview") {
      setTab(tabOf(category));
      if (category === "slack") setChannel("slack");
    }
    scrollTo.current = selector;
  };

  // The store's section (a deep link, the panel's gear, a click on the mascot).
  const firstSection = useRef(true);
  useEffect(() => {
    if (firstSection.current) {
      firstSection.current = false;
      const { category, selector } = placeOf(section);
      if (category && category !== "overview") scrollTo.current = selector;
      return;
    }
    reveal(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  useLayoutEffect(() => {
    const selector = scrollTo.current;
    if (!selector) return;
    scrollTo.current = null;
    const node = rootRef.current?.querySelector<HTMLElement>(selector);
    node?.scrollIntoView?.({ block: "start", inline: "nearest" });
  });

  const goTo = (id: BotSettingsSection) => {
    const category = personaCategoryForSection(id);
    if (!category || !shown(resolve(category))) return;
    dispatch({ type: "personaEditorSection", section: id });
    reveal(id);
  };

  // The server overview loads with General (What it does), the history with
  // Activity: the tab on screen drives what the hook fetches.
  const hookSection: BotSettingsSection = tab === "general" ? "overview" : tab === "knowledge" ? "skills" : tab === "tools" ? "model" : "history";
  const { renderSectionBody, dialogs, derived } = useBotSectionContent(bot, {
    section: hookSection,
    expanded: true,
    onOpenSection: (next) => {
      if (personaCategoryForSection(next) !== null) {
        goTo(next);
        return;
      }
      // Routines and the other Details sections live in the bot panel.
      onClose();
      dispatch({ type: "toggleSettings", open: true, section: next, botId: bot.id });
    },
    returnFocusRef: rootRef,
    slackUrl,
    channelsElsewhere: true,
  });

  const lockOf = (id: BotSettingsSection): LocaleKey | null => botSectionLock(state.config, bot, id);
  const memoryAllowed = canEditBotField(state.config, bot, "memoryEnabled");

  const body = (id: PersonaCategory): ReactNode => {
    // What the server says the bot does, reaches and won't do, the prompt
    // preview and the recent changes.
    if (id === "summary") return renderSectionBody("overview");
    const lock = lockOf(id);
    if (lock) {
      return (
        <div className="flex flex-col gap-3">
          <Note>{t(lock)}</Note>
          {/* The soul is on the bot record: shown as it is, not editable. */}
          {id === "soul" && bot.soul?.trim() && (
            <pre data-persona-readonly="" aria-readonly="true" className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-card p-3 font-sans text-[13px] leading-relaxed text-ink-secondary">
              {bot.soul}
            </pre>
          )}
        </div>
      );
    }
    if (id === "rules") return <RulesSection bot={bot} active={tab === "knowledge"} />;
    if (id === "files") {
      // The Bot folder is also where the memory is managed: "Use memory"
      // heads it for a viewer who may change it.
      const memoryEditable = memoryAllowed && lockOf("memory") === null;
      return (
        <WorkspaceFilesSection
          bot={bot}
          active={tab === "knowledge"}
          memoryEditable={memoryEditable}
          memory={memoryEditable ? { enabled: bot.memoryEnabled !== false, busy: Boolean(bot.busy), onToggle: (enabled) => derived.patch({ memoryEnabled: enabled }) } : undefined}
          onOpenSection={goTo}
        />
      );
    }
    return renderSectionBody(id);
  };

  const block = (id: PersonaCategory) => (shown(id) ? <Block key={id} id={id} locked={lockOf(id) !== null}>{body(id)}</Block> : null);

  // The search: the pages the query leads to, best first. The first one's
  // tab opens and hides its rows that do not match; the tabs of the others
  // stay plain, the rest dim.
  const pages = useMemo(
    () => PERSONA_CATEGORIES.filter((id) => id !== "overview" && shown(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [advanced, slackUrl, available("sharing"), available("visibility")],
  );
  const results = useMemo(() => personaPagesMatching(pages, q, sectionLabel), [pages, q]);
  const searchHit = q ? results[0] ?? null : null;
  const matching = new Set(results.filter((id) => id !== "appearance").map(tabOf));
  const changeQuery = (value: string) => {
    setQuery(value);
    const next = settingsQuery(value);
    if (!next) return;
    const first = personaPagesMatching(pages, next, sectionLabel)[0];
    if (!first) return;
    if (first === "appearance") setAppearanceOpen(true);
    else setTab(tabOf(first));
  };
  useLayoutEffect(() => {
    const root = searchHit ? rootRef.current?.querySelector<HTMLElement>(`[data-bot-profile-section="${searchHit}"]`) : null;
    if (!root || !q) return;
    let scroll = true;
    const apply = () => {
      const hit = applySettingsSearch(root, q);
      if (scroll && hit) hit.scrollIntoView?.({ block: "center", inline: "nearest" });
      scroll = false;
    };
    apply();
    const observer = new MutationObserver(() => apply());
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearSettingsSearch(root);
    };
  }, [q, searchHit, tab, appearanceOpen]);

  const focusSearch = () =>
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  const openSearch = () => {
    setSearching(true);
    focusSearch();
  };
  const closeSearch = () => {
    setSearching(false);
    setQuery("");
  };

  // Command-F or a slash opens the search, from anywhere on the page.
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || (event.target !== document.body && !root.contains(event.target))) return;
      const find = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing;
      if (!find && !slash) return;
      event.preventDefault();
      openSearchRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Escape clears the query, then puts the field away; on the page it closes.
  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (query) {
      setQuery("");
      return;
    }
    closeSearch();
    rootRef.current?.focus({ preventScroll: true });
  };

  // Header: who sees it, who owns it, what this viewer may change.
  const sharing = personaSharingSummary(bot);
  const notShared = sharing === t("botSettings.sharing.empty");
  const audience = notShared && viewerOwnsBot(bot, viewerId) ? t("botProfile.privateToYou") : sharing;
  const isPrimary = isViewersPrimaryBot(bot, viewerId);
  const ownerId = bot.ownerUserId?.trim() ?? "";
  const ownerPerson = people.get(ownerId.toLowerCase());
  const owner = ownerId && !viewerOwnsBot(bot, viewerId) ? personLabel(ownerPerson?.name, ownerPerson?.login, ownerId) : "";
  const canName = canEditBotField(state.config, bot, "name");
  const canLabel = canEditBotField(state.config, bot, "title");
  const canDescribe = canEditBotField(state.config, bot, "description");
  const canColor = canEditBotField(state.config, bot, "color") && lockOf("appearance") === null;
  const colors = paletteSwatches(mascotColorGroup(bot.color));

  const tabs: readonly BotProfileTab[] = BOT_PROFILE_TABS.filter(tabShown);

  // The page fills the main panel (#2136): focus moves in when it opens and
  // back to the opener when it closes; Escape closes it (empty search).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement && !root.contains(document.activeElement) ? document.activeElement : null;
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    const onBodyKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (event.target !== document.body) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onBodyKey);
    return () => {
      window.removeEventListener("keydown", onBodyKey);
      const active = document.activeElement;
      const focusWasHere = !active || active === document.body || root.contains(active);
      if (focusWasHere && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const privateBot = notShared;
  // The banner is a wash of the mascot's colour (#2173): its hex goes to the
  // stylesheet as a variable; a neutral mascot keeps a visible grey there.
  const bannerColor = MAUS_COLORS[bot.color] ?? MAUS_COLORS.green;
  const bannerStyle = { "--bot-profile-banner-color": bannerColor } as CSSProperties;

  // A tab's page: two columns of blocks on a wide window, one under 900px.
  // Knowledge stays mounted (hidden) so Rules and the Bot folder keep an
  // unsaved draft across tabs; the others mount when shown.
  const panel = (id: BotProfileTab, left: ReactNode, right: ReactNode) => (
    <div
      key={id}
      id={`bot-profile-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`bot-profile-tab-${id}`}
      data-bot-profile-panel={id}
      hidden={tab !== id}
      className="mt-5 grid grid-cols-1 gap-6 min-[900px]:grid-cols-2 min-[900px]:items-start"
    >
      <div data-bot-profile-column-side="left" className="flex min-w-0 flex-col gap-6">{left}</div>
      <div data-bot-profile-column-side="right" className="flex min-w-0 flex-col gap-6">{right}</div>
    </div>
  );
  const column = (id: BotProfileTab, side: 0 | 1) => COLUMNS[id][side].map(block);

  return (
    <main
      ref={rootRef}
      tabIndex={-1}
      aria-label={`${t("persona.title")}: ${bot.name}`}
      data-bot-profile-page=""
      data-bot-profile-placement="main"
      data-persona-modal=""
      data-bot-profile-tab-current={tab}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }}
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-app text-ink outline-none"
    >
      <WindowDragStrip />
      <div data-bot-profile-scroll="" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* Banner in the mascot's colour, the close button and who sees it
            on it, the mascot over its lower edge. */}
        <div
          data-bot-profile-banner=""
          data-bot-profile-banner-palette={mascotColorGroup(bot.color)}
          style={bannerStyle}
          className="bot-profile-banner relative h-[145px] w-full shrink-0"
        >
          <WindowCloseButton onClose={onClose} />
          <span
            data-bot-profile-visibility={privateBot ? "private" : "shared"}
            style={controlsShiftStyle ?? noDragStyle}
            className={cn(CIRCLE_LABEL, "absolute right-3 top-3")}
          >
            {privateBot ? <Lock size={14} strokeWidth={1.75} aria-hidden="true" /> : <Users size={14} strokeWidth={1.75} aria-hidden="true" />}
            {privateBot ? t("botProfile.private") : t("botProfile.shared")}
          </span>
        </div>
        {/* One centred column, 1100px wide at most, a 16px gutter on a phone. */}
        <div data-bot-profile-column="" className="mx-auto flex w-full max-w-[1100px] flex-col px-4 pb-10 sm:px-6">
          {/* The header: the bot's appearance and identity, edited in place. */}
          <header data-bot-profile-header="" data-bot-profile-section="overview" data-persona-section="overview" data-open="" className="flex min-w-0 flex-col">
            <div className="-mt-[40px] w-fit">
              <BotProfileAvatarCard
                bot={bot}
                activeState={derived.activeState}
                mascotMotion={derived.mascotMotion}
                onPatch={derived.patch}
                size={56}
                onOpen={() => setAppearanceOpen((prev) => !prev)}
              />
            </div>
            {/* The name alone on its line, the label under it, smaller and
                secondary (JC: never "Name · Label" on one line). */}
            <h2 id="bot-profile-title" data-bot-profile-title="" className="mt-2 flex min-w-0 text-[28px] font-normal leading-9 text-ink">
              <InlineEditableText
                value={bot.name}
                required
                maxLength={BOT_PROFILE_LIMITS.name}
                ariaLabel={t("botPanel.name.edit")}
                onSave={canName ? (name) => derived.patch({ name }) : undefined}
                className="min-w-0 text-[28px] font-normal leading-9 text-ink"
              />
            </h2>
            {(bot.title?.trim() || canLabel) && (
              <div data-bot-profile-label="" className="flex min-w-0 text-[15px] leading-5 text-ink-secondary">
                <InlineEditableText
                  value={bot.title ?? ""}
                  maxLength={BOT_PROFILE_LIMITS.title}
                  placeholder={t("botPanel.label.add")}
                  ariaLabel={t("botPanel.label.edit")}
                  onSave={canLabel ? (title) => derived.patch({ title }) : undefined}
                  className="min-w-0 text-[15px] leading-5 text-ink-secondary"
                />
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] leading-5 text-ink-secondary">
              <span data-bot-profile-audience="" className="inline-flex items-center gap-1.5">
                <Lock size={13} aria-hidden="true" /> {audience}
              </span>
              {owner && (
                <span data-bot-profile-owner="" className="inline-flex items-center gap-1.5">
                  <Users size={13} aria-hidden="true" /> {t("persona.overview.owner")}: {owner}
                </span>
              )}
              {isPrimary && (
                <span className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11.5px]">
                  <Star size={11} aria-hidden="true" className="text-accent" /> {t("primaryBot.badge")}
                </span>
              )}
            </div>
            {/* The description, typed in place; grows with its text. */}
            {canDescribe ? (
              <textarea
                data-bot-profile-description=""
                rows={2}
                maxLength={BOT_PROFILE_LIMITS.description}
                placeholder={t("botPanel.identity.blurbPlaceholder")}
                aria-label={t("persona.overview.description")}
                value={bot.description}
                onChange={(event) => derived.patch({ description: event.target.value })}
                className="mt-3 max-h-[12lh] w-full resize-none rounded-lg bg-transparent px-0 py-0 text-[14px] leading-6 text-ink field-sizing-content placeholder:text-ink-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              />
            ) : (
              <p data-bot-profile-description="" className="mt-3 whitespace-pre-wrap text-[14px] leading-6 text-ink">
                {bot.description.trim() || <span className="text-ink-secondary">{t("persona.overview.noDescription")}</span>}
              </p>
            )}
            {/* The colour dots and the Appearance pill that unfolds the rest. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {canColor && (
                <div role="radiogroup" aria-label={t("mascot.color.title")} data-bot-profile-colors="" className="flex flex-wrap items-center gap-2">
                  {colors.map((name) => (
                    <button
                      key={name}
                      type="button"
                      role="radio"
                      aria-checked={bot.color === name}
                      aria-label={t("mascot.color.use", { color: name })}
                      data-mascot-color={name}
                      onClick={() => derived.patch({ color: name })}
                      style={swatchStyle(name)}
                      className={cn(
                        "size-6 shrink-0 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                        bot.color === name && "ring-2 ring-ink/80 ring-offset-2 ring-offset-app",
                      )}
                    />
                  ))}
                </div>
              )}
              {shown("appearance") && (
                <button
                  type="button"
                  data-bot-profile-appearance-toggle=""
                  aria-expanded={appearanceOpen}
                  aria-controls="bot-profile-appearance"
                  onClick={() => setAppearanceOpen((prev) => !prev)}
                  className={cn(PILL, "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] leading-5", appearanceOpen ? "bg-hover text-ink" : "text-ink-secondary hover:text-ink")}
                >
                  <Palette size={14} strokeWidth={1.5} aria-hidden="true" />
                  {sectionLabel("appearance")}
                  {lockOf("appearance") !== null && <Lock size={11} aria-label={t("persona.lockedBadge")} className="shrink-0 text-ink-tertiary" />}
                  <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform", appearanceOpen && "rotate-180")} />
                </button>
              )}
            </div>
            {appearanceOpen && shown("appearance") && (
              <section
                id="bot-profile-appearance"
                aria-label={sectionLabel("appearance")}
                data-bot-profile-section="appearance"
                data-persona-section="appearance"
                data-open=""
                className="mt-4 flex flex-col gap-3"
              >
                {body("appearance")}
              </section>
            )}
          </header>

          {/* The pill tabs, wrapping when the window is narrow, and the
              search behind the magnifier. */}
          <div className="mt-5 flex items-start gap-1">
            <div
              role="tablist"
              data-bot-profile-tabs=""
              aria-label={t("botProfile.tabsAria")}
              onKeyDown={(event) => {
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]!;
                setTab(next);
                event.currentTarget.querySelector<HTMLElement>(`[data-bot-profile-tab="${next}"]`)?.focus();
              }}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
            >
              {tabs.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`bot-profile-tab-${id}`}
                  aria-controls={`bot-profile-panel-${id}`}
                  data-bot-profile-tab={id}
                  data-bot-profile-tab-match={q && matching.has(id) ? "" : undefined}
                  aria-selected={tab === id}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => setTab(id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[14px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    tab === id ? "bg-hover text-ink" : "text-ink-secondary hover:text-ink",
                    q && !matching.has(id) && "opacity-40",
                  )}
                >
                  {t(TAB_LABEL[id])}
                </button>
              ))}
            </div>
            <button
              type="button"
              data-bot-profile-search-toggle=""
              aria-expanded={searching}
              aria-label={t("persona.searchAria")}
              title={t("persona.search")}
              onClick={() => (searching ? closeSearch() : openSearch())}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                searching ? "bg-hover text-ink" : "text-ink-secondary",
              )}
            >
              <Search size={15} aria-hidden="true" />
            </button>
          </div>
          {searching && (
            <div data-bot-profile-search="" className="mt-3 flex flex-col">
              <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2">
                <Search size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                <input
                  ref={searchRef}
                  data-persona-search=""
                  value={query}
                  onChange={(event) => changeQuery(event.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder={t("persona.search")}
                  aria-label={t("persona.searchAria")}
                  className="w-full bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none"
                />
              </div>
              {q && results.length === 0 && (
                <div data-persona-no-match="" role="status" className="px-2.5 py-3 text-[12.5px] leading-relaxed text-ink-secondary">
                  {t("persona.noMatch", { query: query.trim() })}
                </div>
              )}
            </div>
          )}

          {panel(
            "general",
            tab === "general" && (
              <>
                <ChannelsCard bot={bot} slackUrl={slackUrl} open={channel} onOpen={setChannel} />
                {column("general", 0)}
              </>
            ),
            tab === "general" && (
              <>
                <AccountsCard bot={bot} onEngine={() => goTo("model")} />
                {column("general", 1)}
              </>
            ),
          )}
          {panel(
            "knowledge",
            column("knowledge", 0),
            <>
              {column("knowledge", 1)}
              <button
                type="button"
                data-bot-profile-memory=""
                onClick={() => dispatch({ type: "toggleMemoryManager", open: true })}
                className="flex w-full items-center gap-2.5 rounded-2xl bg-card px-4 py-3 text-left text-[13.5px] leading-5 text-ink transition-colors hover:bg-hover"
              >
                <Brain size={15} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                <span className="min-w-0 flex-1 truncate">{t("botProfile.memoryPage")}</span>
                <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
              </button>
            </>,
          )}
          {tabShown("tools") && panel("tools", tab === "tools" && column("tools", 0), tab === "tools" && column("tools", 1))}
          {tabShown("activity") && panel("activity", tab === "activity" && column("activity", 0), tab === "activity" && column("activity", 1))}
        </div>
      </div>
      {dialogs}
    </main>
  );
}

/** A card of the page: a grey label (and its accessory) over a borderless
 * surface a step lighter than the page (Grok Bot). */
function ProfileCard({ title, groupId, accessory, children }: {
  title: string;
  groupId: string;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-settings-group={groupId} className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1.5 px-1">
        <h3 id={headingId} className="shrink-0 text-[13px] font-normal leading-[18px] text-ink-secondary">{title}</h3>
        {accessory}
      </div>
      <div className="flex flex-col rounded-2xl bg-card py-1">{children}</div>
    </section>
  );
}

/** Slack's own four-color mark (the lucide outline, filled). */
function SlackLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-slack-logo="">
      <rect x="2" y="8" width="8" height="3" rx="1.5" fill="#36C5F0" />
      <path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5" fill="#36C5F0" />
      <rect x="13" y="2" width="3" height="8" rx="1.5" fill="#2EB67D" />
      <path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5" fill="#2EB67D" />
      <rect x="14" y="13" width="8" height="3" rx="1.5" fill="#ECB22E" />
      <path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5" fill="#ECB22E" />
      <rect x="8" y="14" width="3" height="8" rx="1.5" fill="#E01E5A" />
      <path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5" fill="#E01E5A" />
    </svg>
  );
}

/** General > Channels: where the bot can be reached, each with its state. */
function ChannelsCard({ bot, slackUrl, open, onOpen }: {
  bot: Bot;
  slackUrl: string | null | undefined;
  open: Channel | null;
  onOpen: (channel: Channel | null) => void;
}) {
  const { dispatch } = useStore();
  const [mail] = useBotInboundMailState(bot.id);
  const [reach] = useReachMe(bot.id);
  const [messages, setMessages] = useState<MessagesSetupStatus | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    loadMessagesSetup().then((status) => { if (!cancelled) setMessages(status); }, () => { if (!cancelled) setMessages(null); });
    return () => { cancelled = true; };
  }, []);

  const pill = (channel: Channel, connected: boolean) => (
    <button
      type="button"
      data-bot-profile-action={channel}
      aria-expanded={open === channel}
      onClick={() => onOpen(open === channel ? null : channel)}
      className={cn(PILL, "shrink-0")}
    >
      {open === channel ? t("botProfile.hide") : connected ? t("botProfile.manage") : t("botProfile.connect")}
    </button>
  );

  const reachOn = (reach?.settings.channels ?? []).map((id) => (REACH_LABEL[id] ? t(REACH_LABEL[id]!) : null)).filter((label): label is string => label !== null);
  const messagesHere = messages ? messages.available && messages.onThisMac : false;

  return (
    <ProfileCard title={t("botProfile.channels")} groupId="bot-profile-channels">
      <CardRow
        rowId="slack"
        icon={<SlackLogo />}
        label={t("botProfile.channel.slack")}
        state={slackUrl ? t("botProfile.state.managedInAdmin") : t("botProfile.state.notOffered")}
        action={slackUrl ? pill("slack", true) : undefined}
      >
        {slackUrl && open === "slack" ? <SlackSection managementUrl={slackUrl} /> : null}
      </CardRow>
      <CardRow
        rowId="email"
        icon={<Mail />}
        label={t("botProfile.channel.email")}
        state={mail === null ? null : !mail.available ? t("botProfile.state.notOffered") : mail.address ?? t("botProfile.state.noAddress")}
        action={mail?.available && mail.address ? pill("email", true) : undefined}
      >
        {open === "email" && mail?.address ? <BotEmailAddress botId={bot.id} /> : null}
      </CardRow>
      <CardRow
        rowId="reachMe"
        icon={<BellRing />}
        label={t("botPanel.reachMe.label")}
        state={reach === null ? null : reachOn.length > 0 ? reachOn.join(", ") : t("botProfile.state.notConnected")}
        action={reach === null ? undefined : pill("reachMe", reachOn.length > 0)}
      >
        {open === "reachMe" ? <BotReachMe botId={bot.id} /> : null}
      </CardRow>
      <CardRow
        rowId="messages"
        icon={<MessageCircle />}
        label={t("botProfile.channel.messages")}
        state={messages === undefined ? null : !messagesHere ? t("botProfile.state.unavailable") : messages!.useMessages ? t("botProfile.state.on") : t("botProfile.state.notConnected")}
        action={messagesHere ? (
          <button
            type="button"
            data-bot-profile-action="messages"
            onClick={() => {
              dispatch({ type: "togglePlugins", open: true, surface: "apps" });
              window.dispatchEvent(new CustomEvent("sagax:open-mac-messages"));
            }}
            className={cn(PILL, "shrink-0")}
          >
            {messages!.useMessages ? t("botProfile.manage") : t("botProfile.connect")}
          </button>
        ) : undefined}
      />
    </ProfileCard>
  );
}

/** General > Bot accounts: the bot's engine and the connectors it receives;
 * "Add" opens Connect apps for this bot. */
function AccountsCard({ bot, onEngine }: { bot: Bot; onEngine: () => void }) {
  const { dispatch } = useStore();
  const { data, error, loading, reload } = useBotCapabilities(bot.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dismissRoot = useAnchoredDismissRoot(anchorRef, popoverRef);
  usePopoverDismiss(menuOpen, dismissRoot, () => setMenuOpen(false));

  const connect = (surface: "apps" | "mcp") => {
    setMenuOpen(false);
    dispatch({ type: "togglePlugins", open: true, surface, botId: bot.id });
  };
  const accounts = data ? orderedCapabilities(data.items).filter((item) => item.form === "connector" || item.form === "mcp") : [];

  const add = (
    <div className="ml-auto">
      <button
        ref={anchorRef}
        type="button"
        data-bot-profile-add=""
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
        className={cn(PILL, "inline-flex items-center gap-1")}
      >
        {t("botProfile.add")} <ChevronDown size={13} aria-hidden="true" />
      </button>
      {menuOpen && (
        <AnchoredPopover
          anchorRef={anchorRef}
          popoverRef={popoverRef}
          align="end"
          role="menu"
          aria-label={t("botProfile.add")}
          className="w-[220px] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1 text-[13px] text-ink shadow-xl"
        >
          <button type="button" role="menuitem" onClick={() => connect("apps")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
            <Plug size={15} aria-hidden="true" /> {t("botProfile.add.apps")}
          </button>
          <button type="button" role="menuitem" onClick={() => connect("mcp")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
            <Cpu size={15} aria-hidden="true" /> {t("botProfile.add.mcp")}
          </button>
        </AnchoredPopover>
      )}
    </div>
  );

  return (
    <ProfileCard title={t("botProfile.accounts")} groupId="bot-profile-accounts" accessory={add}>
      {error && !data ? (
        <div role="alert" data-bot-profile-accounts-error="" className="flex flex-col items-start gap-1 px-4 py-3.5">
          <span className="text-[14px] font-normal leading-5 text-ink">{t("botProfile.accounts.error")}</span>
          <span className="text-[12.5px] leading-snug text-ink-secondary">{error}</span>
          <button type="button" onClick={() => void reload()} className={cn(PILL, "mt-1")}>{t("botProfile.retry")}</button>
        </div>
      ) : !data ? (
        <div role="status" className="px-4 py-3 text-[12.5px] text-ink-secondary">{loading ? t("botProfile.accounts.loading") : null}</div>
      ) : (
        <>
          <CardRow
            rowId="engine"
            icon={<Cpu />}
            label={data.engine.label}
            state={t("botProfile.engine")}
            action={<button type="button" data-bot-profile-action="engine" onClick={onEngine} className={cn(PILL, "shrink-0")}>{t("botProfile.manage")}</button>}
          />
          {accounts.map((item, index) => (
            <CardRow key={`${item.form}-${index}`} rowId={`account-${index}`} icon={<Plug />} label={capabilityName(item)} state={stateWord(item.state)} />
          ))}
          {accounts.length === 0 && (
            <p className="px-4 pb-2 pt-1 text-[12.5px] leading-snug text-ink-secondary">{t("botProfile.accounts.empty")}</p>
          )}
        </>
      )}
    </ProfileCard>
  );
}
