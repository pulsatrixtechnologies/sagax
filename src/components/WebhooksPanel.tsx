import { useConfirm } from "@/components/ConfirmProvider";
import { boatCapableEngine } from "@/lib/remote-desktop";
import { useEffect, useRef, useState } from "react";
import { Cloud, Laptop, Loader2 } from "lucide-react";

import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import type { RoutineRun, RoutineRunOn } from "@/lib/routines";
import { purgeStoredWebhookCredentials, webhookCredentialStore } from "@/lib/webhook-credentials";
import { WEBHOOK_DEFAULT_MAX_PENDING_RUNS, WEBHOOK_MAX_PENDING_RUNS_LIMIT, webhookActivationDefaults, webhookMaxPendingRunsInput, type WebhookAttempt, type WebhookCredential, type WebhookTrigger, type WebhookTriggerInput } from "@/lib/webhooks";
import { api, useStore, type Bot } from "@/state/store";
import { copyText } from "@/lib/copy-text";
import { t, activeLocale } from "@/lib/i18n";
import { MarkdownEditor } from "./markdown/MarkdownEditor";
import { DetailPanel } from "./DetailPanel";
import { PILL, PRIMARY_PILL } from "./SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

export function relativeTime(at?: number) {
  if (!at) return t("people.never");
  const elapsed = Math.max(0, Date.now() - at);
  if (elapsed < 60_000) return t("webhooks.relative.justNow");
  if (elapsed < 60 * 60_000) return t("webhooks.relative.minutes", { count: Math.floor(elapsed / 60_000) });
  if (elapsed < 24 * 60 * 60_000) return t("webhooks.relative.hours", { count: Math.floor(elapsed / 3_600_000) });
  return new Date(at).toLocaleDateString(activeLocale(), { month: "short", day: "numeric" });
}

function deliverySummary(run: RoutineRun) {
  const eventName = run.prompt?.match(/^Event: (.+)$/m)?.[1]?.trim() || t("webhooks.eventDefault");
  const eventData = run.prompt?.match(/\[UNTRUSTED WEBHOOK EVENT DATA\]\n([\s\S]*?)\n\[\/UNTRUSTED WEBHOOK EVENT DATA\]/)?.[1] ?? "";
  const payloadStart = eventData.indexOf("\n\n");
  const payload = (payloadStart >= 0 ? eventData.slice(payloadStart + 2) : eventData).replace(/\s+/g, " ").trim();
  return { eventName, preview: payload.slice(0, 240) };
}

export function suggestedName(prompt: string, bot?: Bot) {
  const first = prompt.trim().split(/[.!?\n]/)[0]?.trim().slice(0, 60);
  return first || t("webhooks.suggestedName", { name: bot?.name ?? "MAUS" });
}

export function statusFor(webhook: WebhookTrigger) {
  if (webhook.verificationPending) return { label: t("webhooks.status.waiting"), tone: "text-accent", dot: "bg-accent animate-pulse" };
  if (webhook.verifiedAt && !webhook.enabled) return { label: t("webhooks.status.ready"), tone: "text-accent-text", dot: "bg-accent" };
  if (webhook.enabled) return { label: t("webhooks.status.active"), tone: "text-accent-text", dot: "bg-accent" };
  return { label: t("webhooks.status.paused"), tone: "text-ink-secondary", dot: "bg-ink-secondary/50" };
}

export function outcomeTone(outcome: WebhookAttempt["outcome"], run?: RoutineRun) {
  if (outcome === "rejected" || run?.status === "failed" || run?.status === "missed") return "text-danger";
  if (run && ["queued", "running", "waiting"].includes(run.status)) return "text-accent";
  if (run?.status === "completed" || outcome === "captured" || outcome === "accepted") return "text-success";
  return "text-ink-secondary";
}

export function outcomeLabel(outcome: WebhookAttempt["outcome"], run?: RoutineRun) {
  if (run) return run.status === "waiting" ? t("botActivity.outcome.needsYou") : t(`routines.status.${run.status}`);
  if (outcome === "captured") return t("webhooks.outcome.captured");
  if (outcome === "duplicate") return t("webhooks.outcome.duplicate");
  if (outcome === "ignored") return t("webhooks.outcome.ignored");
  if (outcome === "rejected") return t("webhooks.outcome.rejected");
  return t("webhooks.outcome.accepted");
}

export function terminalCommand(credential: WebhookCredential) {
  return credential.command;
}

