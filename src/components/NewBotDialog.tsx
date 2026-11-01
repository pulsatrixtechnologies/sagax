import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Plus, Trash2, Wand2, X } from "lucide-react";
import { api, BotEditorStore, useStore, type Bot, type ConfigStatus, type ModelSelection } from "@/state/store";
import { BotCreationDraft, EMPTY_BOT_DEFAULTS } from "@/lib/bot-creation-draft";
import { createConfiguredBot, preparedBotTemplate } from "@/lib/create-configured-bot";
import { BOT_ROLES, roleProfilePatch } from "@/lib/bot-roles";
import { chosenPreset, presetDraftPatch, presetGroups, presetPictureFile, presetSummaryLines, type BotPreset } from "@/lib/bot-presets";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { placeLabelKey } from "@/lib/place";
import { isEffortLevel } from "../../shared/wire";
import { effortLabel } from "./ModelPicker";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { visibilityFromForm, type VisibilityMode } from "./bot-settings/VisibilitySection";
import type { NewBotDefaults } from "../../shared/new-bot-defaults";
import type { Routine } from "@/lib/routines";
import { IdentitySection } from "./bot-settings/IdentitySection";
import { SoulSection } from "./bot-settings/SoulSection";
import { MarkdownEditor } from "./markdown/MarkdownEditor";
import { SkillsSection } from "./bot-settings/SkillsSection";
import { AccessSection } from "./bot-settings/AccessSection";
import { ModelSection } from "./bot-settings/ModelSection";
import { PermissionsSection } from "./bot-settings/PermissionsSection";
import { VoiceSection } from "./bot-settings/VoiceSection";
import { useBotSettingsDerived } from "./bot-settings/useBotSettingsDerived";
import { BotEditorContext } from "./bot-settings/BotEditorContext";
import { CompactRow, ConfirmPill, DescribedRow, FIELD, FieldRow, PILL, PillSelect, PRIMARY_PILL, Switch, type PillOption, DIALOG, GROUP_CARD } from "./SettingsPrimitives";
import { RoutineEditor } from "./RoutinesPage";
import { FullAccessWarning } from "./FullAccessWarning";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { SharePresetDialog } from "./SharePresetDialog";
import { servedPage } from "@/lib/desktop";
import { viewerBotsReadOnly, viewerCanCreateBots, viewerIsOrgMember } from "@/lib/viewer";
import { canEditBotField } from "@/lib/bot-capabilities";
import { memberNewBotFields, memberNewBotSettings } from "@/lib/member-new-bot-settings";
import { PROACTIVE_MODE_DEFAULT, type ProactiveMode } from "../../shared/proactive-mode";
import { botsReadOnlyText } from "@/lib/permissions";
import { templatesEntryActions } from "@/lib/templates-entry";
import { showBotZipImport } from "@/lib/bot-zip";
import { BotZipImportDialog } from "./BotZipImport";
import { AgentImportDialog } from "./AgentImport";
import { refreshModelHealth, startingModel, type StartingModel } from "@/lib/model-health";
import { useMyEngines, usePerspicaxOrg } from "@/lib/perspicax-org";
import { useOfferedInstances } from "@/lib/offered-instances";
import { openModelKeysSettings } from "@/lib/settings-link";
import { readableError } from "@/lib/plain-error";

// New bot is one page (2026-10-14): where to start from, the avatar, the
// name, the description and the team. Every other setting sits under More
// options, folded, one section at a time; all of them can also be changed
// after the bot exists.
const SECTIONS = ["identity", "soul", "skills", "memory", "routines", "access", "model", "permissions", "voice"] as const;
type Section = typeof SECTIONS[number];
const sectionLabel = (id: Section) => t(`newBot.section.${id}` as LocaleKey);

/** Companion pairing permits creation, but not reading host defaults or
 * patching host settings. Keep its existing single-request creation flow.
 * Cancel, Escape and the backdrop always close it, through the caller's
 * `onClose` when one opened it (Settings, the team map) and through the
 * store's New bot flag otherwise. */
