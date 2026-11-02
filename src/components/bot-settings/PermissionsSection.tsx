// Permissions: how autonomously this bot acts: the approval level (ask /
// edits / auto / full, custom on Codex: the only approval setting since
// 2026-10-26, rules first whatever the level), review-routine approvals, whether it asks before
// contacting other bots, and, while it is its person's Primary Bot
// (formerly Chief of Staff), that role. Moved from SettingsPanel.tsx (Chief of Staff ~720-755,
// Ask-before-contacting ~757-776, Approval level ~990-1010, Review routine
// approvals ~1013-1050).
//
// The Auto branch of LocalComputerAutoWarning (choosing Auto while
// bot.computer === "local") and the FullAccessWarning live here with their
// triggers; the Works-on-picker branch (turning computer to "local" while
// already on Auto) stays with AccessSection, next to that picker. The
// warnings remember which bot they were opened for, so a bot switch while
// one is up never applies the choice to the newly selected bot.
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

import { canEditBotField, canStepPrimary, viewerOwnsBot } from "@/lib/bot-capabilities";
import { useAdvancedMode } from "@/lib/interface-mode";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { fullAccessNeedsConfirmation, orgFullAccessFor } from "@/lib/full-access";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { api, useStore, type Bot } from "@/state/store";
import { liveApprovalChange, type ApprovalMode } from "../../../shared/approval-mode";
import { AppliedLevelNote } from "./AppliedLevelNote";
import { proactiveModeFor, type ProactiveMode } from "../../../shared/proactive-mode";
import { DEFAULT_OUTBOUND_POLICY, type OutboundPolicy } from "../../../shared/outbound";
import { ApprovalModeSelector } from "../ApprovalModeSelector";
import { AllowedRecipientsRow } from "./AllowedRecipientsRow";
import { LifecycleHooksRow } from "./LifecycleHooksRow";
import { CommandAllowlistDialog } from "../CommandAllowlistDialog";
import { FullAccessWarning } from "../FullAccessWarning";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { DescribedRow, HelpTip, PILL, PillSelect, SettingsGroup, Switch, SwitchRow, UnitField } from "../SettingsPrimitives";
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