/** What a webhook shows once its full token is no longer on screen. */
export function maskedToken(webhook: Pick<WebhookTrigger, "tokenLast4">): string {
  return `whsec_\u2022\u2022\u2022\u2022${webhook.tokenLast4 ?? ""}`;
}

export function WebhookEditor({ webhook, bots, onClose, onCredential }: { webhook?: WebhookTrigger; bots: Bot[]; onClose: () => void; onCredential: (credential: WebhookCredential, webhookId: string) => void }) {
  const { state, dispatch } = useStore();
  const [botId, setBotId] = useState(webhook?.botId ?? bots[0]?.id ?? "");
  const [name, setName] = useState(webhook?.name ?? "");
  const [prompt, setPrompt] = useState(webhook?.prompt ?? "");
  const [runOn, setRunOn] = useState<RoutineRunOn>(webhook?.runOn ?? "maus");
  const [eventTypes, setEventTypes] = useState((webhook?.eventTypes ?? []).join(", "));
  const [maxPendingRuns, setMaxPendingRuns] = useState(webhook?.maxPendingRuns?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cloudReady = Boolean(state.config?.box?.configured && boatCapableEngine(state.instances ?? [], bots.find(bot => bot.id === botId)?.modelSelection.instanceId)?.snapshot.state === "available");
  const title = webhook ? t("webhookEditor.editTitle") : t("webhookEditor.newTitle");

  const save = async () => {
    const bot = bots.find((candidate) => candidate.id === botId);
    const pendingLimit = webhookMaxPendingRunsInput(maxPendingRuns);
    if (pendingLimit === undefined) {
      setError(t("webhookEditor.pendingInvalid", { max: WEBHOOK_MAX_PENDING_RUNS_LIMIT }));
      return;
    }
    const input: WebhookTriggerInput = { name: name.trim() || suggestedName(prompt, bot), prompt: prompt.trim(), botId, runOn, ...webhookActivationDefaults(webhook), eventTypes: eventTypes.split(",").map((value) => value.trim()).filter(Boolean), maxPendingRuns: pendingLimit };
    setSaving(true);
    setError("");
    try {
      const response = await api(webhook ? `/api/webhooks/${webhook.id}` : "/api/webhooks", { method: webhook ? "PATCH" : "POST", body: JSON.stringify(input) });
      dispatch({ type: "webhookPatched", webhook: response.webhook });
      onClose();
      if (response.credential) onCredential(response.credential, response.webhook.id);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSaving(false);
    }
  };

  // 2026-11-01 (lot 2, no modals): right detail panel beside Automations >
  // Webhooks, same edge as the bot panel. Escape closes via DetailPanel.
  return (
    <DetailPanel
      label={title}
      title={title}
      closeLabel={t("webhookEditor.close")}
      onClose={onClose}
      data-webhook-editor-panel=""
      footer={
        <>
          <button type="button" onClick={onClose} className={PILL}>{t("common.cancel")}</button>
          <button type="button" disabled={saving || !botId} onClick={() => void save()} className={cn(PRIMARY_PILL, "ml-auto gap-2")}>
            {saving && <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {webhook ? t("webhookEditor.save") : t("webhookEditor.create")}
          </button>
        </>
      }
    >
      <div className="space-y-5 px-4 py-4" data-webhook-editor="">
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("webhookEditor.subtitle")}</p>
        <div>
          <div className="mb-2 text-[12px] font-medium text-ink-secondary">{t("webhookEditor.who")}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {bots.map((bot) => (
              <button key={bot.id} type="button" data-initial-focus={botId === bot.id ? "" : undefined} onClick={() => setBotId(bot.id)} className={cn("flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left", botId === bot.id ? "border-accent/70 bg-accent/10" : "border-hairline/50 bg-inset hover:bg-raised/60")}>
                <BotAvatar bot={bot} state={botId === bot.id ? "happy" : "idle"} size={38} animated={false} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{bot.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-accent/20 bg-accent/5 px-3.5 py-3 text-[12px] leading-relaxed text-ink-secondary">
          {t("webhookEditor.sendTask")} <code className="text-ink">{`{"task":"${t("webhookEditor.sampleTask")}"}`}</code>. {t("webhookEditor.keeps")}
        </div>
        <details className="group rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3" open={Boolean(webhook)}>
          <summary className="cursor-pointer text-[13px] font-medium text-ink">{t("webhookEditor.advanced")}</summary>
          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("webhookEditor.name")} <span className="font-normal">· {t("webhookEditor.optional")}</span></span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder={suggestedName(prompt, bots.find((bot) => bot.id === botId))} className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none placeholder:text-ink-secondary focus:border-border-strong" />
            </label>
            <div className="block">
              <span id="webhook-instructions-label" className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("webhookEditor.instructions")} <span className="font-normal">· {t("webhookEditor.optional")}</span></span>
              <MarkdownEditor value={prompt} onChange={setPrompt} minHeight={90} showCount={false} dataField="webhook-instructions" ariaLabelledBy="webhook-instructions-label" placeholder={t("webhookEditor.instructionsPlaceholder")} />
              <span className="mt-1.5 block text-[11px] leading-relaxed text-ink-secondary">{t("webhookEditor.instructionsHelp")}</span>
            </div>
            <div>
              <div className="mb-2 text-[12px] font-medium text-ink-secondary">{t("webhookEditor.runOn")}</div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setRunOn("maus")} className={cn("rounded-xl border p-3 text-left", runOn === "maus" ? "border-accent/70 bg-accent/10" : "border-hairline/50 bg-panel hover:bg-raised/60")}>
                  <div className="flex items-center gap-2 text-[13px] font-medium text-ink"><Laptop size={14} />{t("webhookEditor.thisComputer")}</div>
                </button>
                <button type="button" disabled={!cloudReady && runOn !== "cloud"} onClick={() => setRunOn("cloud")} className={cn("rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-45", runOn === "cloud" ? "border-accent/70 bg-accent/10" : "border-hairline/50 bg-panel hover:bg-raised/60")}>
                  <div className="flex items-center gap-2 text-[13px] font-medium text-ink"><Cloud size={14} />{t("webhookEditor.cloud")}</div>
                </button>
              </div>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("webhookEditor.events")} <span className="font-normal">· {t("webhookEditor.optional")}</span></span>
              <input value={eventTypes} onChange={(event) => setEventTypes(event.target.value)} placeholder="push, workflow_run" className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none placeholder:text-ink-secondary focus:border-border-strong" />
              <span className="mt-1.5 block text-[11px] text-ink-secondary">{t("webhookEditor.eventsHelp")}</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("webhookEditor.pending")} <span className="font-normal">· {t("webhookEditor.optional")}</span></span>
              <input type="number" inputMode="numeric" min={1} max={WEBHOOK_MAX_PENDING_RUNS_LIMIT} step={1} value={maxPendingRuns} onChange={(event) => setMaxPendingRuns(event.target.value)} placeholder={String(WEBHOOK_DEFAULT_MAX_PENDING_RUNS)} className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none placeholder:text-ink-secondary focus:border-border-strong" />
              <span className="mt-1.5 block text-[11px] text-ink-secondary">{t("webhookEditor.pendingHelp", { count: WEBHOOK_DEFAULT_MAX_PENDING_RUNS })}</span>
            </label>
          </div>
        </details>
        {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>}
      </div>
    </DetailPanel>
  );
}

