// The bot creation window (2026-10-26; restored centred dialog after UX lot 4).
// One entry for New bot. First step is quick create (name, shape, colour,
// Create); guided and manual setup, the full template form, Browse templates
// and Import (zip / Grok Bot / Claude Code) stay as paths under it. Nothing
// the old New bot dialog offered is dropped.
//
// - Guided never waits on a bot the person lacks: with no bot to guide, it
//   creates the Bot designer (src/lib/bot-wizard.ts). With no engine, the
//   card says so and opens Settings > Engines.
// - Six steps over that real bot (WizardSteps.tsx), each skippable.
// - Recap: compact summary, Try it, then Finish.
//
// Later (Escape, Back) keeps the draft: the bot stays a draft until Finish.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bot as BotIcon, ClipboardList, Download, LayoutTemplate, Library, Loader2, MessagesSquare, PlugZap, Send, Trash2 } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { isBackShortcut } from "@/lib/back-shortcut";
import { engineSummary, organisationSignIn } from "@/lib/onboarding";
import { openModelKeysSettings } from "@/lib/settings-link";
import { templatesEntryActions } from "@/lib/templates-entry";
import { showBotZipImport } from "@/lib/bot-zip";
import { canEditBotField } from "@/lib/bot-capabilities";
import { memberNewBotSettings } from "@/lib/member-new-bot-settings";
import { botsReadOnlyText } from "@/lib/permissions";
import { viewerBotsReadOnly, viewerCanCreateBots } from "@/lib/viewer";
import {
  createDesignerBot,
  createWizardBot,
  deleteWizardDraft,
  finishWizard,
  guideBot,
  listWizardDrafts,
  openWizardThread,
  patchWizardDraft,
  pendingRules,
  readWizardDraft,
  sendWizardMessage,
  setSuggestedRule,
  startWizardDraft,
  wizardSuggestions,
  type WireWizardDraft,
} from "@/lib/bot-wizard";
import {
  WIZARD_STEPS,
  applyWizardPatch,
  guidedKickoff,
  nextStepFor,
  previousStepFor,
  tryItMessage,
  wizardPath,
  type WizardMode,
  type WizardPatch,
  type WizardStep,
} from "../../../shared/bot-wizard";
import { PulsatrixMark } from "../PulsatrixMark";
import { BotAvatar } from "../Avatar";
import { ProgressDots } from "../onboarding/ProgressDots";
import { PrimaryButton, QuietButton } from "../onboarding/beats/shared";
import { StepBody, stepIntro, stepTitle, useRuleEffects, type StepProps } from "./WizardSteps";
import { QuickCreate, type QuickCreateChoice } from "./QuickCreate";
import { worksOnMode } from "../computer/WorksOnSetting";
import { placeLabelKey } from "@/lib/place";
import { BOT_ROLES } from "@/lib/bot-roles";
import type { LocaleKey } from "@/locales";
import { WizardConversation } from "./WizardConversation";
import { engineReady } from "../EngineLibrary";
import { BotZipImportPanel } from "../BotZipImport";
import { AgentImportPanel } from "../AgentImport";
import { NewBotForm } from "../lazy-new-bot";
import { readableError } from "@/lib/plain-error";

/** How often the guided panel reads the draft back while the Primary Bot fills it. */
const GUIDED_POLL_MS = 2_500;

type WizardPhase = "loading" | "choose" | "template" | "import-zip" | "import-agent" | "steps";