export function PermissionsSection({
  bot,
  derived,
  part = "all",
}: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  /** "approval": the approval level row alone, with its warnings (the bot
   * creation wizard's Rules step, 2026-10-26). */
  part?: "all" | "approval";
}) {
  const advanced = useAdvancedMode();
  const { patch, engine, canCoordinate, approvalMode, trustedModesAvailable, sectionName, currentChief } = derived;
  const { state, dispatch } = useStore();
  const ownerOrAdmin = useOwnerOrAdmin();
  const { draft, bulk, mixedFields } = useBotEditor();
  const [localAutoWarning, setLocalAutoWarning] = useState<string | null>(null);
  const [fullAccessTarget, setFullAccessTarget] = useState<string | null>(null);
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
  // Edit N bots (#1674) offers Full as Edit bot does: the draft stands for
  // the viewer's bots, and the server decides each one at Apply.
  const orgFullAccess = draft && !bulk ? undefined : orgFullAccessFor(perspicaxOrg, bot, viewerId);
  // The menu shows the open conversation. The grant names that conversation
  // so the saved level is the one still on screen after the reply.
  const grantOrgFull = (target: string, confirm: boolean) => {
    dispatch({
      type: "updateBot",
      botId: target,
      patch: {
        approvalMode: "full",
        organizationFullAccess: true,
        ...(confirm ? { confirmFullAccess: true } : {}),
        ...(bot.id === target ? { threadId: bot.threadId } : {}),
      },
    });
  };
  const levelNow = approvalMode;
  const approvalMixed = Boolean(bulk && mixedFields?.has("approvalMode"));
  const proactiveMixed = Boolean(bulk && mixedFields?.has("proactiveMode"));
  const peerMixed = Boolean(bulk && mixedFields?.has("approvePeerComms"));
  const setApprovalMode = (mode: ApprovalMode) => {
    // Mixed bulk: the draft has no shared level, but botApprovalSetting may
    // still read as Ask; allow picking that level explicitly (#1701).
    if (mode === approvalMode && !approvalMixed) return;
    if (bot.busy && !liveApprovalChange(levelNow, mode)) {
      setApprovalNotice(t("approvalMode.busy"));
      return;
    }
    setApprovalNotice(null);
    if (mode === "full" && orgFullAccess !== undefined) {
      if (orgFullAccess !== "allowed") return;
      if (bulk || fullAccessNeedsConfirmation(bot, viewerId, true)) setFullAccessTarget(bot.id);
      else grantOrgFull(bot.id, false);
      return;
    }
    if (mode === "full") {
      setFullAccessTarget(bot.id);
      return;
    }
    if (mode === "auto" && bot.computer === "local") {
      setLocalAutoWarning(bot.id);
      return;
    }
    patch({ approvalMode: mode });
  };
  // Full access the server does not apply yet (its owner's confirmation is
  // missing): the same flow as choosing it, confirmation included.
  const setApprovalModeAgain = () => {
    if (orgFullAccess === undefined || orgFullAccess === "allowed") setFullAccessTarget(bot.id);
  };
  // How autonomously this bot may act on its own. A level next to the approval
  // level, not a Chief orchestrator: the server enforces it per bot
  // (shared/proactive-mode.ts, server/proactive.ts).
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
  const only = part === "approval";
  // one Primary Bot per person: never set on several bots at once
  const showPrimaryUi = !only && !bulk && advanced && showPrimary && (draft || Boolean(bot.chiefOfStaff));
  const showContactUi = !only && advanced && showContact;
  const showOutboundUi = !only && advanced && showOutbound;
  // 2026-10-21 (parité 1C): who it writes to without a card
  const showRecipientsUi = !only && advanced && !draft && canEditBotField(state.config, bot, "allowedRecipients");
  const showDrafts = !only && advanced && !draft && canEditBotField(state.config, bot, "emailDrafts");
  const showLoopGuard = !only && advanced && !draft && canEditBotField(state.config, bot, "loopGuard");
  const showHooks = !only && !draft && canEditBotField(state.config, bot, "allowedRecipients");
  // the owner always manages their own bot's permission mode and rules
  const showOwnerPermissions = !only && !draft && viewerOwnsBot(state.config, bot);
  // 2026-10-15: this bot's tool access and parallel conversations (they were
  // Settings > General > Advanced for every bot). Owner or admin; the server
  // checks the same (server/routes/bot-runtime-settings.ts).
  const showToolAccess = !only && advanced && !draft && canEditBotField(state.config, bot, "toolScope");
  const showParallel = !only && advanced && !draft && canEditBotField(state.config, bot, "maxConcurrentThreads");
  if (!showPrimaryUi && !showApproval && !showContactUi && !showRecipientsUi && !showDrafts && !showLoopGuard && !showHooks && !showOutboundUi && !showOwnerPermissions && !showToolAccess && !showParallel) return null;

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
      disabled={Boolean(bot.busy) && !liveApprovalChange(levelNow, "ask")}
      trustedModesAvailable={trustedModesAvailable}
      orgFullAccess={orgFullAccess}
      onManageCommandAllowlist={advanced && !draft && ownerOrAdmin === true ? () => setCommandAllowlistTarget({ botId: bot.id, botName: bot.name }) : undefined}
    />
  );
  const approvalRows = (showApproval || showContactUi || showRecipientsUi || showHooks || showDrafts || showLoopGuard) ? (
    <>
      {showApproval && (
        <DescribedRow
          label={t("botPanel.permissions.approval")}
          help={draft && !bulk ? t("botPanel.permissions.approvalDraft") : t("botPanel.permissions.approvalHelp")}
          rowId="approvalLevel"
          // Simple draws its two choices under the label.
          below={!advanced && <div className="mt-2">{approvalSelector}</div>}
        >
          {/* 2026-10-26: a lock on the level only while an
              organization rule really limits it (Full turned off by the
              organization); a member otherwise sets their own bot's
              level freely, so no lock. */}
          {orgFullAccess === "disabled" && <span role="img" data-level-org-lock="" aria-label={t("approvalMode.full.orgDisabled")} title={t("approvalMode.full.orgDisabled")} className="mr-1.5 inline-flex text-ink-tertiary">
            <Lock size={11} aria-hidden="true" />
          </span>}
          {advanced && approvalSelector}
        </DescribedRow>
      )}
      {showApproval && approvalNotice && bot.busy && (
        <div role="alert" data-approval-notice="" className="mt-2 text-[12px] text-danger">{approvalNotice}</div>
      )}
      {/* 2026-10-28: what the open conversation really runs at, when it is
          not this setting, with why and the way back (server-derived). */}
      {showApproval && !draft && bot.approvalApplied && (
        <AppliedLevelNote
          setting={approvalMode}
          applied={bot.approvalApplied}
          onUseSetting={bot.threadId ? () => {
            if (bot.approvalApplied?.reason === "consent") { setApprovalModeAgain(); return; }
            dispatch({ type: "refreshTaskPermissions", botId: bot.id, threadId: bot.threadId });
          } : undefined}
        />
      )}
      {showApproval && advanced && !only && (
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
        />
        {primaryError && <div role="alert" className="mt-2 text-[12px] text-danger">{primaryError}</div>}
        {showTeams && bot.chiefOfStaff && <ManagedTeamsSettings
          key={bot.id + JSON.stringify(bot.managedSections ?? [])}
          name={bot.name} ownTeam={bot.section?.trim() || ""}
          teams={["", ...(state.sections ?? []), ...[...state.bots, ...state.groups].map(member => member.section?.trim() || "")]}
          allowed={bot.managedSections ?? []}
          onSave={managedSections => patch({ managedSections, acknowledgePeerScope: true })}
        />}
      </PaneSection>}

      {/* 2026-10-16: one Approvals group of rows like Settings: the
          approval level (2026-10-26: the bot's one approval setting) and
          contacting other bots, then the owner's rules (OwnerPermissionsCard). */}
      {showOwnerPermissions
        ? <OwnerPermissionsCard key={bot.id} bot={bot} leading={approvalRows} />
        : approvalRows && <SettingsGroup title={t("botPanel.permissions.approvals")} groupId="approvals">{approvalRows}</SettingsGroup>}

      {/* 2026-10-16: the person's custom rules, in their own words */}
      {showOwnerPermissions && <CustomRulesCard key={`custom-rules:${bot.id}`} bot={bot} />}

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
      {!draft && advanced && !only && (showApproval || showOutboundUi) && <AdvancedFold id="permissions">
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
      <FullAccessWarning
        open={fullAccessTarget !== null}
        scope={orgFullAccess !== undefined ? "organization" : "bot"}
        onCancel={() => setFullAccessTarget(null)}
        onConfirm={() => {
          const target = fullAccessTarget;
          setFullAccessTarget(null);
          if (!target) return;
          // Edit N bots keeps the level as each bot's own change; its save
          // takes the organization's route where there is no desktop channel
          if (orgFullAccess !== undefined && !bulk) {
            grantOrgFull(target, true);
            return;
          }
          dispatch({ type: "updateBot", botId: target, patch: { approvalMode: "full", confirmFullAccess: true } });
        }}
      />
    </div>
  );
}

/** Sending on the person's behalf. Separate from the approval level on
 * purpose: Full access does not bypass it, so it cannot live inside that
 * selector without implying it does. Today's count comes from the harness,
 * which is the only thing that knows what actually went out. */
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