export function CompanionNewBotDialog({ onClose, onCreated, section, preserveSelection }: {
  onClose?: () => void; onCreated?: (bot: Bot) => void | Promise<void>; section?: string; preserveSelection?: boolean;
} = {}) {
  const { state, dispatch } = useStore();
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(() => {});
  closeRef.current = () => {
    if (onClose) onClose();
    else dispatch({ type: "toggleNewBot", open: false });
  };
  const close = () => closeRef.current();
  // What this member's permissions open (#1076); nothing else is shown.
  const offered = memberNewBotFields(state.config);
  const [approval, setApproval] = useState<"" | "ask" | "auto">("");
  const [proactive, setProactive] = useState<ProactiveMode>(PROACTIVE_MODE_DEFAULT);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    // On the window, not the dialog: Escape still closes it when focus
    // left the dialog (a click on the backdrop, a disabled button).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <div data-dialog-backdrop className={cn(DIALOG.backdrop, "z-[70]")}
    onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t("newBot.create")} tabIndex={-1}
      className={`${DIALOG.frame} max-w-sm`}
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
        if (event.key === "Tab") {
          const root = event.currentTarget;
          const buttons = [...root.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
          if (event.shiftKey && (document.activeElement === root || document.activeElement === buttons[0])) { event.preventDefault(); buttons.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
        }
      }}>
      <div className={DIALOG.header}><h2 className={DIALOG.title}>{t("newBot.create")}</h2></div>
      <p data-new-bot-quick className="px-5 pb-4 text-[13px] leading-[18px] text-ink-secondary">{t("newBot.quickCreate")}</p>
      {(offered.approvalMode || offered.proactiveMode) && <div data-new-bot-member-settings className="px-5 pb-4">
        {offered.approvalMode && <DescribedRow label={t("botPanel.permissions.approval")} help={t("botPanel.permissions.approvalDraft")} rowId="approvalLevel">
          <PillSelect<"" | "ask" | "auto"> value={approval} ariaLabel={t("botPanel.permissions.approval")} onChange={setApproval}
            options={[
              { value: "", label: t("newBot.memberSettings.serverDefault") },
              { value: "ask", label: t("approvalMode.simple.ask") },
              { value: "auto", label: t("approvalMode.simple.decide") },
            ]} />
        </DescribedRow>}
        {offered.proactiveMode && <DescribedRow label={t("botPanel.permissions.proactive")} help={t("botPanel.permissions.proactiveHelp")}
          description={t(`botPanel.permissions.proactive.${proactive}.hint` as LocaleKey)} rowId="proactiveMode">
          <Switch
            checked={proactive === "proactive"}
            aria-label={t("botPanel.permissions.proactive")}
            onClick={() => setProactive(proactive === "proactive" ? "off" : "proactive")}
          />
        </DescribedRow>}
      </div>}
      <div className={DIALOG.footer}>
        {/* 2026-10-26: the guided wizard beside the quick creation */}
        <button type="button" data-new-bot-wizard onClick={() => { close(); dispatch({ type: "openBotWizard" }); }} className={cn(PILL, "mr-auto")}>
          <Wand2 size={14} aria-hidden="true" />{t("newBot.wizard")}
        </button>
        <button type="button" onClick={close} className={PILL}>{t("common.cancel")}</button>
        <button type="button" disabled={state.botCreationPending} onClick={() => dispatch({ type: "newBot", settings: memberNewBotSettings(state.config, { ...(approval ? { approvalMode: approval } : {}), ...(proactive !== PROACTIVE_MODE_DEFAULT ? { proactiveMode: proactive } : {}) }), ...(section !== undefined ? { section } : {}), ...(preserveSelection ? { preserveSelection } : {}), onCreated: bot => {
          close();
          if (bot && onCreated) void Promise.resolve(onCreated(bot)).catch(cause => dispatch({ type: "error", message: readableError(cause) }));
        } })}
          className={PRIMARY_PILL}>{t("newBot.create")}</button>
      </div>
    </div>
  </div>;
}

/** Shown instead of New bot to a person who may only use the bots shared
 * with them (Perspicax `sagax_bots: use`): never an empty creation form. */
export function BotsReadOnlyDialog({ onClose }: { onClose: () => void }) {
  const { state } = useStore();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return <div data-dialog-backdrop className={cn(DIALOG.backdrop, "z-[70]")}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={t("sidebar.newBot")} tabIndex={-1}
      className={`${DIALOG.frame} max-w-sm`}>
      <div className={DIALOG.header}><h2 className={DIALOG.title}>{t("sidebar.newBot")}</h2></div>
      <p role="note" data-bots-read-only className="px-5 pb-4 text-[13px] leading-[18px] text-ink-secondary">{botsReadOnlyText(state.config)}</p>
      <div className={DIALOG.footer}>
        <button type="button" autoFocus onClick={onClose} className={PRIMARY_PILL}>{t("common.close")}</button>
      </div>
    </div>
  </div>;
}

/** The level New bot starts on: the template's, else the server's own
 * (`approvalMode` of GET /api/bot-defaults: Approve for me, or Ask on an
 * organization whose policy says so), else Approve for me as before. This
 * computer keeps no level here: its own warning decides. */
export function newBotStartMode(profile: Pick<NewBotDefaults["profile"], "approvalMode" | "computer">, server: "ask" | "auto" | undefined): NewBotDefaults["profile"]["approvalMode"] {
  if (profile.approvalMode !== undefined || profile.computer === "local") return profile.approvalMode;
  return server === "ask" ? "ask" : "auto";
}

/** Whether New bot starts on the server's model (GET /api/bot-defaults
 * `modelSelection`) rather than the template's: always when the template
 * names none, and for an organization member (`memberDefault`, #1445),
 * whose bot is never built from the admin's template. Editing the template
 * keeps its own. */
