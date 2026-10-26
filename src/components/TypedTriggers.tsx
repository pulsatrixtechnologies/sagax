// Typed triggers in the Triggers pop-up: a provider (GitHub, Slack, Teams,
// Outlook, Sentry, PagerDuty, Linear...) whose events Sagax verifies by the
// provider's own signature, normalizes, filters and deduplicates before a
// run is queued (server/trigger-sources.ts). This file holds the builder's
// fields and the row each typed trigger gets: setup steps with the URL and
// (once) the secret, the secret's state, events and filters, test-fire and
// the recent events log.
import { useMemo, useState } from "react";
import { ArrowRight, Check, Copy, ExternalLink, KeyRound, Loader2, Pencil, RotateCw, Send, ShieldCheck, Trash2, Webhook } from "lucide-react";

import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  GRAPH_SUBSCRIPTION_SCOPES,
  POLLER_INTERVAL_DEFAULT,
  POLLER_INTERVAL_MAX,
  POLLER_KINDS_FOR,
  POLLER_LEAD_DEFAULT,
  POLLER_LEAD_MAX,
  TRIGGER_RATE_LIMIT_DEFAULT,
  TRIGGER_RATE_LIMIT_MAX,
  TRIGGER_SOURCES,
  triggerEveryEvent,
  type GraphConnectorOption,
  type TriggerAutomationStatus,
  type TriggerFilterKey,
  type TriggerPollerKind,
  type TriggerSourceConfig,
  type TriggerSourceSetup,
  type TriggerSourceType,
} from "../../shared/trigger-sources";
import type { WebhookTrigger, WebhookTriggerInput } from "@/lib/webhooks";
import { useBotInboundMail, type BotInboundMail } from "@/lib/bot-inbound-mail";
import { api, useStore, type Bot } from "@/state/store";

import { Switch } from "./SettingsPrimitives";
import { outcomeLabel, outcomeTone, relativeTime, statusFor, webhookActivity } from "./WebhooksPanel";

const GRAPH_TYPES = new Set<TriggerSourceType>(["teams", "email", "calendar"]);

/** The builder's typed fields as typed (text, before parsing). */
export interface TypedDraft {
  events: string[];
  /** Comma-separated values per filter key. */
  filters: Partial<Record<TriggerFilterKey, string>>;
  signingSecret: string;
  tenantId: string;
  rateLimit: string;
  /** How events reach Sagax: the provider pushes (manual setup), Sagax
   *  subscribes through a Microsoft connector, or Sagax polls. */
  connection?: "manual" | "graph" | "poller";
  /** `<connector>|<account>` of the chosen Microsoft sign-in. */
  graphConnector?: string;
  graphResource?: string;
  pollerKind?: TriggerPollerKind;
  pollerHost?: string;
  pollerPort?: string;
  pollerMailbox?: string;
  pollerUsername?: string;
  pollerUrl?: string;
  pollerInterval?: string;
  pollerLead?: string;
  /** Write only: the poller's password or the ICS link. Memory only. */
  pollerSecret?: string;
  /** GitHub: also run for comments posted by an app or bot. */
  includeBotComments?: boolean;
  /** Bot email (S2): the owner's opt-in to the bot's usual tools. */
  allowFullTools?: boolean;
}

export const EMPTY_TYPED_DRAFT: TypedDraft = { events: [], filters: {}, signingSecret: "", tenantId: "", rateLimit: "" };

/** The source's name: a brand as written, or for bot email (2026-10-21)
 * the translated "Bot email". */
export function typedSourceLabel(type: TriggerSourceType): string {
  return type === "botmail" ? t("triggers.source.botmail") : TRIGGER_SOURCES[type].label;
}

/** Bot email: the bot's own address (from the Perspicax relay) with a Copy
 * button, where other sources show their URL. Nothing while loading. */
export function BotMailAddressLine({ mail }: { mail: BotInboundMail | null }) {
  const [copied, setCopied] = useState(false);
  if (!mail) return null;
  const address = mail.available ? mail.address : null;
  if (!address) return <p data-botmail-no-address="" className="text-[11px] text-ink-secondary">{t("triggers.botmail.noAddress")}</p>;
  const copy = () => void copyText(address).then((result) => {
    if (result !== "copied") return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1_600);
  });
  return (
    <div data-botmail-address="">
      <div className="text-[11px] text-ink-secondary">{t("triggers.botmail.address")}</div>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-inset px-2 py-1 font-mono text-[10.5px] text-ink">{address}</code>
        <button type="button" onClick={copy} className="flex shrink-0 items-center gap-1 rounded-lg border border-hairline/50 px-2 py-1 text-[11px] font-medium text-ink hover:bg-raised">
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}{t(copied ? "triggers.copied" : "triggers.botmail.copy")}
        </button>
      </div>
      {!mail.enabled && <p className="mt-1 text-[11px] text-ink-secondary">{t("botPanel.email.pending")}</p>}
    </div>
  );
}