export interface ActivityItem { id: string; at: number; outcome: WebhookAttempt["outcome"]; eventName: string; preview: string; reason?: string; run?: RoutineRun }

/** Recent deliveries for one webhook: recorded attempts, plus runs from
 * before attempts were recorded. Newest first, at most 30. */
export function webhookActivity(webhook: WebhookTrigger, webhookAttempts: WebhookAttempt[], routineRuns: RoutineRun[]): ActivityItem[] {
  const runById = new Map(routineRuns.map((run) => [run.id, run]));
  const attemptsByRun = new Set(webhookAttempts.map((attempt) => attempt.runId).filter(Boolean));
  const attempts = webhookAttempts
    .filter((attempt) => attempt.webhookId === webhook.id)
    .map((attempt) => ({
      id: attempt.id,
      at: attempt.receivedAt,
      outcome: attempt.outcome,
      eventName: attempt.eventName || (attempt.outcome === "rejected" ? t("webhooks.rejectedRequest") : t("webhooks.eventDefault")),
      preview: attempt.preview || "",
      reason: attempt.reason,
      run: attempt.runId ? runById.get(attempt.runId) : undefined,
    }));
  const legacy = routineRuns
    .filter((run) => run.webhookId === webhook.id && !attemptsByRun.has(run.id))
    .map((run) => {
      const summary = deliverySummary(run);
      return { id: run.id, at: run.scheduledFor, outcome: "accepted" as const, eventName: summary.eventName, preview: summary.preview, run };
    });
  return [...attempts, ...legacy].sort((a, b) => b.at - a.at).slice(0, 30);
}