export function newBotUsesServerModel(selection: ModelSelection | undefined, options: { defaultsMode: boolean; memberDefault: boolean }): boolean {
  if (!selection || (selection.instanceId === "" && selection.model === "")) return true;
  return options.memberDefault && !options.defaultsMode;
}

/** Someone signed in to another person's server (an organization member)
 * gets the same single-request creation: the host's defaults and settings
 * are not theirs to read or change. A read-only person gets the notice,
 * never the form. Every route keeps the caller's `onClose`. */
export function NewBotDialog(props: Parameters<typeof LocalNewBotDialog>[0] = {}) {
  const { state, dispatch } = useStore();
  const close = props.onClose ?? (() => dispatch({ type: "toggleNewBot", open: false }));
  if (viewerBotsReadOnly(state.config) || !viewerCanCreateBots(state.config)) return <BotsReadOnlyDialog onClose={close} />;
  const guestOfServer = state.config?.viewer?.operator === false;
  if ((typeof window !== "undefined" && window.ogb?.remoteClient?.active) || guestOfServer) {
    // The host's defaults for new bots are not a guest's to edit: there is
    // no form to show, so close rather than open an empty dialog.
    if (props.defaultsMode) return null;
    return <CompanionNewBotDialog onClose={props.onClose} onCreated={props.onCreated} section={props.section} preserveSelection={props.preserveSelection} />;
  }
  return <LocalNewBotDialog {...props} />;
}

