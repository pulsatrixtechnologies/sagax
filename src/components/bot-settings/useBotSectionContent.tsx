import { botRoutineRuns } from "@/state/view-slices";
// The body of each bot settings section and the reads behind them (the
// server overview and prompt preview, the file-backed history and its
// version restore). Shared by the bot panel's More tab (BotSettingsDialog) and the
// persona editor (persona/PersonaEditorModal), so both show the same
// controls and save through the same paths.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import { shallowEqual, useStoreCommands, useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { api, type Bot, type BotSettingsSection, type ConfigStatus } from "@/state/store";
import type { BotOverview } from "@/lib/bot-overview-types";
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { canEditBotField, canSetBotHost, canStepPrimary, showBotVisibility, viewerOwnsBot } from "@/lib/bot-capabilities";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { servedPage } from "@/lib/desktop";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { ConfirmDialog } from "../ConfirmDialog";
import { useSlackManagementUrl } from "./useSlackManagement";
import { WorksOnSetting } from "../computer/WorksOnSetting";
import { useBotSettingsDerived } from "./useBotSettingsDerived";
import { OverviewSection } from "./OverviewSection";
import { BotEmailAddress } from "./BotEmailAddress";
import { BotReachMe } from "./BotReachMe";
import { SlackSection } from "./SlackSection";
import { SoulSection } from "./SoulSection";
import { SkillsSection } from "./SkillsSection";
import { MemorySection } from "./MemorySection";
import { RulesSection } from "./RulesSection";
import { WorkspaceFilesSection } from "./WorkspaceFilesSection";
import { RoutinesSection } from "./RoutinesSection";
import { AccessSection } from "./AccessSection";
import { ModelSection } from "./ModelSection";
import { PermissionsSection } from "./PermissionsSection";
import { VoiceSection } from "./VoiceSection";
import { HistorySection, type HistoryRow } from "./HistorySection";
import { BotAnalyticsSection } from "./BotAnalyticsSection";
import { VisibilitySection } from "./VisibilitySection";
import { SharingSection } from "./SharingSection";
import { BotPayerCard } from "./BotPayerSettings";
import { PaneSection } from "./PaneSection";
import { SwitchRow } from "../SettingsPrimitives";
import { TeamBotVaultSection } from "./TeamBotVaultSection";
import { AppearancePane } from "../appearance/AppearancePane";
import type { PromptPreviewData } from "./PromptPreview";

/** Which sections this server offers at all (not a permission). Slack is
 * offered only where the server has an Admin page to link to (a hosted
 * organisation workspace). Who can see a bot matters only where several
 * people sign in: a browser on a served workspace, and there to an admin
 * or to the bot's own owner (#1098, showBotVisibility). A server signed in
 * with Perspicax shares a bot person by person (Sharing); its main MCP
 * account connection is automatic. The audience setting does not apply there. */
export function useBotSectionAvailability(botId: string) {
  const config = useStoreSelector((current) => current.config);
  const bot = useStoreSelector((current) => current.bots.find((candidate) => candidate.id === botId));
  const slackUrl = useSlackManagementUrl(botId);
  const ownerOrAdmin = useOwnerOrAdmin();
  const perspicaxOrg = usePerspicaxOrg();
  const available = (id: BotSettingsSection): boolean =>
    id === "slack" ? slackUrl !== null
      : id === "visibility" ? Boolean(bot) && showBotVisibility(config, bot!, { served: servedPage(), ownerOrAdmin, perspicaxOrg: perspicaxOrg !== null })
        : id === "sharing" ? perspicaxOrg !== null
          : true;
  return { available, slackUrl, perspicaxOrg };
}

/** Why this viewer may not change a section, or null when they may. The
 * server refuses the same writes (bot-capabilities.ts); the bot panel hides
 * a locked section, the persona editor shows it with this reason. */
