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
//   the rows Model, Appearance, Before it acts), the Channels card, the Bot
//   accounts card, More (Rules, When it acts alone, Voice, Advanced
//   settings, Versions). Personality is reached from Knowledge > the Bot
//   folder (SOUL.md); Shared with and Who can see it are in the Share
//   popover of the top bar (owner 2026-11-19).
// - Appearance is not a tab: its row in General > Settings (M-20261119-081)
//   and the header's mascot open the whole mascot editor (character, shape,
//   colour, style, moves, Play a move, Randomize) in a modal. Nothing else
//   opens it: the bot panel's gear opens the page on General
//   (M-20261119-082).
// - Knowledge (#3400, then M-20261119-081): To review (the learnings that
//   wait, approved or declined in place), then the Bot folder in place
//   (BotProfilePage.tsx-parts/BotFolderCard). The Skills, Write a command and
//   Its work sections are gone; their functions are in the "..." menus of
//   the folder and of its entries (Skills in a modal, Learn from use, Write
//   a command, the Memory page, each skill's actions); Routines has no row.
// - Stats: the bot's usage over 7, 30 or 90 days.
// - Outcomes (#4098), the second tab: each result the person wants kept
//   true, read from the bot's routines; a row opens in place and points to
//   the chat for what needs the person (BotProfilePage.tsx-parts/Outcomes).
//
// Every button or row of the page that opens another surface opens it as a
// modal over the page, as the reference app does (#4470, BotPageModal): a
// row opens its sub-page (its title and one line of intro in the modal's
// header, then the cards), a channel's Manage its settings, the Access
// card's Add > Shared vault login its form,
// the folder's "..." > Skills the Skills card, > Memory page the Memory page;
// Connect apps and Analytics' All bots open their own windows over the page
// (a window stays a window). Escape closes the top modal and the focus goes
// back to its button. Each change applies in place, at once, as
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
// for opens its tab and its sub-page's modal, scrolled into view. A section this
// viewer may not change says why (botSectionLock); nothing is hidden for
// lack of a permission.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bell, Repeat } from "lucide-react";