export function LocalNewBotDialog({ defaultsMode = false, onClose, section, onCreated, preserveSelection = false }: {
  defaultsMode?: boolean; onClose?: () => void; section?: string; onCreated?: (bot: Bot) => void | Promise<void>; preserveSelection?: boolean;
} = {}) {
  const parent = useStore();
  const [, render] = useState(0);
  const [draft, setDraft] = useState(() => new BotCreationDraft(EMPTY_BOT_DEFAULTS, () => render(value => value + 1)));
  // The defaults editor is all settings: it opens with More options unfolded.
  const [moreOpen, setMoreOpen] = useState(defaultsMode);
  const [ready, setReady] = useState(false);
  const [localSaving, setSaving] = useState(false);
  const saving = localSaving || parent.state.botCreationPending;
  const savingRef = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState<"full" | "local" | null>(null);
  const [audience, setAudience] = useState<VisibilityMode>("everyone");
  const [people, setPeople] = useState("");
  const ownerOrAdmin = useOwnerOrAdmin();
  const choosesVisibility = !defaultsMode && typeof window !== "undefined" && servedPage() &&
    (ownerOrAdmin === true || (viewerIsOrgMember(parent.state.config) && canEditBotField(parent.state.config, {}, "visibility", { draft: true })));
  const dialog = useRef<HTMLDivElement>(null);
  const [startKind, setStartKind] = useState<StartingModel["kind"] | null>(null);
  const configuredModel = useRef<ModelSelection | null>(null);
  const appliedModel = useRef<ModelSelection | null>(null);
  const closeRef = useRef(() => {});
  closeRef.current = () => {
    if (onClose) onClose();
    else parent.dispatch({ type: "toggleNewBot", open: false });
  };
  useEffect(() => {
    let cancelled = false;
    void api<{ defaults: NewBotDefaults; modelSelection: ModelSelection; suggestedName: string; approvalMode?: "ask" | "auto"; memberDefault?: boolean }>("/api/bot-defaults")
      .then(result => {
        if (cancelled) return;
        const defaults = structuredClone(result.defaults);
        const selection = defaults.profile.modelSelection;
        // #1445: a member's new bot starts on the model chosen for them
        // (their starred one, else one they can run), never the template's.
        if (newBotUsesServerModel(selection, { defaultsMode, memberDefault: result.memberDefault === true })) {
          defaults.profile.modelSelection = result.modelSelection;
        }
        configuredModel.current = defaults.profile.modelSelection ?? null;
        // The level this server starts a new bot on (an organization's
        // policy, 2026-10-11) when the template names none; editing the
        // template itself keeps "none" so the policy keeps deciding.
        if (!defaultsMode) defaults.profile.approvalMode = newBotStartMode(defaults.profile, result.approvalMode);
        if (!defaultsMode) defaults.profile.name = defaults.profile.name?.trim() || result.suggestedName;
        if (section !== undefined) defaults.profile.section = section;
        setDraft(new BotCreationDraft(defaults, () => render(value => value + 1)));
        setReady(true);
      }).catch(cause => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [defaultsMode, section]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // after the effects above: their order is the dialog's own
  const org = usePerspicaxOrg();
  const myEngines = useMyEngines();
  // Whether the models work is checked in the background as the form opens
  // (src/lib/model-health.ts: the engines' state the server already keeps,
  // asked again at most once a minute); the new bot starts on one that works.
  useEffect(() => {
    if (!defaultsMode && parent.refreshInstances) void refreshModelHealth(() => parent.refreshInstances());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsMode]);
  // the engines offered to this person (src/lib/offered-instances.ts)
  const instances = useOfferedInstances();
  useEffect(() => {
    const configured = configuredModel.current;
    if (defaultsMode || !ready || !configured || instances.length === 0) return;
    const current = draft.bot.modelSelection;
    // a model the person chose in the form is theirs: never replaced
    if (!sameModel(current, configured) && !(appliedModel.current && sameModel(current, appliedModel.current))) return;
    const start = startingModel(configured, instances, { orgMode: org !== null, myEngines });
    setStartKind(start.kind);
    if (!sameModel(start.selection, current)) {
      appliedModel.current = start.selection;
      draft.setModel(start.selection);
    }
  }, [defaultsMode, ready, draft, instances, org, myEngines]);
  useEffect(() => () => draft.dispose(), [draft]);
  // Disabling the focused Create button drops focus to the page in Chromium.
  // Keep keyboard dismissal and focus trapping inside the pending dialog.
  useEffect(() => { if (saving) dialog.current?.focus(); }, [saving]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      const root = dialog.current;
      if (!root || (event.target instanceof Node && !root.contains(event.target))) return;
      const nested = root.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      if (nested && nested.getClientRects().length) return;
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]')]
        .filter(control => control.getClientRects().length && !control.closest("[hidden],fieldset:disabled"));
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); root.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus(); };
  }, []);
  const save = async () => {
    if (!ready || savingRef.current || parent.state.botCreationPending) return;
    if (!defaultsMode && draft.bot.approvalMode === "full" && !draft.consent.confirmFullAccess) { setWarning("full"); return; }
    if (!defaultsMode && draft.bot.approvalMode === "auto" && draft.bot.computer === "local" && !draft.consent.acknowledgeLocalAuto) { setWarning("local"); return; }
    const visibility = choosesVisibility ? visibilityFromForm(audience, people) : null;
    if (visibility && !visibility.ok) { setError(t("botSettings.visibility.needPeople")); return; }
    savingRef.current = true; setSaving(true); setError("");
    parent.dispatch({ type: "botCreationPending", on: true });
    try {
      if (defaultsMode) await api("/api/config", { method: "PATCH", body: JSON.stringify({ newBotDefaults: await preparedBotTemplate(draft) }) });
      else {
        const { bot, warnings } = await createConfiguredBot(draft, undefined, undefined, undefined, visibility?.ok ? visibility.visibility : undefined, {
          memberFieldsOnly: viewerIsOrgMember(parent.state.config),
          // the settings this member's permissions let them pick in the form (#1076)
          memberMayWrite: field => canEditBotField(parent.state.config, {}, field, { draft: true }),
        });
        parent.dispatch({ type: "botAdded", bot, preserveSelection });
        if (warnings.length) parent.dispatch({ type: "error", message: warnings.join("\n") });
        try { await onCreated?.(bot); }
        catch (cause) { parent.dispatch({ type: "error", message: readableError(cause) }); }
      }
      savingRef.current = false; if (alive.current) closeRef.current();
    } catch (cause) { if (alive.current) setError(readableError(cause)); }
    finally {
      savingRef.current = false;
      parent.dispatch({ type: "botCreationPending", on: false });
      if (alive.current) setSaving(false);
    }
  };
  const bot = draft.bot;
  const scopedStore: ReturnType<typeof useStore> = {
    ...parent,
    state: { ...parent.state, bots: [bot, ...parent.state.bots], routines: draft.routines, routineRuns: [], routinesLoadState: "ready" },
    flushBotPatches: async () => bot,
    dispatch: action => {
      if (action.type === "updateBot" && action.botId === draft.id) draft.patch(action.patch);
      else if (action.type === "setModel" && action.botId === draft.id) {
        draft.setModel(action.selection);
      } else if (action.type === "routinePatched") { /* Applied by the draft transport. */ }
      else if (action.type === "toggleSettings") { /* Editor links stay inside this dialog. */ }
      else parent.dispatch(action);
    },
  };
  const title = defaultsMode ? t("newBot.defaults") : t("sidebar.newBot");
  const visibilityRow = choosesVisibility ? (
    <div data-new-bot-visibility>
      <CompactRow label={t("botSettings.visibility.title")}>
        <PillSelect<VisibilityMode>
          value={audience}
          disabled={saving}
          ariaLabel={t("botSettings.visibility.title")}
          options={[
            { value: "everyone", label: t("botSettings.visibility.everyone") },
            { value: "admins", label: t("botSettings.visibility.admins") },
            { value: "people", label: t("botSettings.visibility.people") },
          ]}
          onChange={setAudience}
        />
      </CompactRow>
      {audience === "people" && (
        <FieldRow label={t("botSettings.visibility.peopleLabel")}>
          <input
            value={people}
            disabled={saving}
            onChange={(event) => setPeople(event.target.value)}
            placeholder={t("botSettings.visibility.peoplePlaceholder")}
            className={FIELD}
          />
        </FieldRow>
      )}
    </div>
  ) : null;
  return <div className={cn(DIALOG.backdrop, "z-[70]")} hidden={!defaultsMode && parent.state.appSettingsOpen}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} aria-busy={saving} tabIndex={-1}
      className={`${DIALOG.frame} h-[min(760px,94dvh)] max-w-[720px]`}>
      <div className={DIALOG.header}>
        <h2 className={DIALOG.title}>{title}</h2>
        <button type="button" onClick={() => closeRef.current()} aria-label={t("common.close")}
          className={cn(DIALOG.close, "disabled:opacity-40")}><X size={18} className="pointer-events-none" /></button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 pb-4 pt-2">
        {!ready && !error && <div role="status" className="flex items-center gap-2 px-1 text-[13px] text-ink-secondary"><Loader2 size={16} className="animate-spin" />{t("newBot.loading")}</div>}
        {visibilityRow && <div className={cn(GROUP_CARD, "mx-auto mb-5 max-w-[640px]")}>{visibilityRow}</div>}
        {ready && <fieldset disabled={saving} className="mx-auto min-w-0 max-w-[640px]">
          <BotEditorStore value={scopedStore}><BotEditorContext.Provider value={{ request: draft.request, draft: true, uploadAvatar: draft.uploadAvatar }}>
            <DraftPage draft={draft} defaultsMode={defaultsMode} moreOpen={moreOpen} onToggleMore={() => setMoreOpen(open => !open)} onImported={() => closeRef.current()} />
          </BotEditorContext.Provider></BotEditorStore>
        </fieldset>}
      </div>
      {error && <p role="alert" className="mx-5 mb-2 max-h-24 overflow-y-auto rounded-xl bg-danger/10 px-3.5 py-2 text-[12.5px] text-danger">{error}</p>}
      {ready && startKind === "none" && (
        <div role="status" data-new-bot-no-model className="mx-5 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-warning/10 px-3.5 py-2 text-[12.5px] text-warning">
          <span>{t("newBot.model.none")}</span>
          <button type="button" data-new-bot-model-settings onClick={() => {
            closeRef.current();
            openModelKeysSettings(parent.dispatch);
          }} className="font-medium text-accent-text underline-offset-2 hover:underline">{t("newBot.model.openSettings")}</button>
        </div>
      )}
      {ready && (startKind === "auto" || startKind === "first") && (
        <p role="status" data-new-bot-model-switched className="px-6 pb-2 text-[12px] text-ink-secondary">
          {t(startKind === "auto" ? "newBot.model.switchedAuto" : "newBot.model.switchedFirst")}
        </p>
      )}
      <div className={DIALOG.footer}>
        {/* 2026-10-26: the bot creation wizard, beside this quick dialog */}
        {!defaultsMode && <button type="button" data-new-bot-wizard disabled={saving} onClick={() => { closeRef.current(); parent.dispatch({ type: "openBotWizard" }); }} className={cn(PILL, "mr-auto")}>
          <Wand2 size={14} aria-hidden="true" />{t("newBot.wizard")}
        </button>}
        <button type="button" onClick={() => closeRef.current()} className={PILL}>{t("common.cancel")}</button>
        <button type="button" disabled={!ready || saving || (!defaultsMode && !bot.name.trim())} onClick={() => void save()}
          className={PRIMARY_PILL}>
          {saving && <Loader2 size={15} className="animate-spin" />}{t(defaultsMode ? "newBot.saveDefaults" : "newBot.create")}
        </button>
      </div>
      <FullAccessWarning open={warning === "full"} onCancel={() => setWarning(null)} onConfirm={() => { draft.consent.confirmFullAccess = true; setWarning(null); void save(); }} />
      <LocalComputerAutoWarning open={warning === "local"} onCancel={() => setWarning(null)} onConfirm={() => { draft.consent.acknowledgeLocalAuto = true; setWarning(null); void save(); }} />
    </div>
  </div>;
}

