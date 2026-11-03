// A webhook routine's own webhook, where the routine is (2026-10-29): its
// address, its key and the Authorization header, each masked with Show and
// Copy, a curl example in one click, and Regenerate. The key is never kept:
// it shows in memory after a reveal or a regeneration (the same routes the
// Automations panel uses), and the masked last four characters otherwise.
// A routine saved without its webhook (made before 0.8.17) gets one here.
import { useState } from "react";
import { useConfirm } from "@/components/ConfirmProvider";
import { Check, Copy, Eye, EyeOff, Loader2, RotateCw, Terminal, Webhook } from "lucide-react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";
import type { WebhookCredential, WebhookTrigger } from "@/lib/webhooks";
import { api, useStore, type Bot } from "@/state/store";
import { canManageBotWebhooks } from "@/components/bot-settings/BotWebhooks";
import { maskedToken, statusFor } from "@/components/WebhooksPanel";
import { whenLabel } from "@/lib/schedule-label";
import { readableError } from "@/lib/plain-error";

const ROW = "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2";
const LABEL = "w-24 shrink-0 text-[11.5px] font-medium text-ink-secondary";
const VALUE = "min-w-0 flex-1 truncate font-mono text-[12px] text-ink";
const ICON = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40";

/** The address a delivery posts to (server/triggers/webhook-ingress.ts). */
export function routineWebhookUrl(baseUrl: string | undefined, webhook: Pick<WebhookTrigger, "endpointId">): string {
  return `${(baseUrl ?? "").replace(/\/$/, "")}/hooks/${webhook.endpointId}`;
}

/** The curl example: with the key when it is on screen, else a stand-in. */
export function routineWebhookCurl(url: string, token: string | undefined): string {
  return `curl -X POST ${url} -H "Authorization: Bearer ${token ?? "<key>"}" -H "Content-Type: application/json" -d '{"text":"hello"}'`;
}

export function routineWebhookFor(webhooks: WebhookTrigger[], routineId: string | undefined): WebhookTrigger | undefined {
  return routineId ? webhooks.find((webhook) => webhook.routineId === routineId) : undefined;
}

