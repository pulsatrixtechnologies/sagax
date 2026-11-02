// Connect apps > Tailscale: connect an OAuth client or auth key (sealed),
// choose which bot computer joins, wait for a tailnet admin to approve,
// then show Connected with the device name and tailnet IPs, plus Disconnect.
// Sagax words and layout; never Grok Bot copy.
import { useCallback, useEffect, useState } from "react";
import { Loader2, Network } from "lucide-react";

import { cn } from "@/lib/cn";
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
import { PluginPageHeader } from "./PluginParts";

const fieldClass =
  "w-full min-w-0 rounded-lg border border-border bg-raised px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent";
const pillClass =
  "inline-flex items-center justify-center rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-50";

export function TailscaleConnectView({ onBack }: { onBack: () => void }) {
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
      <PluginPageHeader title={t("connectApps.tailscale.title")} onBack={onBack} />
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-7 pt-3 sm:px-8"
        data-plugins-tailscale-page
        data-tailscale-phase={phase}
      >
        <p className="text-[12.5px] leading-relaxed text-ink-secondary">{subtitle}</p>
        {loadError && <p role="alert" className="text-[12.5px] text-danger">{loadError}</p>}
        {!view && !loadError && (
          <p className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
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
        {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
        {view?.error && phase === "error" && (
          <p role="alert" className="text-[12.5px] text-danger">{view.error}</p>
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
    ? props.authKey.trim().length > 12
    : props.clientId.trim() !== "" && props.clientSecret.trim() !== "";
  return (
    <section className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-5" data-tailscale-setup>
      <div className="mb-1 flex items-center gap-2">
        <Network size={16} aria-hidden className="text-ink" />
        <h3 className="text-[13px] font-semibold text-ink">{t("connectApps.tailscale.setupTitle")}</h3>
      </div>
      <p className="mb-4 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.tailscale.setupHelp")}</p>
      <div className="mb-3 flex gap-2" role="tablist" aria-label={t("connectApps.tailscale.modeLabel")}>
        <ModePill active={props.mode === "authKey"} onClick={() => props.setMode("authKey")} label={t("connectApps.tailscale.kindAuthKey")} />
        <ModePill active={props.mode === "oauth"} onClick={() => props.setMode("oauth")} label={t("connectApps.tailscale.kindOAuth")} />
      </div>
      {props.mode === "authKey" ? (
        <label className="mb-3 flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">{t("connectApps.tailscale.authKeyLabel")}</span>
          <input
            className={fieldClass}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={props.authKey}
            onChange={(e) => props.setAuthKey(e.target.value)}
            placeholder={t("connectApps.tailscale.authKeyPlaceholder")}
            data-tailscale-auth-key
          />
          <span className="text-[11.5px] text-ink-secondary">{t("connectApps.tailscale.authKeyHelp")}</span>
        </label>
      ) : (
        <div className="mb-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink">{t("connectApps.tailscale.clientIdLabel")}</span>
            <input
              className={fieldClass}
              value={props.clientId}
              onChange={(e) => props.setClientId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              data-tailscale-client-id
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink">{t("connectApps.tailscale.clientSecretLabel")}</span>
            <input
              className={fieldClass}
              type="password"
              value={props.clientSecret}
              onChange={(e) => props.setClientSecret(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              data-tailscale-client-secret
            />
            <span className="text-[11.5px] text-ink-secondary">{t("connectApps.tailscale.oauthHelp")}</span>
          </label>
        </div>
      )}
      <button
        type="button"
        className={cn(pillClass, "bg-accent text-accent-fg")}
        disabled={props.busy || !canSave}
        onClick={props.onSave}
        data-tailscale-save
      >
        {props.busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : t("connectApps.tailscale.save")}
      </button>
    </section>
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
    <section className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-5" data-tailscale-join>
      <h3 className="mb-1 text-[13px] font-semibold text-ink">{t("connectApps.tailscale.joinTitle")}</h3>
      <p className="mb-4 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.tailscale.joinHelp")}</p>
      <label className="mb-3 flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">{t("connectApps.tailscale.computerLabel")}</span>
        <select
          className={fieldClass}
          value={props.computerId}
          onChange={(e) => props.setComputerId(e.target.value)}
          data-tailscale-computer
        >
          {props.view.computers.map((computer) => (
            <option key={computer.id} value={computer.id}>{computer.label}</option>
          ))}
        </select>
      </label>
      <div className="mb-4 flex gap-2" role="group" aria-label={t("connectApps.tailscale.keyKindLabel")}>
        <ModePill
          active={props.keyKind === "ephemeral"}
          onClick={() => props.setKeyKind("ephemeral")}
          label={t("connectApps.tailscale.keyEphemeral")}
        />
        <ModePill
          active={props.keyKind === "reusable"}
          onClick={() => props.setKeyKind("reusable")}
          label={t("connectApps.tailscale.keyReusable")}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(pillClass, "bg-accent text-accent-fg")}
          disabled={props.busy || !props.computerId}
          onClick={props.onJoin}
          data-tailscale-join-btn
        >
          {props.busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : t("connectApps.tailscale.join")}
        </button>
        <button
          type="button"
          className={cn(pillClass, "bg-raised text-ink")}
          disabled={props.busy}
          onClick={props.onClear}
          data-tailscale-forget
        >
          {t("connectApps.tailscale.forget")}
        </button>
      </div>
    </section>
  );
}

function WaitingCard({ view, busy, onDisconnect }: {
  view: BotTailscaleView;
  busy: boolean;
  onDisconnect: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-5" data-tailscale-waiting>
      <div className="mb-2 flex items-center gap-2">
        <Loader2 size={16} className="animate-spin text-accent" aria-hidden />
        <h3 className="text-[13px] font-semibold text-ink">{t("connectApps.tailscale.waitingTitle")}</h3>
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.tailscale.waitingHelp")}</p>
      {view.device && (
        <p className="mb-4 text-[12.5px] text-ink">
          {t("connectApps.tailscale.waitingDevice", { name: view.device.name })}
        </p>
      )}
      <button
        type="button"
        className={cn(pillClass, "bg-raised text-ink")}
        disabled={busy}
        onClick={onDisconnect}
        data-tailscale-disconnect
      >
        {t("connectApps.tailscale.disconnect")}
      </button>
    </section>
  );
}

function ConnectedCard({ view, busy, onDisconnect }: {
  view: BotTailscaleView;
  busy: boolean;
  onDisconnect: () => void;
}) {
  const device = view.device!;
  return (
    <section className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-5" data-tailscale-connected>
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-block size-2 rounded-full bg-success" aria-hidden />
        <h3 className="text-[13px] font-semibold text-ink">{t("connectApps.tailscale.connectedTitle")}</h3>
      </div>
      <dl className="mb-4 mt-3 space-y-2 text-[12.5px]">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-secondary">{t("connectApps.tailscale.deviceName")}</dt>
          <dd className="font-medium text-ink" data-tailscale-device-name>{device.name}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-secondary">{t("connectApps.tailscale.deviceIps")}</dt>
          <dd className="text-right font-medium text-ink" data-tailscale-device-ips>
            {device.addresses.length ? device.addresses.join(", ") : t("connectApps.tailscale.noIps")}
          </dd>
        </div>
        {view.computer && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">{t("connectApps.tailscale.computerLabel")}</dt>
            <dd className="font-medium text-ink">{view.computer.label}</dd>
          </div>
        )}
      </dl>
      <button
        type="button"
        className={cn(pillClass, "bg-raised text-ink")}
        disabled={busy}
        onClick={onDisconnect}
        data-tailscale-disconnect
      >
        {t("connectApps.tailscale.disconnect")}
      </button>
    </section>
  );
}

function ModePill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        pillClass,
        active ? "bg-ink text-canvas" : "bg-raised text-ink-secondary hover:text-ink",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