function sameModel(a: ModelSelection | undefined, b: ModelSelection | undefined): boolean {
  return Boolean(a && b) && a!.instanceId === b!.instanceId && a!.model === b!.model && Boolean(a!.auto) === Boolean(b!.auto);
}

/** The page itself: Start from, the avatar, name and description, the team
 * when there is more than one to choose from, then More options. Exported
 * for tests. */
export function DraftPage({ draft, defaultsMode, moreOpen, onToggleMore, onImported }: {
  draft: BotCreationDraft; defaultsMode: boolean; moreOpen: boolean; onToggleMore: () => void; onImported?: () => void;
}) {
  const bot = draft.bot;
  const { state } = useStore();
  const derived = useBotSettingsDerived(bot);
  const [active, setActive] = useState<Section>("identity");
  // 2026-10-26: a member sets up every section of their own new bot;
  // each control still follows its field (canEditBotField).
  const sections = SECTIONS;
  const choosesTeam = canEditBotField(state.config, {}, "section", { draft: true });
  const teams = [...new Set([...(state.sections ?? []), ...state.bots.map(existing => existing.section ?? ""), bot.section ?? ""])].filter(Boolean);
  // Start from and Team are one card of compact rows, as Settings draws
  // them; the avatar, name and description follow; More options is the
  // last row, folded.
  return <div className="flex flex-col gap-5">
    <div className={GROUP_CARD}>
      <StartingRole draft={draft} defaultsMode={defaultsMode} onImported={onImported} />
      {choosesTeam && teams.length > 0 && <div data-new-bot-team>
        <CompactRow label={t("newBot.team")}>
          <PillSelect
            value={bot.section ?? ""}
            ariaLabel={t("newBot.team")}
            options={[{ value: "", label: t("sidebar.section.general") }, ...teams.map(name => ({ value: name, label: name }))]}
            onChange={section => draft.patch({ section })}
          />
        </CompactRow>
      </div>}
    </div>
    <IdentitySection bot={bot} patch={derived.patch} activeState={derived.activeState} mascotMotion={null} part="main"
      namePlaceholder={defaultsMode ? t("newBot.randomName") : undefined} />
    <div data-new-bot-more className="flex flex-col rounded-xl border-[0.5px] border-border bg-elevated">
      <button type="button" aria-expanded={moreOpen} aria-controls="new-bot-more-options" onClick={onToggleMore}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left text-[13px] leading-[18px] text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none">
        {t("newBot.moreOptions")}
        <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none", moreOpen && "rotate-180")} />
      </button>
      {moreOpen && <div id="new-bot-more-options" className="flex flex-col gap-4 px-3.5 pb-3.5 pt-1">
        <nav aria-label={t("newBot.sections")} className="flex flex-wrap gap-1">
          {sections.map(id => <button key={id} type="button" data-new-bot-section={id} onClick={() => setActive(id)} aria-current={active === id ? "page" : undefined}
            className={cn("min-h-[44px] shrink-0 rounded-full px-3 text-[13px] leading-[18px] transition-colors md:h-7 md:min-h-0 motion-reduce:transition-none", active === id ? "bg-selected text-ink" : "text-ink-secondary hover:bg-hover hover:text-ink")}>{sectionLabel(id)}</button>)}
        </nav>
        <DraftSection active={sections.includes(active) ? active : "identity"} draft={draft} derived={derived} />
      </div>}
    </div>
  </div>;
}

