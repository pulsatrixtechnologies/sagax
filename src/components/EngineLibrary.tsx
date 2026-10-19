import { useState, type ReactNode } from "react";
import { ArrowUpRight, Check, ChevronDown, RefreshCw } from "lucide-react";
import { useStore, type InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { InstanceProviderMark } from "./ProviderIcons";

export function engineReady(instance: InstanceInfo): boolean {
  if (instance.driverKind === "clineAgent") {
    return instance.snapshot.state === "available" && instance.snapshot.authenticated === true;
  }
  return instance.snapshot.state === "available" &&
    (instance.access === "custom" || instance.snapshot.authenticated !== false);
}

const providers: Record<string, string> = {
  claudeAgent: "Anthropic", codex: "OpenAI", grok: "xAI", grokAgent: "xAI",
  kimiAgent: "Moonshot AI", droidAgent: "Factory", cursorAgent: "Cursor",
  antigravityAgent: "Google", opencodeGo: "OpenCode", qwenAgent: "Qwen",
  hermesAgent: "Nous Research", clineAgent: "Cline", piAgent: "pi.dev", mistral: "Mistral AI", cerebras: "Cerebras", groq: "Groq", meta: "Meta", museCode: "Meta",
};

/** One disclosure, not a second settings dialog. Keep its children mounted so
 * closing a card does not abandon an in-progress sign-in or a CLI path draft. */
export function EngineCard({ instance, personal, children }: {
  instance: InstanceInfo;
  /** On an organization server: the signed-in person's own access (who
   * pays for their turns) instead of the server's account and readiness. */
  personal?: { ready: boolean; line: string; turns: string };
  children: ReactNode;
}) {
  const ready = personal ? personal.ready : engineReady(instance);
  const email = !personal && instance.snapshot.authenticated === true ? instance.snapshot.account?.email : undefined;
  const subtitle = personal?.line ?? email ?? (instance.access === "custom"
    ? t("engines.library.custom")
    : providers[instance.driverKind] ?? instance.driverKind);
  // Some CLIs return their executable name rather than a version. Do not show
  // duplicated labels such as “Grok · grok”; retain the raw value in details.
  const version = instance.snapshot.version?.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?/)?.[0];
  // 0.5.6 (JC): a compact row of the Engines group, as Grok Bot's settings
  // rows: the mark, the name and one grey line at the left, the version or
  // what is missing at the right; the row opens in place.
  return (
    <details data-engine-card={instance.instanceId} className="group/engine min-w-0">
      <summary className="mx-1.5 flex min-h-[44px] cursor-pointer list-none items-center gap-3 rounded-lg px-2 py-1.5 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-border bg-panel">
          <InstanceProviderMark instance={instance} size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-[18px] text-ink" title={instance.displayName}>{instance.displayName}</span>
          <span className="block truncate text-[12px] leading-4 text-ink-secondary" title={subtitle} data-my-turns={personal?.turns}>{subtitle}</span>
        </span>
        {ready ? (
          <span className="flex shrink-0 items-center gap-1 text-[12px] tabular-nums text-ink-secondary">
            <Check size={12} aria-hidden="true" className="text-accent-text" />
            {version ? `v${version}` : t("onboarding.engines.ready")}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent-text">
            {instance.snapshot.state === "available" && instance.snapshot.authenticated === false ? t("model.signInRequired") : t("engines.library.setup")}
            <ArrowUpRight size={13} aria-hidden="true" />
          </span>
        )}
        <ChevronDown size={13} aria-hidden="true" className="shrink-0 text-ink-secondary transition-transform group-open/engine:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="min-w-0 px-3.5 pb-3 pt-2 sm:pl-[52px]">{children}</div>
    </details>
  );
}

export function EngineSections({ instances, renderEngine, isReady = engineReady }: {
  instances: InstanceInfo[];
  renderEngine: (instance: InstanceInfo) => ReactNode;
  /** Which group a card sits in (the person's own access on an organization server). */
  isReady?: (instance: InstanceInfo) => boolean;
}) {
  // Flat, instance-keyed siblings keep forms and sign-in state alive when a
  // refreshed status moves a card between groups. Separate section parents
  // would remount it and discard unsaved input.
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] items-start gap-3">
    {[true, false].flatMap((ready) => {
      const rows = instances.filter((instance) => isReady(instance) === ready);
      if (!rows.length) return [];
      const label = t(ready ? "onboarding.engines.ready" : "onboarding.engines.needsSetup");
      return [
        <div key={`heading-${ready}`} className={cn("col-span-full flex items-center justify-between gap-3", !ready && instances.some(isReady) && "mt-4")}>
          <h2 className="text-[12px] font-semibold text-ink-secondary">{label}</h2>
          <span className="text-[11px] tabular-nums text-ink-secondary">{t(rows.length === 1 ? "engines.library.countOne" : "engines.library.count", { count: rows.length })}</span>
        </div>,
        ...rows.map((instance) => <div key={instance.instanceId} className="contents">{renderEngine(instance)}</div>),
      ];
    })}
    {instances.length === 0 && <p className="col-span-full py-4 text-[13px] text-ink-secondary">{t("engines.none")}</p>}
  </div>;
}

export function RefreshEngines() {
  const { refreshInstances } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  return <div>
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      setError(null);
      setChecked(false);
      try { await refreshInstances({ reportErrors: true }); setChecked(true); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setBusy(false); }
    }} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] font-medium text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
      <RefreshCw size={13} aria-hidden="true" className={cn(busy && "animate-spin")} />
      {busy ? t("common.checking") : t("engines.library.refresh")}
    </button>
    {error && <p role="alert" className="mt-1 text-[12px] text-danger">{t("engineSetup.checkFailed", { reason: error })}</p>}
    {checked && <p role="status" className="mt-1 text-[11px] text-ink-secondary">{t("engineSetup.checked")}</p>}
  </div>;
}
