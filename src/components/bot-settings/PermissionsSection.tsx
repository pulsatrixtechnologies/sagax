// Permissions: how autonomously this bot acts: the approval level (ask /
// auto / full / custom), review-routine approvals, whether it asks before
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

import { canEditBotField, canStepPrimary, viewerOwnsBot } from "@/lib/bot-capabilities";
import { useAdvancedMode } from "@/lib/interface-mode";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { fullAccessNeedsConfirmation, orgFullAccessFor } from "@/lib/full-access";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { api, useStore, type Bot } from "@/state/store";
import type { ApprovalMode } from "../../../shared/approval-mode";
import { PROACTIVE_MODES, type ProactiveMode } from "../../../shared/proactive-mode";
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
import { ProposalStatus } from "./ProposalStatus";
import { PaneSection } from "./PaneSection";
import { AdvancedFold } from "./AdvancedFold";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";
import { useBotEditor } from "./BotEditorContext";

export function PermissionsSection({
  bot,
  derived,
}: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
}) {
  const advanced = useAdvancedMode();
  const { patch, engine, canCoordinate, approvalMode, trustedModesAvailable, sectionName, currentChief } = derived;
  const { state, dispatch } = useStore();
  const ownerOrAdmin = useOwnerOrAdmin();
  const { draft } = useBotEditor();
  const [localAutoWarning, setLocalAutoWarning] = useState<string | null>(null);
  const [fullAccessTarget, setFullAccessTarget] = useState<string | null>(null);
  const [allThreads, setAllThreads] = useState(true);
  const [commandAllowlistTarget, setCommandAllowlistTarget] = useState<{ botId: string; botName: string } | null>(null);
  const [primaryError, setPrimaryError] = useState<string | null>(null);
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
      .catch((error: unknown) => setPrimaryError(error instanceof Error ? error.message : String(error)));
  };
  // Organization server: the owner sets Full as the bot's default (its new
  // threads and routines) over HTTP while the organization allows it.
  const perspicaxOrg = usePerspicaxOrg();
  const viewerId = state.config?.viewer?.principalId ?? null;
  const orgFullAccess = draft ? undefined : orgFullAccessFor(perspicaxOrg, bot, viewerId);
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
  const setApprovalMode = (mode: ApprovalMode) => {
    if (bot.busy || mode === approvalMode) return;
    if (mode === "full" && orgFullAccess !== undefined) {
      if (orgFullAccess !== "allowed") return;
      if (fullAccessNeedsConfirmation(bot, viewerId, true)) setFullAccessTarget(bot.id);
      else grantOrgFull(bot.id, false);
      return;
    }
    if (mode === "full") {
      setAllThreads(true);
      setFullAccessTarget(bot.id);
      return;
    }
    if (mode === "auto" && bot.computer === "local") {
      setLocalAutoWarning(bot.id);
      return;
    }
    patch({ approvalMode: mode });
  };
  // How autonomously this bot may act on its own. A level next to the approval
  // level, not a Chief orchestrator: the server enforces it per bot
  // (shared/proactive-mode.ts, server/proactive.ts).
  const proactiveMode: ProactiveMode = bot.proactiveMode ?? "off";
  const setProactiveMode = (mode: ProactiveMode) => {
    if (bot.busy || mode === proactiveMode) return;
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
  const showPrimaryUi = advanced && showPrimary && (draft || Boolean(bot.chiefOfStaff));
  const showContactUi = advanced && showContact;
  const showOutboundUi = advanced && showOutbound;
  // 2026-10-21 (parité 1C): who it writes to without a card
  const showRecipientsUi = advanced && !draft && canEditBotField(state.config, bot, "allowedRecipients");
  const showDrafts = advanced && !draft && canEditBotField(state.config, bot, "emailDrafts");
  const showHooks = !draft && canEditBotField(state.config, bot, "allowedRecipients");
  // the owner always manages their own bot's permission mode and rules
  const showOwnerPermissions = !draft && viewerOwnsBot(state.config, bot);
  // 2026-10-15: this bot's tool access and parallel conversations (they were
  // Settings > General > Advanced for every bot). Owner or admin; the server
  // checks the same (server/routes/bot-runtime-settings.ts).
  const showToolAccess = advanced && !draft && canEditBotField(state.config, bot, "toolScope");
  const showParallel = advanced && !draft && canEditBotField(state.config, bot, "maxConcurrentThreads");
  if (!showPrimaryUi && !showApproval && !showContactUi && !showRecipientsUi && !showDrafts && !showHooks && !showOutboundUi && !showOwnerPermissions && !showToolAccess && !showParallel) return null;

  const approvalSelector = showApproval && (
    <ApprovalModeSelector
      approvalMode={bot.approvalMode}
      autoApprove={bot.autoApprove}
      providerName={engine?.displayName ?? bot.name}
      driverKind={engine?.driverKind ?? ""}
      onSelect={setApprovalMode}
      menuDirection="down"
      align="right"
      wide
      disabled={Boolean(bot.busy)}
      trustedModesAvailable={trustedModesAvailable}
      orgFullAccess={orgFullAccess}
      onManageCommandAllowlist={advanced && !draft && ownerOrAdmin === true ? () => setCommandAllowlistTarget({ botId: bot.id, botName: bot.name }) : undefined}
    />
  );
  const approvalRows = (showApproval || showContactUi || showRecipientsUi || showHooks || showDrafts) ? (
    <>
      {showApproval && (
        <DescribedRow
          label={t("botPanel.permissions.approval")}
          help={draft ? t("botPanel.permissions.approvalDraft") : t("botPanel.permissions.approvalHelp")}
          rowId="approvalLevel"
          // Simple draws its two choices under the label.
          below={!advanced && <div className="mt-2">{approvalSelector}</div>}
        >
          <ProposalStatus bot={bot} />
          {advanced && approvalSelector}
        </DescribedRow>
      )}
      {showApproval && advanced && (
        <DescribedRow
          label={t("botPanel.permissions.proactive")}
          help={t("botPanel.permissions.proactiveHelp")}
          description={t(`botPanel.permissions.proactive.${proactiveMode}.hint`)}
          rowId="proactiveMode"
        >
          <PillSelect<ProactiveMode>
            value={proactiveMode}
            ariaLabel={t("botPanel.permissions.proactive")}
            disabled={Boolean(bot.busy)}
            onChange={setProactiveMode}
            options={PROACTIVE_MODES.map((mode) => ({ value: mode, label: t(`botPanel.permissions.proactive.${mode}`) }))}
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
            aria-label={t("botPanel.permissions.ask")}
            disabled={!bot.approvePeerComms && !canCoordinate}
            onClick={() => patch({ approvePeerComms: !bot.approvePeerComms })}
          />
        </DescribedRow>
      )}
      {showRecipientsUi && <AllowedRecipientsRow key={bot.id} bot={bot} />}
      {showDrafts && (
        <SwitchRow
          label={t("botPanel.emailDrafts")}
          description={bot.emailDrafts === false ? t("botPanel.emailDrafts.off") : t("botPanel.emailDrafts.help")}
          checked={bot.emailDrafts !== false}
          onChange={() => patch({ emailDrafts: bot.emailDrafts === false })}
        />
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

      {/* 2026-10-16 (JC): one Approvals group of rows like Settings: the
          approval level, the owner's permission mode (OwnerPermissionsCard)
          and contacting other bots. */}
      {showOwnerPermissions
        ? <OwnerPermissionsCard key={bot.id} bot={bot} leading={approvalRows} />
        : approvalRows && <SettingsGroup title={t("botPanel.permissions.approvals")} groupId="approvals">{approvalRows}</SettingsGroup>}

      {/* 2026-10-16: the person's custom rules, in their own words */}
      {showOwnerPermissions && <CustomRulesCard key={`custom-rules:${bot.id}`} bot={bot} />}

      {showToolAccess && <BotToolAccess key={`tools:${bot.id}`} bot={bot} />}
      {showParallel && <BotParallelSettings key={`parallel:${bot.id}`} bot={bot} />}

      {commandAllowlistTarget && <CommandAllowlistDialog
        key={`command-allowlist:${commandAllowlistTarget.botId}`}
        {...commandAllowlistTarget}
        onClose={() => setCommandAllowlistTarget(null)}
      />}
      {/* Applying Full to every thread, the command list (also in the
          approval menu) and sending on your behalf: folded. */}
      {!draft && advanced && (showApproval || showOutboundUi) && <AdvancedFold id="permissions">
        {showApproval && approvalMode === "full" && trustedModesAvailable && <button
          type="button" disabled={Boolean(bot.busy)}
          className={cn(PILL, "self-start")}
          onClick={() => { setAllThreads(true); setFullAccessTarget(bot.id); }}
        >{t("botPanel.permissions.applyFull")}</button>}
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
        allThreads={allThreads}
        onAllThreadsChange={draft || orgFullAccess !== undefined ? undefined : setAllThreads}
        onCancel={() => setFullAccessTarget(null)}
        onConfirm={() => {
          const target = fullAccessTarget;
          setFullAccessTarget(null);
          if (!target) return;
          if (orgFullAccess !== undefined) {
            grantOrgFull(target, true);
            return;
          }
          dispatch({ type: "updateBot", botId: target, patch: { approvalMode: "full", confirmFullAccess: true, applyToAllThreads: allThreads } });
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
  // 2026-10-16 (JC): drawn like Settings: the policy in a pill menu, the
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