/** Pause/enable, delete, and the bearer-token copy, shared by Automations >
 * Webhooks (TriggersPanel). The full token exists in the browser only right
 * after it is created, regenerated or revealed (memory only, never stored);
 * `copy: "token"` puts the bare token on the clipboard, the default is the
 * whole curl command. */
export function useWebhookActions() {
  const confirm = useConfirm();
  const { dispatch } = useStore();
  const [credentials, setCredentials] = useState<Record<string, WebhookCredential>>({});
  useEffect(() => purgeStoredWebhookCredentials(webhookCredentialStore()), []);
  const [working, setWorking] = useState<string | null>(null);
  // A second click can arrive before React paints the shared disabled state.
  // Claim synchronously, so rotations cannot race and save a revoked URL.
  const workingRef = useRef(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedKind, setCopiedKind] = useState<"command" | "token">("command");
  const [error, setError] = useState("");

  const invoke = async (webhook: WebhookTrigger, action: "toggle" | "delete") => {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(`${webhook.id}:${action}`);
    setError("");
    try {
      if (action === "delete") {
        if (!(await confirm({ title: t("webhooks.confirmDelete", { name: webhook.name }), confirmLabel: t("common.delete"), tone: "danger" }))) return;
        await api(`/api/webhooks/${webhook.id}`, { method: "DELETE" });
        dispatch({ type: "webhookDeleted", webhookId: webhook.id });
        setCredentials((current) => {
          const next = { ...current };
          delete next[webhook.id];
          return next;
        });
      } else {
        const enabling = !webhook.enabled;
        if (enabling && webhook.verificationPending) throw new Error(t("webhooks.testFirst"));
        const response = await api(`/api/webhooks/${webhook.id}`, { method: "PATCH", body: JSON.stringify({ enabled: enabling, verificationPending: false }) });
        dispatch({ type: "webhookPatched", webhook: response.webhook });
      }
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      workingRef.current = false;
      setWorking(null);
    }
  };

  const createAndCopyCommand = async (webhook: WebhookTrigger, replace = false, copy: "command" | "token" = "command") => {
    // A typed trigger has no bearer token: rotating here would replace the
    // provider's signing secret behind the owner's back.
    if (webhook.source) {
      setError(t("triggers.typed.managedInTriggers"));
      return;
    }
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(`${webhook.id}:command`);
    setError("");
    try {
      let credential = replace ? undefined : credentials[webhook.id];
      if (!credential) {
        // A token generated at server start for an older webhook is handed
        // over once, with nothing to invalidate. Any other way to get a full
        // token is a regeneration: the current one stops working at once.
        const reveal = Boolean(webhook.tokenPending) && !replace;
        if (!reveal && !(await confirm({ title: t("webhooks.confirmRotate"), confirmLabel: t("common.confirm"), tone: "danger" }))) return;
        const response = await api(`/api/webhooks/${webhook.id}/${reveal ? "reveal" : "rotate"}`, { method: "POST" });
        credential = response.credential;
        dispatch({ type: "webhookPatched", webhook: response.webhook });
        setCredentials((current) => ({ ...current, [webhook.id]: credential! }));
      }
      if (!credential) throw new Error(t("webhooks.noToken"));
      if (await copyText(copy === "token" ? credential.token : terminalCommand(credential)) !== "copied") throw new Error(t("common.copyFailed"));
      setCopiedId(webhook.id);
      setCopiedKind(copy);
      setTimeout(() => setCopiedId((current) => current === webhook.id ? null : current), 1_800);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      workingRef.current = false;
      setWorking(null);
    }
  };

  const rememberCredential = (webhookId: string, credential: WebhookCredential) => {
    setCredentials((current) => ({ ...current, [webhookId]: credential }));
  };

  return { credentials, setCredentials, rememberCredential, working, copiedId, copiedKind, error, setError, invoke, createAndCopyCommand };
}

/** Automations > Webhooks page props. The page itself is TriggersPanel
 * (sentence builder + list, 2026-11-01 lot 2). RoutineCalendarPage renders
 * TriggersPanel; this type keeps older call sites typed. */
export type WebhooksPanelProps = {
  bots: Bot[];
  createRequest: number;
  onCreateHandled: () => void;
};
