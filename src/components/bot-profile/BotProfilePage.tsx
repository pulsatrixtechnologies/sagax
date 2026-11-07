// The bot's profile page (#2126, #2173, #2271, Grok Bot's layout): the
// surface that edits one bot, filling the main panel in place of the chat.
// Its top is the bot's appearance, edited in place: a banner in the mascot's
// colour with the mascot over its lower edge, "Name · Label", who sees it
// ("Private to you") and the owner, the description and an
// Appearance pill that unfolds the full appearance pane (its four tabs; the
// colour dots live in its Color tab only) under them. Then five pill tabs,
// each ONE column of cards (JC 2026-11-06: one column, one option in one
// place, every card in the Channels / Bot accounts style: a grey label over
// a borderless filled surface of rows):
//
// - General: the bot's channels (Slack, email, Reach me, Mac Messages), each
//   with its state and a Connect / Manage pill, the bot's accounts (its
//   engine and the connectors it receives), What it does, Shared with (a
//   summary row; the people are managed in the top bar's Share popover),
//   Who pays for replies, the shared vault and Who can see it.
// - Knowledge: Skills, Personality, Rules, the Bot folder (where the memory
//   is managed) and a link to the Memory page.
// - Model & tools: Model, Workspace, Access, Permissions, Voice & alerts.
// - Activity: Changes.
// - Analytics: the bot's usage over 7, 30 or 90 days.
//
// Nothing of the editor is gone: each section is the same body
// (useBotSectionContent) and saves through the same paths. The magnifier
// beside the tabs searches every setting. The page renders no heading of
// its own for a section: every card carries its own grey label, so the
// hierarchy is one level (labels outside the cards, rows inside).
//
// Opened by the store action openPersonaEditor ("..." > Edit bot, a click on
// the mascot, the bot panel's gear, a deep link to a section). A section asked
// for opens its tab and scrolls into view. A section this viewer may not
// change says why (botSectionLock); nothing is hidden for lack of a
// permission. The page itself carries no gear: the bot's settings live here
// and in the right-hand bot panel.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Brain, ChevronRight, Users } from "lucide-react";

import { useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesBotSection } from "@/lib/interface-visibility";
import { canEditBotField } from "@/lib/bot-capabilities";
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
import { MAUS_COLORS } from "@/lib/mascot";
import { mascotColorGroup } from "../../../shared/mascot-colors";
import { PILL, SettingsSurfaceProvider } from "../SettingsPrimitives";
import { MascotHeroSlotContext } from "../floating-bots/mascot-hero-slot";
import { RulesSection } from "../bot-settings/RulesSection";
import { WorkspaceFilesSection } from "../bot-settings/WorkspaceFilesSection";
import { botSectionLock, useBotSectionAvailability, useBotSectionContent } from "../bot-settings/useBotSectionContent";
import { AccountsCard, Block, CardRow, ChannelsCard, Note, ProfileCard, SECTIONS, sectionLabel, type Channel } from "./BotProfilePage.tsx-parts/cards";
import { BotProfileHeader, useBotProfileHero } from "./BotProfilePage.tsx-parts/BotProfileHeader";
import { BotProfileTabBar, useBotProfileSearch } from "./BotProfilePage.tsx-parts/BotProfileTabs";
import { BotProfileTopBar } from "./BotProfilePage.tsx-parts/BotProfileTopBar";

