// Permissions: how autonomously this bot acts: the approval level (ask /
// edits / auto / full, custom on Codex: the only approval setting since
// 2026-10-26, rules first whatever the level), review-routine approvals, whether it asks before
// contacting other bots, and, while it is its person's Primary Bot
// (formerly Chief of Staff), that role. Moved from SettingsPanel.tsx (Chief of Staff ~720-755,
// Ask-before-contacting ~757-776, Approval level ~990-1010, Review routine
// approvals ~1013-1050).
//
// The Auto branch of LocalComputerAutoWarning (choosing Auto while
// bot.computer === "local") lives here with its trigger; the Works-on-picker
// branch (turning computer to "local" while already on Auto) stays with
// AccessSection, next to that picker. The warning remembers which bot it was
// opened for, so a bot switch while it is up never applies the choice to the
// newly selected bot. Full access has no warning: it applies at once
// (omb #2701 / PRO-RÈGLE).
import { RoleRulesCard } from "./RoleRulesCard";
import { useEffect, useState } from "react";

import { canEditBotField, canStepPrimary, viewerOwnsBot } from "@/lib/bot-capabilities";
import { useAdvancedMode } from "@/lib/interface-mode";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { orgFullAccessFor } from "@/lib/full-access";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { EMPTY_PERSONAL_SECTIONS, personalSectionNames, usePersonalSections } from "@/lib/personal-sections";
import { viewerActorId } from "@/lib/viewer";
import { viewerOwnTeamNames } from "@/lib/viewer-teams";
import { api, useStore, type Bot } from "@/state/store";
import { type ApprovalMode } from "../../../shared/approval-mode";
import { AppliedLevelNote } from "./AppliedLevelNote";
import { DirectTriggersRows } from "./DirectTriggersRows";
import { proactiveModeFor, type ProactiveMode } from "../../../shared/proactive-mode";
import { builtInPageTargets } from "../../../shared/page-targets";
import { pageTargetKeys } from "@/lib/page-target-copy";
import { DEFAULT_OUTBOUND_POLICY, type OutboundPolicy } from "../../../shared/outbound";
import { ApprovalModeSelector } from "../ApprovalModeSelector";
import { AllowedRecipientsRow } from "./AllowedRecipientsRow";
import { LifecycleHooksRow } from "./LifecycleHooksRow";
import { CommandAllowlistDialog } from "../CommandAllowlistDialog";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { DescribedRow, HelpTip, PILL, PillSelect, SettingsGroup, Switch, SwitchRow, UnitField, useSettingsSurface } from "../SettingsPrimitives";
import { ManagedTeamsSettings } from "./ManagedTeamsSettings";
import { OwnerPermissionsCard } from "./OwnerPermissionsCard";
import { CustomRulesCard } from "./CustomRulesCard";
import { BotToolAccess } from "./BotToolAccess";
import { BotParallelSettings } from "./BotParallelSettings";
import { BotTurnLimitsSettings } from "./BotTurnLimitsSettings";
import { ProposalStatus } from "./ProposalStatus";
import { PaneSection } from "./PaneSection";
import { AdvancedFold } from "./AdvancedFold";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";
import { useBotEditor } from "./BotEditorContext";
import { readableError } from "@/lib/plain-error";

export type PermissionsPart = "all" | "approval" | "beforeActing" | "actsAlone" | "rules" | "advanced";
type PermissionsPiece =
  | "approval" | "contact" | "ownerRules" | "proactive" | "pageTarget" | "recipients" | "drafts" | "memes"
  | "customRules" | "primary" | "loopGuard" | "grokConnectors" | "hooks" | "toolAccess" | "parallel" | "fold";
/** Each piece of the section lives in exactly one V6 sub-page (one option, one place). */
export const PERMISSIONS_PARTS: Readonly<Record<Exclude<PermissionsPart, "all">, readonly PermissionsPiece[]>> = {
  approval: ["approval"],
  beforeActing: ["approval", "ownerRules"],
  actsAlone: ["proactive", "pageTarget", "recipients", "drafts", "memes"],
  rules: ["customRules"],
  advanced: ["primary", "contact", "loopGuard", "grokConnectors", "hooks", "toolAccess", "parallel", "fold"],
};