import { openNotificationTarget, openRoutineRun, useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { shallowEqual, useStoreSelector } from "@/state/store-selector";
import { botRoutineRuns } from "@/state/view-slices";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesBotSection } from "@/lib/interface-visibility";
import { canEditBotField } from "@/lib/bot-capabilities";
import {
  BOT_PROFILE_CARD_GROUP,
  BOT_PROFILE_CARD_SECTIONS,
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
  botProfileTabCards,
  botProfileTabOfPage,
  botProfileTabPages,
  personaCategoryForSection,
} from "@/lib/persona-sections";
import { MAUS_COLORS } from "@/lib/mascot";
import { mascotColorGroup } from "../../../shared/mascot-colors";
import { botAvatarProfile } from "../../../shared/bot-avatar";
import { mascotDominantColor } from "@/lib/mascot-dominant";
import { profileBannerColors } from "@/lib/profile-banner";
import { DescribedRow, SettingsSurfaceProvider, Switch } from "../SettingsPrimitives";
import { NotifyMeRow } from "../bot-settings/VoiceSection";
import { MascotHeroSlotContext } from "../floating-bots/mascot-hero-slot";
import { RulesSection } from "../bot-settings/RulesSection";
import { SkillsSection } from "../bot-settings/SkillsSection";
import type { ReviewEntry } from "./BotProfilePage.tsx-parts/ReviewCard";
import { PermissionsSection, type PermissionsPart } from "../bot-settings/PermissionsSection";
import { AccessSection } from "../bot-settings/AccessSection";
import { teamVaultOffered } from "../bot-settings/TeamBotVaultSection";
import { DeveloperLink } from "../settings/DeveloperLink";
import { botSectionLock, useBotSectionAvailability, useBotSectionContent } from "../bot-settings/useBotSectionContent";
import { AccountsCard, Block, ChannelsCard, Note, ProfileCard, sectionLabel, type Channel } from "./BotProfilePage.tsx-parts/cards";
import { BotFolderCard } from "./BotProfilePage.tsx-parts/BotFolderCard";
import { BotProfileHeader, useBotProfileHero } from "./BotProfilePage.tsx-parts/BotProfileHeader";
import { BotProfileTabBar, useBotProfileSearch } from "./BotProfilePage.tsx-parts/BotProfileTabs";
import { useCaptionChrome } from "../DesktopCapabilities";
import { BotProfileInsetStrip, BotProfileTopBar } from "./BotProfilePage.tsx-parts/BotProfileTopBar";
import { AppearanceRow, GROUP_LABEL, SUBPAGE_META, SubPageModal, SubPageRow } from "./BotProfilePage.tsx-parts/subpages";
import { BotPageModal } from "./BotPageModal";
import { appearanceRowValue, useBotRowValues } from "./BotProfilePage.tsx-parts/rowValues";
import { SETTINGS_SWITCH_SEARCH_WORDS, personaSubPageForQuery, settingsSwitchForQuery, type BotProfileSettingsSwitch } from "@/lib/persona-search";
import { BotUsageBreakdownSection } from "../bot-settings/BotUsageBreakdown";
import { OutcomesCard, useOutcomes } from "./BotProfilePage.tsx-parts/Outcomes";
import { MemoryManagerPanel, PluginsPanel } from "../lazy-screens";
import { PageHostProvider } from "../page-host";

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
  // The top bar's Share button holds the people and groups (an organization
  // server) and Who can see it: both are no longer rows of the page.
  const shareGrants = shown("sharing");
  const shareVisibility = shown("visibility");
  const shareShown = shareGrants || shareVisibility;

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
  // listed; a link to it lands on General. A tab holds rows and cards
  // (Knowledge only cards since M-20261119-081).
  const tabShown = (id: BotProfileTab) =>
    id === "outcomes" ? true
      : id === "stats" ? shown("usage")
        : botProfileTabPages(id).some(subPageShown) || botProfileTabCards(id).some((card) => BOT_PROFILE_CARD_SECTIONS[card].some(shown));
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
  // The Appearance modal (the mascot editor), opened by the header's mascot
  // (the owner 2026-11-19: no longer a tab).
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // A modal the Bot folder's "..." menus open (M-20261119-081): the Skills
  // card ("command": with its Write a command field focused), the Memory page.
  const [knowledgeModal, setKnowledgeModal] = useState<"skills" | "command" | "memory" | null>(null);
  // The menu's button that opened it, which takes the focus back on close
  // (the menu item itself is gone by then).
  const knowledgeOpener = useRef<HTMLElement | null>(null);
  const openKnowledgeModal = (next: "skills" | "command" | "memory") => {
    knowledgeOpener.current = rootRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-expanded="true"]') ?? null;
    setKnowledgeModal(next);
  };
  // Closing the Skills card reads the folder's skills again (a change made there shows on skills/).
  const [skillsRead, setSkillsRead] = useState(0);
  const closeKnowledgeModal = () => {
    if (knowledgeModal !== "memory") setSkillsRead((count) => count + 1);
    setKnowledgeModal(null);
    const opener = knowledgeOpener.current;
    knowledgeOpener.current = null;
    if (opener) requestAnimationFrame(() => { if (opener.isConnected) opener.focus({ preventScroll: true }); });
  };

  // A row opens its sub-page's modal over the tab it belongs to; closing it
  // returns to the row (the modal gives the focus back to its button).
  const openPage = (next: BotProfileSubPage) => {
    setKnowledgeModal(null);
    setAppearanceOpen(false);
    setTab(botProfileTabOfPage(next));
    setPage(next);
  };
  const closePage = () => {
    const from = page;
    setPage(null);
    if (from) scrollTo.current = `[data-bot-profile-row="page-${from}"]`;
  };
  const openTab = (next: BotProfileTab) => {
    setKnowledgeModal(null);
    setAppearanceOpen(false);
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
    // the identity is the page's top: the banner, so the gear or Edit bot shows the whole header (M-20261119-082), never the title tucked under the bar
    if (category === "overview") return { category, selector: "[data-bot-profile-banner]" };
    const id = resolve(category);
    return { category: id, selector: cardSelector(id) ?? `[data-bot-profile-section="${id}"]` };
  };

  // A search's hit held on a sub-page while the person types: its row is
  // marked on the tab; Enter opens it (#4470).
  const [searchRow, setSearchRow] = useState<BotProfileSubPage | null>(null);

  // Opens a section where it lives: its tab and sub-page, scrolled into
  // view. A search shows the tab and marks the sub-page's row (`open`
  // false) until Enter opens its modal (#4470).
  const pageListed = (id: BotProfileSubPage) => BOT_PROFILE_TABS.some((each) => botProfileTabPages(each).includes(id));
  const openCategory = (category: PersonaCategory, query?: string, open = true) => {
    setKnowledgeModal(null);
    setSearchRow(null);
    // Three sections are not rows of a tab: Appearance is the header
    // mascot's modal; Shared with and Who can see it are in the top bar's
    // Share popover. A search shows them on Enter only, never while typing.
    if (category === "appearance" || category === "sharing" || category === "visibility") {
      if (!open) return;
      setPage(null);
      if (category === "appearance") { setAppearanceOpen(true); return; }
      setAppearanceOpen(false);
      setShareOpen(true);
      return;
    }
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
    // a page with no row (Personality: the Bot folder's SOUL.md; Routines: a link) is not marked while typing
    if (next && !open && !pageListed(next)) {
      setPage(null);
      return;
    }
    if (next && !open) {
      setPage(null);
      setSearchRow(next);
      scrollTo.current = `[data-bot-profile-row="page-${next}"]`;
      return;
    }
    setPage(next);
    // A section held by a card in place opens its tab at its card.
    if (!next) scrollTo.current = cardSelector(resolve(category)) ?? scrollTo.current;
    if (category === "slack") setChannel("slack");
    // the skills are the Skills card, a modal of the Bot folder (M-20261119-081): a link or Enter opens it
    if (category === "skills" && open && shown("skills")) setKnowledgeModal("skills");
  };
  const reveal = (target: BotSettingsSection) => {
    // Routines have their own sub-page (#2624), not a persona category.
    if (target === "routines") { openPage("routines"); return; }
    const { category, selector } = placeOf(target);
    if (!category) return;
    if (category === "appearance" || category === "sharing" || category === "visibility") {
      if (category === "appearance" ? shown("appearance") : shareShown) openCategory(category);
      return;
    }
    if (category !== "overview") openCategory(category);
    scrollTo.current = selector;
  };

  // The store's section (a deep link, the panel's gear, a click on the mascot).
  const firstSection = useRef(true);
  useEffect(() => {
    if (firstSection.current) {
      firstSection.current = false;
      const { category, selector } = placeOf(section);
      // a deep link to Appearance or Shared with opens its modal or popover (after mount, where its anchor is)
      if (category === "appearance" && shown("appearance")) setAppearanceOpen(true);
      else if ((category === "sharing" || category === "visibility") && shareShown) setShareOpen(true);
      else if (category && category !== "overview") scrollTo.current = selector;
      if (category === "skills" && shown("skills")) setKnowledgeModal("skills");
      return;
    }
    reveal(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  useLayoutEffect(() => {
    const selector = scrollTo.current;
    if (!selector) return;
    scrollTo.current = null;
    // a section on an open sub-page's modal (portalled to the body), else on the page
    const modal = page ? document.querySelector<HTMLElement>(`[data-bot-page-modal="page-${page}"]`) : null;
    const node = modal?.querySelector<HTMLElement>(selector) ?? rootRef.current?.querySelector<HTMLElement>(selector);
    node?.scrollIntoView?.({ block: "start", inline: "nearest" });
    // a row, on the way back from its modal (the search's marked row leaves the field its focus)
    if (node?.matches("[data-bot-profile-row]") && !(document.activeElement instanceof HTMLInputElement)) node.focus({ preventScroll: true });
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
          : page === "personality" ? "overview"
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
    // the shared vault is under Access (owner decision 2026-11-10, #3399)
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
    if (id === "files") {
      // Knowledge (M-20261119-081): To review, then the Bot folder in place,
      // where the memory is managed too: "Use memory" heads it for a viewer
      // who may change it. A folder this viewer may not change says why, its
      // "..." menu still there (the skills, the Memory page).
      const memoryEditable = memoryAllowed && lockOf("memory") === null;
      return (
        <BotFolderCard
          bot={bot}
          active={tab === "knowledge"}
          lock={lockOf("files")}
          memoryEditable={memoryEditable}
          memory={memoryEditable ? { enabled: bot.memoryEnabled !== false, busy: Boolean(bot.busy), onToggle: (enabled) => derived.patch({ memoryEnabled: enabled }) } : undefined}
          skillsShown={shown("skills")}
          refreshKey={skillsRead}
          onOpenSection={goTo}
          onOpenChat={openLearningInChat}
          onOpenSkills={() => openKnowledgeModal("skills")}
          onWriteCommand={() => openKnowledgeModal("command")}
          onOpenMemory={() => openKnowledgeModal("memory")}
        />
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
    // The Skills card, in the modal the folder's "..." > Skills opens; > Write a command opens it at its field.
    if (id === "skills") return <SkillsSection bot={bot} {...(knowledgeModal === "command" ? { focus: "command" as const } : {})} />;
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
    }
  };

  // The short value every row shows on its right (the canvas, #2621).
  const rowValue = useBotRowValues(bot, { tab, listing: page === null });
  // General > Settings starts with its two switches in place (#3398): who
  // may create routines on the bot (#2622, for whoever may change it) and
  // this person's own "Notify me" (with its per-person override).
  // #4360: collaborators exist only where the bot can be shared (an
  // organization server); a person alone is offered no switch about them.
  const collaboratorsSwitch = available("sharing") && canEditBotField(state.config, bot, "collaboratorsCreateRoutines") ? (
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
    if (group.card === "folder") return block("files");
    if (group.card === "channels") return <ChannelsCard key={group.id} bot={bot} slackUrl={slackUrl} open={channel} onOpen={setChannel} />;
    if (group.card === "accounts") {
      return (
        // #3399: one card, each app, server and vault login once, with its
        // control in its row (the MCP servers card is gone from this page).
        <Block key={group.id} id="access" locked={lockOf("access") !== null}>
          <AccountsCard bot={bot} derived={derived} vault={teamVaultOffered(state.config, bot)} />
          {lockOf("access") ? body("access") : null}
        </Block>
      );
    }
    const switches = group.id === "settings" ? [collaboratorsSwitch, notifySwitch].filter(Boolean) : [];
    const rows: ReactNode[] = group.pages.filter(subPageShown).map((id) => (
      <SubPageRow key={id} page={id} value={rowValue(id)} hit={search.q !== "" && id === searchRow} onOpen={() => openPage(id)} />
    ));
    // M-20261119-081: Appearance is a row of Settings again, after Model (as #4188 had it), opening the mascot editor's modal
    if (group.id === "settings" && shown("appearance")) {
      const at = group.pages.filter(subPageShown).indexOf("model") + 1;
      rows.splice(at, 0, <AppearanceRow key="appearance" value={appearanceRowValue(bot)} onOpen={() => openCategory("appearance")} />);
    }
    if (switches.length === 0 && rows.length === 0) return null;
    return (
      <ProfileCard key={group.id} title={t(GROUP_LABEL[group.id]!)} groupId={`bot-profile-group-${group.id}`}>
        {switches}
        {rows}
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

  // Outcomes (#4098): the routines and runs this viewer already has for
  // the bot, read once; the tab carries the attention dot while one of
  // them needs the person.
  const outcomeRuns = useStoreSelector((current) => botRoutineRuns(current, bot.id), shallowEqual);
  const routinesLoadState = useStoreSelector((current) => current.routinesLoadState);
  const outcomes = useOutcomes(derived.botRoutines, outcomeRuns);
  const tabAttention = useMemo<ReadonlySet<BotProfileTab>>(() => new Set(outcomes.some((outcome) => outcome.needsPerson) ? ["outcomes"] : []), [outcomes]);
  const outcomesBody = (
    <OutcomesCard
      outcomes={outcomes}
      routines={derived.botRoutines}
      runs={outcomeRuns}
      loadState={routinesLoadState}
      actions={{
        // "Reply in chat": the run in the bot's chat, where it is answered
        // as today; a need with no run opens the bot's chat.
        onReply: (need) => {
          onClose();
          if (need.runId) openRoutineRun(dispatch, { runId: need.runId, botId: bot.id });
          else dispatch({ type: "select", id: bot.id });
        },
        onOpenRoutine: (routine) => dispatch({ type: "openRoutine", botId: bot.id, routineId: routine.id }),
        onOpenRun: (runId) => {
          onClose();
          openRoutineRun(dispatch, { runId, botId: bot.id });
        },
        onAsk: () => {
          onClose();
          dispatch({ type: "select", id: bot.id });
        },
        // "New outcome": the person's own message in the bot's one
        // conversation, marked as an outcome ask; the page moves to the chat
        onNewOutcome: (text) => {
          onClose();
          dispatch({ type: "select", id: bot.id });
          dispatch({ type: "send", botId: bot.id, text, dataContext: { outcome: true } });
        },
      }}
    />
  );

  // Connect apps opened from this page (Add > Apps or MCP servers, a
  // Connect of the Access card, Mac Messages) is its own window, the one the
  // sidebar opens, over this page (#4470; a window stays a window). It is
  // open while the store says so: the profile and Connect apps both open
  // means it was opened here (the reducer leaves the profile otherwise).
  const connectAppsOpen = state.pluginsOpen;
  const connectAppsOpenRef = useRef(connectAppsOpen);
  connectAppsOpenRef.current = connectAppsOpen;

  // The page fills the main panel (#2136): focus moves in when it opens and
  // back to the opener when it closes; Escape closes it (empty search).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // A deep link opens the page with a modal (#4470): its effect ran first
    // and holds the focus, and the opener is whatever it took it from.
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inModal = Boolean(active?.closest("[data-bot-page-modal]"));
    const opener = active && !inModal && !root.contains(active) ? active : null;
    if (!root.contains(active) && !inModal) root.focus({ preventScroll: true });
    const onBodyKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (event.target !== document.body) return;
      // Connect apps' window takes its own Escape
      if (connectAppsOpenRef.current) return;
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

  // The banner is a wash of the mascot's colour (#2173, back after #2313),
  // 124px tall as the reference's cover (its stage top plus 40px, #4420):
  // a neutral mascot keeps a visible grey there. The wash comes from the bot
  // colour, which the mascot wears too, so its two colours go to the
  // stylesheet already kept apart from the mascot's body colour
  // (profile-banner.ts). The banner scrolls with the page under the clear
  // top bar, so nothing cuts it.
  const bannerPalette = mascotColorGroup(bot.color);
  const bannerAccent = bannerPalette === "neutral" ? "#8e949e" : (MAUS_COLORS[bot.color] ?? MAUS_COLORS.green);
  const avatar = botAvatarProfile(bot);
  const wearsPicture = Boolean(avatar.avatarUrl) && avatar.avatarCrop !== "mascot";
  const banner = profileBannerColors(bannerAccent, wearsPicture ? null : mascotDominantColor(bot));
  const bannerStyle = { "--bot-profile-banner-from": banner.from, "--bot-profile-banner-to": banner.to } as CSSProperties;
  const { dragProps } = useCaptionChrome();

  const { heroSlot, hero } = useBotProfileHero({ bot, derived, onOpenAppearance: shown("appearance") ? () => openCategory("appearance") : undefined });

  return (
    <MascotHeroSlotContext.Provider value={heroSlot}>
    {/* The plain surface (JC 2026-11-06): every card of the page is the
        Channels / Access look, a grey label over a borderless filled
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
      data-bot-profile-modal-open={page || knowledgeModal || appearanceOpen || channel ? "" : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
        // Connect apps' window takes its own Escape.
        if (connectAppsOpen) return;
        // A modal of the page is open: its own Escape closes it (BotPageModal).
        if (page || knowledgeModal || appearanceOpen || channel) return;
        // A popover of the page is open (Share, Add, a pill list): this
        // Escape is its own, so it closes that popover only (its dismiss
        // hook on the window) and the page stays (#3398).
        if (pagePopoverOpen(rootRef.current)) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }}
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-app text-ink outline-none"
    >
      <BotProfileInsetStrip />
      <div data-bot-profile-scroll="" className="content-card-body min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* Banner in the mascot's colour from the very top, the mascot over
            its lower edge. It is the window's drag handle (the top of the
            page moves the window, as every view's top does) and it scrolls
            away with the page, so the handle never sits over a row. */}
        <div
          aria-hidden="true"
          data-bot-profile-banner=""
          data-bot-profile-banner-palette={bannerPalette}
          {...dragProps}
          style={{ ...bannerStyle, ...dragProps.style }}
          className="bot-profile-banner h-[124px] w-full shrink-0"
        />
        {/* No bar (#5371): Share and the X float at the top right (sticky,
            no height of their own in the flow) and the banner scrolls away
            under them with the page. After the banner, so the two buttons
            are cut out of its drag region. */}
        <BotProfileTopBar
          bot={bot}
          onClose={onClose}
          shareShown={shareShown}
          shareGrants={shareGrants}
          shareVisibility={shareVisibility}
          shareOpen={shareOpen}
          onShareOpenChange={setShareOpen}
        />
        {/* One centred column, the reference's reading width (920px, 32px
            gutters, #4420), a 16px gutter on a phone. */}
        <div data-bot-profile-column="" className="mx-auto flex w-full max-w-[920px] flex-col px-4 pb-12 sm:px-8">
          <BotProfileHeader bot={bot} hero={hero} />

          <BotProfileTabBar tabs={tabs} tab={tab} onTab={openTab} search={search} attention={tabAttention} />

          <div
            key={tab}
            id={`bot-profile-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`bot-profile-tab-${tab}`}
            data-bot-profile-panel={tab}
            className="mt-[26px] flex min-w-0 flex-col gap-6"
          >
            {tab === "outcomes"
              ? outcomesBody
              : tab === "stats"
              ? (
                  <>
                    {/* #3401: the reference block first, our cost breakdown after it */}
                    {block("usage")}
                    <BotUsageBreakdownSection bot={bot} />
                  </>
                )
              : BOT_PROFILE_TAB_GROUPS[tab].map(tabGroup)}
          </div>
        </div>
      </div>
      {/* The modals over the page (#4470): a sub-page; the Skills card and the Memory page, from the Bot folder's "..." menus. */}
      {page && (
        <SubPageModal key={page} page={page} onClose={closePage}>
          {subPageBody(page)}
        </SubPageModal>
      )}
      {/* Appearance: the mascot editor, exactly the old tab's content, in the page's shared modal. Its editor draws its own
          preview (no header slot: the header's mascot is behind this modal and follows each pick). */}
      {appearanceOpen && shown("appearance") && (
        <BotPageModal id="appearance" title={t("botProfile.tab.appearance")} size="large" onClose={() => setAppearanceOpen(false)}>
          <MascotHeroSlotContext.Provider value={null}>
            {block("appearance")}
          </MascotHeroSlotContext.Provider>
        </BotPageModal>
      )}
      {(knowledgeModal === "skills" || knowledgeModal === "command") && shown("skills") && (
        <BotPageModal id="skills" title={t("botSettings.nav.skills")} size="large" onClose={closeKnowledgeModal}>
          {block("skills")}
        </BotPageModal>
      )}
      {knowledgeModal === "memory" && (
        <BotPageModal id="memory" title={t("memoryManager.title")} size="large" bare onClose={closeKnowledgeModal}>
          {/* drawn as a page of this modal: no window strip; its own close closes the modal */}
          <PageHostProvider value={{ onClose: closeKnowledgeModal }}>
            <MemoryManagerPanel />
          </PageHostProvider>
        </BotPageModal>
      )}
      {/* Connect apps' own window, over the page (portalled after every header for Electron's drag regions) */}
      {connectAppsOpen && (typeof document === "undefined" ? <PluginsPanel /> : createPortal(<PluginsPanel />, document.body))}
      {dialogs}
    </main>
    </SettingsSurfaceProvider>
    </MascotHeroSlotContext.Provider>
  );
}