export function RoutineWebhookPanel({ routine, bot }: { routine?: Routine; bot?: Bot }) {
  const confirm = useConfirm();
  const { state, dispatch } = useStore();
  const webhook = routineWebhookFor(state.webhooks, routine?.id);
  const [credential, setCredential] = useState<WebhookCredential | null>(null);
  const [shown, setShown] = useState(false);
  const [working, setWorking] = useState<"" | "reveal" | "rotate" | "create">("");
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const manage = bot ? canManageBotWebhooks(state.config, bot) : false;

  if (!routine) {
    return <p data-routine-webhook="new" className="rounded-xl border border-dashed border-hairline/60 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("routineWebhook.afterSave")}</p>;
  }

  const copy = async (kind: string, text: string) => {
    setError("");
    if (await copyText(text) !== "copied") { setError(t("common.copyFailed")); return; }
    setCopied(kind);
    setTimeout(() => setCopied((current) => (current === kind ? "" : current)), 1_600);
  };

  const fetchKey = async (rotate: boolean) => {
    if (!webhook) return;
    if (rotate && !(await confirm({ title: t("webhooks.confirmRotate"), confirmLabel: t("common.confirm"), tone: "danger" }))) return;
    setWorking(rotate ? "rotate" : "reveal");
    setError("");
    try {
      const response = await api(`/api/webhooks/${webhook.id}/${rotate ? "rotate" : "reveal"}`, { method: "POST" }) as { webhook: WebhookTrigger; credential: WebhookCredential };
      dispatch({ type: "webhookPatched", webhook: response.webhook });
      setCredential(response.credential);
      setShown(true);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setWorking("");
    }
  };

  const create = async () => {
    setWorking("create");
    setError("");
    try {
      // Saving the routine as a webhook routine attaches its webhook.
      const response = await api(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify({ schedule: { type: "webhook" } }) });
      dispatch({ type: "routinePatched", routine: response.routine });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setWorking("");
    }
  };

  if (!webhook) {
    return <div data-routine-webhook="missing" className="space-y-2 rounded-xl border border-hairline/40 bg-inset/30 px-3 py-2.5">
      <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t("routineWebhook.missing")}</p>
      {manage && <button type="button" onClick={() => void create()} disabled={working !== ""} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised disabled:opacity-50">{working === "create" ? <Loader2 size={13} className="animate-spin" /> : <Webhook size={13} />}{t("routineWebhook.create")}</button>}
      {error && <p role="alert" className="text-[11.5px] text-danger">{error}</p>}
    </div>;
  }

  const url = routineWebhookUrl(state.webhookIngress?.baseUrl, webhook);
  const token = credential?.token;
  const keyText = shown && token ? token : maskedToken(webhook);
  const header = `Authorization: Bearer ${keyText}`;
  const status = statusFor(webhook);
  // Show: the key waiting from creation is handed over once; any other
  // way to see a key is a new key (the old one stops at once).
  const show = () => {
    if (token) { setShown((open) => !open); return; }
    void fetchKey(!webhook.tokenPending);
  };
  const copyButton = (kind: string, text: string, label: string) => (
    <button type="button" data-copy={kind} onClick={() => void copy(kind, text)} aria-label={label} title={label} className={ICON}>
      {copied === kind ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
    </button>
  );
  const eye = manage && (
    <button type="button" data-show-key onClick={show} disabled={working !== ""} aria-pressed={shown && Boolean(token)} aria-label={shown && token ? t("routineWebhook.hide") : t("routineWebhook.show")} title={shown && token ? t("routineWebhook.hide") : webhook.tokenPending ? t("routineWebhook.show") : t("routineWebhook.showRotates")} className={ICON}>
      {working === "reveal" ? <Loader2 size={14} className="animate-spin" /> : shown && token ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  );

  return <div data-routine-webhook={webhook.id} className="space-y-2">
    <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-secondary">
      <span className={cn("inline-flex items-center gap-1.5 font-medium", status.tone)}><span aria-hidden="true" className={cn("size-1.5 rounded-full", status.dot)} />{status.label}</span>
      <span>· {t("routineWebhook.deliveries", { count: webhook.deliveryCount })}</span>
      {webhook.lastReceivedAt && <span>· {t("routineWebhook.last", { when: whenLabel(webhook.lastReceivedAt) })}</span>}
    </div>
    <div className="divide-y divide-hairline/40 rounded-xl border border-hairline/40 bg-inset/30">
      <div className={ROW}>
        <span className={LABEL}>{t("routineWebhook.postTo")}</span>
        <span data-webhook-url className={VALUE} title={url}>{url}</span>
        {copyButton("url", url, t("routineWebhook.copyUrl"))}
      </div>
      <div className={ROW}>
        <span className={LABEL}>{t("routineWebhook.key")}</span>
        <span data-webhook-key className={VALUE}>{keyText}</span>
        {eye}
        {manage && token && copyButton("key", token, t("routineWebhook.copyKey"))}
      </div>
      <div className={ROW}>
        <span className={LABEL}>{t("routineWebhook.header")}</span>
        <span data-webhook-header className={VALUE}>{header}</span>
        {manage && token && copyButton("header", `Authorization: Bearer ${token}`, t("routineWebhook.copyHeader"))}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" data-copy-curl onClick={() => void copy("curl", routineWebhookCurl(url, token))} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-raised">
        {copied === "curl" ? <Check size={13} className="text-accent" /> : <Terminal size={13} />}{t("routineWebhook.copyCurl")}
      </button>
      {manage && <button type="button" data-rotate-key onClick={() => void fetchKey(true)} disabled={working !== ""} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50">
        {working === "rotate" ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}{t("routineWebhook.rotate")}
      </button>}
      {!token && <span className="text-[11px] text-ink-secondary">{t("routineWebhook.curlNote")}</span>}
    </div>
    {state.webhookIngress && !state.webhookIngress.available && <p role="alert" className="text-[11.5px] text-danger">{t("botWebhooks.receiverDown")}</p>}
    {error && <p role="alert" className="text-[11.5px] text-danger">{error}</p>}
  </div>;
}
