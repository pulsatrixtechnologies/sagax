// Triggers: webhooks as a sentence. "When <something happens>, <this bot>
// should <do this>." The builder on top is the same create call the
// Automations page's Webhooks tab makes (POST /api/webhooks). A link-request
// preset only fills in the name; a typed source (GitHub, Slack, Teams,
// Outlook, Sentry, PagerDuty, Linear...) adds its events, filters and signing
// secret, and is verified by the provider's own signature (TypedTriggers.tsx).
// Everything the full editor offers (event types, where it runs, how many
// at once, rotating the private URL, the delivery log) stays one
// "Advanced options" away on each trigger.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, Laptop, Cloud, Link2, Loader2, Pencil, RotateCw, Trash2, Webhook, Zap } from "lucide-react";

import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { WEBHOOK_DEFAULT_MAX_PENDING_RUNS, webhookActivationDefaults, type WebhookTrigger, type WebhookTriggerInput } from "@/lib/webhooks";
import { api, openBotThread, useStore, type Bot } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { TRIGGER_SOURCE_TYPES, isRelaySource, isTriggerSourceType, type TriggerSourceSetup } from "../../shared/trigger-sources";

import { DANGER_PILL, DIALOG, DialogCloseButton, GROUP_CARD, PILL, PillSelect, PRIMARY_PILL, Switch } from "./SettingsPrimitives";
import { MarkdownEditor } from "./markdown/MarkdownEditor";
import { EMPTY_TYPED_DRAFT, TypedSourceFields, TypedTriggerRow, typedSourceLabel, typedTriggerInput, type TypedDraft } from "./TypedTriggers";
import {
  WebhookEditor,
  outcomeLabel,
  outcomeTone,
  relativeTime,
  statusFor,
  suggestedName,
  terminalCommand,
  useWebhookActions,
  webhookActivity,
} from "./WebhooksPanel";

/** Link-request presets: picking one only names the trigger, every one is
 * the same private URL with a bearer token underneath. Typed sources (with
 * their own signature) are TRIGGER_SOURCE_TYPES. Brand names stay as written. */
export const TRIGGER_SOURCES: Array<{ id: string; labelKey?: LocaleKey; label?: string }> = [
  { id: "link", labelKey: "triggers.source.linkRequest" },
  { id: "typeform", label: "Typeform" },
  { id: "zapier", label: "Zapier" },
  { id: "stripe", label: "Stripe" },
  { id: "custom", labelKey: "triggers.source.custom" },
];

export function triggerSourceLabel(id: string): string {
  if (isTriggerSourceType(id)) return typedSourceLabel(id);
  const source = TRIGGER_SOURCES.find((entry) => entry.id === id);
  if (!source) return "";
  return source.labelKey ? t(source.labelKey) : source.label ?? "";
}

/** The request the builder sends: exactly what the full editor sends for a
 * new webhook with its advanced options left alone. */
export function triggerInput(
  draft: { source: string; customName: string; botId: string; prompt: string },
  bots: Bot[],
  typed: TypedDraft = EMPTY_TYPED_DRAFT,
): WebhookTriggerInput {
  const prompt = draft.prompt.trim();
  const named = draft.source === "custom" ? draft.customName.trim() : triggerSourceLabel(draft.source);
  const base: WebhookTriggerInput = {
    name: named || suggestedName(prompt, bots.find((bot) => bot.id === draft.botId)),
    prompt,
    botId: draft.botId,
    runOn: "maus",
    ...webhookActivationDefaults(),
    eventTypes: [],
    maxPendingRuns: null,
  };
  return isTriggerSourceType(draft.source) ? typedTriggerInput(draft.source, typed, base) : base;
}


