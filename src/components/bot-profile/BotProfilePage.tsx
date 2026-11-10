// The bot's profile page, V6 (#2612, the "Épuré Grok Bot" canvas; before
// it #2126, #2173, #2271): the surface that edits one bot, filling the main
// panel in place of the chat. Its top is the bot's appearance, edited in
// place: a low banner in the mascot's colour with the mascot small on the
// left over its lower edge, no card around it (Grok Bot, the owner 2026-11-09), the
// name with its title under it, who sees it and the owner, the description,
// all aligned left. The
// top bar floats over the banner and, once the name scrolls under it, turns
// into a blurred bar with the small mascot and the name. Then pill tabs:
//
// - General: section cards with their controls in place (#3398). Settings
//   (the switches "Collaborators can create routines" and "Notify me", then
//   the rows Personality, Model, Before it acts), the Channels card, the Bot
//   accounts card, More (Shared with, Rules, When it acts alone, Voice,
//   Advanced settings, Versions).
// - Appearance: the whole mascot editor (character, shape, colour, style,
//   moves, Play a move, Randomize); the character picked previews in the
//   hero.
// - Knowledge (#3400): To review (the learnings that wait, approved or
//   declined in place) and Skills in place, then Its work (Routines, Folder
//   and memory).
// - Stats: the bot's usage over 7, 30 or 90 days.
//
// A row opens its own sub-page in the same column, only for a setting too
// long for a card: a link back named after the tab (focused when the page
// opens), the title, one line of intro, then the cards. Each change applies in place, at once, as
// on the Settings pages (#3397): no Cancel and no Save bar, no question on
// leaving; Versions restores a change. Nothing of the editor is gone: each
// sub-page shows the same section bodies (useBotSectionContent, and the
// Permissions and Access sections split in parts) that save through the
// same paths; each option is in exactly one sub-page. The magnifier beside
// the tabs searches every setting and opens the sub-page of the first hit
// (or the General tab at its card).
//
// Opened by the store action openPersonaEditor ("..." > Edit bot, a click on
// the mascot, the bot panel's gear, a deep link to a section). A section asked
// for opens its tab and sub-page and scrolls into view. A section this
// viewer may not change says why (botSectionLock); nothing is hidden for
// lack of a permission.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Bell, Brain, ChevronRight, Repeat, Users } from "lucide-react";