export function BotProfilePage({ bot, section, onClose }: { bot: Bot; section: BotSettingsSection; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const rootRef = useRef<HTMLElement>(null);
  const { available, slackUrl } = useBotSectionAvailability(bot.id);

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
  const scrollTo = useRef<string | null>(null);
  // The Share popover of the top bar (Grok Bot): the one place the people
  // and groups the bot is shared with are managed.
  const [shareOpen, setShareOpen] = useState(false);

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
  const hookSection: BotSettingsSection =
    tab === "general" ? "overview" : tab === "knowledge" ? "skills" : tab === "tools" ? "model" : tab === "analytics" ? "usage" : "history";
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
    sharingElsewhere: true,
  });

  const lockOf = (id: BotSettingsSection): LocaleKey | null => botSectionLock(state.config, bot, id);
  const memoryAllowed = canEditBotField(state.config, bot, "memoryEnabled");

  const body = (id: PersonaCategory): ReactNode => {
    // What the server says the bot does, reaches and won't do, the prompt
    // preview and the recent changes.
    if (id === "summary") return renderSectionBody("overview");
    // Shared with: one summary row whose Manage opens the top bar's Share
    // popover (the people and groups are edited there, nowhere else), then
    // who pays for the replies and the shared vault.
    if (id === "sharing") {
      return (
        <>
          <ProfileCard title={sectionLabel("sharing")} groupId="botSharing">
            <CardRow
              rowId="sharing"
              icon={<Users strokeWidth={1.5} />}
              label={t("botProfile.sharing.people")}
              state={personaSharingSummary(bot)}
              action={
                <button type="button" data-bot-profile-share-open="" onClick={() => setShareOpen(true)} className={cn(PILL, "shrink-0")}>
                  {t("botProfile.manage")}
                </button>
              }
            />
          </ProfileCard>
          {renderSectionBody("sharing")}
        </>
      );
    }
    const lock = lockOf(id);
    if (lock) {
      // A locked section is still a card (its label, the reason as a row),
      // never a bare note.
      return (
        <ProfileCard title={sectionLabel(id)} groupId={`bot-profile-locked-${id}`}>
          <Note>{t(lock)}</Note>
          {/* The soul is on the bot record: shown as it is, not editable. */}
          {id === "soul" && bot.soul?.trim() && (
            <pre data-persona-readonly="" aria-readonly="true" className="mx-4 mb-3 mt-1 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-inset p-3 font-sans text-[13px] leading-relaxed text-ink-secondary">
              {bot.soul}
            </pre>
          )}
        </ProfileCard>
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

  const pages = useMemo(
    () => PERSONA_CATEGORIES.filter((id) => id !== "overview" && shown(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [advanced, slackUrl, available("sharing"), available("visibility")],
  );
  const search = useBotProfileSearch({
    rootRef,
    pages,
    tabOf,
    tab,
    appearanceOpen,
    onOpenTab: setTab,
    onOpenAppearance: () => setAppearanceOpen(true),
  });

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

  const privateBot = personaSharingSummary(bot) === t("botSettings.sharing.empty");
  // The banner is a wash of the mascot's colour (#2173, back after #2313):
  // its hex goes to the stylesheet as a variable; a neutral mascot keeps a
  // visible grey there. The top bar carries the wash's top colour so the
  // bar and the banner read as one coloured header.
  const bannerColor = MAUS_COLORS[bot.color] ?? MAUS_COLORS.green;
  const bannerStyle = { "--bot-profile-banner-color": bannerColor } as CSSProperties;
  const bannerPalette = mascotColorGroup(bot.color);

  const { heroSlot, hero } = useBotProfileHero({
    bot,
    derived,
    appearanceShown: shown("appearance"),
    appearanceLocked: lockOf("appearance") !== null,
    appearanceOpen,
    onToggleAppearance: () => setAppearanceOpen((prev) => !prev),
  });

  // A tab's page: one column of cards (JC 2026-11-06). Knowledge stays
  // mounted (hidden) so Rules and the Bot folder keep an unsaved draft
  // across tabs; the others mount when shown.
  const panel = (id: BotProfileTab, children: ReactNode) => (
    <div
      key={id}
      id={`bot-profile-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`bot-profile-tab-${id}`}
      data-bot-profile-panel={id}
      hidden={tab !== id}
      className="mt-5 flex min-w-0 flex-col gap-6"
    >
      {children}
    </div>
  );
  const blocks = (id: BotProfileTab) => SECTIONS[id].map(block);

  return (
    <MascotHeroSlotContext.Provider value={heroSlot}>
    {/* The plain surface (JC 2026-11-06): every card of the page is the
        Channels / Bot accounts look, a grey label over a borderless filled
        surface, whichever section component draws it. */}
    <SettingsSurfaceProvider surface="plain">
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
      <BotProfileTopBar
        bot={bot}
        onClose={onClose}
        privateBot={privateBot}
        shareShown={shown("sharing")}
        shareOpen={shareOpen}
        onShareOpenChange={setShareOpen}
        bannerStyle={bannerStyle}
        bannerPalette={bannerPalette}
      />
      <div data-bot-profile-scroll="" className="content-card-body min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* Banner in the mascot's colour under the bar, the hero card over its lower edge. */}
        <div
          aria-hidden="true"
          data-bot-profile-banner=""
          data-bot-profile-banner-palette={bannerPalette}
          style={bannerStyle}
          className="bot-profile-banner h-[96px] w-full shrink-0"
        />
        {/* One centred column, a comfortable reading width (Grok Bot), a
            16px gutter on a phone. */}
        <div data-bot-profile-column="" className="mx-auto flex w-full max-w-[820px] flex-col px-4 pb-10 sm:px-6">
          <BotProfileHeader
            bot={bot}
            derived={derived}
            hero={hero}
            appearance={appearanceOpen && shown("appearance") ? body("appearance") : null}
          />

          <BotProfileTabBar tabs={tabs} tab={tab} onTab={setTab} search={search} />

          {panel(
            "general",
            tab === "general" && (
              <>
                <ChannelsCard bot={bot} slackUrl={slackUrl} open={channel} onOpen={setChannel} />
                <AccountsCard bot={bot} onEngine={() => goTo("model")} />
                {blocks("general")}
              </>
            ),
          )}
          {panel(
            "knowledge",
            <>
              {blocks("knowledge")}
              {/* The Memory page (every bot's memory): a row that opens it. */}
              <ProfileCard title={sectionLabel("memory")} groupId="botMemoryPage">
                <button
                  type="button"
                  data-bot-profile-memory=""
                  onClick={() => dispatch({ type: "toggleMemoryManager", open: true })}
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-2xl px-4 py-2 text-left transition-colors hover:bg-hover"
                >
                  <Brain strokeWidth={1.5} aria-hidden="true" className="size-5 shrink-0 text-ink-secondary" />
                  <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink">{t("botProfile.memoryPage")}</span>
                  <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
                </button>
              </ProfileCard>
            </>,
          )}
          {tabShown("tools") && panel("tools", tab === "tools" && blocks("tools"))}
          {tabShown("activity") && panel("activity", tab === "activity" && blocks("activity"))}
          {tabShown("analytics") && panel("analytics", tab === "analytics" && blocks("analytics"))}
        </div>
      </div>
      {dialogs}
    </main>
    </SettingsSurfaceProvider>
    </MascotHeroSlotContext.Provider>
  );
}