export function TriggersPanel() {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const bots = state.bots.filter((bot) => !bot.hidden);
  const dialogRef = useRef<HTMLDivElement>(null);
  const actions = useWebhookActions();
  const { credentials, working, copiedId, copiedKind, error, setError, invoke, createAndCopyCommand, rememberCredential } = actions;
  const [source, setSource] = useState("link");
  const [customName, setCustomName] = useState("");
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WebhookTrigger | null>(null);
  const [typedDraft, setTypedDraft] = useState<TypedDraft>(EMPTY_TYPED_DRAFT);
  // Setup of a typed trigger (URL and, once, a generated secret): memory only.
  const [setups, setSetups] = useState<Record<string, TriggerSourceSetup>>({});
  const editingRef = useRef(false);
  editingRef.current = editing !== null;
  const close = () => dispatch({ type: "toggleTriggers", open: false });
  const ingress = state.webhookIngress;
  const chosenBot = bots.some((bot) => bot.id === botId) ? botId : bots[0]?.id ?? "";

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    (dialog?.querySelector<HTMLElement>("[data-pill-select]") ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // The full editor, when open, owns Escape and its own focus trap.
      if (event.defaultPrevented || editingRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleTriggers", open: false });
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      returnFocus?.focus();
    };
  }, [dispatch]);

  const create = async () => {
    if (!chosenBot || creating) return;
    setCreating(true);
    setError("");
    try {
      const response = await api("/api/webhooks", {
        method: "POST",
        body: JSON.stringify(triggerInput({ source, customName, botId: chosenBot, prompt }, bots, typedDraft)),
      });
      dispatch({ type: "webhookPatched", webhook: response.webhook });
      if (response.credential) rememberCredential(response.webhook.id, response.credential);
      if (response.sourceSetup) setSetups((current) => ({ ...current, [response.webhook.id]: response.sourceSetup }));
      setPrompt("");
      setCustomName("");
      setTypedDraft(EMPTY_TYPED_DRAFT);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  return (
    // 2026-10-16 (JC): drawn like Settings: its frame, the title at the top
    // left, the round close button, grey headings over rounded cards, pill
    // menus and pill buttons.
    <div
      className={DIALOG.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="triggers-title"
        tabIndex={-1}
        className={cn(DIALOG.frame, DIALOG.width.xl, "h-[min(700px,calc(100dvh-96px))]")}
      >
        <DialogCloseButton label={t("triggers.close")} onClick={close} />
        <header className={DIALOG.headerWide}>
          <h2 id="triggers-title" className={DIALOG.title}>{t("triggers.title")}</h2>
          <p className={DIALOG.subtitle}>{t("triggers.subtitle")}</p>
        </header>

        <div className={DIALOG.bodyWide}>
          {/* the builder: one sentence */}
          <form
            data-trigger-builder
            className={cn(GROUP_CARD, "px-3.5 py-3")}
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink">
              <Zap size={15} className="shrink-0 text-accent-text" aria-hidden="true" />
              <span>{t("triggers.when")}</span>
              <PillSelect
                ariaLabel={t("triggers.sourceAria")}
                value={source}
                onChange={(next) => {
                  setSource(next);
                  setTypedDraft(EMPTY_TYPED_DRAFT);
                }}
                options={[
                  ...TRIGGER_SOURCES.map((entry) => ({ value: entry.id, label: triggerSourceLabel(entry.id), group: t("triggers.group.link") })),
                  ...TRIGGER_SOURCE_TYPES.map((type) => ({ value: type as string, label: typedSourceLabel(type), group: isRelaySource(type) ? t("triggers.group.botmail") : t("triggers.group.signed") })),
                ]}
              />
              {source === "custom" && (
                <input
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  aria-label={t("triggers.source.customAria")}
                  placeholder={t("triggers.source.customPlaceholder")}
                  maxLength={80}
                  className="h-7 min-w-[200px] flex-1 rounded-lg border-[0.5px] border-border bg-inset px-2.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-focus focus:outline-none"
                />
              )}
              <ArrowRight size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
              <PillSelect
                ariaLabel={t("triggers.botAria")}
                value={chosenBot}
                disabled={bots.length === 0}
                onChange={setBotId}
                options={bots.map((bot) => ({ value: bot.id, label: bot.name }))}
              />
              <span>{t("triggers.should")}</span>
            </div>
            {isTriggerSourceType(source) && <TypedSourceFields type={source} draft={typedDraft} onChange={setTypedDraft} creating botId={chosenBot} />}
            <MarkdownEditor
              value={prompt}
              onChange={setPrompt}
              minHeight={90}
              showCount={false}
              dataField="trigger-instructions"
              ariaLabel={t("triggers.instructionsAria")}
              placeholder={t("triggers.instructionsPlaceholder")}
              className="mt-3"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              {bots.length === 0 ? <p className="text-[12px] text-warning">{t("triggers.noBots")}</p> : <span />}
              <button
                type="submit"
                disabled={creating || !chosenBot}
                className={cn(PRIMARY_PILL, "gap-2")}
              >
                {creating && <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
                {t("triggers.create")}
              </button>
            </div>
          </form>

          {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>}
          {ingress && !ingress.available && (
            <div role="status" className="flex items-center gap-2 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">
              <span className="size-1.5 shrink-0 rounded-full bg-danger" />{t("triggers.receiverUnavailable")}{ingress.error ? ` ${ingress.error}` : ""}
            </div>
          )}

          <section aria-labelledby="triggers-yours" className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 px-1">
              <h3 id="triggers-yours" className="text-[13px] leading-[18px] text-ink-secondary">{t("triggers.yours")}</h3>
              <span className="text-[12px] tabular-nums text-ink-tertiary">{state.webhooks.length}</span>
            </div>
            {state.webhooks.length === 0 ? (
              <div className={cn(GROUP_CARD, "px-3.5 py-6 text-center text-[13px] text-ink-secondary")}>{t("triggers.empty")}</div>
            ) : (
              <ul className={cn(GROUP_CARD, "divide-y divide-hairline/40 py-0")}>
                {state.webhooks.map((webhook) => webhook.source ? (
                  <TypedTriggerRow
                    key={webhook.id}
                    webhook={webhook}
                    bot={state.bots.find((candidate) => candidate.id === webhook.botId)}
                    setup={setups[webhook.id]}
                    baseUrl={ingress?.baseUrl}
                    busy={working !== null}
                    onToggle={() => void invoke(webhook, "toggle")}
                    onDelete={() => void invoke(webhook, "delete")}
                    onEdit={() => setEditing(webhook)}
                    onSetup={(setup) => setSetups((current) => ({ ...current, [webhook.id]: setup }))}
                    onOpenChat={(threadId) => {
                      close();
                      const bot = state.bots.find((candidate) => candidate.id === webhook.botId);
                      if (bot) openBotThread(dispatch, bot, threadId, showThreads);
                    }}
                  />
                ) : (
                  <TriggerRow
                    key={webhook.id}
                    webhook={webhook}
                    bot={state.bots.find((candidate) => candidate.id === webhook.botId)}
                    hasCredential={Boolean(credentials[webhook.id])}
                    command={credentials[webhook.id] ? terminalCommand(credentials[webhook.id]!) : ""}
                    working={working}
                    copied={copiedId === webhook.id ? copiedKind : null}
                    ingressAvailable={ingress?.available !== false}
                    onToggle={() => void invoke(webhook, "toggle")}
                    onDelete={() => void invoke(webhook, "delete")}
                    onCopy={(copy, replace) => void createAndCopyCommand(webhook, replace, copy)}
                    onEdit={() => setEditing(webhook)}
                    onOpenChat={(threadId) => {
                      close();
                      // offered only while the webhook's bot is here
                      const bot = state.bots.find((candidate) => candidate.id === webhook.botId);
                      if (bot) openBotThread(dispatch, bot, threadId, showThreads);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      {editing && (
        <WebhookEditor
          webhook={editing}
          bots={bots}
          onClose={() => setEditing(null)}
          onCredential={(credential, webhookId) => rememberCredential(webhookId, credential)}
        />
      )}
    </div>
  );
}

function TriggerRow({
  webhook,
  bot,
  hasCredential,
  command,
  working,
  copied,
  ingressAvailable,
  onToggle,
  onDelete,
  onCopy,
  onEdit,
  onOpenChat,
}: {
  webhook: WebhookTrigger;
  bot: Bot | undefined;
  hasCredential: boolean;
  command: string;
  working: string | null;
  copied: "command" | "token" | null;
  ingressAvailable: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onCopy: (copy: "command" | "token", replace: boolean) => void;
  onEdit: () => void;
  onOpenChat: (threadId: string) => void;
}) {
  const { state } = useStore();
  const status = statusFor(webhook);
  const activity = useMemo(
    () => webhookActivity(webhook, state.webhookAttempts, state.routineRuns),
    [webhook, state.webhookAttempts, state.routineRuns],
  );
  const busy = working !== null;
  // Turning on before the first test request is refused by the server too.
  const waitingForTest = Boolean(webhook.verificationPending && !webhook.enabled);
  const botName = bot?.name ?? t("triggers.deletedBot");
  return (
    <li data-trigger-row={webhook.id}>
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
        {bot ? (
          <BotAvatar bot={bot} state={webhook.enabled ? "idle" : "sleeping"} size={34} animated={false} label={bot.name} />
        ) : (
          <div className="flex size-[34px] shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Webhook size={16} /></div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-ink">
            <span className="truncate">{webhook.name}</span>
            <ArrowRight size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
            <span className="truncate">{botName}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
            <span className={cn("size-1.5 rounded-full", status.dot)} />
            <span className={status.tone}>{status.label}</span>
            <span aria-hidden="true">·</span>
            <span>
              {webhook.lastReceivedAt
                ? t("triggers.received", { count: webhook.deliveryCount, when: relativeTime(webhook.lastReceivedAt) })
                : t("triggers.neverReceived")}
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled={busy || (!hasCredential && !ingressAvailable)}
          onClick={() => onCopy("command", !hasCredential && !webhook.tokenPending)}
          className={cn(PILL, "gap-1.5")}
        >
          {copied === "command" ? <Check size={13} className="text-success" /> : working === `${webhook.id}:command` ? <Loader2 size={13} className="animate-spin" /> : hasCredential ? <Copy size={13} /> : <Link2 size={13} />}
          {copied === "command" ? t("triggers.copied") : t(hasCredential ? "triggers.copyCommand" : webhook.tokenPending ? "triggers.showToken" : "triggers.regenerateToken")}
        </button>
        <Switch
          checked={webhook.enabled}
          disabled={busy || waitingForTest}
          title={waitingForTest ? t("triggers.waitingTest") : undefined}
          aria-label={t("triggers.toggleAria", { name: webhook.name })}
          onClick={onToggle}
        />
      </div>
      <details className="group/advanced px-3.5 pb-2.5">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-full px-1 text-[12.5px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 [&::-webkit-details-marker]:hidden">
          {t("triggers.advanced")}
          <ChevronDown size={13} aria-hidden="true" className="transition-transform group-open/advanced:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="mt-3 space-y-3 pb-2 text-[11.5px] leading-relaxed text-ink-secondary">
          <div className="rounded-xl border border-accent-border/30 bg-inset/60 px-3 py-2.5">
            {t("triggers.requestTask")} <code className="text-ink">{JSON.stringify({ task: t("triggers.sampleTask") })}</code>. {t("triggers.keepsSetup")}
          </div>
          {webhook.prompt ? <p><span className="font-medium text-ink">{t("triggers.defaultInstruction")}</span> {webhook.prompt}</p> : <p>{t("triggers.requestInstruction")}</p>}
          {webhook.eventTypes?.length ? <p><span className="font-medium text-ink">{t("triggers.acceptedEvents")}</span> {webhook.eventTypes.join(", ")}</p> : <p>{t("triggers.allEvents")}</p>}
          <p className="flex items-center gap-1.5">
            {webhook.runOn === "cloud" ? <Cloud size={12} /> : <Laptop size={12} />}
            <span className="font-medium text-ink">{t("routines.drawer.runsOn")}:</span> {t(webhook.runOn === "cloud" ? "triggers.cloudVm" : "routines.runsOn.local")}
          </p>
          <p><span className="font-medium text-ink">{t("triggers.pendingTasks")}</span> {t("triggers.pendingTasksHelp", { count: webhook.maxPendingRuns ?? WEBHOOK_DEFAULT_MAX_PENDING_RUNS })}</p>
          {hasCredential ? (
            <>
              <pre className="overflow-x-auto rounded-xl bg-inset p-3 font-mono text-[10.5px] whitespace-pre-wrap break-all text-ink-secondary">{command}</pre>
              <p className="text-warning">{t("triggers.tokenOnce")}</p>
            </>
          ) : webhook.tokenPending ? (
            <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-ink">{t("triggers.tokenPendingBanner")}</p>
          ) : (
            <p>{t("triggers.tokenEnding", { last4: webhook.tokenLast4 ?? "" })}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {(hasCredential || webhook.tokenPending) && (
              <button type="button" disabled={busy || (!hasCredential && !ingressAvailable)} onClick={() => onCopy("command", false)} className={cn(PILL, "gap-1.5")}>
                {copied === "command" ? <Check size={12} className="text-success" /> : <Copy size={12} />}{t(copied === "command" ? "triggers.copied" : hasCredential ? "engineSetup.copyCommand" : "triggers.showToken")}
              </button>
            )}
            <button type="button" disabled={busy || !ingressAvailable} onClick={() => onCopy("command", true)} className={cn(PILL, "gap-1.5")}>
              <RotateCw size={12} />{t("triggers.regenerateToken")}
            </button>
            <button type="button" disabled={busy} onClick={onEdit} className={cn(PILL, "gap-1.5")}>
              <Pencil size={12} />{t("triggers.editSettings")}
            </button>
            <button type="button" disabled={busy} onClick={onDelete} className={cn(DANGER_PILL, "gap-1.5")}>
              <Trash2 size={12} />{t("common.delete")}
            </button>
          </div>
          <div>
            <div className="mb-1 font-medium text-ink">{t("triggers.recentDeliveries")}</div>
            {activity.length === 0 ? (
              <p>{t("triggers.noRequests")}</p>
            ) : (
              <ul className="divide-y divide-hairline/25">
                {activity.slice(0, 8).map((item) => (
                  <li key={item.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5"><span className="truncate font-medium text-ink">{item.eventName}</span><span className="shrink-0">· {relativeTime(item.at)}</span></div>
                      <div className="truncate font-mono text-[10px] text-ink-tertiary">{item.reason || item.preview || t("triggers.emptyPayload")}</div>
                    </div>
                    <span className={cn("shrink-0 text-[10.5px] font-medium", outcomeTone(item.outcome, item.run))}>{outcomeLabel(item.outcome, item.run)}</span>
                    {item.run?.threadId && bot && (
                      <button type="button" onClick={() => onOpenChat(item.run!.threadId!)} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] hover:bg-raised hover:text-ink">
                        <ExternalLink size={11} />{t("canvas.openChat")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}