export function PermissionsSection({
  bot,
  derived,
  part = "all",
}: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  /** "approval": the approval level row alone, with its warnings (the bot
   * creation wizard's Rules step, 2026-10-26). The bot page's V6 sub-pages
   * (#2612) each show one share of the rest: "beforeActing" (the level and
   * the owner's per-action rules), "actsAlone" (proactive,
   * publish target, recipients, drafts, memes), "rules" (custom and role
   * rules), "advanced" (Primary Bot, contacting other bots, loop guard, hooks, tool access,
   * parallel and turn limits, the folded command list and outbound). */
  part?: PermissionsPart;
}) {
  const advanced = useAdvancedMode();
  const plainSurface = useSettingsSurface() === "plain";
  const { patch, engine, canCoordinate, approvalMode, trustedModesAvailable, sectionName, currentChief } = derived;
  const { state, dispatch } = useStore();
  const ownerOrAdmin = useOwnerOrAdmin();
  const { draft, bulk, mixedFields } = useBotEditor();
  const [localAutoWarning, setLocalAutoWarning] = useState<string | null>(null);
  const [commandAllowlistTarget, setCommandAllowlistTarget] = useState<{ botId: string; botName: string } | null>(null);
  const [primaryError, setPrimaryError] = useState<string | null>(null);
  // #1373: Full and Custom still wait for the turn to end. The selector
  // stays open for Ask, Edits and Auto, so a refused choice says why
  // instead of doing nothing.
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);
  // Taking the role and leaving it go through the owner's own route (one
  // per person). A draft still patches, because the bot does not exist yet;
  // an organization member never sees the switch while drafting (create
  // refuses chiefOfStaff).
  const togglePrimary = () => {
    setPrimaryError(null);
    if (draft) return patch({ chiefOfStaff: !bot.chiefOfStaff });
    const method = bot.chiefOfStaff ? "DELETE" : "POST";
    void api<{ bot: Bot }>(`/api/bots/${bot.id}/primary`, { method })
      .then((response) => dispatch({ type: "botPatched", bot: response.bot }))
      .catch((error: unknown) => setPrimaryError(readableError(error)));
  };
  // Organization server: the owner sets Full as the bot's default (its new
  // threads and routines) over HTTP while the organization allows it.
  const perspicaxOrg = usePerspicaxOrg();
  const viewerId = state.config?.viewer?.principalId ?? null;
  // #2045: Primary Bot managed teams are this person's teams only.
  const orgMode = perspicaxOrg !== null;
  const personal = usePersonalSections();
  const viewerTeamChoices = viewerOwnTeamNames({
    orgMode,
    viewerId: viewerActorId(state.config),
    personalNames: orgMode ? personalSectionNames(personal ?? EMPTY_PERSONAL_SECTIONS) : undefined,
    serverSections: state.sections ?? [],
    bots: state.bots,
    groups: state.groups,
  });
  // Edit N bots (#1674) offers Full as Edit bot does: the draft stands for
  // the viewer's bots, and the server decides each one at Apply.
  const orgFullAccess = draft && !bulk ? undefined : orgFullAccessFor(perspicaxOrg, bot, viewerId);
  // The menu shows the open conversation. The grant names that conversation
  // so the saved level is the one still on screen after the reply.
  const applyFull = (target: string) => {
    // #1674: Edit N bots keeps Full as each bot's own level change (never the
    // organization grant of the draft). The org grant path is single-bot only.
    if (orgFullAccess !== undefined && !bulk) {
      if (orgFullAccess === "hidden") return;
      dispatch({
        type: "updateBot",
        botId: target,
        patch: {
          approvalMode: "full",
          organizationFullAccess: true,
          ...(bot.id === target ? { threadId: bot.threadId } : {}),
        },
      });
      return;
    }
    if (orgFullAccess !== undefined && orgFullAccess !== "allowed") return;
    dispatch({ type: "updateBot", botId: target, patch: { approvalMode: "full" } });
  };
  const approvalMixed = Boolean(bulk && mixedFields?.has("approvalMode"));
  const proactiveMixed = Boolean(bulk && mixedFields?.has("proactiveMode"));
  const peerMixed = Boolean(bulk && mixedFields?.has("approvePeerComms"));
  const setApprovalMode = (mode: ApprovalMode) => {
    // Mixed bulk: the draft has no shared level, but botApprovalSetting may
    // still read as Ask; allow picking that level explicitly (#1701).
    if (mode === approvalMode && !approvalMixed) return;
    setApprovalNotice(bot.busy ? t("approvalMode.whileWorking") : null);
    if (mode === "full") {
      applyFull(bot.id);
      return;
    }
    if (mode === "auto" && bot.computer === "local") {
      setLocalAutoWarning(bot.id);
      return;
    }
    patch({ approvalMode: mode });
  };
  // Re-apply Full to every thread that still holds an exception.
  const setApprovalModeAgain = () => {
    if (orgFullAccess === undefined || orgFullAccess === "allowed") applyFull(bot.id);
  };
  // How autonomously this bot may act on its own. A level next to the approval
  // level, not a Chief orchestrator: the server enforces it per bot
  // (shared/proactive-mode.ts, server/proactive/proactive.ts).
  const proactiveMode: ProactiveMode = proactiveModeFor(bot);
  const setProactiveMode = (mode: ProactiveMode) => {
    if (bot.busy || (mode === proactiveMode && !proactiveMixed)) return;
    patch({ proactiveMode: mode });
  };
  const showPrimary = canStepPrimary(state.config, bot, { draft });
  const showApproval = canEditBotField(state.config, bot, "approvalMode", { draft });
  const showContact = canEditBotField(state.config, bot, "approvePeerComms", { draft });
  const showTeams = canEditBotField(state.config, bot, "managedSections", { draft });
  const showOutbound = canEditBotField(state.config, bot, "outbound", { draft });
  // Simple keeps the approval level and hides the rest. Values stay.
  // Making a saved bot primary is in the bot's "..." menu (BotActionsMenu);
  // this pane shows the role only while the bot holds it (to leave it and
  // pick the teams it coordinates), and on a draft.
  const inPart = (piece: PermissionsPiece) => part === "all" || PERMISSIONS_PARTS[part].includes(piece);
  // one Primary Bot per person: never set on several bots at once
  const showPrimaryUi = inPart("primary") && !bulk && advanced && showPrimary && (draft || Boolean(bot.chiefOfStaff));
  const showContactUi = inPart("contact") && advanced && showContact;
  const showOutboundUi = inPart("fold") && advanced && showOutbound;
  // 2026-10-21 (parité 1C): who it writes to without a card
  const showRecipientsUi = inPart("recipients") && advanced && !draft && canEditBotField(state.config, bot, "allowedRecipients");
  const showDrafts = inPart("drafts") && advanced && !draft && canEditBotField(state.config, bot, "emailDrafts");
  const showMemeReplies = inPart("memes") && advanced && !draft && canEditBotField(state.config, bot, "memeReplies");
  const showLoopGuard = inPart("loopGuard") && advanced && !draft && canEditBotField(state.config, bot, "loopGuard");
  // #2747: grok.com connectors, only for a bot on the Grok CLI engine (the xAI
  // API engine "grok" cannot load them) whose tools are not limited to a scope
  // (a scoped turn never loads them)
  const grokEngine = engine?.driverKind === "grokAgent";
  const showGrokConnectors = inPart("grokConnectors") && advanced && !draft && grokEngine && bot.toolScope === undefined
    && canEditBotField(state.config, bot, "grokAccountConnectors");
  const showHooks = inPart("hooks") && !draft && canEditBotField(state.config, bot, "allowedRecipients");
  // the owner always manages their own bot's permission mode and rules
  const ownsBot = !draft && viewerOwnsBot(state.config, bot);
  const showOwnerPermissions = inPart("ownerRules") && ownsBot;
  const showCustomRules = inPart("customRules") && ownsBot;
  // 2026-10-15: this bot's tool access and parallel conversations (they were
  // Settings > General > Advanced for every bot). Owner or admin; the server
  // checks the same (server/routes/bot-runtime-settings.ts).
  const showToolAccess = inPart("toolAccess") && advanced && !draft && canEditBotField(state.config, bot, "toolScope");
  const showParallel = inPart("parallel") && advanced && !draft && canEditBotField(state.config, bot, "maxConcurrentThreads");
  const showApprovalRow = showApproval && inPart("approval");
  const showProactive = showApproval && advanced && inPart("proactive");
  const showPageTarget = showApproval && advanced && inPart("pageTarget") && !draft && canEditBotField(state.config, bot, "pageTargetDefault");
  const showFold = !draft && advanced && inPart("fold") && (showApproval || showOutboundUi);
  if (!showPrimaryUi && !showApprovalRow && !showProactive && !showPageTarget && !showFold && !showCustomRules && !showContactUi && !showRecipientsUi && !showDrafts && !showMemeReplies && !showLoopGuard && !showGrokConnectors && !showHooks && !showOutboundUi && !showOwnerPermissions && !showToolAccess && !showParallel) return null;

  const approvalSelector = showApproval && (
    <ApprovalModeSelector
      approvalMode={approvalMode}
      autoApprove={approvalMode === "auto"}
      providerName={engine?.displayName ?? bot.name}
      driverKind={engine?.driverKind ?? ""}
      onSelect={setApprovalMode}
      menuDirection="down"
      align="right"
      wide
      mixed={approvalMixed}
      busy={Boolean(bot.busy)}
      trustedModesAvailable={trustedModesAvailable}
      orgFullAccess={orgFullAccess}
      onManageCommandAllowlist={advanced && !draft && ownerOrAdmin === true ? () => setCommandAllowlistTarget({ botId: bot.id, botName: bot.name }) : undefined}
    />
  );
  const approvalRows = (showApprovalRow || showProactive || showPageTarget || showContactUi || showRecipientsUi || showHooks || showDrafts || showMemeReplies || showLoopGuard || showGrokConnectors) ? (
    <>
      {showApprovalRow && (
        <DescribedRow
          label={t("botPanel.permissions.approval")}
          help={draft && !bulk ? t("botPanel.permissions.approvalDraft") : t("botPanel.permissions.approvalHelp")}
          rowId="approvalLevel"
          // Simple draws its two choices under the label.
          below={!advanced && <div className="mt-2">{approvalSelector}</div>}
        >
          {advanced && approvalSelector}
        </DescribedRow>
      )}
      {showApprovalRow && approvalNotice && bot.busy && (
        <div role="alert" data-approval-notice="" className={cn("mt-2 text-[12px] text-danger", plainSurface && "px-4 pb-2")}>{approvalNotice}</div>
      )}
      {/* 2026-10-28: what the open conversation really runs at, when it is
          not this setting, with why and the way back (server-derived). */}
      {showApprovalRow && !draft && bot.approvalApplied && (
        <AppliedLevelNote
          setting={approvalMode}
          applied={bot.approvalApplied}
          onUseSetting={bot.threadId ? () => {
            if (bot.approvalApplied?.reason === "consent") { setApprovalModeAgain(); return; }
            dispatch({ type: "refreshTaskPermissions", botId: bot.id, threadId: bot.threadId });
          } : undefined}
        />
      )}
      {showProactive && (
        <DescribedRow
          label={t("botPanel.permissions.proactive")}
          help={t("botPanel.permissions.proactiveHelp")}
          description={t(`botPanel.permissions.proactive.${proactiveMode}.hint`)}
          rowId="proactiveMode"
        >
          <Switch
            checked={proactiveMode === "proactive"}
            mixed={proactiveMixed}
            aria-label={t("botPanel.permissions.proactive")}
            disabled={Boolean(bot.busy)}
            onClick={() => setProactiveMode(proactiveMixed || proactiveMode === "off" ? "proactive" : "off")}
          />
        </DescribedRow>
      )}
      {/* #2691: direct email, calendar and text triggers with filters. Hidden
          while drafting or editing several bots (one bot's own channels). */}
      {showProactive && !draft && !bulk && (
        <DirectTriggersRows bot={bot} proactiveOn={proactiveMode === "proactive"} patch={(value) => patch(value)} />
      )}
      {/* #2048: remembered publish target (page / artifact surface). */}
      {showPageTarget && (
        <DescribedRow
          label={t("botPanel.permissions.pageTarget")}
          help={t("botPanel.permissions.pageTargetHelp")}
          description={bot.pageTargetDefault
            ? t("botPanel.permissions.pageTarget.set", {
              name: (() => {
                const id = bot.pageTargetDefault!;
                const keys = pageTargetKeys(id);
                return keys ? t(keys.name) : (builtInPageTargets().find((row) => row.id === id)?.name ?? id);
              })(),
            })
            : t("botPanel.permissions.pageTarget.ask")}
          rowId="pageTargetDefault"
        >
          <PillSelect
            value={bot.pageTargetDefault ?? ""}
            disabled={Boolean(bot.busy)}
            ariaLabel={t("botPanel.permissions.pageTarget")}
            onChange={(value) => patch({ pageTargetDefault: value || null })}
            options={[
              { value: "", label: t("botPanel.permissions.pageTarget.askEachTime") },
              ...builtInPageTargets().map((row) => {
                const keys = pageTargetKeys(row.id);
                return { value: row.id, label: keys ? t(keys.name) : row.name };
              }),
            ]}
          />
        </DescribedRow>
      )}
      {showContactUi && (
        <DescribedRow
          label={t("botPanel.permissions.ask")}
          help={bot.approvePeerComms ? t("botPanel.permissions.askOn") : t("botPanel.permissions.askOff")}
          description={!bot.approvePeerComms && !canCoordinate ? t("botPanel.permissions.cannotContact") : undefined}
          rowId="askBeforeContact"
        >
          <Switch
            checked={Boolean(bot.approvePeerComms)}
            mixed={peerMixed}
            aria-label={t("botPanel.permissions.ask")}
            disabled={!peerMixed && !bot.approvePeerComms && !canCoordinate}
            onClick={() => patch({ approvePeerComms: peerMixed ? true : !bot.approvePeerComms })}
          />
        </DescribedRow>
      )}
      {showRecipientsUi && <AllowedRecipientsRow key={bot.id} bot={bot} />}
      {showDrafts && (
        <DescribedRow
          label={t("botPanel.emailDrafts")}
          help={t("botPanel.emailDrafts.help")}
          description={bot.emailDrafts === false ? t("botPanel.emailDrafts.off") : undefined}
          rowId="emailDrafts"
        >
          <Switch
            checked={bot.emailDrafts !== false}
            aria-label={t("botPanel.emailDrafts")}
            onClick={() => patch({ emailDrafts: bot.emailDrafts === false })}
          />
        </DescribedRow>
      )}
      {showMemeReplies && (
        <DescribedRow
          label={t("botPanel.memeReplies")}
          help={t("botPanel.memeReplies.help")}
          description={bot.memeReplies === "off" ? t("botPanel.memeReplies.off") : t("botPanel.memeReplies.auto")}
          rowId="memeReplies"
        >
          <PillSelect<"auto" | "off">
            value={bot.memeReplies === "off" ? "off" : "auto"}
            ariaLabel={t("botPanel.memeReplies")}
            options={[
              { value: "auto", label: t("botPanel.memeReplies.autoLabel") },
              { value: "off", label: t("botPanel.memeReplies.offLabel") },
            ]}
            onChange={(next) => patch({ memeReplies: next })}
          />
        </DescribedRow>
      )}
      {showLoopGuard && (
        <DescribedRow
          label={t("botPanel.loopGuard")}
          help={t("botPanel.loopGuard.help")}
          description={bot.loopGuard === false ? t("botPanel.loopGuard.off") : undefined}
          rowId="loopGuard"
        >
          <Switch
            checked={bot.loopGuard !== false}
            aria-label={t("botPanel.loopGuard")}
            onClick={() => patch({ loopGuard: bot.loopGuard === false })}
          />
        </DescribedRow>
      )}
      {showGrokConnectors && (
        <DescribedRow
          label={t("botPanel.grokAccountConnectors")}
          help={t("botPanel.grokAccountConnectors.help")}
          description={bot.grokAccountConnectors === true ? t("botPanel.grokAccountConnectors.on") : undefined}
          rowId="grokAccountConnectors"
        >
          <Switch
            checked={bot.grokAccountConnectors === true}
            aria-label={t("botPanel.grokAccountConnectors")}
            onClick={() => patch({ grokAccountConnectors: bot.grokAccountConnectors !== true })}
          />
        </DescribedRow>
      )}
      {showHooks && <LifecycleHooksRow key={`hooks:${bot.id}`} botId={bot.id} />}
    </>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      {showPrimaryUi && <PaneSection title={<>{t("botPanel.permissions.primarySection")}{showTeams && bot.chiefOfStaff && <ProposalStatus bot={bot} />}</>}>
        <SwitchRow
          label={t("botPanel.permissions.primary")}
          description={t("botPanel.permissions.one")}
          help={bot.chiefOfStaff && !canCoordinate
            ? t("botPanel.permissions.holdsRole")
            : bot.chiefOfStaff
              ? t("botPanel.permissions.isPrimary", { team: sectionName })
              : !canCoordinate
                ? t("botPanel.permissions.chooseProvider")
                : currentChief
                  ? t("botPanel.permissions.handOver", { name: currentChief.name })
                  : t("botPanel.permissions.makePrimary")}
          checked={Boolean(bot.chiefOfStaff)}
          disabled={!bot.chiefOfStaff && !canCoordinate}
          onChange={() => togglePrimary()}
          className={plainSurface ? "text-[14px]" : undefined}
        />
        {primaryError && <div role="alert" className="mt-2 text-[12px] text-danger">{primaryError}</div>}
        {showTeams && bot.chiefOfStaff && <ManagedTeamsSettings
          key={bot.id + JSON.stringify(bot.managedSections ?? [])}
          name={bot.name} ownTeam={bot.section?.trim() || ""}
          teams={["", ...viewerTeamChoices]}
          allowed={bot.managedSections ?? []}
          onSave={managedSections => patch({ managedSections, acknowledgePeerScope: true })}
        />}
      </PaneSection>}

      {/* 2026-10-16: one Approvals group of rows like Settings: the
          approval level (2026-10-26: the bot's one approval setting) and
          contacting other bots, then the owner's rules (OwnerPermissionsCard). */}
      {showOwnerPermissions
        ? <OwnerPermissionsCard key={bot.id} bot={bot} leading={approvalRows} />
        : approvalRows && <SettingsGroup title={t(part === "actsAlone" ? "botProfile.v6.group.actsAlone" : part === "advanced" ? "botProfile.v6.group.behaviour" : "botPanel.permissions.approvals")} groupId="approvals">{approvalRows}</SettingsGroup>}

      {/* 2026-10-16: the person's custom rules, in their own words */}
      {showCustomRules && <CustomRulesCard key={`custom-rules:${bot.id}`} bot={bot} />}
      {/* 2026-11-05: the owner's "Toujours ainsi" role rules (visible roles) */}
      {showCustomRules && <RoleRulesCard key={`role-rules:${bot.id}`} botId={bot.id} />}

      {showToolAccess && <BotToolAccess key={`tools:${bot.id}`} bot={bot} />}
      {showParallel && <BotParallelSettings key={`parallel:${bot.id}`} bot={bot} />}
      {showParallel && <BotTurnLimitsSettings key={`turn-limits:${bot.id}`} bot={bot} />}

      {commandAllowlistTarget && <CommandAllowlistDialog
        key={`command-allowlist:${commandAllowlistTarget.botId}`}
        {...commandAllowlistTarget}
        onClose={() => setCommandAllowlistTarget(null)}
      />}
      {/* The command list (also in the approval menu) and sending on your
          behalf: folded. #1169: no "apply Full to every thread" any more:
          every thread follows the bot's level, always. */}
      {showFold && <AdvancedFold id="permissions">
        {showApproval && ownerOrAdmin === true && <button
          type="button"
          className={cn(PILL, "self-start")}
          onClick={() => setCommandAllowlistTarget({ botId: bot.id, botName: bot.name })}
        >{t("commandAllowlist.manage")}</button>}
        {showOutboundUi && <OutboundControl key={bot.id} bot={bot} onChange={(outbound) => patch({ outbound })} />}
      </AdvancedFold>}
      <LocalComputerAutoWarning
        open={localAutoWarning !== null}
        onCancel={() => setLocalAutoWarning(null)}
        onConfirm={() => {
          const target = localAutoWarning;
          setLocalAutoWarning(null);
          if (!target) return;
          dispatch({ type: "updateBot", botId: target, patch: { approvalMode: "auto", acknowledgeLocalAuto: true } });
        }}
      />
    </div>
  );
}