export function typedEventLabel(kind: string): string {
  return t(`triggers.event.${kind.replace(/\./g, "_")}` as LocaleKey);
}

export function typedFilterLabel(key: TriggerFilterKey): string {
  return t(`triggers.filter.${key}` as LocaleKey);
}

function splitValues(text: string | undefined): string[] {
  return Array.from(new Set((text ?? "").split(",").map((value) => value.trim()).filter(Boolean)));
}

/** The source config the server expects, from the draft. */
export function typedSourceConfig(type: TriggerSourceType, draft: TypedDraft): TriggerSourceConfig {
  const definition = TRIGGER_SOURCES[type];
  const filters: TriggerSourceConfig["filters"] = {};
  for (const key of definition.filters) {
    const values = splitValues(draft.filters[key]);
    if (values.length) filters[key] = values;
  }
  const config: TriggerSourceConfig = { type, events: draft.events.filter((kind) => definition.events.includes(kind)), filters };
  if (type === "github" && draft.includeBotComments) config.includeBotComments = true;
  if (type === "botmail" && draft.allowFullTools) config.allowFullTools = true;
  const rate = Number(draft.rateLimit);
  if (draft.rateLimit.trim() && Number.isInteger(rate) && rate >= 1 && rate <= TRIGGER_RATE_LIMIT_MAX) config.rateLimitPerMinute = rate;
  if (GRAPH_TYPES.has(type) && draft.tenantId.trim()) config.tenantId = draft.tenantId.trim();
  if (draft.connection === "graph" && GRAPH_TYPES.has(type) && draft.graphConnector) {
    const [connector, account] = draft.graphConnector.split("|");
    config.graph = { connector: connector!, ...(account && account !== "default" ? { account } : {}), ...(draft.graphResource?.trim() ? { resource: draft.graphResource.trim() } : {}) };
  }
  const kinds = POLLER_KINDS_FOR[type] ?? [];
  if (draft.connection === "poller" && kinds.length) {
    const kind = draft.pollerKind && kinds.includes(draft.pollerKind) ? draft.pollerKind : kinds[0]!;
    const poller: NonNullable<TriggerSourceConfig["poller"]> = { kind };
    const int = (text: string | undefined, min: number, max: number) => {
      const value = Number(text);
      return text?.trim() && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
    };
    if (kind === "imap") {
      if (draft.pollerHost?.trim()) poller.host = draft.pollerHost.trim();
      const port = int(draft.pollerPort, 1, 65_535);
      if (port) poller.port = port;
      if (draft.pollerMailbox?.trim()) poller.mailbox = draft.pollerMailbox.trim();
    }
    if (kind === "caldav" && draft.pollerUrl?.trim()) poller.url = draft.pollerUrl.trim();
    if (kind !== "ics" && draft.pollerUsername?.trim()) poller.username = draft.pollerUsername.trim();
    const interval = int(draft.pollerInterval, 1, POLLER_INTERVAL_MAX);
    if (interval) poller.intervalMinutes = interval;
    const lead = int(draft.pollerLead, 0, POLLER_LEAD_MAX);
    if (kind !== "imap" && lead !== undefined) poller.leadMinutes = lead;
    config.poller = poller;
  }
  return config;
}

/** The write-only credential typed in the draft, as the API takes it. */
export function pollerCredentialsInput(type: TriggerSourceType, draft: TypedDraft): { password?: string; url?: string } | undefined {
  const secret = draft.pollerSecret?.trim();
  if (draft.connection !== "poller" || !secret || !(POLLER_KINDS_FOR[type] ?? []).length) return undefined;
  const kind = draft.pollerKind ?? POLLER_KINDS_FOR[type]![0];
  return kind === "ics" ? { url: secret } : { password: draft.pollerSecret };
}

/** The create request for a typed trigger: the plain webhook fields plus
 * the source, and the pasted secret only when there is one. */
export function typedTriggerInput(type: TriggerSourceType, draft: TypedDraft, base: WebhookTriggerInput): WebhookTriggerInput {
  const secret = draft.signingSecret.trim();
  return {
    ...base,
    source: typedSourceConfig(type, draft),
    ...(TRIGGER_SOURCES[type].secretMode === "provided" && secret ? { signingSecret: secret } : {}),
    ...(pollerCredentialsInput(type, draft) ? { pollerCredentials: pollerCredentialsInput(type, draft) } : {}),
  };
}