import { openNotificationTarget, useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesBotSection } from "@/lib/interface-visibility";
import { canEditBotField } from "@/lib/bot-capabilities";
import {
  BOT_PROFILE_CARD_GROUP,
  BOT_PROFILE_SUBPAGE_SECTIONS,
  BOT_PROFILE_TAB_GROUPS,
  BOT_PROFILE_TABS,
  PERSONA_CATEGORIES,
  type BotProfileSubPage,
  type BotProfileTab,
  type PersonaCategory,
  botProfileCardOf,
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
import { DescribedRow, PILL, SettingsSurfaceProvider, Switch } from "../SettingsPrimitives";
import { NotifyMeRow } from "../bot-settings/VoiceSection";
import { MascotHeroSlotContext } from "../floating-bots/mascot-hero-slot";
import { RulesSection } from "../bot-settings/RulesSection";
import { WorkspaceFilesSection } from "../bot-settings/WorkspaceFilesSection";
import { SkillsSection } from "../bot-settings/SkillsSection";
import type { ReviewEntry } from "./BotProfilePage.tsx-parts/ReviewCard";
import { PermissionsSection, type PermissionsPart } from "../bot-settings/PermissionsSection";
import { AccessSection } from "../bot-settings/AccessSection";
import { teamVaultOffered } from "../bot-settings/TeamBotVaultSection";
import { DeveloperLink } from "../settings/DeveloperLink";
import { botSectionLock, useBotSectionAvailability, useBotSectionContent } from "../bot-settings/useBotSectionContent";
import { AccountsCard, Block, CardRow, ChannelsCard, Note, ProfileCard, sectionLabel, type Channel } from "./BotProfilePage.tsx-parts/cards";
import { BotProfileHeader, useBotProfileHero } from "./BotProfilePage.tsx-parts/BotProfileHeader";
import { BotProfileTabBar, useBotProfileSearch } from "./BotProfilePage.tsx-parts/BotProfileTabs";
import { BotProfileInsetStrip, BotProfileTopBar } from "./BotProfilePage.tsx-parts/BotProfileTopBar";
import { GROUP_LABEL, SUBPAGE_META, SubPage, SubPageRow } from "./BotProfilePage.tsx-parts/subpages";
import { useBotRowValues } from "./BotProfilePage.tsx-parts/rowValues";
import { SETTINGS_SWITCH_SEARCH_WORDS, personaSubPageForQuery, settingsSwitchForQuery, type BotProfileSettingsSwitch } from "@/lib/persona-search";
import { BotUsageBreakdownSection } from "../bot-settings/BotUsageBreakdown";

/** General's Settings card (its two switches lead it, #3398). */
const SETTINGS_CARD_SELECTOR = '[data-settings-group="bot-profile-group-settings"]';

type BotProfilePageProps = { bot: Bot; section: BotSettingsSection; onClose: () => void };

/** True while a popover anchored in the page is open: its trigger says so
 * with aria-haspopup and aria-expanded (Share, Add, a pill list). A row that
 * only unfolds in place has no aria-haspopup and does not count. */
export function pagePopoverOpen(root: ParentNode | null): boolean {
  return !!root?.querySelector('[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]');
}

/** The bot page. Every control writes the bot at once (#3397). */
export function BotProfilePage({ bot: propBot, section, onClose }: BotProfilePageProps) {
  const { state, dispatch } = useStore();
  const bot = state.bots.find((candidate) => candidate.id === propBot.id) ?? propBot;
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

  // A sub-page with nothing to show this viewer is not listed. When it
  // acts alone, Rules and Routines always have something; Advanced
  // settings is for Advanced mode.
  const subPageShown = (id: BotProfileSubPage): boolean => {
    if (id === "advanced") return advanced;
    // Voice holds the voice rows (a server with spoken replies) or, for a
    // viewer who may not change the bot's voice, their own provider; "Notify
    // me" is in place in General > Settings (#3398).
    if (id === "voice") return shown("voice") && (Boolean(state.config?.tts) || !canEditBotField(state.config, bot, "voice"));
    if (id === "actsAlone" || id === "rules" || id === "routines") return true;
    return BOT_PROFILE_SUBPAGE_SECTIONS[id].some(shown);
  };
  const resolvePage = (id: BotProfileSubPage | null): BotProfileSubPage | null => (id && subPageShown(id) ? id : null);

  // A tab with nothing to show this viewer (Stats in Simple mode) is not
  // listed; a link to it lands on General.
  const tabShown = (id: BotProfileTab) =>
    id === "stats" ? shown("usage") : id === "appearance" ? shown("appearance") : botProfileTabPages(id).some(subPageShown);
  const resolveTab = (next: BotProfileTab): BotProfileTab => (tabShown(next) ? next : "general");
  const tabOf = (id: PersonaCategory): BotProfileTab => resolveTab(botProfileTabOf(resolve(id)) ?? "general");
  const pageOf = (id: PersonaCategory): BotProfileSubPage | null => resolvePage(botProfileSubPageOf(resolve(id)));

  const [page, setPage] = useState<BotProfileSubPage | null>(() => resolvePage(botProfileSubPageFor(section)));
  const [tab, setTab] = useState<BotProfileTab>(() => {
    const first = resolvePage(botProfileSubPageFor(section));
    return first ? botProfileTabOfPage(first) : resolveTab(botProfileTabFor(section));
  });
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

  // The card of the General tab that holds a section in place (the
  // channels, the bot's accounts), as a selector to scroll to.
  const cardSelector = (id: PersonaCategory): string | null => {
    const card = botProfileCardOf(id);
    return card ? `[data-settings-group="${BOT_PROFILE_CARD_GROUP[card]}"]` : null;
  };

  // Where a section lives: the header (identity), the Appearance tab, a
  // card of the General tab, or a block on its sub-page.
  const placeOf = (target: BotSettingsSection): { category: PersonaCategory | null; selector: string | null } => {
    const category = personaCategoryForSection(target);
    if (!category) return { category, selector: null };
    if (category === "overview") return { category, selector: "[data-bot-profile-title]" };
    const id = resolve(category);
    return { category: id, selector: cardSelector(id) ?? `[data-bot-profile-section="${id}"]` };
  };

  // Opens a section where it lives: its tab and sub-page, scrolled into view.
  const openCategory = (category: PersonaCategory, query?: string) => {
    // A search for one of the two switches in place (#3398) opens General
    // at the Settings card, where the switch is now.
    if (query && settingsSwitchSelector(query)) {
      setTab("general");
      setPage(null);
      scrollTo.current = settingsSwitchSelector(query);
      return;
    }
    // A search opens the sub-page that holds the matched option (#2623).
    const hit = query ? resolvePage(personaSubPageForQuery(resolve(category), query)) : null;
    const next = hit ?? pageOf(category);
    setTab(hit ? botProfileTabOfPage(hit) : tabOf(category));
    setPage(next);
    // A section held by a card in place opens the General tab at its card.
    if (!next) scrollTo.current = cardSelector(resolve(category)) ?? scrollTo.current;
    if (category === "slack") setChannel("slack");
  };
  const reveal = (target: BotSettingsSection) => {
    // Routines have their own sub-page (#2624), not a persona category.
    if (target === "routines") { openPage("routines"); return; }
    const { category, selector } = placeOf(target);
    if (!category) return;
    if (category !== "overview") openCategory(category);
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
    // A sub-page just opened: the focus goes to its link back (#3398), so
    // the next Tab is the page's first control, not the top bar's Close.
    if (node?.matches("[data-bot-profile-subpage]")) node.querySelector<HTMLElement>("[data-bot-profile-back]")?.focus({ preventScroll: true });
  });

  const goTo = (id: BotSettingsSection) => {
    if (id === "routines") {
      dispatch({ type: "personaEditorSection", section: id });
      reveal(id);
      return;
    }
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
        : page === "folder" ? "skills"
            : page === "personality" || page === "sharing" ? "overview"
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
    // the shared vault is under Bot accounts (owner decision 2026-11-10, #3399)
    vaultElsewhere: true,
    // #3398: both switches sit in place in General > Settings.
    notifyElsewhere: true,
    routinesSwitchElsewhere: true,
  });

  const lockOf = (id: BotSettingsSection): LocaleKey | null => botSectionLock(state.config, bot, id);
  const showThreads = useShowThreads();
  const openLearningInChat = (entry: ReviewEntry) => {
    if (!entry.card) return;
    onClose();
    openNotificationTarget(dispatch, { botId: bot.id, threadId: entry.card.threadId, requestId: entry.card.requestId, cardId: entry.card.messageId }, state, showThreads);
  };
  const memoryAllowed = canEditBotField(state.config, bot, "memoryEnabled");

  const body = (id: PersonaCategory): ReactNode => {
    // What the server says the bot does, reaches and won't do, the prompt
    // preview and the recent changes.
    if (id === "summary") return renderSectionBody("overview");
    // Shared with: one summary row whose Manage opens the top bar's Share
    // popover (the people and groups are edited there, nowhere else). The
    // shared vault is under Bot accounts (#3399); who pays for the replies
    // is on Model (#2625).
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
    // Knowledge (#3400): To review heads the Skills card; "Open in chat"
    // closes the profile and shows the bot's chat at the learning's card.
    if (id === "skills") return <SkillsSection bot={bot} review={{ onOpenChat: openLearningInChat }} />;
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
  const access = (part: "brief" | "advanced") =>
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
      case "sharing":
        return <>{block("sharing")}{block("visibility")}</>;
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

  // The short value every row shows on its right (the canvas, #2621).
  const rowValue = useBotRowValues(bot, { tab, listing: page === null });

  // General > Settings starts with its two switches in place (#3398): who
  // may create routines on the bot (#2622, for whoever may change it) and
  // this person's own "Notify me" (with its per-person override).
  const collaboratorsSwitch = canEditBotField(state.config, bot, "collaboratorsCreateRoutines") ? (
    <DescribedRow
      key="collaboratorsCreateRoutines"
      rowId="botCollaboratorsCreateRoutines"
      icon={<Repeat strokeWidth={1.5} />}
      keywords={SETTINGS_SWITCH_SEARCH_WORDS.collaboratorsCreateRoutines.join(" · ")}
      label={t("botPanel.routines.collaboratorsCreate")}
      description={t("botPanel.routines.collaboratorsCreateHint")}
    >
      <Switch
        checked={bot.collaboratorsCreateRoutines !== false}
        aria-label={t("botPanel.routines.collaboratorsCreate")}
        onClick={() => derived.patch({ collaboratorsCreateRoutines: bot.collaboratorsCreateRoutines === false })}
      />
    </DescribedRow>
  ) : null;
  const notifySwitch = shown("voice") && lockOf("voice") === null ? <NotifyMeRow key="notifyMe" bot={bot} derived={derived} icon={<Bell strokeWidth={1.5} />} keywords={SETTINGS_SWITCH_SEARCH_WORDS.notifyMe.join(" · ")} /> : null;

  // One group of the General or Knowledge tab: a card in place, or rows
  // that each open their sub-page (a group with nothing left is not drawn).
  const tabGroup = (group: (typeof BOT_PROFILE_TAB_GROUPS)[BotProfileTab][number]): ReactNode => {
    if (group.card === "skills") return block("skills");
    if (group.card === "channels") return <ChannelsCard key={group.id} bot={bot} slackUrl={slackUrl} open={channel} onOpen={setChannel} />;
    if (group.card === "accounts") {
      return (
        // #3399: one card, each app, server and vault login once, with its
        // control in its row (the MCP servers card is gone from this page).
        <Block key={group.id} id="access" locked={lockOf("access") !== null}>
          <AccountsCard bot={bot} onEngine={() => openPage("model")} derived={derived} vault={teamVaultOffered(state.config, bot)} />
          {lockOf("access") ? body("access") : null}
        </Block>
      );
    }
    const switches = group.id === "settings" ? [collaboratorsSwitch, notifySwitch].filter(Boolean) : [];
    const rows = group.pages.filter(subPageShown);
    if (switches.length === 0 && rows.length === 0) return null;
    return (
      <ProfileCard key={group.id} title={t(GROUP_LABEL[group.id]!)} groupId={`bot-profile-group-${group.id}`}>
        {switches}
        {rows.map((id) => <SubPageRow key={id} page={id} value={rowValue(id)} onOpen={() => openPage(id)} />)}
      </ProfileCard>
    );
  };

  // The Settings card when a search names one of its switches and this
  // viewer has it, as a selector (the search marks the row inside it).
  const switchShown: Record<BotProfileSettingsSwitch, boolean> = { notifyMe: notifySwitch !== null, collaboratorsCreateRoutines: collaboratorsSwitch !== null };
  function settingsSwitchSelector(query: string): string | null {
    const id = settingsSwitchForQuery(query, pages.map(sectionLabel));
    return id && switchShown[id] ? SETTINGS_CARD_SELECTOR : null;
  }

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
    onOpenCategory: openCategory,
    // the search filters the General tab (it holds the card) and marks the switch
    rootFor: (query) => (settingsSwitchSelector(query) ? '[data-bot-profile-panel="general"]' : null),
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

  // The banner is a wash of the mascot's colour (#2173, back after #2313):
  // its hex goes to the stylesheet as a variable; a neutral mascot keeps a
  // visible grey there. The banner scrolls with the page under the clear
  // top bar, so nothing cuts it.
  const bannerColor = MAUS_COLORS[bot.color] ?? MAUS_COLORS.green;
  const bannerStyle = { "--bot-profile-banner-color": bannerColor } as CSSProperties;
  const bannerPalette = mascotColorGroup(bot.color);

  const { heroSlot, hero } = useBotProfileHero({ bot, derived });

  // Once the name scrolls under the top bar, the bar turns opaque (blurred)
  // and shows the small mascot and the name: the content scrolls under it,
  // never cut by a coloured band (JC 2026-11-08).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);
  const onScroll = () => {
    const scroller = scrollRef.current;
    const title = scroller?.querySelector<HTMLElement>("[data-bot-profile-title]");
    if (!scroller || !title) return;
    const bar = scroller.querySelector<HTMLElement>("[data-bot-profile-topbar]")?.offsetHeight ?? 56;
    const titleTop = title.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const next = titleTop < bar;
    setCondensed((prev) => (prev === next ? prev : next));
  };

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
        // A popover of the page is open (Share, Add, a pill list): this
        // Escape is its own, so it closes that popover only (its dismiss
        // hook on the window) and the page stays (#3398).
        if (pagePopoverOpen(rootRef.current)) return;
        event.preventDefault();
        event.stopPropagation();
        if (page) back();
        else onCloseRef.current();
      }}
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-app text-ink outline-none"
    >
      <BotProfileInsetStrip />
      <div ref={scrollRef} onScroll={onScroll} data-bot-profile-scroll="" className="content-card-body min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* The bar floats over the banner (sticky, no height of its own in
            the flow) and the banner scrolls away under it with the page. */}
        <BotProfileTopBar
          bot={bot}
          onClose={onClose}
          shareShown={shown("sharing")}
          shareOpen={shareOpen}
          onShareOpenChange={setShareOpen}
          condensed={condensed}
        />
        {/* Banner in the mascot's colour from the very top, the mascot over its lower edge. */}
        <div
          aria-hidden="true"
          data-bot-profile-banner=""
          data-bot-profile-banner-palette={bannerPalette}
          style={bannerStyle}
          className="bot-profile-banner h-[112px] w-full shrink-0"
        />
        {/* One centred column, a comfortable reading width (Grok Bot), a
            16px gutter on a phone. */}
        <div data-bot-profile-column="" className="mx-auto flex w-full max-w-[760px] flex-col px-4 pb-10 sm:px-6">
          <BotProfileHeader bot={bot} derived={derived} hero={hero} />

          {(!page || search.searching) && <BotProfileTabBar tabs={tabs} tab={tab} onTab={openTab} search={search} />}

          {page ? (
            <SubPage key={page} page={page} tab={tab} onBack={back}>
              {subPageBody(page)}
            </SubPage>
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
                : tab === "appearance"
                  ? block("appearance")
                  : BOT_PROFILE_TAB_GROUPS[tab].map(tabGroup)}
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
