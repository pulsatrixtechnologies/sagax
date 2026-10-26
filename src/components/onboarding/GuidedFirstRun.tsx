// The guided first run: a dedicated, dismissible screen that walks the three
// real steps between a brand-new person and a working first message. It is a
// guide OVER the existing surfaces, never a second place to configure things:
//
//   1. connect an engine  — reuses the welcome engines card (EnginesBeat),
//      which is the existing engine/connect flow; shown done and skipped when
//      an engine is already connected;
//   2. create your first bot — one click that reuses the server's Auto
//      defaults (createAutoFirstBot, the same `GET /api/bot-defaults` the New
//      bot dialog opens on), engine Auto, model Auto, approval left on
//      "Approve for me"; the full New bot dialog stays one click away for the
//      rare advanced case;
//   3. send your first message — closes the guide onto the new bot's chat with
//      the caret already in the composer.
//
// Nothing is forced: a Skip button and Escape dismiss it, and finishing or
// dismissing is written to the workspace config (completionPatch) so it never
// reappears on the next launch. It is rendered by WelcomeGate at the app root,
// a sibling of the shell, so no widget is ever injected into the conversation
// (#876). No marketing, no fake progress: a step that cannot run shows the one
// real next action instead.
import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check } from "lucide-react";
import { PulsatrixMark } from "@/components/PulsatrixMark";
import { engineReady } from "@/components/EngineLibrary";
import { MausAvatar } from "@/components/Avatar";
import { setEmailGateDone, track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { focusComposer } from "@/lib/composer-focus";
import { createAutoFirstBot } from "@/lib/first-bot";
import { FIRST_RUN_STEPS, firstRunInitialStep, firstRunStepIndex, type FirstRunStep } from "@/lib/first-run";
import { t } from "@/lib/i18n";
import { completionPatch, engineSummary, organisationSignIn } from "@/lib/onboarding";
import { api, useStore } from "@/state/store";
import { EnginesBeat } from "./beats/EnginesBeat";
import { PrimaryButton, QuietButton } from "./beats/shared";
import { ProgressDots } from "./ProgressDots";

function stepTitle(step: FirstRunStep): string {
  switch (step) {
    case "engine":
      return t("onboarding.engines.title");
    case "bot":
      return t("onboarding.firstRun.bot.title");
    case "message":
      return t("onboarding.firstRun.message.title");
  }
}

export function GuidedFirstRun({
  replay = false,
  initialStep,
  onDone,
  onOpenServer,
}: {
  /** A replay from Settings: nothing is forced and the record is already
   * written, but finishing still closes it cleanly. */
  replay?: boolean;
  /** Resume on a given step (the engines step, after the launch screen's
   * server mode closed). */
  initialStep?: FirstRunStep;
  onDone: () => void;
  /** The engines step's server row opens the launch screen's server mode. */
  onOpenServer?: () => void;
}) {
  const { state, dispatch } = useStore();
  const organisation = organisationSignIn(window.ogb, { hosted: false });
  const summary = engineSummary(state.instances ?? [], engineReady, { company: Boolean(organisation) });
  const engineReadyNow = summary.ready.length > 0 || summary.company > 0;
  const firstBot = state.bots.find((b) => !b.hidden) ?? null;
  const facts = { engineReady: engineReadyNow, botExists: firstBot !== null };

  const [step, setStep] = useState<FirstRunStep>(() => initialStep ?? firstRunInitialStep(facts));
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const [createdBotId, setCreatedBotId] = useState<string | null>(null);
  const finishing = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // The bot the message step opens: the one just created, or the one already
  // there (a fresh install's starter bot, or one kept from before).
  const messageBot = (createdBotId && state.bots.find((b) => b.id === createdBotId)) || firstBot;

  const finish = useCallback(
    async (reason: "completed" | "skipped") => {
      if (finishing.current) return;
      finishing.current = true;
      track("first_run_completed", { reason, at: step, replay });
      // release the old browser-side gate, as the welcome flow does
      setEmailGateDone("submitted");
      // never trap the person behind the card: close first, persist after
      onDone();
      if (reason === "completed" && typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => focusComposer());
      }
      try {
        const config = await api("/api/config", { method: "PUT", body: JSON.stringify(completionPatch()), signal: AbortSignal.timeout(10_000) });
        dispatch({ type: "configStatus", config });
      } catch {
        // offline or no admin scope: the card still closed; it returns next
        // launch, which is the honest state
      }
    },
    [step, replay, onDone, dispatch],
  );

  const goTo = useCallback((target: FirstRunStep) => setStep(target), []);

  const createFirstBot = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setCreateFailed(false);
    try {
      const bot = await createAutoFirstBot();
      setCreatedBotId(bot.id);
      // the same dispatch the New bot dialog uses: it selects the bot and
      // opens its chat, so the message step lands in the right place
      dispatch({ type: "botAdded", bot });
      goTo("message");
    } catch {
      setCreateFailed(true);
    } finally {
      setCreating(false);
    }
  }, [creating, dispatch, goTo]);

  const startWriting = useCallback(() => {
    if (messageBot && state.selectedId !== messageBot.id) dispatch({ type: "select", id: messageBot.id });
    void finish("completed");
  }, [messageBot, state.selectedId, dispatch, finish]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void finish("skipped");
      return;
    }
    if (event.key !== "Tab" || !cardRef.current) return;
    const focusable = Array.from(
      cardRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const index = firstRunStepIndex(step);
  const previous = index > 0 ? FIRST_RUN_STEPS[index - 1]! : null;
  const width = step === "engine" ? 680 : 480;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app p-3 sm:p-8">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("onboarding.firstRun.dialog")}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="welcome-card relative flex max-h-full w-full flex-col overflow-y-auto rounded-2xl border border-hairline/40 bg-panel p-5 sm:p-8 shadow-[0_30px_80px_-28px_rgba(0,0,0,0.45),0_8px_24px_-12px_rgba(0,0,0,0.25)] outline-none"
        style={{ maxWidth: width }}
      >
        <QuietButton onClick={() => void finish("skipped")} className="absolute right-4 top-4">
          {t("onboarding.skipTour")}
        </QuietButton>

        <div className="flex shrink-0 items-center gap-3">
          <span className="flex shrink-0">
            <PulsatrixMark size={40} ground="app" />
          </span>
          <h1 className="font-semibold text-ink text-[18px]">{stepTitle(step)}</h1>
        </div>

        <div key={step} className={cn("flex flex-col", step === "engine" ? "min-h-0" : "shrink-0")}>
          {step === "engine" && (
            <EnginesBeat
              onNext={() => goTo("bot")}
              onSkip={() => goTo("bot")}
              setMascot={() => {}}
              bump={() => {}}
              onOpenServer={onOpenServer}
            />
          )}

          {step === "bot" && (
            <div className="flex flex-col">
              {!engineReadyNow ? (
                // the one real next action when no engine can run a turn yet
                <>
                  <p className="mt-1 text-[13.5px] text-ink-secondary">{t("onboarding.firstRun.bot.needEngine")}</p>
                  <PrimaryButton onClick={() => goTo("engine")} className="mt-5">
                    {t("onboarding.firstRun.connectEngine")}
                  </PrimaryButton>
                </>
              ) : firstBot ? (
                // a bot already exists (a fresh install seeds a starter bot):
                // never create a second one, just move on to the message
                <>
                  <p className="mt-1 flex items-center gap-2 text-[13.5px] text-success">
                    <Check size={15} strokeWidth={2.5} aria-hidden="true" />
                    {t("onboarding.firstRun.bot.haveOne", { name: firstBot.name })}
                  </p>
                  <PrimaryButton onClick={() => goTo("message")} className="mt-5">
                    {t("onboarding.continue")}
                  </PrimaryButton>
                </>
              ) : (
                <>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-secondary">{t("onboarding.firstRun.bot.intro")}</p>
                  {createFailed && (
                    <div role="alert" className="mt-4 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[13px] text-danger">
                      {t("onboarding.firstRun.bot.error")}
                    </div>
                  )}
                  <PrimaryButton onClick={() => void createFirstBot()} disabled={creating} className="mt-5">
                    {creating ? t("onboarding.firstRun.bot.creating") : t("onboarding.firstRun.bot.create")}
                  </PrimaryButton>
                  <QuietButton onClick={() => dispatch({ type: "toggleNewBot", open: true })} className="mt-3 self-center">
                    {t("onboarding.firstRun.bot.advanced")}
                  </QuietButton>
                </>
              )}
            </div>
          )}

          {step === "message" && (
            <div className="flex flex-col">
              <div className="mt-2 flex items-center gap-4">
                <MausAvatar color={messageBot?.color ?? "green"} state="happy" size={56} label={messageBot?.name} />
                <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-ink-secondary">
                  {messageBot
                    ? t("onboarding.firstRun.message.intro", { name: messageBot.name })
                    : t("onboarding.firstRun.message.introGeneric")}
                </p>
              </div>
              <PrimaryButton onClick={startWriting} className="mt-5">
                {t("onboarding.firstRun.message.start")}
              </PrimaryButton>
            </div>
          )}
        </div>

        <div className="mt-6 flex shrink-0 items-center justify-between">
          {previous ? (
            <QuietButton onClick={() => goTo(previous)}>{t("onboarding.back")}</QuietButton>
          ) : (
            <span />
          )}
          <ProgressDots
            items={FIRST_RUN_STEPS.map((id) => ({ id }))}
            index={index}
          />
          <span className="text-[11px] text-ink-secondary" aria-live="polite">
            {t("onboarding.progress", { current: index + 1, total: FIRST_RUN_STEPS.length })}
          </span>
        </div>
      </div>
    </div>
  );
}