export function draftFromConfig(config: TriggerSourceConfig): TypedDraft {
  // A trigger saved before the current catalog with nothing checked runs
  // for the old set only: show those checked, so saving keeps them.
  const every = triggerEveryEvent(config.type, config.catalog);
  const legacy = !config.events.length && every.length < TRIGGER_SOURCES[config.type].events.length;
  return {
    events: legacy ? [...every] : [...config.events],
    ...(config.includeBotComments ? { includeBotComments: true } : {}),
    ...(config.allowFullTools ? { allowFullTools: true } : {}),
    filters: Object.fromEntries(Object.entries(config.filters).map(([key, values]) => [key, (values ?? []).join(", ")])),
    signingSecret: "",
    tenantId: config.tenantId ?? "",
    rateLimit: config.rateLimitPerMinute ? String(config.rateLimitPerMinute) : "",
    ...(config.graph ? {
      connection: "graph" as const,
      graphConnector: `${config.graph.connector}|${config.graph.account ?? "default"}`,
      graphResource: config.graph.resource ?? "",
    } : {}),
    ...(config.poller ? {
      connection: "poller" as const,
      pollerKind: config.poller.kind,
      pollerHost: config.poller.host ?? "",
      pollerPort: config.poller.port ? String(config.poller.port) : "",
      pollerMailbox: config.poller.mailbox ?? "",
      pollerUsername: config.poller.username ?? "",
      pollerUrl: config.poller.url ?? "",
      pollerInterval: config.poller.intervalMinutes ? String(config.poller.intervalMinutes) : "",
      pollerLead: config.poller.leadMinutes !== undefined ? String(config.poller.leadMinutes) : "",
      pollerSecret: "",
    } : {}),
  };
}

/** The editor's line for the subscription or poller state. */
export function automationText(status: TriggerAutomationStatus | undefined): { text: string; tone: "ok" | "error" | "pending" } | null {
  if (!status) return null;
  const code = status.code ?? status.state;
  const when = status.expiresAt ? new Date(status.expiresAt).toLocaleString() : "";
  const known = AUTOMATION_CODES[status.kind].includes(code.replace(/-/g, "_"));
  const key = (known ? `triggers.automation.${status.kind}.${code.replace(/-/g, "_")}` : `triggers.automation.${status.state}`) as LocaleKey;
  return { text: t(key, { when }), tone: status.state };
}

const AUTOMATION_CODES: Record<TriggerAutomationStatus["kind"], readonly string[]> = {
  graph: ["active", "created", "renewed", "paused", "needs_resource", "needs_https", "no_connector", "no_scope", "signed_out", "gone", "forbidden", "refused", "graph_error", "network"],
  poller: ["ok", "no_credentials", "blocked_address", "unreachable", "tls", "sign_in_refused", "mailbox", "protocol", "http_status", "too_large", "timeout", "redirect"],
};

function connectorChoices(type: TriggerSourceType, options: GraphConnectorOption[]): Array<GraphConnectorOption & { covers: boolean }> {
  return options.map((option) => ({ ...option, covers: option.sources.includes(type) }));
}

