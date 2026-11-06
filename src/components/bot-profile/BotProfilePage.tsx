// The bot's profile page (#2126, Grok Bot's layout): the surface that edits
// one bot, in the wide right-hand detail panel. A banner with the mascot over
// its lower edge, "Name · Label", who sees it ("Private to you"), then three
// pill tabs:
//
// - General: the bot's channels (Slack, email, Reach me, Mac Messages), each
//   with its state and a Connect / Manage pill, and the bot's accounts (its
//   engine and the connectors it receives), "Add" opening Connect apps for
//   this bot.
// - Knowledge: Skills, Personality, Rules, the Bot folder (where the memory
//   is managed) and a link to the Memory page.
// - Settings: every other section of the former editor, folded, with its
//   search. Nothing of the editor is gone: each section is the same body
//   (useBotSectionContent) and saves through the same paths.
//
// Opened by the store action openPersonaEditor ("..." > Edit bot, a click on
// the mascot, the bot panel's gear, a deep link to a section). A section asked
// for opens its tab, unfolds and scrolls into view. A section this viewer may
// not change says why (botSectionLock); nothing is hidden for lack of a
// permission.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { BellRing, Brain, ChevronDown, ChevronRight, Cpu, LayoutDashboard, Lock, Mail, MessageCircle, Plug, Search, Star, Users, X } from "lucide-react";

import { useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesBotSection } from "@/lib/interface-visibility";
import { canEditBotField } from "@/lib/bot-capabilities";
import { isViewersPrimaryBot, viewerOwnsBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";
import { personaPagesMatching } from "@/lib/persona-search";
import { applySettingsSearch, clearSettingsSearch, settingsQuery } from "@/lib/settings-search";
import { useBotInboundMailState } from "@/lib/bot-inbound-mail";
import { useReachMe } from "@/lib/reach-me";
import { loadMessagesSetup } from "@/lib/mac-messages-setup";
import { capabilityName, orderedCapabilities, stateWord, useBotCapabilities } from "@/lib/capabilities";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import {
  KNOWLEDGE_SECTIONS,
  SETTINGS_SECTIONS,
  botProfileTabFor,
  personaCategoryForSection,
  type BotProfileTab,
  type PersonaCategory,
} from "@/lib/persona-sections";
import type { MessagesSetupStatus } from "../../../shared/mac-messages-setup";
import { BOT_PROFILE_LIMITS } from "../../../shared/bot-profile";
import { WindowDragStrip, useCaptionChrome } from "../DesktopCapabilities";
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
import { PersonaOverview, personaSharingSummary } from "../persona/PersonaOverview";

const ENTRY = new Map(BOT_SECTIONS.map((entry) => [entry.id, entry]));

/** A section's name, as the editor's rail named it. */
function sectionLabel(id: BotSettingsSection): string {
  const entry = ENTRY.get(id);
  if (!entry) return id;
  return entry.labelKey ? t(entry.labelKey) : entry.label;
}

/** The tabs shown: Settings is folded into General (#2136). */
const VISIBLE_TABS = ["general", "knowledge"] as const satisfies readonly BotProfileTab[];
type VisibleTab = (typeof VISIBLE_TABS)[number];

const TAB_LABEL: Record<VisibleTab, LocaleKey> = {
  general: "botProfile.tab.general",
  knowledge: "botProfile.tab.knowledge",
};

const REACH_LABEL: Record<string, LocaleKey> = {
  push: "botPanel.reachMe.push.label",
  sms: "botPanel.reachMe.sms.label",
  teams: "botPanel.reachMe.teams.label",
  telegram: "botPanel.reachMe.telegram.label",
  whatsapp: "botPanel.reachMe.whatsapp.label",
};

/** Sections that keep an unsaved draft (their own Save button): mounted
 * while folded, so a draft survives a look elsewhere. */
const KEEP_MOUNTED: ReadonlySet<PersonaCategory> = new Set(["rules", "files"]);

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

/** A folded section: its name as a button, the body under it when open. */
function Fold({ id, label, icon, locked, open, keep, onToggle, children }: {
  id: PersonaCategory;
  label: string;
  icon: ReactNode;
  locked: boolean;
  open: boolean;
  keep: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = `bot-profile-section-${id}`;
  return (
    <section data-bot-profile-section={id} data-persona-section={id} data-open={open ? "" : undefined} className="flex flex-col">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left text-[13.5px] leading-5 text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <span className="shrink-0 text-ink-secondary [&>svg]:size-[15px]" aria-hidden="true">{icon}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {locked && <Lock size={12} aria-label={t("persona.lockedBadge")} className="shrink-0 text-ink-tertiary" />}
          {open ? <ChevronDown size={15} aria-hidden="true" className="shrink-0 text-ink-tertiary" /> : <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
        </button>
      </h3>
      {(open || keep) && (
        <div id={bodyId} hidden={!open} className="flex flex-col gap-3 px-1 pb-4 pt-1">
          {children}
        </div>
      )}
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

  const [tab, setTab] = useState<BotProfileTab>(() => botProfileTabFor(section));
  const [open, setOpen] = useState<ReadonlySet<PersonaCategory>>(() => {
    const first = personaCategoryForSection(section);
    const start = new Set<PersonaCategory>(["skills"]);
    if (first && first !== "overview" && first !== "slack") start.add(resolve(first));
    return start;
  });
  const [lastOpened, setLastOpened] = useState<PersonaCategory | null>(() => {
    const first = personaCategoryForSection(section);
    return first && first !== "overview" && first !== "slack" ? resolve(first) : null;
  });
  const [channel, setChannel] = useState<Channel | null>(() => (personaCategoryForSection(section) === "slack" ? "slack" : null));
  const [query, setQuery] = useState("");
  const q = settingsQuery(query);
  const scrollTo = useRef<string | null>(null);

  // Opens a section where it lives: its tab, unfolded, scrolled into view.
  const reveal = (target: BotSettingsSection) => {
    setTab(botProfileTabFor(target));
    const category = personaCategoryForSection(target);
    if (!category || category === "overview" && botProfileTabFor(target) === "general") return;
    if (category === "slack") {
      setChannel("slack");
      scrollTo.current = '[data-bot-profile-row="slack"]';
      return;
    }
    const id = resolve(category);
    setOpen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setLastOpened(id);
    scrollTo.current = `[data-bot-profile-section="${id}"]`;
  };

  // The store's section (a deep link, the gear, a click on the mascot).
  const firstSection = useRef(true);
  useEffect(() => {
    if (firstSection.current) {
      firstSection.current = false;
      const category = personaCategoryForSection(section);
      if (category && category !== "overview") scrollTo.current = category === "slack" ? '[data-bot-profile-row="slack"]' : `[data-bot-profile-section="${resolve(category)}"]`;
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

  const toggle = (id: PersonaCategory) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!open.has(id)) setLastOpened(id);
  };

  // The server overview loads with What it does open, the history with
  // Changes: the section last unfolded drives what the hook fetches.
  const { renderSectionBody, dialogs, derived } = useBotSectionContent(bot, {
    section: lastOpened === null || lastOpened === "summary" ? "overview" : lastOpened,
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
    if (id === "overview") return <PersonaOverview bot={bot} derived={derived} identity={false} />;
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
    if (id === "rules") return <RulesSection bot={bot} active={open.has("rules") && tab === "knowledge"} />;
    if (id === "files") {
      // The Bot folder is also where the memory is managed: "Use memory"
      // heads it for a viewer who may change it.
      const memoryEditable = memoryAllowed && lockOf("memory") === null;
      return (
        <WorkspaceFilesSection
          bot={bot}
          active={open.has("files") && tab === "knowledge"}
          memoryEditable={memoryEditable}
          memory={memoryEditable ? { enabled: bot.memoryEnabled !== false, busy: Boolean(bot.busy), onToggle: (enabled) => derived.patch({ memoryEnabled: enabled }) } : undefined}
          onOpenSection={goTo}
        />
      );
    }
    return renderSectionBody(id);
  };

  const fold = (id: PersonaCategory, forceOpen = false) => {
    const Icon = ENTRY.get(id)?.icon ?? LayoutDashboard;
    return (
      <Fold
        key={id}
        id={id}
        label={sectionLabel(id)}
        icon={<Icon strokeWidth={1.5} />}
        locked={lockOf(id) !== null}
        open={forceOpen || open.has(id)}
        keep={KEEP_MOUNTED.has(id) && lockOf(id) === null}
        onToggle={() => toggle(id)}
      >
        {body(id)}
      </Fold>
    );
  };

  // Settings' search: the sections the query leads to, best first; the
  // first one unfolds and hides its rows that do not match.
  const settingsPages = useMemo(
    () => SETTINGS_SECTIONS.filter(shown),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [advanced, slackUrl, available("sharing"), available("visibility")],
  );
  const results = useMemo(() => personaPagesMatching(settingsPages, q, sectionLabel), [settingsPages, q]);
  const searchHit = q ? results[0] ?? null : null;
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
  }, [q, searchHit, tab]);

  // Command-F or a slash goes to Settings' search, from anywhere on the page.
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
      setTab("settings");
      requestAnimationFrame(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape" || !query) return; // empty: the page closes
    event.preventDefault();
    event.stopPropagation();
    setQuery("");
  };

  // Header: who sees it.
  const sharing = personaSharingSummary(bot);
  const notShared = sharing === t("botSettings.sharing.empty");
  const audience = notShared && viewerOwnsBot(bot, viewerId) ? t("botProfile.privateToYou") : sharing;
  const isPrimary = isViewersPrimaryBot(bot, viewerId);
  const canName = canEditBotField(state.config, bot, "name");
  const canLabel = canEditBotField(state.config, bot, "title");

  // Two tabs show, General and Knowledge (Grok Bot). Settings is the
  // "settings" state of General: its sections unfold under the cards.
  const visibleTab: VisibleTab = tab === "settings" ? "general" : tab;
  const settingsOpen = tab === "settings";
  const chooseTab = (next: VisibleTab) => {
    if (next === visibleTab) return;
    setTab(next);
  };
  const toggleSettings = () => setTab(settingsOpen ? "general" : "settings");

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
        {/* Banner in the mascot's color, the close button and who sees it
            on it, the mascot over its lower edge. */}
        <div data-bot-profile-banner="" className="bot-profile-banner relative h-[90px] w-full shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
            style={noDragStyle}
            className="absolute left-3 top-3 flex size-8 items-center justify-center rounded-full bg-black/85 text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 max-sm:left-14"
          >
            <X size={16} aria-hidden="true" />
          </button>
          <span
            data-bot-profile-visibility={privateBot ? "private" : "shared"}
            style={controlsShiftStyle ?? noDragStyle}
            className="absolute right-3 top-3 inline-flex h-7 items-center gap-1.5 rounded-full bg-black/85 px-3 text-[12.5px] leading-none text-white"
          >
            {privateBot ? <Lock size={12} aria-hidden="true" /> : <Users size={12} aria-hidden="true" />}
            {privateBot ? t("botProfile.private") : t("botProfile.shared")}
          </span>
        </div>
        <div data-bot-profile-column="" className="mx-auto flex w-full max-w-[622px] flex-col px-4 pb-10 sm:max-w-[670px] sm:px-10 lg:max-w-[730px] lg:px-[70px]">
          <div className="-mt-[40px] w-fit">
            <BotProfileAvatarCard
              bot={bot}
              activeState={derived.activeState}
              mascotMotion={derived.mascotMotion}
              onPatch={derived.patch}
              size={56}
              onOpen={() => goTo("appearance")}
            />
          </div>
          <h2 id="bot-profile-title" className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[28px] font-normal leading-9 text-ink">
            <InlineEditableText
              value={bot.name}
              required
              maxLength={BOT_PROFILE_LIMITS.name}
              ariaLabel={t("botPanel.name.edit")}
              onSave={canName ? (name) => derived.patch({ name }) : undefined}
              className="text-[28px] font-normal leading-9 text-ink"
            />
            {(bot.title?.trim() || canLabel) && (
              <>
                <span aria-hidden="true" className="text-ink">·</span>
                <InlineEditableText
                  value={bot.title ?? ""}
                  maxLength={BOT_PROFILE_LIMITS.title}
                  placeholder={t("botPanel.label.add")}
                  ariaLabel={t("botPanel.label.edit")}
                  onSave={canLabel ? (title) => derived.patch({ title }) : undefined}
                  className="text-[28px] font-normal leading-9 text-ink"
                />
              </>
            )}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13.5px] leading-5 text-ink-secondary">
            <span data-bot-profile-audience="" className="inline-flex items-center gap-1.5">
              <Lock size={13} aria-hidden="true" /> {audience}
            </span>
            {isPrimary && (
              <span className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11.5px]">
                <Star size={11} aria-hidden="true" className="text-accent" /> {t("primaryBot.badge")}
              </span>
            )}
          </div>

          <div
            role="tablist"
            aria-label={t("botProfile.tabsAria")}
            onKeyDown={(event) => {
              const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const next = VISIBLE_TABS[(VISIBLE_TABS.indexOf(visibleTab) + step + VISIBLE_TABS.length) % VISIBLE_TABS.length]!;
              chooseTab(next);
              event.currentTarget.querySelector<HTMLElement>(`[data-bot-profile-tab="${next}"]`)?.focus();
            }}
            className="mt-5 flex w-fit items-center gap-1"
          >
            {VISIBLE_TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`bot-profile-tab-${id}`}
                aria-controls={`bot-profile-panel-${id}`}
                data-bot-profile-tab={id}
                aria-selected={visibleTab === id}
                tabIndex={visibleTab === id ? 0 : -1}
                onClick={() => chooseTab(id)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[14px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  visibleTab === id ? "bg-hover text-ink" : "text-ink-secondary hover:text-ink",
                )}
              >
                {t(TAB_LABEL[id])}
              </button>
            ))}
          </div>

          <div id="bot-profile-panel-general" role="tabpanel" aria-labelledby="bot-profile-tab-general" hidden={visibleTab !== "general"} className="mt-5 flex flex-col gap-6">
            {visibleTab === "general" && (
              <>
                <ChannelsCard bot={bot} slackUrl={slackUrl} open={channel} onOpen={setChannel} />
                <AccountsCard bot={bot} onEngine={() => goTo("model")} />
                {/* Every other section of the bot, folded under the cards
                    (progressive disclosure): nothing of the editor is gone. */}
                <section data-bot-profile-settings="" className="flex flex-col">
                  <button
                    type="button"
                    id="bot-profile-settings-toggle"
                    data-bot-profile-settings-toggle=""
                    aria-expanded={settingsOpen}
                    aria-controls="bot-profile-panel-settings"
                    onClick={toggleSettings}
                    className="flex w-fit items-center gap-1.5 rounded-full px-1 py-1 text-[13px] leading-[18px] text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    {settingsOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                    {t("botProfile.tab.settings")}
                  </button>
                  <div id="bot-profile-panel-settings" role="region" aria-labelledby="bot-profile-settings-toggle" hidden={!settingsOpen} className="mt-2 flex flex-col">
                    {settingsOpen && (
                      <>
                        <div className="mb-2 flex items-center gap-2 rounded-xl bg-card px-3 py-2">
                          <Search size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                          <input
                            ref={searchRef}
                            data-persona-search=""
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={onSearchKey}
                            placeholder={t("persona.search")}
                            aria-label={t("persona.searchAria")}
                            className="w-full bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none"
                          />
                        </div>
                        {q && results.length === 0 && (
                          <div data-persona-no-match="" role="status" className="px-2.5 py-4 text-[12.5px] leading-relaxed text-ink-secondary">
                            {t("persona.noMatch", { query: query.trim() })}
                          </div>
                        )}
                        {results.map((id) => fold(id, id === searchHit))}
                      </>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>

          {/* Knowledge stays mounted (hidden) so Rules and the Bot folder keep
              an unsaved draft across tabs. */}
          <div id="bot-profile-panel-knowledge" role="tabpanel" aria-labelledby="bot-profile-tab-knowledge" hidden={tab !== "knowledge"} className="mt-5 flex flex-col">
            {KNOWLEDGE_SECTIONS.filter(shown).map((id) => (tab === "knowledge" || (KEEP_MOUNTED.has(id) && open.has(id)) ? fold(id) : null))}
            {tab === "knowledge" && (
              <button
                type="button"
                data-bot-profile-memory=""
                onClick={() => dispatch({ type: "toggleMemoryManager", open: true })}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left text-[13.5px] leading-5 text-ink transition-colors hover:bg-hover"
              >
                <Brain size={15} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                <span className="min-w-0 flex-1 truncate">{t("botProfile.memoryPage")}</span>
                <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
              </button>
            )}
          </div>
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