export function BotWizard() {
  const { state, dispatch } = useStore();
  const opened = state.botWizard;
  const language = activeLocale();
  const cardRef = useRef<HTMLDivElement>(null);
  const [botId, setBotId] = useState<string | null>(opened?.botId ?? null);
  const [draft, setDraft] = useState<WireWizardDraft | null>(null);
  const [phase, setPhase] = useState<WizardPhase>(opened?.botId ? "loading" : "choose");
  const [drafts, setDrafts] = useState<WireWizardDraft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<WireWizardDraft | null>(null);
  draftRef.current = draft;
  const bot = botId ? state.bots.find((candidate) => candidate.id === botId) ?? null : null;
  const guide = useMemo(() => {
    if (draft?.guidedBotId) return state.bots.find((candidate) => candidate.id === draft.guidedBotId) ?? null;
    return guideBot(state.bots, botId);
  }, [draft?.guidedBotId, state.bots, botId]);
  const readOnly = viewerBotsReadOnly(state.config) || !viewerCanCreateBots(state.config);
  const canImport = showBotZipImport(state.config);

  // An engine that can run the guide's turns (the first run's own test).
  const engineReadyNow = useMemo(() => {
    const instances = state.instances ?? [];
    // not listed yet (the first /api/instances answer): no verdict, no flash
    if (instances.length === 0) return true;
    const summary = engineSummary(instances, engineReady, { company: Boolean(organisationSignIn(typeof window === "undefined" ? undefined : window.ogb, { hosted: false })) });
    return summary.ready.length > 0 || summary.company > 0 || instances.some(engineReady);
  }, [state.instances]);

  const close = useCallback(() => dispatch({ type: "closeBotWizard" }), [dispatch]);
  const fail = (cause: unknown) => setError(readableError(cause));
  useEffect(() => { cardRef.current?.focus({ preventScroll: true }); }, []);

  // A bot's own wizard (Redo, Resume): its open draft resumes in its mode;
  // otherwise the mode choice, prefilled from the bot.
  useEffect(() => {
    let cancelled = false;
    if (opened?.botId) {
      void readWizardDraft(opened.botId, language)
        .then(({ draft: found }) => {
          if (cancelled) return;
          if (found.status === "draft" && !opened.redo) { setDraft(found); setPhase("steps"); }
          else setPhase("choose");
        })
        .catch(() => { if (!cancelled) setPhase("choose"); });
    } else {
      void listWizardDrafts().then((found) => { if (!cancelled) setDrafts(found); }).catch(() => {});
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The draft's own patch: shown at once, then the server's answer. */
  const patch = useCallback(async (value: WizardPatch) => {
    const current = draftRef.current;
    if (!current) return;
    setDraft(applyWizardPatch(current, value, Date.now()) as WireWizardDraft);
    try {
      const saved = await patchWizardDraft(current.botId, value);
      setDraft((shown) => shown && shown.botId === saved.botId ? saved : shown);
    } catch (cause) {
      fail(cause);
    }
  }, []);

  /** The guided conversation: a new topic with the guide, opened by the
   * person's own request naming the bot. Once per draft. With no bot to
   * guide, the Bot designer is created first (the person's own bot). */
  const ensureGuided = useCallback(async (current: WireWizardDraft, target: Bot | null) => {
    if (current.guidedThreadId) return;
    let leader: Bot | null = guide;
    if (!leader) {
      if (!engineReadyNow) return;
      leader = await createDesignerBot(language);
      dispatch({ type: "botAdded", bot: leader, preserveSelection: true });
    }
    const name = target?.name ?? current.botName ?? "";
    const threadId = await openWizardThread(leader.id, t("botWizard.guided.threadTitle", { name }));
    await patch({ guidedBotId: leader.id, guidedThreadId: threadId });
    await sendWizardMessage(leader.id, threadId, guidedKickoff({ botName: name, language }));
  }, [guide, engineReadyNow, language, patch, dispatch]);

  const connectEngine = () => {
    close();
    openModelKeysSettings(dispatch);
  };

  // Other paths stay inside this view (one entry, no second modal).
  const startFromTemplate = () => { setError(null); setPhase("template"); };
  const browseTemplates = () => { for (const action of templatesEntryActions("botWizard")) dispatch(action); };
  const quickCreate = (choice: QuickCreateChoice) => {
    if (state.botCreationPending || busy) return;
    setBusy("quick");
    setError(null);
    dispatch({
      type: "newBot",
      settings: {
        ...memberNewBotSettings(state.config, {}),
        name: choice.name,
        color: choice.color,
        mascotLook: { character: "shape", shape: choice.shape, skins: { shape: "plain" } },
      },
      onCreated: () => close(),
      onError: (message) => { setError(message); setBusy(null); },
    });
  };

  const choose = async (mode: WizardMode, resume?: WireWizardDraft) => {
    if (busy) return;
    setBusy(mode);
    setError(null);
    try {
      let target = resume ? state.bots.find((candidate) => candidate.id === resume.botId) ?? null : bot;
      let origin: "new" | "redo" = resume?.origin ?? (opened?.botId ? "redo" : "new");
      if (!target) {
        const created = await createWizardBot(undefined, { noMcp: canEditBotField(state.config, {}, "mcpServers", { draft: true }) });
        // in the sidebar at once, without leaving what is open behind
        dispatch({ type: "botAdded", bot: created, preserveSelection: true });
        target = created;
        origin = "new";
      }
      const started = await startWizardDraft(target.id, { origin, mode, ...(opened?.redo ? { restart: true } : {}) });
      setBotId(target.id);
      setDraft(started);
      setPhase("steps");
      if (mode === "guided") await ensureGuided(started, target);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  };

  const switchMode = async (mode: WizardMode) => {
    if (!draft || draft.mode === mode) return;
    await patch({ mode });
    if (mode === "guided") await ensureGuided({ ...draft, mode }, bot).catch(fail);
  };

  // Guided: the Primary Bot fills the draft; read it back while it works,
  // and make the rules it marked "pending" with the person's own session.
  useEffect(() => {
    if (phase !== "steps" || draft?.mode !== "guided" || !botId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const { draft: fresh } = await readWizardDraft(botId, language);
        if (stopped) return;
        if (fresh.updatedAt !== draftRef.current?.updatedAt) setDraft(fresh);
        for (const id of pendingRules(fresh)) {
          const rules = await setSuggestedRule(fresh, id, true, language);
          if (Object.keys(rules).length) await patch({ rules });
        }
      } catch {
        // the next beat tries again
      }
    };
    const timer = setInterval(() => void tick(), GUIDED_POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [phase, draft?.mode, botId, language, patch]);

  const goTo = (step: WizardStep) => void patch({ step });
  const skip = () => { if (draft) void patch({ skip: draft.step }); };
  const next = () => {
    if (!draft) return;
    const after = nextStepFor(draft);
    if (after) goTo(after);
  };

  const finish = async () => {
    if (!draft || busy) return;
    setBusy("finish");
    setError(null);
    try {
      const { failed } = await finishWizard(draft, language);
      close();
      dispatch({ type: "select", id: draft.botId });
      if (failed.length) dispatch({ type: "error", message: t("botWizard.finish.routineFailed", { names: failed.join(", ") }) });
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  };

  const discard = async (target: WireWizardDraft) => {
    setError(null);
    try {
      await deleteWizardDraft(target.botId);
      // a bot the wizard made goes with its draft, the way Delete removes one
      if (target.origin === "new") dispatch({ type: "deleteBot", botId: target.botId });
      setDrafts((all) => all.filter((each) => each.botId !== target.botId));
    } catch (cause) {
      fail(cause);
    }
  };

  const leaveSubPage = () => {
    if (phase === "template" || phase === "import-zip" || phase === "import-agent") {
      setPhase("choose");
      return;
    }
    close();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    // Nested menus/dialogs own the key; this window's own role=dialog does not.
    if (target.closest("[role=menu], [role=listbox], [role=dialog]:not([data-bot-wizard]), [role=alertdialog]")) return;
    if (event.key === "Escape" && (phase === "template" || phase === "import-zip" || phase === "import-agent")) {
      if (target.closest("textarea, input")) return;
      event.preventDefault();
      setPhase("choose");
      return;
    }
    if (event.key === "Escape" || isBackShortcut(event)) {
      if (target.closest("textarea, input") && event.key === "Escape") return;
      event.preventDefault();
      leaveSubPage();
    }
  };

  const guided = phase === "steps" && draft?.mode === "guided";
  const step = draft?.step ?? "identity";
  const path = draft ? wizardPath(draft) : WIZARD_STEPS.filter((each) => each !== "tools");
  const index = Math.max(0, path.indexOf(step));
  const previous = draft ? previousStepFor(draft) : null;
  const suggestions = useMemo(() => wizardSuggestions(draft?.roleId ?? "", language), [draft?.roleId, language]);
  const stepProps: StepProps | null = bot && draft ? { bot, draft, suggestions, patch, language } : null;
  const title = phase === "steps" ? stepTitle(step)
    : phase === "template" ? t("botWizard.other.template")
      : phase === "import-zip" ? t("botWizard.other.importZip")
        : phase === "import-agent" ? t("botWizard.other.importAgent")
          : t("botWizard.title");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" data-bot-wizard-screen="">
      <div
        ref={cardRef}
        role="dialog"
        data-bot-wizard=""
        aria-modal="true"
        aria-label={t("botWizard.dialog")}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="welcome-card relative flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-hairline/40 bg-panel shadow-[0_30px_80px_-28px_rgba(0,0,0,0.45),0_8px_24px_-12px_rgba(0,0,0,0.25)] outline-none"
        style={{ maxWidth: guided ? 1180 : 760, height: phase === "steps" ? "min(860px, 100%)" : undefined }}
      >
      <header
        data-bot-wizard-header=""
        className="flex shrink-0 items-center gap-3 px-5 pb-3 pt-5 sm:px-8 sm:pt-7"
      >
        {(phase === "template" || phase === "import-zip" || phase === "import-agent") && (
          <QuietButton onClick={leaveSubPage} className="shrink-0" data-wizard-back-view="">{t("botWizard.back")}</QuietButton>
        )}
        <span className="flex shrink-0"><PulsatrixMark size={36} ground="app" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <BotIcon size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
            <h1 className="truncate text-[18px] font-semibold text-ink">{title}</h1>
          </div>
          {phase === "steps" && bot && <p className="truncate text-[12.5px] text-ink-secondary">{t("botWizard.subtitle", { name: bot.name })}</p>}
        </div>
        {phase === "steps" && draft && (
          <div role="radiogroup" aria-label={t("botWizard.mode")} className="hidden shrink-0 gap-0.5 rounded-lg bg-control p-0.5 sm:flex" data-wizard-mode-switch="">
            {(["guided", "manual"] as const).map((mode) => (
              <button key={mode} type="button" role="radio" aria-checked={draft.mode === mode} data-wizard-mode={mode}
                onClick={() => void switchMode(mode)}
                className={cn("flex min-h-[30px] items-center gap-1.5 rounded-md border px-2.5 text-[12px]",
                  draft.mode === mode ? "border-accent-border bg-selected font-medium text-ink shadow-sm" : "border-transparent text-ink-secondary hover:bg-raised-hover hover:text-ink")}>
                {mode === "guided" ? <MessagesSquare size={13} aria-hidden="true" /> : <ClipboardList size={13} aria-hidden="true" />}
                {t(`botWizard.mode.${mode}.short`)}
              </button>
            ))}
          </div>
        )}
        <QuietButton onClick={close} className="shrink-0" data-wizard-later="">{t("botWizard.later")}</QuietButton>
      </header>

      <div className={cn("flex min-h-0 flex-1 flex-col", guided ? "mx-auto w-full max-w-[1180px]" : "mx-auto w-full max-w-[760px]")}>
        {error && <p role="alert" className="mx-5 mb-2 mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[13px] text-danger sm:mx-8">{error}</p>}

        {readOnly && phase === "choose" && !opened?.botId && (
          <p role="note" data-bots-read-only className="mx-5 mt-6 rounded-xl border border-hairline/50 bg-raised/60 px-4 py-3 text-[13px] leading-relaxed text-ink-secondary sm:mx-8">
            {botsReadOnlyText(state.config)}
          </p>
        )}

        {phase === "loading" && (
          <div role="status" className="flex items-center justify-center gap-2 px-8 py-16 text-[13px] text-ink-secondary">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />{t("botWizard.loading")}
          </div>
        )}

        {phase === "choose" && !readOnly && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!opened?.botId && (
              <QuickCreate
                busy={busy === "quick" || Boolean(state.botCreationPending)}
                onCreate={quickCreate}
                footer={
                  <p className="mt-2 max-w-sm text-center text-[12.5px] text-ink-secondary">{t("botWizard.quick.hint")}</p>
                }
              />
            )}
            <ModeChoice busy={busy} redoName={opened?.botId ? bot?.name : undefined} guideName={guide?.name ?? null}
              engineReady={engineReadyNow} onConnectEngine={connectEngine}
              drafts={drafts} onChoose={(mode) => void choose(mode)}
              onResume={(entry) => void choose(entry.mode, entry)} onDiscard={(entry) => void discard(entry)}
              otherStarts={opened?.botId ? undefined : {
                onTemplate: startFromTemplate,
                onBrowse: browseTemplates,
                onImport: canImport ? (kind) => setPhase(kind === "zip" ? "import-zip" : "import-agent") : undefined,
              }} />
          </div>
        )}

        {phase === "template" && (
          <div className="min-h-0 flex-1 overflow-hidden" data-wizard-template="">
            <NewBotForm onClose={close} onCreated={() => close()} presentation="dialog" />
          </div>
        )}

        {phase === "import-zip" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-8" data-wizard-import="zip">
            <BotZipImportPanel onCancel={() => setPhase("choose")} onImported={() => close()} autoFocus />
          </div>
        )}

        {phase === "import-agent" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-8" data-wizard-import="agent">
            <AgentImportPanel onCancel={() => setPhase("choose")} onImported={() => close()} />
          </div>
        )}

        {phase === "steps" && draft && !bot && (
          <div role="status" className="flex items-center justify-center gap-2 px-8 py-16 text-[13px] text-ink-secondary">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />{t("botWizard.loading")}
          </div>
        )}

        {phase === "steps" && stepProps && draft && (
          <div className={cn("flex min-h-0 flex-1", guided ? "flex-col lg:flex-row" : "flex-col")}>
            {guided && (
              <section aria-label={t("botWizard.guided.conversation")} className="relative flex min-h-[320px] flex-1 flex-col overflow-hidden border-hairline/40 max-lg:border-b lg:max-w-[520px] lg:border-r" data-wizard-guided-chat="">
                {draft.guidedThreadId && draft.guidedBotId
                  ? <WizardConversation botId={draft.guidedBotId} threadId={draft.guidedThreadId} title={t("botWizard.guided.conversation")} />
                  : <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-[13px] text-ink-secondary">
                      {!guide && !engineReadyNow
                        ? <NeedsEngine onConnect={connectEngine} />
                        : <><Loader2 size={16} className="animate-spin" aria-hidden="true" />{guide ? t("botWizard.guided.opening", { name: guide.name }) : t("botWizard.guided.creatingDesigner")}</>}
                    </div>}
              </section>
            )}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-8" data-wizard-step={step}>
                <p className="mb-4 text-[13.5px] leading-relaxed text-ink-secondary">{stepIntro(step)}</p>
                {step === "recap"
                  ? <Recap {...stepProps} onEdit={goTo} />
                  : <StepBody key={step} {...stepProps} step={step} />}
              </div>
              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline/40 px-5 py-4 sm:px-8">
                {previous ? <QuietButton onClick={() => goTo(previous)} data-wizard-back="">{t("onboarding.back")}</QuietButton> : <span />}
                <div className="flex items-center gap-3">
                  <ProgressDots items={path.map((id) => ({ id, label: stepTitle(id) }))} index={index}
                    onSelect={(target) => goTo(path[target]!)} label={t("botWizard.steps")} />
                  <span className="text-[11px] text-ink-secondary" aria-live="polite">{t("onboarding.progress", { current: index + 1, total: path.length })}</span>
                </div>
                <div className="flex items-center gap-3">
                  {step !== "recap" && <QuietButton onClick={skip} data-wizard-skip="">{t("botWizard.skip")}</QuietButton>}
                  {step === "recap"
                    ? <PrimaryButton onClick={() => void finish()} disabled={busy === "finish"} className="w-auto px-5" data-wizard-finish="">
                        {busy === "finish" ? t("botWizard.finishing") : t("botWizard.finish")}
                      </PrimaryButton>
                    : <PrimaryButton onClick={next} className="w-auto px-5" data-wizard-next="">{t("onboarding.continue")}</PrimaryButton>}
                </div>
              </footer>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

/** Guided with no engine to run the guide: what to do, not a grey card. */
function NeedsEngine({ onConnect, compact }: { onConnect: () => void; compact?: boolean }) {
  return (
    <span className={cn("flex flex-col gap-2", compact ? "items-start" : "items-center")} data-wizard-needs-engine="">
      <span className="text-[13px] leading-relaxed text-ink-secondary">{t("botWizard.guided.needsEngine")}</span>
      <button type="button" onClick={onConnect} data-wizard-connect-engine=""
        className="ui-button inline-flex min-h-[36px] items-center gap-1.5 md:min-h-0">
        <PlugZap size={14} aria-hidden="true" />{t("botWizard.guided.connectEngine")}
      </button>
    </span>
  );
}

export interface OtherStarts {
  /** The full form: Start from (presets, built-in roles), More options. */
  onTemplate: () => void;
  /** Browse Bots on Templates. */
  onBrowse: () => void;
  /** Import a zip, or an agent from Grok Bot or Claude Code (#1178); absent where import is not offered. */
  onImport?: (kind: "zip" | "agent") => void;
}

export function ModeChoice({ busy, redoName, guideName, engineReady = true, onConnectEngine, drafts, onChoose, onResume, onDiscard, otherStarts }: {
  busy: string | null;
  redoName?: string;
  guideName: string | null;
  /** An engine can run the guide (with no bot to guide, the Bot designer is created). */
  engineReady?: boolean;
  onConnectEngine?: () => void;
  drafts: WireWizardDraft[];
  onChoose: (mode: WizardMode) => void;
  onResume: (draft: WireWizardDraft) => void;
  onDiscard: (draft: WireWizardDraft) => void;
  /** New bot's other ways to start (absent on a bot's own Redo). */
  otherStarts?: OtherStarts;
}) {
  const needsEngine = !guideName && !engineReady;
  const card = "group flex min-h-[180px] flex-1 flex-col items-start gap-3 rounded-2xl border border-hairline/50 bg-elevated p-5 text-left transition-[border-color,transform] duration-150 hover:border-accent-border active:scale-[0.99] disabled:opacity-50 motion-reduce:transition-none";
  return (
    <div className="flex flex-col gap-6 overflow-y-auto px-5 pb-7 sm:px-8" data-wizard-mode-choice="">
      <p className="text-[13.5px] leading-relaxed text-ink-secondary">
        {redoName ? t("botWizard.choose.redo", { name: redoName }) : t("botWizard.choose.intro")}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {needsEngine
          // no engine to run the guide: the card says what to do and does it
          ? <div className={cn(card, "hover:border-hairline/50 active:scale-100")} data-wizard-choose="guided" data-wizard-guided-state="needs-engine">
              <span className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent"><MessagesSquare size={22} aria-hidden="true" /></span>
              <span className="text-[16px] font-semibold text-ink">{t("botWizard.mode.guided")}</span>
              {onConnectEngine && <NeedsEngine onConnect={onConnectEngine} compact />}
            </div>
          : <button type="button" className={card} disabled={busy !== null} onClick={() => onChoose("guided")} data-wizard-choose="guided"
              data-wizard-guided-state={guideName ? "guide" : "designer"}>
              <span className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent"><MessagesSquare size={22} aria-hidden="true" /></span>
              <span className="text-[16px] font-semibold text-ink">{t("botWizard.mode.guided")}</span>
              <span className="text-[13px] leading-relaxed text-ink-secondary">
                {guideName ? t("botWizard.mode.guided.body", { name: guideName }) : t("botWizard.mode.guided.bodyDesigner")}
              </span>
              {busy === "guided" && <Loader2 size={16} className="animate-spin text-ink-secondary" aria-hidden="true" />}
            </button>}
        <button type="button" className={card} disabled={busy !== null} onClick={() => onChoose("manual")} data-wizard-choose="manual">
          <span className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent"><ClipboardList size={22} aria-hidden="true" /></span>
          <span className="text-[16px] font-semibold text-ink">{t("botWizard.mode.manual")}</span>
          <span className="text-[13px] leading-relaxed text-ink-secondary">{t("botWizard.mode.manual.body")}</span>
          {busy === "manual" && <Loader2 size={16} className="animate-spin text-ink-secondary" aria-hidden="true" />}
        </button>
      </div>
      <p className="text-[12px] text-ink-secondary">{t("botWizard.choose.switchAnytime")}</p>
      {otherStarts && <OtherStartsRow {...otherStarts} busy={busy !== null} />}
      {drafts.length > 0 && (
        <section aria-label={t("botWizard.drafts")} className="flex flex-col gap-2" data-wizard-drafts="">
          <h2 className="px-1 text-[13px] font-medium text-ink">{t("botWizard.drafts")}</h2>
          <div className="flex flex-col divide-y divide-hairline/40 rounded-xl border-[0.5px] border-border bg-elevated">
            {drafts.map((entry) => (
              <div key={entry.botId} className="flex min-h-[48px] items-center gap-3 px-3.5 py-2" data-wizard-draft-row={entry.botId}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{entry.botName || t("botWizard.unnamed")}</span>
                  <span className="block truncate text-[12px] text-ink-secondary">{t("botWizard.draftAt", { step: stepTitle(entry.step) })}</span>
                </span>
                <button type="button" onClick={() => onResume(entry)} className="ui-button min-h-[36px] md:min-h-0">{t("botWizard.resume")}</button>
                <button type="button" onClick={() => onDiscard(entry)} aria-label={t("botWizard.discard", { name: entry.botName || t("botWizard.unnamed") })} title={t("botWizard.discard", { name: entry.botName || t("botWizard.unnamed") })} className="ui-button min-h-[36px] md:min-h-0"><Trash2 size={14} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Paths beside quick create and the guided/manual cards: nothing offered before is lost. */
function OtherStartsRow({ onTemplate, onBrowse, onImport, busy }: OtherStarts & { busy: boolean }) {
  const option = "ui-button inline-flex min-h-[36px] items-center gap-1.5 md:min-h-0 disabled:opacity-50";
  return (
    <section aria-labelledby="wizard-other-starts" className="flex flex-col gap-2 border-t border-hairline/40 pt-4" data-wizard-other-starts="">
      <h2 id="wizard-other-starts" className="px-1 text-[13px] font-medium text-ink">{t("botWizard.other.title")}</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={option} disabled={busy} onClick={onTemplate} data-wizard-other="template" title={t("botWizard.other.templateHint")}>
          <LayoutTemplate size={14} aria-hidden="true" />{t("botWizard.other.template")}
        </button>
        <button type="button" className={option} disabled={busy} onClick={onBrowse} data-wizard-other="browse">
          <Library size={14} aria-hidden="true" />{t("botWizard.other.browse")}
        </button>
        {onImport && <>
          <button type="button" className={option} disabled={busy} onClick={() => onImport("agent")} data-wizard-other="import-agent">
            <Download size={14} aria-hidden="true" />{t("botWizard.other.importAgent")}
          </button>
          <button type="button" className={option} disabled={busy} onClick={() => onImport("zip")} data-wizard-other="import-zip">
            <Download size={14} aria-hidden="true" />{t("botWizard.other.importZip")}
          </button>
        </>}
      </div>
    </section>
  );
}

/** The last step (2026-10-27): a compact read-only summary. The bot in one
 * card (avatar, name, role, description) with Try it, then one line per
 * step with Edit, which opens that step. Finish stays in the footer. */
function Recap(props: StepProps & { onEdit: (step: WizardStep) => void }) {
  const { bot, draft, suggestions, patch, language, onEdit } = props;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effects] = useRuleEffects(draft, suggestions);
  const tryIt = async () => {
    setSending(true);
    setError(null);
    try {
      let threadId = draft.testThreadId;
      if (!threadId) {
        threadId = await openWizardThread(bot.id, t("botWizard.recap.testTitle"));
        await patch({ testThreadId: threadId });
      }
      await sendWizardMessage(bot.id, threadId, tryItMessage(language));
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSending(false);
    }
  };
  const role = BOT_ROLES.find((each) => each.id === draft.roleId);
  const roleName = role ? t(`botWizard.role.${role.id}` as LocaleKey) : t("botWizard.role.custom");
  const lines = recapLines({ bot, draft, effects, suggestions, roleName });
  return (
    <div className="flex flex-col gap-5" data-wizard-recap="">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border-[0.5px] border-border bg-elevated px-4 py-4" data-wizard-recap-card="">
        <BotAvatar bot={bot} state="happy" size={56} animated={false} />
        <span className="flex min-w-0 flex-1 basis-[200px] flex-col gap-0.5">
          <span className="truncate text-[15px] font-semibold text-ink">{bot.name}</span>
          <span className="truncate text-[12.5px] text-accent-text" data-wizard-recap-role="">{roleName}</span>
          <span className="line-clamp-2 text-[12.5px] leading-relaxed text-ink-secondary">{bot.description || bot.title || t("botWizard.recap.noDescription")}</span>
        </span>
        <PrimaryButton onClick={() => void tryIt()} disabled={sending} className="w-auto px-5" data-wizard-try="">
          <span className="inline-flex items-center gap-1.5">{sending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}{t("botWizard.recap.try")}</span>
        </PrimaryButton>
      </div>
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      <dl className="flex flex-col divide-y divide-hairline/40 rounded-xl border-[0.5px] border-border bg-elevated">
        {lines.map((line) => (
          <div key={line.step} className="flex min-h-[48px] items-center gap-4 px-3.5 py-2.5" data-wizard-recap-section={line.step}>
            <dt className="w-[110px] shrink-0 text-[13px] font-medium text-ink sm:w-[140px]">{stepTitle(line.step)}</dt>
            <dd className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-secondary" data-wizard-recap-summary="">
              {line.text}
              {draft.skipped.includes(line.step) && <span className="ml-2 text-[12px] text-ink-tertiary">{t("botWizard.recap.skipped")}</span>}
            </dd>
            <button type="button" onClick={() => onEdit(line.step)} data-wizard-recap-edit={line.step}
              aria-label={t("botWizard.recap.editStep", { step: stepTitle(line.step) })}
              className="shrink-0 rounded-md px-2 py-1 text-[12.5px] font-medium text-accent-text hover:bg-accent/10">{t("botWizard.recap.edit")}</button>
          </div>
        ))}
      </dl>
      {draft.testThreadId && (
        <div className="relative flex h-[320px] flex-col overflow-hidden rounded-xl border-[0.5px] border-border" data-wizard-test-chat="">
          <WizardConversation botId={bot.id} threadId={draft.testThreadId} title={t("botWizard.recap.testTitle")} />
        </div>
      )}
    </div>
  );
}

const countText = (count: number, one: LocaleKey, many: LocaleKey) => t(count === 1 ? one : many, { count });

/** One line of words per step, read only. Exported for tests. */
export function recapLines({ bot, draft, effects, suggestions, roleName }: {
  bot: Bot; draft: WireWizardDraft; effects: Record<string, "allow" | "ask" | "deny">; suggestions: StepProps["suggestions"]; roleName: string;
}): Array<{ step: Exclude<WizardStep, "recap">; text: string }> {
  const answered = Object.values(draft.answers).filter((value) => value.trim()).length;
  const soul = bot.soul?.trim()
    ? t("botWizard.recap.soulWritten", { answered, total: Object.keys(draft.answers).length })
    : t("botWizard.recap.soulEmpty");
  const counts = { allow: 0, ask: 0, deny: 0 };
  for (const effect of Object.values(effects)) counts[effect] += 1;
  const ruleParts = [
    counts.ask ? countText(counts.ask, "botWizard.recap.rules.ask.one", "botWizard.recap.rules.ask.many") : "",
    counts.deny ? countText(counts.deny, "botWizard.recap.rules.deny.one", "botWizard.recap.rules.deny.many") : "",
    counts.allow ? countText(counts.allow, "botWizard.recap.rules.allow.one", "botWizard.recap.rules.allow.many") : "",
  ].filter(Boolean);
  const level = bot.approvalMode ? t(`approvalMode.${bot.approvalMode}.label` as LocaleKey) : "";
  const rules = [level, ruleParts.length ? ruleParts.join(", ") : t("botWizard.recap.rules.none")].filter(Boolean).join(" · ");
  const mcp = bot.mcpServers == null ? t("botWizard.recap.tools.mcpAll") : bot.mcpServers.length ? t("botWizard.recap.tools.mcpSome", { names: bot.mcpServers.join(", ") }) : t("botWizard.recap.tools.mcpNone");
  const tools = [
    t("botWizard.recap.tools.workspace", { place: t(placeLabelKey(worksOnMode(bot.computer) ?? "auto")) }),
    mcp,
    suggestions.apps.length ? t("botWizard.recap.tools.appsFor", { apps: suggestions.apps.join(", ") }) : t("botWizard.recap.tools.appsLater"),
  ].join(" · ");
  const picked = suggestions.routines.filter((routine) => draft.routines.includes(routine.id)).map((routine) => routine.name);
  const routines = picked.length ? picked.join(", ") : t("botWizard.recap.routines.none");
  const identity = [roleName, bot.chiefOfStaff ? t("botWizard.identity.primary") : ""].filter(Boolean).join(" · ");
  return [
    { step: "identity", text: identity },
    { step: "soul", text: soul },
    { step: "rules", text: rules },
    { step: "tools", text: tools },
    { step: "routines", text: routines },
  ];
}