export function botSectionLock(
  config: ConfigStatus | null | undefined,
  bot: { ownerUserId?: string | null },
  id: BotSettingsSection,
): LocaleKey | null {
  const locked =
    id === "access" ? !canEditBotField(config, bot, "computer") && !canEditBotField(config, bot, "cwd")
      : id === "worksOn" ? !canEditBotField(config, bot, "computer")
        : id === "memory" ? !canEditBotField(config, bot, "memoryEnabled")
          // RULES.md, docs/ and the Files list: the Soul's gate (owner or
          // admin; 2026-10-09, members manage their own bots)
          : id === "rules" || id === "files" ? !canEditBotField(config, bot, "soul")
          : id === "soul" ? !canEditBotField(config, bot, "soul")
            // 2026-10-26: the owner reads their own bot's history
            : id === "history" ? !canEditBotField(config, bot, "soul")
              : id === "permissions" ? !canStepPrimary(config, bot) && !canEditBotField(config, bot, "approvalMode")
                : false;
  if (!locked) return null;
  if (viewerBotsReadOnly(config)) return "bots.readOnly.notice";
  return "persona.locked.owner";
}

export function useBotSectionContent(bot: Bot, {
  section,
  expanded,
  onOpenSection,
  returnFocusRef,
  slackUrl,
  channelsElsewhere = false,
  sharingElsewhere = false,
  notifyElsewhere = false,
  routinesSwitchElsewhere = false,
}: {
  /** The section on screen: the overview and history load when it is theirs. */
  section: BotSettingsSection;
  /** Whether that section's body is shown (the panel's accordion is open). */
  expanded: boolean;
  /** The Overview's links to another section. */
  onOpenSection: (target: BotSettingsSection) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  slackUrl: string | null;
  /** The bot's address and "Me joindre" are shown elsewhere (the profile
   * page's Channels, #2126): What it does leaves them out. */
  channelsElsewhere?: boolean;
  /** The people the bot is shared with are managed elsewhere (the profile
   * page's Share popover, JC 2026-11-06: one option in one place): the
   * Sharing section keeps only who pays and the shared vault. */
  sharingElsewhere?: boolean;
  /** "Notify me" is drawn elsewhere (the profile page's Settings card,
   * #3398): Voice leaves it out. */
  notifyElsewhere?: boolean;
  /** "Collaborators can create routines" is drawn elsewhere (the profile
   * page's Settings card, #3398): Routines leaves it out. */
  routinesSwitchElsewhere?: boolean;
}): { renderSectionBody: (id: BotSettingsSection) => ReactNode; dialogs: ReactNode; derived: ReturnType<typeof useBotSettingsDerived> } {
  const dispatch = useStoreDispatch();
  const { flushBotPatches } = useStoreCommands();
  const config = useStoreSelector((current) => current.config);
  const routines = useStoreSelector((current) => current.routines.filter((routine) => routine.botId === bot.id), shallowEqual);
  const webhooks = useStoreSelector((current) => current.webhooks);
  const runs = useStoreSelector((current) => botRoutineRuns(current, bot.id), shallowEqual);
  const derived = useBotSettingsDerived(bot);

  const [overview, setOverview] = useState<BotOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [prompt, setPrompt] = useState<PromptPreviewData | null>(null);
  const [promptError, setPromptError] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryRow[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyRevision, setHistoryRevision] = useState<string | null>(null);
  const historyRequest = useRef(0);
  const [rollingBack, setRollingBack] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<{ id: string; expectedRevision: string; fields: string } | null>(null);

  // The bot-record fields the server-built overview and system-prompt
  // preview actually read (OverviewFacts.bot plus the prompt's persona
  // inputs). A streamed message or unread flag replaces the bot object but
  // must not refetch an unchanged overview.
  const factsSignature = useMemo(
    () =>
      JSON.stringify([
        bot.name,
        bot.title,
        bot.description,
        bot.soul,
        bot.computer,
        bot.cloudBackend,
        bot.cwd,
        bot.autoApprove,
        bot.approvePeerComms,
        bot.peers,
        bot.section,
        bot.browser,
        bot.mcpServers,
        bot.chiefOfStaff,
        bot.managedSections,
        bot.modelSelection,
      ]),
    [
      bot.name,
      bot.title,
      bot.description,
      bot.soul,
      bot.computer,
      bot.cloudBackend,
      bot.cwd,
      bot.autoApprove,
      bot.approvePeerComms,
      bot.peers,
      bot.section,
      bot.browser,
      bot.mcpServers,
      bot.chiefOfStaff,
      bot.managedSections,
      bot.modelSelection,
    ],
  );

  // Fetch on entry: skills and memory are files, not bot-record fields, so
  // returning from either editor must reload their overview/prompt too.
  // Await the existing write queue instead of racing a second debounce.
  useEffect(() => {
    if (section !== "overview") return;
    let cancelled = false;
    const fetchOverviewAndPrompt = async () => {
      await flushBotPatches(bot.id);
      if (cancelled) return;
      void api(`/api/bots/${bot.id}/overview`)
        .then((data: BotOverview) => {
          if (cancelled) return;
          setOverview(data);
          setOverviewError(false);
        })
        .catch(() => {
          if (!cancelled) setOverviewError(true);
        });
      void api(`/api/bots/${bot.id}/system-prompt`)
        .then((data: PromptPreviewData) => {
          if (cancelled) return;
          setPrompt(data);
          setPromptError(false);
        })
        .catch(() => {
          if (!cancelled) setPromptError(true);
        });
    };

    void fetchOverviewAndPrompt();
    return () => {
      cancelled = true;
    };
  }, [bot.id, section, factsSignature, routines, webhooks, flushBotPatches]);

  // Read the file-backed history only when its section is opened. A newer
  // load (or leaving History) invalidates older rows, revision, and errors.
  const loadHistory = useCallback(() => {
    const request = ++historyRequest.current;
    setHistoryError(false);
    return flushBotPatches(bot.id)
      .then(() => api(`/api/bots/${bot.id}/history?limit=100&full=1`))
      .then((data: { rows: HistoryRow[]; revision: string }) => {
        if (request !== historyRequest.current) return;
        setHistoryRows(data.rows);
        setHistoryRevision(data.revision);
      })
      .catch(() => {
        if (request === historyRequest.current) setHistoryError(true);
      });
  }, [bot.id, flushBotPatches]);

  const historyAllowed = canEditBotField(config, bot, "soul");
  useEffect(() => {
    if (!historyAllowed || section !== "history") return;
    void loadHistory();
    return () => { historyRequest.current++; };
  }, [section, loadHistory, historyAllowed]);

  // Restoring a version: a failure (the bot changed meanwhile, say) still
  // reloads history so the list matches the server, and says why through
  // the app's error toast.
  const restoreVersion = async (target: { id: string; expectedRevision: string }) => {
    if (rollingBack) return;
    setRestoreTarget(null);
    setRollingBack(true);
    try {
      await flushBotPatches(bot.id);
      await api(`/api/bots/${bot.id}/history/restore`, {
        method: "POST",
        body: JSON.stringify({ id: target.id, expectedRevision: target.expectedRevision }),
      });
    } catch (e: unknown) {
      dispatch({ type: "error", message: e instanceof Error ? e.message : t("botPanel.history.restoreError") });
    } finally {
      await loadHistory();
      setRollingBack(false);
    }
  };

  const renderSectionBody = (id: BotSettingsSection): ReactNode => {
    switch (id) {
      case "overview":
        return overview === null && overviewError ? (
          <div className="text-[13px] text-ink-secondary">{t("botPanel.overview.loadError")}</div>
        ) : (
          // Data wins over a transient refetch failure: once an overview has
          // loaded once, a later failed refetch (routines/webhooks/bot-record
          // changed, the request errored) keeps showing it rather than
          // replacing a fully populated card with an error block: the same
          // precedence PromptPreview already gives its own data vs. error.
          <div className="flex flex-col gap-5">
            {/* B21 (2026-10-21): the bot's own address from the Perspicax relay; nothing when none */}
            {!channelsElsewhere && <BotEmailAddress botId={bot.id} />}
            {/* 2026-10-26 "Me joindre": how this bot reaches the person outside the app, and when */}
            {!channelsElsewhere && <BotReachMe botId={bot.id} />}
            <OverviewSection
              overview={overview}
              refreshError={overview !== null && overviewError}
              prompt={prompt}
              promptError={promptError}
              onOpen={onOpenSection}
            />
          </div>
        );
      case "appearance":
        return <AppearancePane bot={bot} onPatch={derived.patch} />;
      case "soul":
        if (!canEditBotField(config, bot, "soul")) return null;
        return <SoulSection bot={bot} patch={derived.patch} />;
      case "slack":
        return slackUrl ? <SlackSection managementUrl={slackUrl} /> : null;
      case "skills":
        return <SkillsSection bot={bot} />;
      case "memory":
        // Memory has an explicit Save button; preserve its unsaved draft
        // while the user consults another section. It fetches when it
        // becomes the active section. Mounted below while the viewer may
        // change it; visibility toggled via hidden on the wrapper.
        if (!canEditBotField(config, bot, "memoryEnabled")) return null;
        return <MemorySection bot={bot} active={expanded && section === "memory"} onToggle={(enabled) => derived.patch({ memoryEnabled: enabled })} />;
      case "rules":
        // Rules and Files have their own Save; the persona editor keeps them
        // mounted like Memory (PersonaEditorModal).
        if (!canEditBotField(config, bot, "soul")) return null;
        return <RulesSection bot={bot} active={expanded && section === "rules"} />;
      case "files":
        if (!canEditBotField(config, bot, "soul")) return null;
        return <WorkspaceFilesSection bot={bot} active={expanded && section === "files"} onOpenSection={onOpenSection} memoryEditable={canEditBotField(config, bot, "memoryEnabled")} />;
      case "routines":
        // #2622: the owner decides whether the people the bot is shared
        // with may create routines on it (absent = they may).
        return (
          <>
            {!routinesSwitchElsewhere && canEditBotField(config, bot, "collaboratorsCreateRoutines") && (
              <PaneSection>
                <SwitchRow
                  label={t("botPanel.routines.collaboratorsCreate")}
                  description={t("botPanel.routines.collaboratorsCreateHint")}
                  checked={bot.collaboratorsCreateRoutines !== false}
                  onChange={(next) => derived.patch({ collaboratorsCreateRoutines: next })}
                />
              </PaneSection>
            )}
            <RoutinesSection bot={bot} routines={derived.botRoutines} runs={runs} />
          </>
        );
      case "access":
        return <AccessSection bot={bot} derived={derived} />;
      case "worksOn":
        return <WorksOnSetting bot={bot} />;
      case "model":
        // #2625: who pays for the replies sits with the engine that answers
        // (the canvas's Model sub-page), its one place.
        return (
          <>
            <ModelSection bot={bot} />
            <BotPayerCard bot={bot} />
          </>
        );
      case "permissions":
        return <PermissionsSection bot={bot} derived={derived} />;
      case "voice":
        return <VoiceSection bot={bot} derived={derived} notifyElsewhere={notifyElsewhere} />;
      case "visibility":
        return <VisibilitySection bot={bot} />;
      case "sharing":
        // The shared vault of a team bot sits with its sharing, in Edit bot,
        // not in the bot's side panel (JC 2026-11-03).
        return (
          <>
            {!sharingElsewhere && <SharingSection bot={bot} />}
            {Boolean(bot.grants?.length || bot.directGrants?.length) && (viewerOwnsBot(config, bot) || canSetBotHost(config, bot)) && (
              <TeamBotVaultSection botId={bot.id} botName={bot.name} />
            )}
          </>
        );
      case "history":
        if (!historyAllowed) return null;
        return historyRows === null && historyError ? (
          <div className="text-[13px] text-ink-secondary">{t("botPanel.history.loadError")}</div>
        ) : (
          // Same precedence as the Overview: rows already on screen
          // survive a failed reload (after an undo, say) with a quiet
          // note rather than being replaced by an error block.
          <HistorySection
            bot={bot}
            rows={historyRows}
            refreshError={historyRows !== null && historyError}
            onRestore={(versionId, fields) => {
              if (historyRevision) setRestoreTarget({ id: versionId, expectedRevision: historyRevision, fields });
            }}
            restoring={rollingBack || !historyRevision}
          />
        );
      case "usage":
        return <BotAnalyticsSection bot={bot} />;
      default:
        return null;
    }
  };

  const dialogs = (
    <ConfirmDialog
      open={restoreTarget !== null}
      title={t("botPanel.history.restoreVersionTitle")}
      body={t("botPanel.history.restoreVersionBody", { fields: restoreTarget?.fields ?? "" })}
      confirmLabel={t("botPanel.history.restoreVersion")}
      tone="neutral"
      returnFocusRef={returnFocusRef}
      onCancel={() => setRestoreTarget(null)}
      onConfirm={() => { if (restoreTarget) void restoreVersion(restoreTarget); }}
    />
  );

  return { renderSectionBody, dialogs, derived };
}
