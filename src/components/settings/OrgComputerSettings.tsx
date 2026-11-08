// Settings > Computer on an organization server (0.5.6: the reference design's
// Computer page). "Your computer" (its name after the heading): whether
// routines may use it, the network its bots reach through it, the person's
// other computers, and the recent activity behind a link (#555). Local
// models stay a folded card of their own (#555). "Bots' computer": the
// person's server environment (state and resources, its screen shown here
// in the app, never in a browser window, and Reset as a red pill with a
// confirmation) and the Local VM on their own computer (found through their
// desktop app: which runtime, its state, "Set up in one click" with visible
// steps, install offers). One short grey line under each label.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Circle, Loader2, X } from "lucide-react";

import { confirmAsync, type ConfirmRequest } from "@/components/ConfirmProvider";
import { cn } from "@/lib/cn";
import { currentDesktop, type DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { installChoices, localVmAutoSetup, localVmProblemKey, localVmReady, localVmView, runtimeSummaryKey, type DesktopLocalVmStatus, type SetupStep } from "@/lib/desktop-local-vm";
import { t } from "@/lib/i18n";
import { loadServerEnvironment, resetServerEnvironment, type ServerEnvironmentStatus } from "@/lib/server-environment";

type LooseConfirm = (request: ConfirmRequest | string) => Promise<boolean> | boolean;

const defaultConfirm: LooseConfirm = (request) =>
  confirmAsync(typeof request === "string" ? { title: request, confirmLabel: t("common.confirm"), tone: "danger" } : request);
import { ServerComputerScreen, useDesktopLocalVm } from "../computer/OrgComputerTab";
import { screenStateLabel } from "../computer/ComputerScreen";
import { DANGER_PILL, DescribedRow, HelpTip, SettingsGroup } from "../SettingsPrimitives";
import { BotWorkplaceSettings } from "./BotWorkplaceSettings";
import { ComputerMacControlRow } from "./ComputerMacControlRow";
import { ServerModeComputerAccess } from "../ServerModeSettings";
import { serverEnvironmentStateText } from "./MyServerEnvironment";

export function OrgComputerSettings({ bridge, initialLocal = null, initialServer = null, confirm = defaultConfirm, localVmAllowed = true, botsExtra }: {
  bridge: DesktopBridgeStatus;
  /** False when the organization's policy turned the Local VM off: no
   * automatic setup then. */
  localVmAllowed?: boolean;
  initialLocal?: DesktopLocalVmStatus | null;
  initialServer?: ServerEnvironmentStatus | null;
  confirm?: LooseConfirm;
  /** Cloud / VPS cards that belong in Bots' computer (#2080 L3). */
  botsExtra?: ReactNode;
}) {
  const desktop = currentDesktop(bridge);
  return (
    <>
      <SettingsGroup
        title={t("computer.group.yours")}
        groupId="yourComputer"
        accessory={(
          <>
            {desktop && <span className="min-w-0 truncate text-[13px] leading-[18px] text-ink" data-computer-name="">{desktop.name}</span>}
            <HelpTip label={t("botWorkplace.title")}>{t("botWorkplace.help")}</HelpTip>
          </>
        )}
      >
        <BotWorkplaceSettings status={bridge} />
        <ServerModeComputerAccess />
        <ComputerMacControlRow />
      </SettingsGroup>
      <SettingsGroup title={t("computer.group.bots")} groupId="botsComputer">
        <ServerEnvironmentCard initial={initialServer} confirm={confirm} withReset={false} />
        <LocalVmCard bridge={bridge} initial={initialLocal} confirm={confirm} allowed={localVmAllowed} />
        {botsExtra}
      </SettingsGroup>
    </>
  );
}

function pillClass(primary = false): string {
  return primary ? "ui-button ui-button-primary font-medium disabled:opacity-50" : "ui-button disabled:opacity-50";
}

/** The Local VM on the person's own computer: one row (state and runtime,
 * the setup or repair pill, Recheck), with what it needs below it. Opening
 * it checks, then runs the one-click setup by itself once when a check is
 * not ready and needs nothing from the person (localVmAutoSetup); the pill
 * goes away once every check is ready and comes back with the real error. */
export function LocalVmCard({ bridge, initial, confirm, allowed = true }: { bridge: DesktopBridgeStatus; initial: DesktopLocalVmStatus | null; confirm: LooseConfirm; allowed?: boolean }) {
  const desktop = currentDesktop(bridge);
  const connected = Boolean(desktop?.capabilities?.localVm);
  const vm = useDesktopLocalVm(connected, initial);
  const view = localVmView(vm.status, connected, vm.pending);
  const runtime = runtimeSummaryKey(vm.status?.runtime);
  const setup = vm.status?.setup;
  // One automatic attempt per opening of this row, never a loop.
  const autoTried = useRef(false);
  const auto = localVmAutoSetup(vm.status, connected, vm.pending, allowed);
  useEffect(() => {
    if (!auto || autoTried.current) return;
    autoTried.current = true;
    void vm.act("setup");
  }, [auto, vm.act]);
  const ready = localVmReady(vm.status, connected, vm.pending);
  const oneClick = async () => {
    if (!(await confirm({
      title: t("localVm.consent.oneClick", { folder: vm.status?.workspace ?? "" }),
      confirmLabel: t("common.confirm"),
      tone: "neutral",
    }))) return;
    void vm.act("setup");
  };
  const description = !connected
    ? <span role="status">{t("localVm.problem.not_connected")}</span>
    : (
      <span className="inline-flex flex-wrap items-center gap-x-1.5">
        <StateDot tone={view.state === "running" ? "ok" : view.state === "error" ? "bad" : "idle"} />
        <span>{screenStateLabel(view.state)}</span>
        {vm.status && <span data-runtime-product={vm.status.runtime.product ?? ""}>· {t(runtime.key, { product: runtime.product })}</span>}
      </span>
    );
  return (
    <div data-settings-card="computer.orgLocalVm" data-org-local-vm={view.state} data-local-vm-problem={view.problem ?? ""}>
      <DescribedRow
        label={t("localVm.title")}
        description={description}
        rowId="localVm"
        below={connected && (
          <div className="mt-2 flex flex-col gap-2 text-[13px] empty:hidden">
            {view.problem && view.problem !== "not_connected" && (
              <p className="text-[12px] leading-relaxed text-ink-secondary">{t(localVmProblemKey(view.problem), { product: runtime.product, folder: vm.status?.vm?.folder ?? "" })}</p>
            )}
            {view.problem === "no_runtime" && (
              <div className="flex flex-col gap-1.5 rounded-lg bg-inset p-3" data-install-offers>
                <span className="text-[12px] text-ink-secondary">{t(desktop?.platform === "win32" ? "localVm.install.helpWindows" : "localVm.install.help")}</span>
                <div className="flex flex-wrap gap-2">
                  {installChoices(desktop?.platform).map((choice) => (
                    <button key={choice} type="button" onClick={() => void vm.act("install", { choice })} disabled={vm.pending !== null}
                      className="ui-button min-h-[44px] disabled:opacity-50 md:min-h-0">
                      {t(`localVm.install.${choice}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {setup && <SetupSteps steps={setup.steps} />}
            {setup?.state === "error" && setup.error && <p role="alert" className="text-[12px] text-danger">{setup.error}</p>}
            {setup?.state === "done" && setup.previousFolder && <p className="text-[12px] text-ink-secondary">{t("localVm.previousFolder", { folder: setup.previousFolder })}</p>}
            {vm.error && <p role="alert" className="text-[12px] text-danger">{vm.error}</p>}
          </div>
        )}
      >
        {connected && (
          <>
            <button type="button" onClick={() => void vm.refresh()} disabled={vm.pending !== null} className={cn(pillClass(), "min-h-[44px] md:min-h-0")}>
              {t("vm.main.recheck")}
            </button>
            {!ready && (
              <button type="button" onClick={() => void oneClick()} disabled={vm.pending !== null || setup?.state === "running" || view.problem === "foreign"}
                data-local-vm-setup="" className={cn(pillClass(true), "min-h-[44px] gap-1.5 md:min-h-0")}>
                {setup?.state === "running" && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}
                {setup?.state === "error" ? t("localVm.retry") : view.repair ? t("localVm.repair") : t("localVm.setupOneClick")}
              </button>
            )}
          </>
        )}
      </DescribedRow>
    </div>
  );
}

export function SetupSteps({ steps }: { steps: SetupStep[] }) {
  return (
    <ol className="flex flex-col gap-1 text-[12px]" aria-label={t("localVm.steps")}>
      {steps.map((step) => (
        <li key={step.id} data-step={step.id} data-step-state={step.state} className={cn("flex items-center gap-2", step.state === "error" ? "text-danger" : step.state === "pending" ? "text-ink-secondary" : "text-ink")}>
          {step.state === "done" ? <Check size={12} aria-hidden="true" className="text-success" />
            : step.state === "running" ? <Loader2 size={12} aria-hidden="true" className="animate-spin" />
            : step.state === "error" ? <X size={12} aria-hidden="true" />
            : <Circle size={9} aria-hidden="true" />}
          <span>{t(`localVm.step.${step.id}`)}{step.detail && step.state !== "error" ? ` · ${step.detail}` : ""}</span>
        </li>
      ))}
    </ol>
  );
}

function StateDot({ tone }: { tone: "ok" | "bad" | "idle" }) {
  return <span aria-hidden="true" className={cn("inline-block size-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-success" : tone === "bad" ? "bg-danger" : "bg-ink-secondary/60")} />;
}

/** The person's server environment, as two rows of "Bots' computer":
 * its state and resources with its screen on demand, then Reset (a red
 * pill, after a confirmation), as the reference design's Update and Reset rows. */
export function ServerEnvironmentCard({ initial = null, confirm = defaultConfirm, withReset = true, resetOnly = false }: { initial?: ServerEnvironmentStatus | null; confirm?: LooseConfirm; withReset?: boolean; resetOnly?: boolean }) {
  const [status, setStatus] = useState<ServerEnvironmentStatus | null>(initial);
  const [showScreen, setShowScreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    try { setStatus(await loadServerEnvironment()); } catch { setStatus({ configured: true, state: "unavailable" }); }
  };
  useEffect(() => { if (!initial) void load(); }, []);
  const reset = async () => {
    if (!(await confirm({
      title: t("serverEnvironment.reset.confirm"),
      confirmLabel: t("serverEnvironment.reset"),
      tone: "danger",
    }))) return;
    setBusy(true);
    setError("");
    try { setStatus(await resetServerEnvironment()); } catch { setError(t("serverEnvironment.reset.error")); await load(); } finally { setBusy(false); }
  };
  const limits = status?.limits;
  const usable = Boolean(status?.configured) && !status?.pendingDeletionAt && status?.state !== "unavailable";
  const state = serverEnvironmentStateText(status);
  if (resetOnly) {
    if (!status?.configured) return null;
    return (
      <div data-settings-card="developer.serverEnvironmentReset">
        <SettingsGroup title={t("serverEnvironment.sectionTitle")} groupId="developerServerEnvironment">
      {status?.configured && (
        <DescribedRow
          label={t("serverEnvironment.resetTitle")}
          description={t("serverEnvironment.resetHint")}
          rowId="serverEnvironmentReset"
          below={error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
        >
          <button type="button" disabled={busy || !usable} onClick={() => void reset()} data-server-environment-reset="" className={cn(DANGER_PILL, "min-h-[44px] md:min-h-0")}>
            {busy && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}
            {t("serverEnvironment.reset")}
          </button>
        </DescribedRow>
      )}
        </SettingsGroup>
      </div>
    );
  }
  return (
    <div data-settings-card="computer.orgServerEnvironment" data-server-environment={status?.state ?? (status ? "off" : "loading")}>
      <DescribedRow
        label={t("serverEnvironment.sectionTitle")}
        rowId="serverEnvironment"
        description={!status
          ? <Loader2 size={12} aria-hidden="true" className="animate-spin" />
          : !status.configured
            ? <span role="status">{t("serverEnvironment.notConfigured")}</span>
            : (
              <span className="inline-flex flex-wrap items-center gap-x-1.5">
                <StateDot tone={status.state === "running" ? "ok" : status.state === "unavailable" ? "bad" : "idle"} />
                <span>{state}</span>
                {limits && <span>· {t("serverEnvironment.resourcesValue", { cpus: limits.cpus, memory: limits.memoryMb, disk: limits.diskMb })}</span>}
              </span>
            )}
        below={showScreen && <div className="mt-3"><ServerComputerScreen caption={t("serverEnvironment.sectionTitle")} /></div>}
      >
        {status?.configured && (
          <button type="button" disabled={!usable} onClick={() => setShowScreen((open) => !open)} aria-expanded={showScreen}
            className={cn(pillClass(), "min-h-[44px] md:min-h-0")}>
            {t(showScreen ? "serverEnvironment.hideScreen" : "serverEnvironment.showScreen")}
          </button>
        )}
      </DescribedRow>
      {withReset && status?.configured && (
        <DescribedRow
          label={t("serverEnvironment.resetTitle")}
          description={t("serverEnvironment.resetHint")}
          rowId="serverEnvironmentReset"
          below={error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
        >
          <button type="button" disabled={busy || !usable} onClick={() => void reset()} data-server-environment-reset="" className={cn(DANGER_PILL, "min-h-[44px] md:min-h-0")}>
            {busy && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}
            {t("serverEnvironment.reset")}
          </button>
        </DescribedRow>
      )}
    </div>
  );
}
