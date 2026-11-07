// The bot's profile page, V6 (#2612, the "Épuré Grok Bot" canvas; before
// it #2126, #2173, #2271): the surface that edits one bot, filling the main
// panel in place of the chat. Its top is the bot's appearance, edited in
// place: a banner in the mascot's colour with the mascot over its lower
// edge, the name with its title under it in plain grey, who sees it and the
// owner, the description and an Appearance pill that unfolds the full
// appearance pane under them. Then three pill tabs:
//
// - General: rows under grey labels. Settings (Personality, Model, Before
//   it acts), Channels (Channels, Shared with), Bot accounts (What it can
//   use), More (Rules, When it acts alone, Voice, Advanced settings,
//   Versions).
// - Knowledge: Its work (Routines, Skills, Folder and memory).
// - Stats: the bot's usage over 7, 30 or 90 days.
//
// Each row opens its own sub-page in the same column: Back, the title, one
// line of intro, then the cards. Nothing of the editor is gone: each
// sub-page shows the same section bodies (useBotSectionContent, and the
// Permissions and Access sections split in parts) that save through the
// same paths; each option is in exactly one sub-page. The magnifier beside
// the tabs searches every setting and opens the sub-page of the first hit.
//
// Opened by the store action openPersonaEditor ("..." > Edit bot, a click on
// the mascot, the bot panel's gear, a deep link to a section). A section asked
// for opens its tab and sub-page and scrolls into view. A section this
// viewer may not change says why (botSectionLock); nothing is hidden for
// lack of a permission.
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
  BOT_PROFILE_SUBPAGE_SECTIONS,
  BOT_PROFILE_TAB_GROUPS,
  BOT_PROFILE_TABS,
  PERSONA_CATEGORIES,
  type BotProfileSubPage,
  type BotProfileTab,
  type PersonaCategory,
  botProfileSubPageFor,
  botProfileSubPageOf,
  botProfileTabFor,
  botProfileTabOf,
  botProfileTabOfPage,
  botProfileTabPages,
  personaCategoryForSection,
} from "@/lib/persona-sections";
import { personaSharingSummary } from "@/lib/bot-sharing";
import { MAUS_COLORS } from "@/lib/mascot";
import { mascotColorGroup } from "../../../shared/mascot-colors";
import { approvalModeFor } from "../../../shared/approval-mode";
import { proactiveModeFor } from "../../../shared/proactive-mode";
import { PILL, SettingsSurfaceProvider } from "../SettingsPrimitives";
import { MascotHeroSlotContext } from "../floating-bots/mascot-hero-slot";
import { modelLabel } from "../ModelPicker.tsx-parts/helpers";
import { RulesSection } from "../bot-settings/RulesSection";
import { WorkspaceFilesSection } from "../bot-settings/WorkspaceFilesSection";
import { PermissionsSection, type PermissionsPart } from "../bot-settings/PermissionsSection";
import { AccessSection } from "../bot-settings/AccessSection";
import { DeveloperLink } from "../settings/DeveloperLink";
import { botSectionLock, useBotSectionAvailability, useBotSectionContent } from "../bot-settings/useBotSectionContent";
import { AccountsCard, Block, CardRow, ChannelsCard, Note, ProfileCard, sectionLabel, type Channel } from "./BotProfilePage.tsx-parts/cards";
import { BotProfileHeader, useBotProfileHero } from "./BotProfilePage.tsx-parts/BotProfileHeader";
import { BotProfileTabBar, useBotProfileSearch } from "./BotProfilePage.tsx-parts/BotProfileTabs";
import { BotProfileTopBar } from "./BotProfilePage.tsx-parts/BotProfileTopBar";
import { GROUP_LABEL, SUBPAGE_META, SubPage, SubPageRow } from "./BotProfilePage.tsx-parts/subpages";
import { BotUsageBreakdownSection } from "../bot-settings/BotUsageBreakdown";

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

  // A sub-page with nothing to show this viewer is not listed. The
  // channels, the bot's accounts, When it acts alone, Rules and Routines
  // always have something; Advanced settings is for Advanced mode.
  const subPageShown = (id: BotProfileSubPage): boolean => {
    if (id === "advanced") return advanced;
    if (id === "channels" || id === "accounts" || id === "actsAlone" || id === "rules" || id === "routines") return true;
    return BOT_PROFILE_SUBPAGE_SECTIONS[id].some(shown);
  };
  const resolvePage = (id: BotProfileSubPage | null): BotProfileSubPage | null => (id && subPageShown(id) ? id : null);

  // A tab with nothing to show this viewer (Stats in Simple mode) is not
  // listed; a link to it lands on General.
  const tabShown = (id: BotProfileTab) => (id === "stats" ? shown("usage") : botProfileTabPages(id).some(subPageShown));
  const resolveTab = (next: BotProfileTab): BotProfileTab => (tabShown(next) ? next : "general");
  const tabOf = (id: PersonaCategory): BotProfileTab => resolveTab(botProfileTabOf(resolve(id)) ?? "general");
  const pageOf = (id: PersonaCategory): BotProfileSubPage | null => resolvePage(botProfileSubPageOf(resolve(id)));

  const [page, setPage] = useState<BotProfileSubPage | null>(() => resolvePage(botProfileSubPageFor(section)));
  const [tab, setTab] = useState<BotProfileTab>(() => {
    const first = resolvePage(botProfileSubPageFor(section));
    return first ? botProfileTabOfPage(first) : resolveTab(botProfileTabFor(section));
  });
  // The appearance pane under the header, unfolded by its pill, the mascot
  // or a link to Appearance.
  const [appearanceOpen, setAppearanceOpen] = useState(() => personaCategoryForSection(section) === "appearance");
  const [channel, setChannel] = useState<Channel | null>(() => (personaCategoryForSection(section) === "slack" ? "slack" : null));
  const scrollTo = useRef<string | null>(null);
  // The Share popover of the top bar (Grok Bot): the one place the people
  // and groups the bot is shared with are managed.
  const [shareOpen, setShareOpen] = useState(false);

  // A row opens its sub-page at the top; Back returns to the row.
  const openPage = (next: BotProfileSubPage) => {
    setTab(botProfileTabOfPage(next));
    setPage(next);
    scrollTo.current = "[data-bot-profile-subpage]";
  };
  const back = () => {
    const from = page;
    setPage(null);
    if (from) scrollTo.current = `[data-bot-profile-row="page-${from}"]`;
  };
  const openTab = (next: BotProfileTab) => {
    setTab(next);
    setPage(null);
  };

  // Where a section lives: the header (identity, appearance), a channel
  // row, or a block on its sub-page.
  const placeOf = (target: BotSettingsSection): { category: PersonaCategory | null; selector: string | null } => {
    const category = personaCategoryForSection(target);
    if (!category) return { category, selector: null };
    if (category === "overview") return { category, selector: "[data-bot-profile-title]" };
    if (category === "appearance") return { category, selector: '[data-bot-profile-section="appearance"]' };
    const id = resolve(category);
    return { category: id, selector: id === "slack" ? '[data-bot-profile-row="slack"]' : `[data-bot-profile-section="${id}"]` };
  };

  // Opens a section where it lives: its tab and sub-page, scrolled into view.
  const openCategory = (category: PersonaCategory) => {
    setTab(tabOf(category));
    setPage(pageOf(category));
    if (category === "slack") setChannel("slack");
  };
  const reveal = (target: BotSettingsSection) => {
    const { category, selector } = placeOf(target);
    if (!category) return;
    if (category === "appearance") setAppearanceOpen(true);
    else if (category !== "overview") openCategory(category);
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
    if (node?.matches("[data-bot-profile-row]")) node.focus({ preventScroll: true });
  });

  const goTo = (id: BotSettingsSection) => {
    const category = personaCategoryForSection(id);
    if (!category || !shown(resolve(category))) return;
    dispatch({ type: "personaEditorSection", section: id });
    reveal(id);
  };

  // The sub-page on screen drives what the hook fetches: the server
  // overview with Personality and the lists, the history with Versions.
  const hookSection: BotSettingsSection = page
    ? page === "versions" ? "history"
      : page === "routines" ? "routines"
        : page === "skills" ? "skills"
          : page === "folder" ? "skills"
            : page === "personality" || page === "channels" || page === "sharing" ? "overview"
              : "model"
    : tab === "stats" ? "usage" : tab === "knowledge" ? "skills" : "overview";
  const { renderSectionBody, dialogs, derived } = useBotSectionContent(bot, {
    section: hookSection,
    expanded: true,
    onOpenSection: (next) => {
      if (next === "routines") {
        openPage("routines");
        return;
      }
      if (personaCategoryForSection(next) !== null) {
        goTo(next);
        return;
      }
      // The other Details sections live in the bot panel.
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
    if (id === "rules") return <RulesSection bot={bot} active={page === "rules"} />;
    if (id === "files") {
      // The Bot folder is also where the memory is managed: "Use memory"
      // heads it for a viewer who may change it.
      const memoryEditable = memoryAllowed && lockOf("memory") === null;
      return (
        <WorkspaceFilesSection
          bot={bot}
          active={page === "folder"}
          memoryEditable={memoryEditable}
          memory={memoryEditable ? { enabled: bot.memoryEnabled !== false, busy: Boolean(bot.busy), onToggle: (enabled) => derived.patch({ memoryEnabled: enabled }) } : undefined}
          onOpenSection={goTo}
        />
      );
    }
    return renderSectionBody(id);
  };

  const block = (id: PersonaCategory) => (shown(id) ? <Block key={id} id={id} locked={lockOf(id) !== null}>{body(id)}</Block> : null);
  // One part of Permissions or Access on a sub-page (V6): the same section,
  // split so each option is in one sub-page only. A locked section shows
  // its reason instead.
  const permissions = (part: PermissionsPart) =>
    shown("permissions") ? (
      <Block key={`permissions-${part}`} id="permissions" locked={lockOf("permissions") !== null}>
        {lockOf("permissions") ? body("permissions") : <PermissionsSection bot={bot} derived={derived} part={part} />}
      </Block>
    ) : null;
  const access = (part: "mcp" | "brief" | "advanced") =>
    shown("access") ? (
      <Block key={`access-${part}`} id="access" locked={lockOf("access") !== null}>
        {lockOf("access") ? body("access") : <AccessSection bot={bot} derived={derived} part={part} />}
      </Block>
    ) : null;

  // Each sub-page's cards, in the canvas's order.
  const subPageBody = (id: BotProfileSubPage): ReactNode => {
    switch (id) {
      case "personality":
        return <>{block("summary")}{block("soul")}</>;
      case "model":
        return <>{block("model")}{block("worksOn")}</>;
      case "beforeActing":
        return permissions("beforeActing");
      case "channels":
        return <ChannelsCard bot={bot} slackUrl={slackUrl} open={channel} onOpen={setChannel} />;
      case "sharing":
        return <>{block("sharing")}{block("visibility")}</>;
      case "accounts":
        return <><AccountsCard bot={bot} onEngine={() => openPage("model")} />{access("mcp")}</>;
      case "rules":
        return <>{block("rules")}{permissions("rules")}</>;
      case "actsAlone":
        return <>{permissions("actsAlone")}{access("brief")}</>;
      case "voice":
        return block("voice");
      case "advanced":
        // #2658: the technical cards are on Settings > Developer > Per bot
        return <>{permissions("advanced")}{access("advanced")}<DeveloperLink bot={bot} /></>;
      case "versions":
        return block("history");
      case "routines":
        return <div data-bot-profile-section="routines" aria-label={t(SUBPAGE_META.routines.title)} className="flex min-w-0 flex-col gap-6">{renderSectionBody("routines")}</div>;
      case "skills":
        return block("skills");
      case "folder":
        return (
          <>
            {block("files")}
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
          </>
        );
    }
  };

  // The short value a row shows on its right (the canvas): the model, the
  // approval level, who it is shared with, whether it acts alone.
  const selection = bot.modelSelection;
  const rowValue = (id: BotProfileSubPage): string | null => {
    if (id === "model") {
      if (!selection) return null;
      if (selection.auto) return t("botProfile.v6.value.auto");
      return modelLabel(state.instances.find((instance) => instance.instanceId === selection.instanceId), selection.model);
    }
    if (id === "beforeActing") return t(`approvalMode.${approvalModeFor(bot)}.chip` as LocaleKey);
    if (id === "sharing") return personaSharingSummary(bot);
    if (id === "actsAlone") return t(proactiveModeFor(bot) === "off" ? "botProfile.v6.value.off" : "botProfile.v6.value.proactive");
    return null;
  };

  const pages = useMemo(
    () => PERSONA_CATEGORIES.filter((id) => id !== "overview" && shown(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [advanced, slackUrl, available("sharing"), available("visibility")],
  );
  const search = useBotProfileSearch({
    rootRef,
    pages,
    tabOf,
    view: `${tab}/${page ?? ""}`,
    appearanceOpen,
    onOpenCategory: openCategory,
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
      data-bot-profile-subpage-current={page ?? undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (page) back();
        else onCloseRef.current();
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
        <div data-bot-profile-column="" className="mx-auto flex w-full max-w-[760px] flex-col px-4 pb-10 sm:px-6">
          <BotProfileHeader
            bot={bot}
            derived={derived}
            hero={hero}
            appearance={appearanceOpen && shown("appearance") ? body("appearance") : null}
          />

          {(!page || search.searching) && <BotProfileTabBar tabs={tabs} tab={tab} onTab={openTab} search={search} />}

          {page ? (
            <SubPage key={page} page={page} onBack={back}>{subPageBody(page)}</SubPage>
          ) : (
            <div
              key={tab}
              id={`bot-profile-panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`bot-profile-tab-${tab}`}
              data-bot-profile-panel={tab}
              className="mt-5 flex min-w-0 flex-col gap-6"
            >
              {tab === "stats"
                ? (
                    <>
                      <BotUsageBreakdownSection bot={bot} />
                      {block("usage")}
                    </>
                  )
                : BOT_PROFILE_TAB_GROUPS[tab].map((group) => {
                    const rows = group.pages.filter(subPageShown);
                    if (rows.length === 0) return null;
                    return (
                      <ProfileCard key={group.id} title={t(GROUP_LABEL[group.id]!)} groupId={`bot-profile-group-${group.id}`}>
                        {rows.map((id) => <SubPageRow key={id} page={id} value={rowValue(id)} onOpen={() => openPage(id)} />)}
                      </ProfileCard>
                    );
                  })}
            </div>
          )}
        </div>
      </div>
      {dialogs}
    </main>
    </SettingsSurfaceProvider>
    </MascotHeroSlotContext.Provider>
  );
}