/** Sending on the person's behalf. Below Full access this policy still
 * decides (ask every send, or a daily allowance). Full access sends without
 * asking (omb #2894 / PRO-RÈGLE). Today's count comes from the harness. */
function OutboundControl({ bot, onChange }: { bot: Bot; onChange: (policy: OutboundPolicy) => void }) {
  const policy = bot.outbound ?? DEFAULT_OUTBOUND_POLICY;
  const [today, setToday] = useState<number | null>(null);
  const [capDraft, setCapDraft] = useState(String(policy.dailyCap));

  useEffect(() => {
    setCapDraft(String(policy.dailyCap));
  }, [policy.dailyCap]);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/bots/${bot.id}/outbound`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { today?: number } | null) => {
        if (alive && body && typeof body.today === "number") setToday(body.today);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bot.id, bot.outbound]);

  const commitCap = () => {
    const parsed = Number(capDraft);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      setCapDraft(String(policy.dailyCap));
      return;
    }
    if (parsed !== policy.dailyCap) onChange({ policy: policy.policy, dailyCap: parsed });
  };

  const title = t("botPanel.permissions.outbound");
  // 2026-10-16 : drawn like Settings: the policy in a pill menu, the
  // daily cap as a small number field with its unit.
  return (
    <SettingsGroup title={title} groupId="outbound"
      accessory={<HelpTip label={t("settings.moreAbout", { title })}>{t("botPanel.permissions.outboundHelp")}</HelpTip>}>
      <DescribedRow
        label={t("botPanel.permissions.outboundPolicy")}
        description={t(policy.policy === "allow" ? "botPanel.permissions.allowDailyHint" : "botPanel.permissions.askEveryHint")}
      >
        <PillSelect<OutboundPolicy["policy"]>
          value={policy.policy}
          ariaLabel={title}
          onChange={(value) => { if (value !== policy.policy) onChange({ policy: value, dailyCap: policy.dailyCap }); }}
          options={[
            { value: "ask", label: t("botPanel.permissions.askEvery") },
            { value: "allow", label: t("botPanel.permissions.allowDaily") },
          ]}
        />
      </DescribedRow>
      {policy.policy === "allow" && (
        <DescribedRow
          label={t("botPanel.permissions.dailyLimit")}
          description={today === null ? undefined : t("botPanel.permissions.usedToday", { today: String(today), cap: String(policy.dailyCap) })}
        >
          <UnitField
            value={capDraft}
            unit={t("botPanel.permissions.aDay")}
            label={t("botPanel.permissions.dailyLimit")}
            min={1}
            max={1000}
            onChange={setCapDraft}
            onCommit={commitCap}
          />
        </DescribedRow>
      )}
    </SettingsGroup>
  );
}