/** How events reach Sagax: manual Graph steps, a Microsoft connector, or a poller. */
function ConnectionFields({ type, draft, onChange, secretSet }: { type: TriggerSourceType; draft: TypedDraft; onChange: (draft: TypedDraft) => void; secretSet?: boolean }) {
  const { state } = useStore();
  const kinds = POLLER_KINDS_FOR[type] ?? [];
  const graph = GRAPH_TYPES.has(type);
  if (!graph && !kinds.length) return null;
  const connection = draft.connection ?? "manual";
  const choices = connectorChoices(type, state.webhookGraphConnectors ?? []);
  const usable = choices.filter((choice) => choice.covers);
  const pollerKind = draft.pollerKind && kinds.includes(draft.pollerKind) ? draft.pollerKind : kinds[0];
  const set = (patch: Partial<TypedDraft>) => onChange({ ...draft, ...patch });
  const option = (value: "manual" | "graph" | "poller", label: string) => (
    <label key={value} className="flex items-center gap-1.5 text-[11.5px] text-ink">
      <input type="radio" name={`typed-connection-${type}`} value={value} checked={connection === value} data-typed-connection={value} onChange={() => set({ connection: value })} />
      {label}
    </label>
  );
  return (
    <fieldset data-typed-connection-fields className="space-y-2">
      <legend className="mb-1 text-[11.5px] font-medium text-ink-secondary">{t("triggers.connection.title")}</legend>
      <div className="flex flex-wrap gap-3">
        {option("manual", graph ? t("triggers.connection.manual") : t("triggers.connection.push"))}
        {graph && option("graph", t("triggers.connection.graph"))}
        {kinds.length > 0 && option("poller", t("triggers.connection.poller"))}
      </div>
      {connection === "graph" && graph && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.connection.connector")}</span>
            <select value={draft.graphConnector ?? ""} data-typed-graph-connector onChange={(event) => set({ graphConnector: event.target.value })} className={inputClass}>
              <option value="">{t("triggers.connection.chooseConnector")}</option>
              {choices.map((choice) => (
                <option key={`${choice.connector}|${choice.account}`} value={`${choice.connector}|${choice.account}`} disabled={!choice.covers}>
                  {choice.label ? `${choice.connector} (${choice.label})` : choice.connector}{choice.covers ? "" : ` · ${t("triggers.connection.missingScope")}`}
                </option>
              ))}
            </select>
            {usable.length === 0 && (
              <span data-typed-graph-none className="mt-0.5 block text-[10.5px] text-warning">
                {t("triggers.connection.noConnector", { scopes: (GRAPH_SUBSCRIPTION_SCOPES[type] ?? []).slice(0, 2).join(", ") })}
              </span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.connection.resource")}</span>
            <input value={draft.graphResource ?? ""} data-typed-graph-resource onChange={(event) => set({ graphResource: event.target.value })} className={inputClass} maxLength={300}
              placeholder={type === "email" ? "me/mailFolders('Inbox')/messages" : type === "calendar" ? "me/events" : "teams/<id>/channels/<id>/messages"} />
          </label>
          <p className="text-[10.5px] text-ink-tertiary sm:col-span-2">{t("triggers.connection.graphHelp")}</p>
        </div>
      )}
      {connection === "poller" && pollerKind && (
        <div className="grid gap-2 sm:grid-cols-2">
          {kinds.length > 1 && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.poller.kind")}</span>
              <select value={pollerKind} data-typed-poller-kind onChange={(event) => set({ pollerKind: event.target.value as TriggerPollerKind, pollerSecret: "" })} className={inputClass}>
                {kinds.map((kind) => <option key={kind} value={kind}>{t(`triggers.poller.kind.${kind}` as LocaleKey)}</option>)}
              </select>
            </label>
          )}
          {pollerKind === "imap" && (
            <>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.poller.host")}</span>
                <input value={draft.pollerHost ?? ""} data-typed-poller-host onChange={(event) => set({ pollerHost: event.target.value })} className={inputClass} maxLength={253} placeholder="imap.example.com" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.poller.port")}</span>
                <input type="number" inputMode="numeric" min={1} max={65_535} value={draft.pollerPort ?? ""} onChange={(event) => set({ pollerPort: event.target.value })} className={inputClass} placeholder="993" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.poller.mailbox")}</span>
                <input value={draft.pollerMailbox ?? ""} onChange={(event) => set({ pollerMailbox: event.target.value })} className={inputClass} maxLength={200} placeholder="INBOX" />
              </label>
            </>
          )}
          {pollerKind === "caldav" && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.poller.caldavUrl")}</span>
              <input value={draft.pollerUrl ?? ""} data-typed-poller-url onChange={(event) => set({ pollerUrl: event.target.value })} className={inputClass} maxLength={2_000} placeholder="https://" />
            </label>
          )}
          {pollerKind !== "ics" && (
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.poller.username")}</span>
              <input value={draft.pollerUsername ?? ""} autoComplete="off" onChange={(event) => set({ pollerUsername: event.target.value })} className={inputClass} maxLength={320} />
            </label>
          )}
          <label className={cn("block", pollerKind === "ics" && "sm:col-span-2")}>
            <span className="mb-1 block text-[11px] text-ink-secondary">{t(pollerKind === "ics" ? "triggers.poller.icsUrl" : "triggers.poller.password")}</span>
            <input
              type="password"
              autoComplete="off"
              value={draft.pollerSecret ?? ""}
              data-typed-poller-secret
              onChange={(event) => set({ pollerSecret: event.target.value })}
              className={inputClass}
              maxLength={pollerKind === "ics" ? 2_000 : 1_024}
              placeholder={secretSet ? t("triggers.poller.secretKept") : ""}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.poller.interval")}</span>
            <input type="number" inputMode="numeric" min={1} max={POLLER_INTERVAL_MAX} value={draft.pollerInterval ?? ""} onChange={(event) => set({ pollerInterval: event.target.value })} className={inputClass} placeholder={String(POLLER_INTERVAL_DEFAULT)} />
          </label>
          {pollerKind !== "imap" && (
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.poller.lead")}</span>
              <input type="number" inputMode="numeric" min={0} max={POLLER_LEAD_MAX} value={draft.pollerLead ?? ""} onChange={(event) => set({ pollerLead: event.target.value })} className={inputClass} placeholder={String(POLLER_LEAD_DEFAULT)} />
            </label>
          )}
          <p className="text-[10.5px] text-ink-tertiary sm:col-span-2">{t(pollerKind === "imap" ? "triggers.poller.imapHelp" : "triggers.poller.calendarHelp")}</p>
        </div>
      )}
    </fieldset>
  );
}