function DraftSection({ active, draft, derived }: { active: Section; draft: BotCreationDraft; derived: ReturnType<typeof useBotSettingsDerived> }) {
  const bot = draft.bot;
  if (active === "identity") return <IdentitySection bot={bot} patch={derived.patch} activeState={derived.activeState} mascotMotion={null} part="more" />;
  if (active === "soul") return <SoulSection bot={bot} patch={derived.patch} />;
  if (active === "skills") return <SkillsSection bot={bot} />;
  if (active === "memory") return <DraftMemory draft={draft} />;
  if (active === "routines") return <DraftRoutines draft={draft} />;
  if (active === "access") return <AccessSection bot={bot} derived={derived} />;
  if (active === "model") return <ModelSection bot={bot} />;
  if (active === "permissions") return <PermissionsSection bot={bot} derived={derived} />;
  return <VoiceSection bot={bot} derived={derived} />;
}

const BROWSE_TEMPLATES = "action:browse-templates";
const IMPORT_ZIP = "action:import-zip";
const IMPORT_AGENT = "action:import-agent";

/** Starting role: presets from the organization and imported files first,
 * then the built-in roles. A preset fills name, look and instructions (all
 * still editable); its skills and notes are added when the bot is created.
 * "Browse templates" closes New bot and opens Browse Bots on Templates, the
 * one place where every template lives (described, with the apps it uses).
 * "Import from zip" makes the bot from its `.sagaxbot.zip` instead, then
 * New bot closes on the imported bot. Exported for tests. */
