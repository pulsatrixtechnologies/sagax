// Connect apps > Tailscale: connect an OAuth client or auth key (sealed),
// choose which bot computer joins, wait for a tailnet admin to approve,
// then show Connected with the device name and tailnet IPs, plus Disconnect.
// Shaped as a plugin's detail page (2026-11-02): back row, icon and name with
// the state under it, then one card; Capabilities' segmented control and the
// shared pill buttons. Sagax words; never Grok Bot copy.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, Network } from "lucide-react";

import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import {
  clearBotTailscale,
  disconnectBotTailscale,
  fetchBotTailscale,
  joinBotTailscale,
  refreshBotTailscale,
  setupBotTailscale,
  shouldPollTailscale,
  type BotTailscaleKeyKind,
  type BotTailscaleView,
} from "@/lib/bot-tailscale";
import { FIELD } from "../SettingsPrimitives";
import type { Crumb } from "../Breadcrumb";
import { PluginCard, PluginIcon, PluginPageHeader } from "./PluginParts";
import { SEGMENT_GROUP, segmentOptionClass } from "./ScopeToggle";

// Sentences wrap inside the column at any width, a long token included.
const prose = "min-w-0 text-[12.5px] leading-relaxed text-ink-secondary [overflow-wrap:anywhere]";
const hint = "text-[11.5px] leading-relaxed text-ink-secondary [overflow-wrap:anywhere]";
const label = "text-[12px] font-medium text-ink";
const primaryButton = "ui-button ui-button-primary font-medium";
const secondaryButton = "ui-button";
const TAILSCALE_ICON = { kind: "featured", name: "Tailscale", logo: null, domain: "tailscale.com" } as const;