const inputClass =
  "min-h-8 w-full rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-tertiary focus:border-focus";

/** Events, filters and, when creating, the secret field. */
export function TypedSourceFields({
  type,
  draft,
  onChange,
  creating,
  pollerSecretSet,
  botId,
}: {
  type: TriggerSourceType;
  draft: TypedDraft;
  onChange: (draft: TypedDraft) => void;
  creating: boolean;
  /** Editing a trigger whose poller credential is already stored. */
  pollerSecretSet?: boolean;
  /** Bot email: the bot whose address the builder shows. */
  botId?: string;
}) {
  const definition = TRIGGER_SOURCES[type];
  const deferred = new Set(definition.deferredFilters ?? []);
  const contains = new Set(definition.containsFilters ?? []);
  const relay = definition.secretMode === "relay";
  const mail = useBotInboundMail(relay && creating ? botId : null);
  const toggleEvent = (kind: string) =>
    onChange({ ...draft, events: draft.events.includes(kind) ? draft.events.filter((value) => value !== kind) : [...draft.events, kind] });
  return (
    <div data-typed-fields={type} className="mt-3 space-y-3 rounded-xl border border-hairline/30 bg-inset/40 p-3">
      <fieldset>
        <legend className="mb-1.5 text-[11.5px] font-medium text-ink-secondary">
          {t("triggers.typed.events")} <span className="font-normal">· {t("triggers.typed.eventsHelp")}</span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {definition.events.map((kind) => {
            const on = draft.events.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                data-typed-event={kind}
                onClick={() => toggleEvent(kind)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11.5px] font-medium",
                  on ? "border-accent/60 bg-accent/15 text-ink" : "border-hairline/45 text-ink-secondary hover:bg-raised",
                )}
              >
                {typedEventLabel(kind)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-[11.5px] font-medium text-ink-secondary">
          {t("triggers.typed.filters")} <span className="font-normal">· {t("triggers.typed.filtersHelp")}</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {definition.filters.map((key) => (
            <label key={key} className="block">
              <span className="mb-1 block text-[11px] text-ink-secondary">{typedFilterLabel(key)}</span>
              <input
                value={draft.filters[key] ?? ""}
                data-typed-filter={key}
                onChange={(event) => onChange({ ...draft, filters: { ...draft.filters, [key]: event.target.value } })}
                className={inputClass}
                maxLength={1_000}
              />
              {deferred.has(key) && <span className="mt-0.5 block text-[10.5px] text-ink-tertiary">{t("triggers.typed.deferred", { provider: definition.label })}</span>}
              {contains.has(key) && <span className="mt-0.5 block text-[10.5px] text-ink-tertiary">{t("triggers.typed.contains")}</span>}
            </label>
          ))}
        </div>
      </fieldset>
      {type === "github" && (
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[11.5px] font-medium text-ink-secondary">{t("triggers.typed.botComments")}</span>
            <span className="mt-0.5 block text-[10.5px] text-ink-tertiary">{t("triggers.typed.botCommentsHelp")}</span>
          </span>
          <Switch
            checked={Boolean(draft.includeBotComments)}
            aria-label={t("triggers.typed.botComments")}
            data-typed-bot-comments
            onClick={() => onChange({ ...draft, includeBotComments: !draft.includeBotComments })}
          />
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.typed.rateLimit")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={TRIGGER_RATE_LIMIT_MAX}
            value={draft.rateLimit}
            placeholder={String(TRIGGER_RATE_LIMIT_DEFAULT)}
            onChange={(event) => onChange({ ...draft, rateLimit: event.target.value })}
            className={inputClass}
          />
        </label>
        {GRAPH_TYPES.has(type) && (
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.typed.tenant")}</span>
            <input value={draft.tenantId} onChange={(event) => onChange({ ...draft, tenantId: event.target.value })} className={inputClass} maxLength={100} />
          </label>
        )}
      </div>
      <ConnectionFields type={type} draft={draft} onChange={onChange} secretSet={pollerSecretSet} />
      {type === "botmail" && (
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[11.5px] font-medium text-ink-secondary">{t("triggers.botmail.fullTools")}</span>
            <span className="mt-0.5 block text-[10.5px] text-warning">{t("triggers.botmail.fullToolsHelp")}</span>
          </span>
          <Switch
            checked={Boolean(draft.allowFullTools)}
            aria-label={t("triggers.botmail.fullTools")}
            data-botmail-full-tools=""
            onClick={() => onChange({ ...draft, allowFullTools: !draft.allowFullTools })}
          />
        </div>
      )}
      {relay && (
        <div className="space-y-2">
          <p data-botmail-relay="" className="flex items-center gap-1.5 text-[11px] text-ink-secondary"><ShieldCheck size={12} aria-hidden="true" />{t("triggers.botmail.relay")}</p>
          {creating && <BotMailAddressLine mail={mail} />}
        </div>
      )}
      {creating && !relay && (definition.secretMode === "provided" ? (
        <label className="block">
          <span className="mb-1 block text-[11px] text-ink-secondary">{t("triggers.typed.secretProvided", { provider: definition.label })}</span>
          <input
            type="password"
            autoComplete="off"
            value={draft.signingSecret}
            data-typed-secret
            onChange={(event) => onChange({ ...draft, signingSecret: event.target.value })}
            className={inputClass}
            maxLength={512}
          />
          <span className="mt-0.5 block text-[10.5px] text-ink-tertiary">{t("triggers.typed.secretProvidedHelp", { provider: definition.label })}</span>
        </label>
      ) : (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-secondary"><KeyRound size={12} aria-hidden="true" />{t("triggers.typed.secretGenerated")}</p>
      ))}
      <p className="flex items-center gap-1.5 text-[11px] text-ink-secondary"><ShieldCheck size={12} aria-hidden="true" />{t("triggers.typed.untrusted")}</p>
    </div>
  );
}

/** The source URL never holds a secret, so it can be shown and copied any time. */
export function sourceEndpointUrl(baseUrl: string | undefined, webhook: Pick<WebhookTrigger, "endpointId">): string {
  return `${(baseUrl ?? "").replace(/\/$/, "")}/sources/${webhook.endpointId}`;
}

export function TypedTriggerRow({
  webhook,
  bot,
  setup,
  baseUrl,
  busy,
  onToggle,
  onDelete,
  onEdit,
  onSetup,
  onOpenChat,
}: {
  webhook: WebhookTrigger;
  bot: Bot | undefined;
  /** Shown once, right after create or rotate: memory only. */
  setup: TriggerSourceSetup | undefined;
  baseUrl: string | undefined;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onSetup: (setup: TriggerSourceSetup) => void;
  onOpenChat: (threadId: string) => void;
}) {
  const { state, dispatch } = useStore();
  const source = webhook.source!;
  const definition = TRIGGER_SOURCES[source.type];
  const [draft, setDraft] = useState<TypedDraft>(() => draftFromConfig(source));
  const [secret, setSecret] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"url" | "secret" | null>(null);
  const status = statusFor(webhook);
  const activity = useMemo(
    () => webhookActivity(webhook, state.webhookAttempts, state.routineRuns),
    [webhook, state.webhookAttempts, state.routineRuns],
  );
  const url = setup?.endpointUrl ?? sourceEndpointUrl(baseUrl, webhook);
  const waitingForTest = Boolean(webhook.verificationPending && !webhook.enabled);
  const disabled = busy || working !== null;
  const filterSummary = Object.entries(source.filters)
    .map(([key, values]) => `${typedFilterLabel(key as TriggerFilterKey)}: ${(values ?? []).join(", ")}`)
    .join(" · ");

  const run = async (name: string, action: () => Promise<void>) => {
    if (working) return;
    setWorking(name);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(null);
    }
  };

  const copy = (kind: "url" | "secret", text: string) =>
    void copyText(text).then((result) => {
      if (result !== "copied") return;
      setCopied(kind);
      setTimeout(() => setCopied(null), 1_600);
    });

  const testFire = () => run("test", async () => {
    const result = await api(`/api/webhooks/${webhook.id}/test`, { method: "POST", body: "{}" });
    setNotice(t(result?.captured ? "triggers.typed.testCaptured" : result?.ignored ? "triggers.typed.testIgnored" : "triggers.typed.testStarted"));
  });

  const saveSecret = () => run("secret", async () => {
    const response = await api(`/api/webhooks/${webhook.id}`, { method: "PATCH", body: JSON.stringify({ signingSecret: secret.trim() }) });
    dispatch({ type: "webhookPatched", webhook: response.webhook });
    setSecret("");
    setNotice(t("triggers.typed.secretSaved"));
  });

  const rotate = () => run("rotate", async () => {
    if (!window.confirm(t("triggers.typed.rotateConfirm", { provider: definition.label }))) return;
    const response = await api(`/api/webhooks/${webhook.id}/rotate`, { method: "POST" });
    dispatch({ type: "webhookPatched", webhook: response.webhook });
    if (response.sourceSetup) onSetup(response.sourceSetup);
  });

  const saveFilters = () => run("filters", async () => {
    const credentials = pollerCredentialsInput(source.type, draft);
    const response = await api(`/api/webhooks/${webhook.id}`, {
      method: "PATCH",
      body: JSON.stringify({ source: typedSourceConfig(source.type, draft), ...(credentials ? { pollerCredentials: credentials } : {}) }),
    });
    dispatch({ type: "webhookPatched", webhook: response.webhook });
    // The password or link never stays in the page once sent.
    if (credentials) setDraft((current) => ({ ...current, pollerSecret: "" }));
    setNotice(t("triggers.typed.saved"));
  });
  const automation = automationText(webhook.automation);
  const relay = definition.secretMode === "relay";
  const mail = useBotInboundMail(relay ? webhook.botId : null);

  return (
    <li data-trigger-row={webhook.id} data-trigger-source={source.type}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        {bot ? (
          <BotAvatar bot={bot} state={webhook.enabled ? "idle" : "sleeping"} size={34} animated={false} label={bot.name} />
        ) : (
          <div className="flex size-[34px] shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Webhook size={16} /></div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium text-ink">
            <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-secondary">{typedSourceLabel(source.type)}</span>
            <span className="truncate">{webhook.name}</span>
            <ArrowRight size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
            <span className="truncate">{bot?.name ?? t("triggers.deletedBot")}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-secondary">
            <span className={cn("size-1.5 rounded-full", status.dot)} />
            <span className={status.tone}>{status.label}</span>
            <span aria-hidden="true">·</span>
            <span>
              {webhook.lastReceivedAt
                ? t("triggers.received", { count: webhook.deliveryCount, when: relativeTime(webhook.lastReceivedAt) })
                : t("triggers.neverReceived")}
            </span>
            {!relay && !webhook.signingSecretSet && !source.poller && <span className="text-warning">· {t("triggers.typed.secretMissing")}</span>}
            {source.poller && webhook.pollerCredentialsSet === false && <span className="text-warning">· {t("triggers.poller.secretMissing")}</span>}
            {automation && (
              <span data-typed-automation={webhook.automation?.state} className={automation.tone === "error" ? "text-danger" : automation.tone === "ok" ? "text-success" : "text-ink-secondary"}>
                · {automation.text}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={testFire}
          className="flex items-center gap-1.5 rounded-lg bg-control/70 px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40"
        >
          {working === "test" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          {t("triggers.typed.testFire")}
        </button>
        <Switch
          checked={webhook.enabled}
          disabled={disabled || waitingForTest}
          title={waitingForTest ? t("triggers.waitingTest") : undefined}
          aria-label={t("triggers.toggleAria", { name: webhook.name })}
          onClick={onToggle}
        />
      </div>
      {(notice || error) && (
        <div role={error ? "alert" : "status"} className={cn("mx-4 mb-3 rounded-xl px-3 py-2 text-[11.5px]", error ? "border border-danger/30 bg-danger/10 text-danger" : "bg-success/10 text-ink")}>
          {error || notice}
        </div>
      )}
      <details className="group/advanced px-3.5 pb-2.5" open={Boolean(setup)}>
        <summary className="cursor-pointer text-[12px] font-medium text-ink-secondary hover:text-ink">{t("triggers.advanced")}</summary>
        <div className="mt-3 space-y-3 pb-2 text-[11.5px] leading-relaxed text-ink-secondary">
          {relay ? (
            <section data-typed-setup className="space-y-2 rounded-xl border border-accent-border/30 bg-inset/60 px-3 py-2.5">
              <p>{t("triggers.setup.botmail")}</p>
              <BotMailAddressLine mail={mail} />
            </section>
          ) : <>
          <section data-typed-setup className="rounded-xl border border-accent-border/30 bg-inset/60 px-3 py-2.5">
            <div className="mb-1.5 font-medium text-ink">{t("triggers.typed.setupTitle", { provider: definition.label })}</div>
            <p>{source.graph ? t("triggers.setup.graphAuto", { connector: source.graph.connector }) : source.poller ? t("triggers.setup.pollerAuto") : t(`triggers.setup.${source.type}` as LocaleKey)}</p>
            <div className="mt-2 text-[11px]">{t("triggers.typed.endpoint", { provider: definition.label })}</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-inset px-2 py-1 font-mono text-[10.5px] text-ink">{url}</code>
              <button type="button" onClick={() => copy("url", url)} className="flex shrink-0 items-center gap-1 rounded-lg border border-hairline/50 px-2 py-1 text-[11px] font-medium text-ink hover:bg-raised">
                {copied === "url" ? <Check size={12} className="text-success" /> : <Copy size={12} />}{t(copied === "url" ? "triggers.copied" : "triggers.typed.copyUrl")}
              </button>
            </div>
            {setup?.secret && (
              <>
                <div className="mt-2 text-[11px]">{t("triggers.typed.secretOnce")}</div>
                <div className="mt-1 flex items-center gap-2">
                  <code data-typed-secret-once className="min-w-0 flex-1 truncate rounded-lg bg-inset px-2 py-1 font-mono text-[10.5px] text-ink">{setup.secret}</code>
                  <button type="button" onClick={() => copy("secret", setup.secret!)} className="flex shrink-0 items-center gap-1 rounded-lg border border-hairline/50 px-2 py-1 text-[11px] font-medium text-ink hover:bg-raised">
                    {copied === "secret" ? <Check size={12} className="text-success" /> : <Copy size={12} />}{t(copied === "secret" ? "triggers.copied" : "triggers.typed.copySecret")}
                  </button>
                </div>
                <p className="mt-1 text-warning">{t("triggers.tokenOnce")}</p>
              </>
            )}
          </section>

          <section>
            {webhook.signingSecretSet ? <p className="flex items-center gap-1.5"><ShieldCheck size={12} className="text-success" />{t("triggers.typed.secretSet")}</p> : <p className="text-warning">{t("triggers.typed.secretMissing")}</p>}
            {definition.secretMode === "provided" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  aria-label={webhook.signingSecretSet ? t("triggers.typed.secretReplace") : t("triggers.typed.secretProvided", { provider: definition.label })}
                  placeholder={webhook.signingSecretSet ? t("triggers.typed.secretReplace") : t("triggers.typed.secretProvided", { provider: definition.label })}
                  className={cn(inputClass, "max-w-[320px] flex-1")}
                  maxLength={512}
                />
                <button type="button" disabled={disabled || secret.trim().length < 8} onClick={saveSecret} className="flex items-center gap-1.5 rounded-lg border border-hairline/50 px-3 py-1.5 text-[11.5px] font-medium text-ink hover:bg-raised disabled:opacity-40">
                  {working === "secret" ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}{t("triggers.typed.secretSave")}
                </button>
              </div>
            ) : (
              <button type="button" disabled={disabled} onClick={rotate} className="mt-2 flex items-center gap-1.5 rounded-lg border border-hairline/50 px-3 py-1.5 text-[11.5px] font-medium text-ink hover:bg-raised disabled:opacity-40">
                <RotateCw size={12} />{t("triggers.typed.rotate")}
              </button>
            )}
          </section>
          </>}

          <p>
            <span className="font-medium text-ink">{t("triggers.typed.events")}:</span>{" "}
            {source.events.length ? source.events.map(typedEventLabel).join(", ") : t("triggers.typed.allEvents")}
            {" · "}
            <span className="font-medium text-ink">{t("triggers.typed.filters")}:</span> {filterSummary || t("triggers.typed.noFilters")}
          </p>
          <TypedSourceFields type={source.type} draft={draft} onChange={setDraft} creating={false} pollerSecretSet={webhook.pollerCredentialsSet} />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={disabled} onClick={saveFilters} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-40">
              {working === "filters" && <Loader2 size={12} className="animate-spin" />}{t("triggers.typed.saveFilters")}
            </button>
            <button type="button" disabled={disabled} onClick={onEdit} className="flex items-center gap-1.5 rounded-lg border border-hairline/50 px-3 py-1.5 text-[11.5px] font-medium text-ink hover:bg-raised disabled:opacity-40">
              <Pencil size={12} />{t("triggers.editSettings")}
            </button>
            <button type="button" disabled={disabled} onClick={onDelete} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-danger hover:bg-danger/10 disabled:opacity-40">
              <Trash2 size={12} />{t("common.delete")}
            </button>
          </div>
          <div>
            <div className="mb-1 font-medium text-ink">{t("triggers.typed.recentEvents")}</div>
            {activity.length === 0 ? (
              <p>{t("triggers.typed.noEvents")}</p>
            ) : (
              <ul className="divide-y divide-hairline/25">
                {activity.slice(0, 10).map((item) => (
                  <li key={item.id} data-typed-event-log={item.outcome} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-ink">{definition.events.includes(item.eventName) ? typedEventLabel(item.eventName) : item.eventName}</span>
                        <span className="shrink-0">· {relativeTime(item.at)}</span>
                      </div>
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