export function StartingRole({ draft, defaultsMode, onImported }: { draft: BotCreationDraft; defaultsMode: boolean; onImported?: () => void }) {
  const { state, dispatch } = useStore();
  const [zipOpen, setZipOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [presets, setPresets] = useState<BotPreset[]>([]);
  const [loads, setLoads] = useState(0);
  const [error, setError] = useState("");
  // The draft's picture came from a preset (so the next preset may replace it).
  const presetPicture = useRef(false);
  useEffect(() => {
    // Defaults are the installation's own; presets are for one new bot.
    if (defaultsMode) return;
    let cancelled = false;
    void api<{ presets: BotPreset[] }>("/api/bot-presets")
      .then(result => { if (!cancelled) setPresets(result.presets); })
      // Members and older servers: the built-in roles only.
      .catch(() => { if (!cancelled) setPresets([]); });
    return () => { cancelled = true; };
  }, [defaultsMode, loads]);
  const chosen = draft.preset ? presets.find(preset => preset.id === draft.preset!.id) : undefined;
  const choose = async (value: string) => {
    setError("");
    const preset = value.startsWith("preset:") ? presets.find(candidate => candidate.id === value.slice("preset:".length)) : undefined;
    if (!preset) {
      draft.choosePreset(undefined);
      const role = BOT_ROLES.find(role => role.id === value);
      if (role) draft.patch(roleProfilePatch(role));
      return;
    }
    draft.patch(presetDraftPatch(preset));
    draft.choosePreset(chosenPreset(preset));
    const picture = presetPictureFile(preset);
    try {
      if (picture) {
        draft.patch({ avatarUrl: await draft.uploadAvatar(picture), avatarCrop: preset.bot.appearance!.avatar!.crop });
        presetPicture.current = true;
      } else if (presetPicture.current) {
        draft.patch({ avatarUrl: "" });
        presetPicture.current = false;
      }
    } catch (cause) {
      setError(readableError(cause));
    }
  };
  const remove = async (preset: BotPreset) => {
    setError("");
    try {
      await api(`/api/bot-presets/${encodeURIComponent(preset.id)}`, { method: "DELETE" });
      if (draft.preset?.id === preset.id) draft.choosePreset(undefined);
      setLoads(value => value + 1);
    } catch (cause) {
      setError(readableError(cause));
    }
  };
  const canImport = !defaultsMode && showBotZipImport(state.config);
  // Browse templates and Import from zip are two more ways to start: they
  // are offered in the same list, and picking one opens it (the list keeps
  // what it showed).
  const onPick = (value: string) => {
    if (value === BROWSE_TEMPLATES) { for (const action of templatesEntryActions("newBot")) dispatch(action); return; }
    if (value === IMPORT_ZIP) { setZipOpen(true); return; }
    if (value === IMPORT_AGENT) { setAgentOpen(true); return; }
    void choose(value);
  };
  return <div>
    {zipOpen && <BotZipImportDialog onClose={() => setZipOpen(false)} onImported={() => onImported?.()} />}
    {agentOpen && <AgentImportDialog onClose={() => setAgentOpen(false)} onImported={() => onImported?.()} />}
    <div data-new-bot-start>
      <CompactRow label={t("newBot.startingRole")}>
        <PillSelect
          value={draft.preset ? `preset:${draft.preset.id}` : ""}
          ariaLabel={t("newBot.startingRole")}
          options={startOptions(presets, defaultsMode, canImport)}
          onChange={onPick}
        />
      </CompactRow>
    </div>
    {chosen && <div className="mx-3.5 mb-2 flex flex-col gap-1 rounded-lg bg-inset px-3 py-2.5 text-[12.5px] text-ink-secondary" data-new-bot-preset>
      {presetSummaryLines(chosen).map((line, index) => <p key={index} className="break-words">{line}</p>)}
      {chosen.source === "file" && <div className="mt-1">
        <ConfirmPill label={t("newBot.presetRemove")} confirmLabel={t("common.confirmRemove")} onConfirm={() => void remove(chosen)} />
      </div>}
    </div>}
    {error && <p role="alert" className="px-3.5 pb-2 text-[12.5px] text-danger">{error}</p>}
  </div>;
}

/** The Start from menu: presets first (grouped as the server groups them),
 * then the built-in roles, then the other ways to start. Pure, for tests. */
export function startOptions(presets: BotPreset[], defaultsMode: boolean, canImport: boolean): PillOption<string>[] {
  const options: PillOption<string>[] = [{ value: "", label: t("newBot.customSettings") }];
  for (const group of presetGroups(presets)) {
    for (const preset of group.presets) options.push({ value: `preset:${preset.id}`, label: preset.name, group: group.label });
  }
  const rolesGroup = presets.length || !defaultsMode ? t("newBot.builtInRoles") : undefined;
  for (const role of BOT_ROLES) options.push({ value: role.id, label: role.title, ...(rolesGroup ? { group: rolesGroup } : {}) });
  if (!defaultsMode) {
    options.push({ value: BROWSE_TEMPLATES, label: t("newBot.browseTemplatesOption"), group: t("newBot.otherStarts") });
    if (canImport) options.push({ value: IMPORT_ZIP, label: t("newBot.importZipOption"), group: t("newBot.otherStarts") });
    if (canImport) options.push({ value: IMPORT_AGENT, label: t("newBot.importAgentOption"), group: t("newBot.otherStarts") });
  }
  return options;
}

/** Exported for tests. */
export function DraftMemory({ draft }: { draft: BotCreationDraft }) {
  const [path, setPath] = useState("MEMORY.md");
  const [name, setName] = useState("");
  return <div className="flex flex-col gap-3">
    <div className="flex justify-start">
      <PillSelect
        value={path}
        ariaLabel={t("newBot.memory.file")}
        options={[...new Set(["MEMORY.md", ...Object.keys(draft.template.memory)])].map(file => ({ value: file, label: file }))}
        onChange={setPath}
      />
    </div>
    <MarkdownEditor ariaLabel={t("newBot.memory.contents")} dataField="new-bot-memory" minHeight={288} value={draft.template.memory[path] ?? ""} onChange={value => draft.setMemory(path, value)} />
    <div className="flex items-center gap-2"><input className={FIELD} aria-label={t("newBot.memory.newTopic")} placeholder={t("newBot.memory.topicName")} value={name} onChange={event => setName(event.target.value)} />
      <button type="button" aria-label={t("newBot.memory.addTopic")} title={t("newBot.memory.addTopic")} disabled={!/^[a-zA-Z0-9_-]+$/.test(name)} className={PILL} onClick={() => { const next = `memory/${name}.md`; if (!(next in draft.template.memory)) draft.setMemory(next, ""); setPath(next); setName(""); }}><Plus size={14} aria-hidden="true" /></button>
      {path !== "MEMORY.md" && <ConfirmPill label={t("newBot.memory.removeTopic")} confirmLabel={t("common.confirmRemove")} onConfirm={() => { draft.setMemory(path, null); setPath("MEMORY.md"); }}><Trash2 size={14} aria-hidden="true" /></ConfirmPill>}
    </div>
  </div>;
}

function DraftRoutines({ draft }: { draft: BotCreationDraft }) {
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  return <div className="flex flex-col gap-3">
    {draft.routines.length > 0 && <div className="flex flex-col rounded-xl border-[0.5px] border-border py-1.5">
      {draft.routines.map(routine => <div key={routine.id} className="flex min-h-[44px] items-center gap-3 px-3.5 py-1.5">
        <button type="button" className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline" onClick={() => setEditing(routine)}>{routine.name}</button>
        <Switch checked={routine.enabled} aria-label={`${routine.name} · ${t("newBot.routine.enabled")}`} title={t("newBot.routine.enabled")} onClick={() => draft.setRoutineEnabled(routine.id, !routine.enabled)} />
        <ConfirmPill label={t("newBot.routine.remove", { name: routine.name })} confirmLabel={t("common.confirmRemove")} onConfirm={() => draft.removeRoutine(routine.id)}><Trash2 size={14} aria-hidden="true" /></ConfirmPill>
      </div>)}
    </div>}
    <div><button type="button" className={PILL} onClick={() => setEditing("new")}><Plus size={14} aria-hidden="true" />{t("computer.routines.create")}</button></div>
    {editing && <RoutineEditor routine={editing === "new" ? undefined : editing} bots={[draft.bot]} lockedBotId={draft.id} onClose={() => setEditing(null)} />}
  </div>;
}

/** One line: model, effort, approval, Works on. Empty fields are left out. */
export function newBotDefaultsSummary(config: ConfigStatus | null | undefined): string {
  const profile = config?.newBotDefaults?.profile;
  if (!profile) return "";
  const bits: string[] = [];
  const model = profile.modelSelection?.model?.trim();
  if (model) bits.push(model);
  const effort = profile.modelSelection?.effort;
  if (effort && isEffortLevel(effort)) bits.push(effortLabel(effort));
  if (profile.approvalMode) bits.push(t(`approvalMode.${profile.approvalMode}.chip` as LocaleKey));
  if (profile.computer) bits.push(t(placeLabelKey(profile.computer)));
  return bits.length === 0 ? "" : t("newBot.defaults.summary", { summary: bits.join(" · ") });
}

function DefaultsTitle({ summary }: { summary: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] leading-[18px] text-ink">{t("newBot.defaults")}</div>
      {summary ? <p className="truncate text-[12px] leading-[16px] text-ink-secondary">{summary}</p> : null}
    </div>
  );
}