export function TailscaleConnectView({ onBack, trail }: { onBack: () => void; trail?: Crumb[] }) {
  const [view, setView] = useState<BotTailscaleView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"authKey" | "oauth">("authKey");
  const [authKey, setAuthKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [computerId, setComputerId] = useState<string>("");
  const [keyKind, setKeyKind] = useState<BotTailscaleKeyKind>("ephemeral");

  const apply = useCallback((next: BotTailscaleView) => {
    setView(next);
    if (!computerId && next.computers[0]) setComputerId(next.computers[0].id);
  }, [computerId]);

  useEffect(() => {
    let cancelled = false;
    void fetchBotTailscale()
      .then((next) => { if (!cancelled) apply(next); })
      .catch((failure) => { if (!cancelled) setLoadError(readableError(failure)); });
    return () => { cancelled = true; };
  }, [apply]);

  useEffect(() => {
    if (!shouldPollTailscale(view)) return;
    const timer = window.setInterval(() => {
      void refreshBotTailscale()
        .then(apply)
        .catch(() => { /* keep showing Waiting */ });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [view?.phase, apply, view]);

  const run = async (work: () => Promise<BotTailscaleView>) => {
    setBusy(true);
    setError(null);
    try {
      apply(await work());
      setAuthKey("");
      setClientSecret("");
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };

  const phase = view?.phase ?? "disconnected";
  const subtitle = phaseSubtitle(phase, view);

  return (
    <>
      <PluginPageHeader title={t("connectApps.tailscale.title")} trail={trail} onBack={onBack} named />
      <div
        className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 pb-7 pt-3 sm:px-8"
        data-plugins-tailscale-page
        data-tailscale-phase={phase}
      >
        <div className="flex min-w-0 items-center gap-3 px-1" data-tailscale-head>
          <PluginIcon item={TAILSCALE_ICON} className="size-12" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink">{t("connectApps.tailscale.title")}</h2>
            <p className={prose} data-tailscale-subtitle>{subtitle}</p>
          </div>
        </div>
        {loadError && <p role="alert" className="text-[12.5px] text-danger [overflow-wrap:anywhere]">{loadError}</p>}
        {!view && !loadError && (
          <p className="flex items-center gap-2 px-1 text-[12.5px] text-ink-secondary">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            {t("connectApps.tailscale.loading")}
          </p>
        )}
        {view && phase === "disconnected" && (
          <SetupCard
            mode={mode}
            setMode={setMode}
            authKey={authKey}
            setAuthKey={setAuthKey}
            clientId={clientId}
            setClientId={setClientId}
            clientSecret={clientSecret}
            setClientSecret={setClientSecret}
            busy={busy}
            onSave={() => run(() => setupBotTailscale(
              mode === "authKey"
                ? { mode: "authKey", authKey }
                : { mode: "oauth", clientId, clientSecret },
            ))}
          />
        )}
        {view && (phase === "ready" || phase === "error") && (
          <JoinCard
            view={view}
            computerId={computerId || view.computers[0]?.id || ""}
            setComputerId={setComputerId}
            keyKind={keyKind}
            setKeyKind={setKeyKind}
            busy={busy}
            onJoin={() => run(() => joinBotTailscale({
              computerId: computerId || view.computers[0]?.id || "",
              keyKind,
            }))}
            onClear={() => run(() => clearBotTailscale())}
          />
        )}
        {view && (phase === "pending_approval" || phase === "joining") && (
          <WaitingCard view={view} busy={busy} onDisconnect={() => run(() => disconnectBotTailscale())} />
        )}
        {view && phase === "connected" && (
          <ConnectedCard view={view} busy={busy} onDisconnect={() => run(() => disconnectBotTailscale())} />
        )}
        {error && <p role="alert" className="px-1 text-[12.5px] text-danger [overflow-wrap:anywhere]">{error}</p>}
        {view?.error && phase === "error" && (
          <p role="alert" className="px-1 text-[12.5px] text-danger [overflow-wrap:anywhere]">{view.error}</p>
        )}
      </div>
    </>
  );
}

function phaseSubtitle(phase: string, view: BotTailscaleView | null): string {
  if (!view) return t("connectApps.tailscale.loading");
  if (phase === "connected" && view.device) {
    const ips = view.device.addresses.join(" · ");
    return ips
      ? t("connectApps.tailscale.connectedSub", { name: view.device.name, ips })
      : t("connectApps.tailscale.connectedName", { name: view.device.name });
  }
  if (phase === "pending_approval" || phase === "joining") return t("connectApps.tailscale.waitingSub");
  if (phase === "ready" && view.credentials) {
    return t("connectApps.tailscale.readySub", {
      kind: view.credentials.kind === "oauth"
        ? t("connectApps.tailscale.kindOAuth")
        : t("connectApps.tailscale.kindAuthKey"),
      hint: view.credentials.hint,
    });
  }
  if (phase === "error") return t("connectApps.tailscale.errorSub");
  return t("connectApps.tailscale.intro");
}

function CardTitle({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {icon}
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </span>
  );
}

/** A primary action that says why it is off (a disabled button gets no hover). */
function ActionButton({ label, onClick, disabled, busy, reason, primary = false, ...data }: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  /** why it is off, in its tooltip (only while off for that reason) */
  reason?: string;
  primary?: boolean;
} & Record<`data-${string}`, string | boolean>) {
  const off = disabled || busy;
  const title = disabled && !busy ? reason : undefined;
  return (
    <span className="inline-flex max-w-full" title={title}>
      <button
        type="button"
        className={primary ? primaryButton : secondaryButton}
        disabled={off}
        aria-busy={busy || undefined}
        aria-description={title}
        onClick={onClick}
        {...data}
      >
        {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
        <span className="truncate">{label}</span>
      </button>
    </span>
  );
}

function Segments<T extends string>({ label, value, options, onChange, data }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
  data: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={SEGMENT_GROUP} {...{ [`data-${data}`]: value }}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={segmentOptionClass(value === option.value)}
          onClick={() => onChange(option.value)}
          {...{ [`data-${data}-option`]: option.value }}
        >
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function SetupCard(props: {
  mode: "authKey" | "oauth";
  setMode: (mode: "authKey" | "oauth") => void;
  authKey: string;
  setAuthKey: (v: string) => void;
  clientId: string;
  setClientId: (v: string) => void;
  clientSecret: string;
  setClientSecret: (v: string) => void;
  busy: boolean;
  onSave: () => void;
}) {
  const canSave = props.mode === "authKey"
    ? props.authKey.trim() !== ""
    : props.clientId.trim() !== "" && props.clientSecret.trim() !== "";
  const reason = props.mode === "authKey"
    ? t("connectApps.tailscale.saveNeedsKey")
    : t("connectApps.tailscale.saveNeedsOAuth");
  return (
    <div data-tailscale-setup>
      <PluginCard title={<CardTitle icon={<Network size={16} aria-hidden className="shrink-0 text-ink" />}>{t("connectApps.tailscale.setupTitle")}</CardTitle>}>
        <p className={`${prose} mb-4`}>{t("connectApps.tailscale.setupHelp")}</p>
        <div className="mb-4">
          <Segments
            label={t("connectApps.tailscale.modeLabel")}
            value={props.mode}
            onChange={props.setMode}
            data="tailscale-mode"
            options={[
              { value: "authKey", label: t("connectApps.tailscale.kindAuthKey") },
              { value: "oauth", label: t("connectApps.tailscale.kindOAuth") },
            ]}
          />
        </div>
        {props.mode === "authKey" ? (
          <label className="mb-4 flex min-w-0 flex-col gap-1.5">
            <span className={label}>{t("connectApps.tailscale.authKeyLabel")}</span>
            <input
              className={FIELD}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={props.authKey}
              onChange={(e) => props.setAuthKey(e.target.value)}
              placeholder={t("connectApps.tailscale.authKeyPlaceholder")}
              data-tailscale-auth-key
            />
            <span className={hint}>{t("connectApps.tailscale.authKeyHelp")}</span>
          </label>
        ) : (
          <div className="mb-4 flex min-w-0 flex-col gap-3">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={label}>{t("connectApps.tailscale.clientIdLabel")}</span>
              <input
                className={FIELD}
                value={props.clientId}
                onChange={(e) => props.setClientId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                data-tailscale-client-id
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={label}>{t("connectApps.tailscale.clientSecretLabel")}</span>
              <input
                className={FIELD}
                type="password"
                value={props.clientSecret}
                onChange={(e) => props.setClientSecret(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                data-tailscale-client-secret
              />
              <span className={hint}>{t("connectApps.tailscale.oauthHelp")}</span>
            </label>
          </div>
        )}
        <ActionButton
          primary
          label={t("connectApps.tailscale.save")}
          disabled={!canSave}
          busy={props.busy}
          reason={reason}
          onClick={props.onSave}
          data-tailscale-save
        />
      </PluginCard>
    </div>
  );
}

function JoinCard(props: {
  view: BotTailscaleView;
  computerId: string;
  setComputerId: (id: string) => void;
  keyKind: BotTailscaleKeyKind;
  setKeyKind: (k: BotTailscaleKeyKind) => void;
  busy: boolean;
  onJoin: () => void;
  onClear: () => void;
}) {
  return (
    <div data-tailscale-join>
      <PluginCard title={<CardTitle>{t("connectApps.tailscale.joinTitle")}</CardTitle>}>
        <p className={`${prose} mb-4`}>{t("connectApps.tailscale.joinHelp")}</p>
        <label className="mb-4 flex min-w-0 flex-col gap-1.5">
          <span className={label}>{t("connectApps.tailscale.computerLabel")}</span>
          <select
            className={FIELD}
            value={props.computerId}
            onChange={(e) => props.setComputerId(e.target.value)}
            data-tailscale-computer
          >
            {props.view.computers.map((computer) => (
              <option key={computer.id} value={computer.id}>{computer.label}</option>
            ))}
          </select>
        </label>
        <div className="mb-4">
          <Segments
            label={t("connectApps.tailscale.keyKindLabel")}
            value={props.keyKind}
            onChange={props.setKeyKind}
            data="tailscale-key-kind"
            options={[
              { value: "ephemeral", label: t("connectApps.tailscale.keyEphemeral") },
              { value: "reusable", label: t("connectApps.tailscale.keyReusable") },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            primary
            label={t("connectApps.tailscale.join")}
            disabled={!props.computerId}
            busy={props.busy}
            reason={t("connectApps.tailscale.joinNeedsComputer")}
            onClick={props.onJoin}
            data-tailscale-join-btn
          />
          <ActionButton
            label={t("connectApps.tailscale.forget")}
            disabled={false}
            busy={props.busy}
            onClick={props.onClear}
            data-tailscale-forget
          />
        </div>
      </PluginCard>
    </div>
  );
}

function WaitingCard({ view, busy, onDisconnect }: {
  view: BotTailscaleView;
  busy: boolean;
  onDisconnect: () => void;
}) {
  return (
    <div data-tailscale-waiting>
      <PluginCard title={<CardTitle icon={<Loader2 size={16} className="shrink-0 animate-spin text-accent" aria-hidden />}>{t("connectApps.tailscale.waitingTitle")}</CardTitle>}>
        <p className={`${prose} mb-3`}>{t("connectApps.tailscale.waitingHelp")}</p>
        {view.device && (
          <p className="mb-4 text-[12.5px] text-ink [overflow-wrap:anywhere]">
            {t("connectApps.tailscale.waitingDevice", { name: view.device.name })}
          </p>
        )}
        <ActionButton
          label={t("connectApps.tailscale.disconnect")}
          disabled={false}
          busy={busy}
          onClick={onDisconnect}
          data-tailscale-disconnect
        />
      </PluginCard>
    </div>
  );
}

function ConnectedCard({ view, busy, onDisconnect }: {
  view: BotTailscaleView;
  busy: boolean;
  onDisconnect: () => void;
}) {
  const device = view.device!;
  const row = "flex min-w-0 justify-between gap-3";
  const value = "min-w-0 text-right font-medium text-ink [overflow-wrap:anywhere]";
  return (
    <div data-tailscale-connected>
      <PluginCard title={<CardTitle icon={<span className="inline-block size-2 shrink-0 rounded-full bg-success" aria-hidden />}>{t("connectApps.tailscale.connectedTitle")}</CardTitle>}>
        <dl className="mb-4 mt-3 space-y-2 text-[12.5px]">
          <div className={row}>
            <dt className="shrink-0 text-ink-secondary">{t("connectApps.tailscale.deviceName")}</dt>
            <dd className={value} data-tailscale-device-name>{device.name}</dd>
          </div>
          <div className={row}>
            <dt className="shrink-0 text-ink-secondary">{t("connectApps.tailscale.deviceIps")}</dt>
            <dd className={value} data-tailscale-device-ips>
              {device.addresses.length ? device.addresses.join(", ") : t("connectApps.tailscale.noIps")}
            </dd>
          </div>
          {view.computer && (
            <div className={row}>
              <dt className="shrink-0 text-ink-secondary">{t("connectApps.tailscale.computerLabel")}</dt>
              <dd className={value}>{view.computer.label}</dd>
            </div>
          )}
        </dl>
        <ActionButton
          label={t("connectApps.tailscale.disconnect")}
          disabled={false}
          busy={busy}
          onClick={onDisconnect}
          data-tailscale-disconnect
        />
      </PluginCard>
    </div>
  );
}