export function DefaultBotSettings() {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const summary = newBotDefaultsSummary(state.config);
  // A read-only person reads why instead of a button that would open an
  // empty form. A guest of someone else's server (an organization member,
  // a companion) cannot read or change the host's defaults: no row.
  if (viewerBotsReadOnly(state.config)) {
    return <div className="flex items-center justify-between gap-4 px-3.5 py-2.5"><DefaultsTitle summary={summary} />
      <p role="note" data-bots-read-only className="text-right text-[12.5px] leading-snug text-ink-secondary">{botsReadOnlyText(state.config)}</p>
    </div>;
  }
  const guest = state.config?.viewer?.operator === false || (typeof window !== "undefined" && window.ogb?.remoteClient?.active === true);
  if (guest) return null;
  return <>
    <div className="flex items-center justify-between gap-4 px-3.5 py-2.5"><DefaultsTitle summary={summary} />
      <div className="flex shrink-0 gap-2">
        {/* The reference design's pills, as the other rows of General > System (0.5.6) */}
        <button type="button" onClick={() => setSharing(true)} className="ui-button cursor-pointer bg-transparent text-ink-secondary hover:bg-hover hover:text-ink">{t("newBot.sharePreset")}</button>
        <button type="button" onClick={() => setOpen(true)} className="ui-button cursor-pointer">{t("newBot.edit")}</button>
      </div>
    </div>
    {open && <NewBotDialog defaultsMode onClose={() => setOpen(false)} />}
    {sharing && <SharePresetDialog onClose={() => setSharing(false)} />}
  </>;
}
