// One-place setup for the isolated Local VM image and its shared/per-bot policy.
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { waitForLocalVmReady } from "@/lib/local-vm-readiness";
import type { LocaleKey } from "@/locales";
import {
  AlertTriangle,
  Check,
  Circle,
  Cloud,
  ExternalLink,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  Trash2,
} from "lucide-react";
import { Card, CommandLine, DANGER_PILL, DescribedRow, SettingsGroup, cardCount } from "./SettingsPrimitives";
import { SettingsText } from "./SettingsLink";
import { MacLocalControl } from "./MacLocalControl";
import { MessagesSettings } from "./MessagesSettings";
import { cn } from "@/lib/cn";
import { useStore } from "@/state/store";
import { boatComputerEnabled, vpsComputerEnabled } from "@/lib/feature-flags";
import { useDesktopBridgeStatus } from "@/lib/desktop-bridge";
import { canManageComputers } from "@/lib/viewer";
import { OrgComputerSettings } from "./settings/OrgComputerSettings";
import { ComputerCareSettings } from "./settings/ComputerCareSettings";

type Action = "pull" | "run" | "start" | "stop" | "remove" | "recreate";

/** The automatic Local VM care's state, as the desktop app's own server
 * reports it (a mirror of server/local-vm-auto.ts's LocalVmAutoSnapshot). */
export interface LocalVmAutoState {
  phase: "idle" | "checking" | "starting" | "running" | "stopped" | "waiting" | "problem";
  step: "runtime" | "image" | "container" | "start" | null;
  problem: "no_runtime" | "runtime_stopped" | "foreign" | "unsupported" | "image_failed" | "start_failed" | null;
  detail: string | null;
  attempts: number;
  nextRetryAt: number | null;
  stoppedByPerson: boolean;
}

interface Status {
  platform: string;
  runtime: string | null;
  available: string[];
  daemonUp: boolean;
  image: boolean;
  imageMatches: boolean;
  managed: boolean;
  container: "running" | "stopped" | "missing";
  network: "loopback" | "unsafe" | "unknown";
  security: "hardened" | "unsafe" | "unknown";
  persistence: "durable" | "unsafe" | "unknown";
  desktopReady: boolean;
  ready: boolean;
  problem: string | null;
  image_ref: string;
  base_image_ref: string;
  driver_version: string;
  container_name: string;
  workspace_path: string;
  workspace_guest_path: string;
  viewer_url: string;
  idle_timeout_ms: number;
  stop_reason?: "idle" | null;
  mode: "shared" | "per-bot" | "pool";
  /** An organization server: one environment per person, no VM per bot. */
  organization?: boolean;
  max_instances: number;
  /** The automatic care's state (null on an organization or self-hosted
   * server, where nothing starts the Local VM by itself). */
  auto: LocalVmAutoState | null;
  commands: {
    install: string | null;
    runtimeStart: string | null;
    pull: string | null;
    run: string | null;
    start: string | null;
    stop: string | null;
    remove: string | null;
    view: string;
  };
}

export interface LocalVmInventoryInstance {
  botId: string;
  name: string;
  destination: "auto" | "cloud" | "vm" | "local" | "browser" | "off";
  container: "running" | "stopped";
  ready: boolean;
  managed: boolean;
  problem: string | null;
  inUse: boolean;
}

interface LocalVmInventoryPayload {
  instances: LocalVmInventoryInstance[];
  maxInstances: number;
  available: boolean;
  problem: string | null;
}

export interface CloudComputerInventoryInstance {
  boxId: string;
  name: string;
  state: string;
  ownerBotId: string | null;
  ownerName: string | null;
  orphaned: boolean;
  inUse: boolean;
}

export interface CloudComputerInventoryPayload {
  configured: boolean;
  available: boolean;
  problem: string | null;
  instances: CloudComputerInventoryInstance[];
}

type CloudAction = "sleep" | "delete";
type PendingCloudAction = { boxId: string; action: CloudAction } | null;
export type CloudPostActionOverride = "deleted" | "deleting" | "sleeping";
export type CloudPostActionOverrides = Record<string, CloudPostActionOverride>;

const PENDING_CLOUD_DELETE_REFRESH_DELAYS_MS = [1_000, 2_000, 4_000] as const;

function waitForCloudDeleteRefresh(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

export interface VpsComputerInventoryInstance {
  name: string;
  state: "created" | "restarting" | "running" | "removing" | "paused" | "exited" | "dead" | "unknown";
  ownerBotId: string | null;
  ownerName: string | null;
  orphaned: boolean;
  inUse: boolean;
}

interface VpsComputerInventoryPayload {
  configured: boolean;
  available: boolean;
  sshAlias: string | null;
  problem: string | null;
  instances: VpsComputerInventoryInstance[];
}

const destinationLabelKeys: Record<LocalVmInventoryInstance["destination"], LocaleKey> = {
  auto: "vm.dest.auto",
  cloud: "place.cloud",
  vm: "vm.dest.vm",
  local: "vm.dest.local",
  browser: "vm.dest.browser",
  off: "vm.dest.off",
};

/** The badge's colour is decided by the kind, never by the label: a
 * translated label would silently stop matching `=== "Running"`. */
export type ComputerStateKind =
  | "unmanaged"
  | "in-use"
  | "stopped"
  | "running"
  | "attention"
  | "sleeping"
  | "going-to-sleep"
  | "starting"
  | "restarting"
  | "removing"
  | "paused";

const stateLabelKeys: Record<ComputerStateKind, LocaleKey> = {
  unmanaged: "vm.state.notManaged",
  "in-use": "vm.state.inUse",
  stopped: "vm.state.stopped",
  running: "vm.state.running",
  attention: "vm.state.attention",
  sleeping: "vm.state.sleeping",
  "going-to-sleep": "vm.state.goingToSleep",
  starting: "vm.state.starting",
  restarting: "vm.state.restarting",
  removing: "vm.state.removing",
  paused: "vm.state.paused",
};

export function computerStateLabel(kind: ComputerStateKind): string {
  return t(stateLabelKeys[kind]);
}

export function localVmInventoryStateKind(instance: LocalVmInventoryInstance): ComputerStateKind {
  if (!instance.managed) return "unmanaged";
  if (instance.inUse) return "in-use";
  if (instance.container === "stopped") return "stopped";
  if (instance.ready) return "running";
  return "attention";
}

export function localVmInventoryState(instance: LocalVmInventoryInstance): string {
  return computerStateLabel(localVmInventoryStateKind(instance));
}

export function cloudComputerInventoryStateKind(
  instance: CloudComputerInventoryInstance,
): ComputerStateKind {
  if (instance.inUse) return "in-use";
  if (instance.state === "removing") return "removing";
  if (["archived", "stopped"].includes(instance.state)) return "sleeping";
  if (["archiving", "stopping"].includes(instance.state)) return "going-to-sleep";
  if (["idle", "ready", "running"].includes(instance.state)) return "running";
  if (["init", "provisioning", "provisioned", "cloning", "starting"].includes(instance.state)) return "starting";
  return "attention";
}

export function cloudComputerInventoryState(instance: CloudComputerInventoryInstance): string {
  return computerStateLabel(cloudComputerInventoryStateKind(instance));
}

/** Boat's account LIST is eventually consistent. Preserve the result of an
 * action the provider accepted instead of letting an older snapshot make a
 * confirmed deletion reappear, a pending deletion disappear, or a sleeping
 * computer look awake. */
export function reconcileCloudInventorySnapshot(
  incoming: CloudComputerInventoryInstance[],
  previous: CloudComputerInventoryInstance[],
  overrides: CloudPostActionOverrides,
): { instances: CloudComputerInventoryInstance[]; overrides: CloudPostActionOverrides } {
  const nextOverrides = { ...overrides };
  const incomingIds = new Set(incoming.map((instance) => instance.boxId));
  const instances = incoming.flatMap((instance) => {
    const override = overrides[instance.boxId];
    if (override === "deleted") return [];
    if (override === "deleting") return [{ ...instance, state: "removing" }];
    if (override !== "sleeping") return [instance];
    if (["archived", "stopped"].includes(instance.state)) {
      delete nextOverrides[instance.boxId];
      return [instance];
    }
    return [{ ...instance, state: "archived" }];
  });

  // A transitioning Boat can briefly disappear from LIST. Keep the last safe
  // row until LIST returns the terminal sleeping state.
  for (const instance of previous) {
    if (overrides[instance.boxId] !== "sleeping" || incomingIds.has(instance.boxId)) continue;
    instances.push({ ...instance, state: "archived" });
  }
  for (const [boxId, override] of Object.entries(overrides)) {
    if ((override === "deleted" || override === "deleting") && !incomingIds.has(boxId)) {
      delete nextOverrides[boxId];
    }
  }
  return { instances, overrides: nextOverrides };
}

/** An empty list proves deletion only when Boat says the inventory read was
 * authoritative. Provider outages and disconnected accounts must not erase
 * the last known row or settle a pending deletion as successful. */
export function reconcileCloudInventoryPayload(
  payload: CloudComputerInventoryPayload,
  previous: CloudComputerInventoryInstance[],
  overrides: CloudPostActionOverrides,
): { instances: CloudComputerInventoryInstance[]; overrides: CloudPostActionOverrides } {
  if (payload.configured !== true || payload.available !== true) {
    return { instances: previous, overrides: { ...overrides } };
  }
  return reconcileCloudInventorySnapshot(
    Array.isArray(payload.instances) ? payload.instances : [],
    previous,
    overrides,
  );
}

function cloudComputerCanSleep(instance: CloudComputerInventoryInstance): boolean {
  return ["idle", "ready", "running"].includes(instance.state);
}

export function vpsComputerInventoryStateKind(
  instance: VpsComputerInventoryInstance,
): ComputerStateKind {
  if (instance.inUse) return "in-use";
  if (instance.state === "running") return "running";
  if (instance.state === "restarting") return "restarting";
  if (instance.state === "removing") return "removing";
  if (["created", "exited"].includes(instance.state)) return "stopped";
  if (instance.state === "paused") return "paused";
  return "attention";
}

export function vpsComputerInventoryState(instance: VpsComputerInventoryInstance): string {
  return computerStateLabel(vpsComputerInventoryStateKind(instance));
}

export function vpsComputerShortId(name: string): string {
  const suffix = /-([a-f0-9]{12})$/i.exec(name)?.[1];
  return suffix ? suffix.slice(-8).toLowerCase() : "unknown";
}

type ComputerInventoryRequest = "status" | "local-vms" | "cloud" | "vps";
type ComputerApiRequest = [url: string, init: RequestInit];
export interface ComputerActionPlan {
  confirmation: string | null;
  request: ComputerApiRequest;
}

const computerInventoryPaths: Record<ComputerInventoryRequest, string> = {
  status: "/api/local-computer",
  "local-vms": "/api/local-computer/instances",
  cloud: "/api/computers/boxes",
  vps: "/api/computers/vps",
};

/** Keep the observation-only Settings reads explicit and independently
 * testable: opening Computers must never provision or wake anything. */
export function computerInventoryRequest(
  inventory: ComputerInventoryRequest,
  signal?: AbortSignal,
): ComputerApiRequest {
  return [computerInventoryPaths[inventory], { signal }];
}

function jsonPostRequest(url: string, body: unknown): ComputerApiRequest {
  return [url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }];
}

export function perBotLocalVmDeletePlan(instance: LocalVmInventoryInstance): ComputerActionPlan {
  return {
    confirmation: t("vm.confirm.deleteBotVm", { name: instance.name }),
    request: jsonPostRequest(`/api/bots/${instance.botId}/local-computer/remove`, {}),
  };
}

export function cloudComputerActionPlan(
  action: CloudAction,
  instance: CloudComputerInventoryInstance,
): ComputerActionPlan {
  return {
    confirmation: action === "delete"
      ? t("vm.confirm.deleteCloud", {
          subject: instance.orphaned
            ? t("vm.confirm.orphanCloud")
            : t("vm.confirm.ownedCloud", { name: instance.ownerName ?? "" }),
        })
      : null,
    request: jsonPostRequest(
      `/api/computers/boxes/${encodeURIComponent(instance.boxId)}/${action}`,
      action === "delete" ? { confirmName: instance.name } : {},
    ),
  };
}

export function vpsComputerRemovePlan(instance: VpsComputerInventoryInstance): ComputerActionPlan {
  return {
    confirmation: t("vm.confirm.removeVps", {
      subject: instance.orphaned
        ? t("vm.confirm.orphanVpsUnnamed")
        : t("vm.confirm.ownedVps", { name: instance.ownerName ?? "" }),
    }),
    request: jsonPostRequest(`/api/computers/vps/${encodeURIComponent(instance.name)}/remove`, {
      confirmName: instance.name,
    }),
  };
}

/** The person's own Start or Retry: a fresh budget for the automatic care
 * (a new download allowance and attempt count), answered at once. */
export function localVmEnsurePlan(): ComputerActionPlan {
  return {
    confirmation: null,
    request: jsonPostRequest("/api/local-computer/ensure", { reason: "person" }),
  };
}

/** Reset: delete this computer's Local VMs (the shared one and, in per-bot
 * mode, each bot's), keep the files saved on this computer, then let the
 * automatic care create the shared one again. */
export function localVmResetPlan(perBot: boolean): ComputerActionPlan {
  return {
    confirmation: t(perBot ? "vm.reset.confirmPerBot" : "vm.reset.confirm"),
    request: jsonPostRequest("/api/local-computer/reset", { confirm: true }),
  };
}

export function confirmComputerAction(
  plan: ComputerActionPlan,
  confirm: (message: string) => boolean,
): ComputerApiRequest | null {
  if (plan.confirmation !== null && !confirm(plan.confirmation)) return null;
  return plan.request;
}

export function VpsComputersCard({
  instances,
  configured,
  sshAlias,
  loading,
  removingName,
  error,
  unavailableReason,
  onRefresh,
  onRemove,
}: {
  instances: VpsComputerInventoryInstance[];
  configured: boolean | null;
  sshAlias: string | null;
  loading: boolean;
  removingName: string | null;
  error: string | null;
  unavailableReason: string | null;
  onRefresh: () => void;
  onRemove: (instance: VpsComputerInventoryInstance) => void;
}) {
  return (
    <Card
      collapsible
      cardId="computer.vps"
      defaultOpen={false}
      title={t("vm.vps.title")}
      subtitle={t("vm.vps.subtitle")}
      summary={configured === false || !sshAlias
        ? t("settings.card.notSet")
        : `${sshAlias} · ${cardCount("computers", instances.length)}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] text-ink-secondary">
          {configured === true
            ? t("vm.vps.sshHost", { alias: sshAlias ?? t("vm.vps.configuredFallback") })
            : configured === false
              ? <SettingsText text={t("vm.vps.needsAlias")} links={{ settings: { section: "connections", cardId: "connections.integrations" } }} />
              : t("vm.vps.refreshHint")}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || removingName !== null}
          aria-label={t("vm.vps.refreshAria")}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline/40 px-2.5 py-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40"
        >
          <RefreshCw size={12} className={cn(loading && "animate-spin")} /> {t("vm.refresh")}
        </button>
      </div>

      {error && <div role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {loading
          ? t("vm.vps.checking")
          : unavailableReason
            ? t("vm.vps.unavailable", { reason: unavailableReason })
            : configured === false
              ? t("vm.vps.notConfigured")
              : instances.length === 1
                ? t("vm.vps.foundOne")
                : t("vm.vps.foundMany", { count: instances.length })}
      </p>

      <div
        aria-busy={loading || removingName !== null}
        className="mt-3 overflow-hidden rounded-xl border border-hairline/40"
      >
        {loading && instances.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-secondary">
            <Loader2 size={13} className="animate-spin" /> {t("vm.vps.checkingList")}
          </div>
        ) : unavailableReason ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-secondary">
            <AlertTriangle size={14} className="shrink-0 text-warning" /> {unavailableReason}
          </div>
        ) : configured === false ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-secondary">
            <Server size={14} className="shrink-0" /> {t("vm.vps.notConfigured")}
          </div>
        ) : instances.length === 0 ? (
          <div className="px-3 py-4 text-[13px] text-ink-secondary">{t("vm.vps.noneFound")}</div>
        ) : instances.map((instance, index) => {
          const kind = vpsComputerInventoryStateKind(instance);
          const state = computerStateLabel(kind);
          const removing = removingName === instance.name;
          const shortId = vpsComputerShortId(instance.name);
          return (
            <div
              key={instance.name}
              className={cn(
                "flex items-start justify-between gap-3 px-3 py-3",
                index > 0 && "border-t border-hairline/35",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-ink" title={instance.orphaned ? shortId : undefined}>
                    {instance.orphaned ? t("vm.vps.orphanUnnamed") : instance.ownerName}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px]",
                      instance.inUse || kind === "running"
                        ? "bg-accent/15 text-accent-text"
                        : kind === "stopped" || kind === "paused"
                          ? "bg-control text-ink-secondary"
                          : "bg-warning/15 text-warning",
                    )}
                  >
                    {state}
                  </span>
                </div>
                <div className="mt-1 text-[11.5px] text-ink-secondary">
                  {instance.orphaned ? t("vm.owner.gone") : t("vm.owner.owned")}
                </div>
                {instance.inUse && (
                  <div className="mt-1 text-[11.5px] text-ink-secondary">{t("vm.vps.stopFirst")}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemove(instance)}
                disabled={loading || instance.inUse || removingName !== null}
                aria-busy={removing || undefined}
                title={t("vm.vps.removeTitle")}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {t("vm.vps.remove")}
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function CloudComputersCard({
  instances,
  configured,
  loading,
  pending,
  error,
  unavailableReason,
  onRefresh,
  onSleep,
  onDelete,
}: {
  instances: CloudComputerInventoryInstance[];
  configured: boolean | null;
  loading: boolean;
  pending: PendingCloudAction;
  error: string | null;
  unavailableReason: string | null;
  onRefresh: () => void;
  onSleep: (instance: CloudComputerInventoryInstance) => void;
  onDelete: (instance: CloudComputerInventoryInstance) => void;
}) {
  return (
    <Card
      collapsible
      cardId="computer.cloud"
      defaultOpen={false}
      title={t("vm.cloud.title")}
      subtitle={t("vm.cloud.subtitle")}
      summary={configured === false
        ? t("settings.card.notConnected")
        : cardCount("computers", instances.length)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] text-ink-secondary">
          {configured === true
            ? t("vm.cloud.includesOrphans")
            : configured === false
              ? <SettingsText text={t("vm.cloud.needsKey")} links={{ settings: { section: "connections", cardId: "connections.integrations" } }} />
              : t("vm.cloud.refreshHint")}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || pending !== null}
          aria-label={t("vm.cloud.refreshAria")}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline/40 px-2.5 py-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40"
        >
          <RefreshCw size={12} className={cn(loading && "animate-spin")} /> {t("vm.refresh")}
        </button>
      </div>

      {error && <div role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {loading
          ? t("vm.cloud.checking")
          : unavailableReason
            ? t("vm.cloud.unavailable", { reason: unavailableReason })
            : configured === false
              ? t("vm.cloud.notConnected")
              : instances.length === 1
                ? t("vm.cloud.foundOne")
                : t("vm.cloud.foundMany", { count: instances.length })}
      </p>

      <div
        aria-busy={loading || pending !== null}
        className="mt-3 overflow-hidden rounded-xl border border-hairline/40"
      >
        {loading && instances.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-secondary">
            <Loader2 size={13} className="animate-spin" /> {t("vm.cloud.checkingList")}
          </div>
        ) : unavailableReason ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-secondary">
            <AlertTriangle size={14} className="shrink-0 text-warning" /> {unavailableReason}
          </div>
        ) : configured === false ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-secondary">
            <Cloud size={14} className="shrink-0" /> {t("vm.cloud.notConnected")}
          </div>
        ) : instances.length === 0 ? (
          <div className="px-3 py-4 text-[13px] text-ink-secondary">{t("vm.cloud.noneFound")}</div>
        ) : instances.map((instance, index) => {
          const kind = cloudComputerInventoryStateKind(instance);
          const state = computerStateLabel(kind);
          const isPending = pending?.boxId === instance.boxId;
          const canSleep = cloudComputerCanSleep(instance);
          const isRemoving = kind === "removing";
          return (
            <div
              key={instance.boxId}
              className={cn(
                "flex items-start justify-between gap-3 px-3 py-3",
                index > 0 && "border-t border-hairline/35",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-ink">
                    {instance.orphaned ? t("vm.cloud.orphan") : instance.ownerName}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px]",
                      instance.inUse || kind === "running"
                        ? "bg-accent/15 text-accent-text"
                        : kind === "sleeping" || kind === "going-to-sleep"
                          ? "bg-control text-ink-secondary"
                          : "bg-warning/15 text-warning",
                    )}
                  >
                    {state}
                  </span>
                </div>
                <div className="mt-1 break-all text-[11.5px] text-ink-secondary" title={instance.name}>
                  {instance.orphaned ? t("vm.owner.gone") : t("vm.owner.owned")}
                </div>
                {instance.inUse && (
                  <div className="mt-1 text-[11.5px] text-ink-secondary">{t("vm.cloud.stopFirst")}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onSleep(instance)}
                  disabled={loading || instance.inUse || pending !== null || !canSleep}
                  aria-busy={isPending && pending?.action === "sleep" ? true : undefined}
                  title={canSleep ? t("vm.cloud.sleepTitle") : t("vm.cloud.sleepBlocked", { state: state.toLowerCase() })}
                  className="flex items-center gap-1.5 rounded-lg border border-hairline/40 px-2.5 py-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPending && pending?.action === "sleep" ? <Loader2 size={12} className="animate-spin" /> : <Moon size={12} />}
                  {t("vm.cloud.sleep")}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(instance)}
                  disabled={loading || instance.inUse || pending !== null || isRemoving}
                  aria-busy={isPending && pending?.action === "delete" ? true : undefined}
                  title={t("vm.cloud.deleteTitle")}
                  className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPending && pending?.action === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {t("common.delete")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function LocalVmInventoryCard({
  instances,
  maxInstances,
  loading,
  deletingBotId,
  error,
  unavailableReason,
  onRefresh,
  onDelete,
}: {
  instances: LocalVmInventoryInstance[];
  maxInstances: number;
  loading: boolean;
  deletingBotId: string | null;
  error: string | null;
  unavailableReason: string | null;
  onRefresh: () => void;
  onDelete: (instance: LocalVmInventoryInstance) => void;
}) {
  return (
    <Card
      collapsible
      cardId="computer.perBotInventory"
      title={t("vm.perBot.title")}
      summary={unavailableReason
        ? t("vm.perBot.inventoryUnavailable")
        : t("vm.perBot.created", { count: instances.length, max: maxInstances })}
      subtitle={t("vm.perBot.subtitle", {
        count: unavailableReason
          ? t("vm.perBot.inventoryUnavailable")
          : t("vm.perBot.created", { count: instances.length, max: maxInstances }),
      })}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] text-ink-secondary">
          {t("vm.perBot.deleteHint")}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || deletingBotId !== null}
          aria-label={t("vm.perBot.refreshAria")}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline/40 px-2.5 py-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40"
        >
          <RefreshCw size={12} className={cn(loading && "animate-spin")} /> {t("vm.refresh")}
        </button>
      </div>

      {error && <div role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {loading
          ? t("vm.perBot.checking")
          : unavailableReason
            ? t("vm.perBot.unavailable", { reason: unavailableReason })
            : instances.length === 1
              ? t("vm.perBot.foundOne")
              : t("vm.perBot.foundMany", { count: instances.length })}
      </p>

      <div
        aria-busy={loading || deletingBotId !== null}
        className="mt-3 overflow-hidden rounded-xl border border-hairline/40"
      >
        {loading && instances.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-secondary">
            <Loader2 size={13} className="animate-spin" /> {t("vm.perBot.checkingList")}
          </div>
        ) : unavailableReason ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-secondary">
            <AlertTriangle size={14} className="shrink-0 text-warning" /> {unavailableReason}
          </div>
        ) : instances.length === 0 ? (
          <div className="px-3 py-4 text-[13px] text-ink-secondary">{t("vm.perBot.none")}</div>
        ) : instances.map((instance, index) => {
          const state = localVmInventoryState(instance);
          const deleting = deletingBotId === instance.botId;
          const managed = instance.managed === true;
          return (
            <div
              key={instance.botId}
              className={cn(
                "flex items-start justify-between gap-3 px-3 py-3",
                index > 0 && "border-t border-hairline/35",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-ink">{instance.name}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px]",
                      !managed
                        ? "bg-warning/15 text-warning"
                        : instance.inUse || instance.ready
                          ? "bg-success/15 text-success"
                          : instance.container === "stopped"
                            ? "bg-control text-ink-secondary"
                            : "bg-warning/15 text-warning",
                    )}
                  >
                    {state}
                  </span>
                </div>
                <div className="mt-1 text-[11.5px] text-ink-secondary">
                  {t("vm.perBot.destination", { destination: t(destinationLabelKeys[instance.destination]) })}
                </div>
                {!managed && (
                  <div className="mt-1 text-[11.5px] text-warning">
                    {t("vm.perBot.unmanaged")}
                  </div>
                )}
                {managed && instance.problem && !instance.inUse && (
                  <div className="mt-1 text-[11.5px] text-warning">{instance.problem}</div>
                )}
                {managed && instance.inUse && (
                  <div className="mt-1 text-[11.5px] text-ink-secondary">{t("vm.perBot.stopFirst")}</div>
                )}
              </div>
              {managed && <button
                type="button"
                onClick={() => onDelete(instance)}
                disabled={loading || instance.inUse || deletingBotId !== null}
                aria-busy={deleting || undefined}
                title={
                  instance.inUse
                    ? t("vm.perBot.deleteBlocked")
                    : t("vm.perBot.deleteTitle", { name: instance.name })
                }
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {t("common.delete")}
              </button>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** The first setup step still to do, for the collapsed Setup card. */
export function setupStep(status: Pick<Status, "runtime" | "daemonUp" | "image">): number {
  if (!status.runtime) return 1;
  if (!status.daemonUp) return 2;
  if (!status.image) return 3;
  return 4;
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]",
          done ? "bg-success/20 text-success" : "border border-hairline/50 text-ink-secondary",
        )}
      >
        {done ? <Check size={12} /> : n}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("text-[14px]", done ? "text-ink-secondary line-through" : "text-ink")}>{title}</div>
        {!done && children && <div className="mt-2 flex flex-col items-start gap-2 [&>*]:max-w-full">{children}</div>}
      </div>
    </div>
  );
}

function ActionButton({
  action,
  pending,
  children,
  onClick,
  danger = false,
}: {
  action: Action;
  pending: Action | null;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-busy={pending === action}
      disabled={pending !== null}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50",
        danger ? "bg-danger/15 text-danger hover:bg-danger/20" : "bg-accent text-accent-ink hover:brightness-110",
      )}
    >
      {pending === action && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
}

// Mirrors localVm.idleTimeoutMinutes in server/config.ts; the server is the
// authority and rejects anything outside these bounds.
const MIN_LOCAL_VM_IDLE_TIMEOUT_MINUTES = 5;
const MAX_LOCAL_VM_IDLE_TIMEOUT_MINUTES = 1_440;
const DEFAULT_LOCAL_VM_IDLE_TIMEOUT_MINUTES = 10;

/** A whole number of minutes within the server's bounds, or null. */
export function parseLocalVmIdleTimeoutMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return minutes >= MIN_LOCAL_VM_IDLE_TIMEOUT_MINUTES && minutes <= MAX_LOCAL_VM_IDLE_TIMEOUT_MINUTES ? minutes : null;
}

export function LocalVmIdleTimeoutSetting({
  minutes,
  disabled,
  onSave,
}: {
  minutes: number;
  disabled: boolean;
  onSave: (minutes: number) => Promise<void>;
}) {
  const [value, setValue] = useState(String(minutes));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // The status poll keeps refreshing the confirmed value; never overwrite
  // what the person is typing.
  useEffect(() => {
    if (!dirty) setValue(String(minutes));
  }, [minutes, dirty]);

  const save = async () => {
    if (!dirty || saving) return;
    const parsed = parseLocalVmIdleTimeoutMinutes(value);
    if (parsed === null) {
      setError(t("vm.idle.range"));
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
      setValue(String(parsed));
      setDirty(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("vm.idle.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <label htmlFor="local-vm-idle-timeout" className="text-[13px] text-ink">{t("vm.idle.label")}</label>
          <div id="local-vm-idle-timeout-help" className="text-[11.5px] text-ink-secondary">{t("vm.idle.detail")}</div>
        </div>
        <div
          className={cn(
            "flex w-[150px] shrink-0 items-center rounded-lg border bg-control",
            error ? "border-danger/60" : "border-hairline/40 focus-within:border-focus",
          )}
        >
          <input
            id="local-vm-idle-timeout"
            type="number"
            min={MIN_LOCAL_VM_IDLE_TIMEOUT_MINUTES}
            max={MAX_LOCAL_VM_IDLE_TIMEOUT_MINUTES}
            step={1}
            inputMode="numeric"
            value={value}
            disabled={disabled || saving}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "local-vm-idle-timeout-error local-vm-idle-timeout-help" : "local-vm-idle-timeout-help"}
            onChange={(event) => {
              setValue(event.target.value);
              setDirty(true);
              setError("");
            }}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-[13px] tabular-nums text-ink focus:outline-none disabled:opacity-50"
          />
          <span className="pr-2.5 text-[12.5px] text-ink-secondary">{t("vm.idle.minutes")}</span>
        </div>
      </div>
      {error ? (
        <p id="local-vm-idle-timeout-error" role="alert" className="mt-1.5 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const AUTO_STEP_KEYS: Record<NonNullable<LocalVmAutoState["step"]>, LocaleKey> = {
  runtime: "vm.auto.starting.runtime",
  image: "vm.auto.starting.image",
  container: "vm.auto.starting.container",
  start: "vm.auto.starting.start",
};

const AUTO_PROBLEM_KEYS: Record<NonNullable<LocalVmAutoState["problem"]>, LocaleKey> = {
  no_runtime: "vm.auto.problem.no_runtime",
  runtime_stopped: "vm.auto.problem.runtime_stopped",
  foreign: "vm.auto.problem.foreign",
  unsupported: "vm.auto.problem.unsupported",
  image_failed: "vm.auto.problem.image_failed",
  start_failed: "vm.auto.problem.start_failed",
};

/** What the automatic care is doing, in one line; null when the state badge
 * already says it (idle, or running and ready). */
export function localVmAutoLabel(auto: LocalVmAutoState): string | null {
  switch (auto.phase) {
    case "checking":
      return t("vm.auto.checking");
    case "starting":
      return t(auto.step ? AUTO_STEP_KEYS[auto.step] : "vm.auto.starting.container");
    case "waiting":
      return t("vm.auto.waiting", {
        time: new Date(auto.nextRetryAt ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
    case "problem":
      return t(auto.problem ? AUTO_PROBLEM_KEYS[auto.problem] : "vm.auto.problem.start_failed");
    case "stopped":
      return t("vm.auto.stopped");
    default:
      return null;
  }
}

/** The person's way forward: their own Start after they stopped it, or a
 * Retry now instead of the next automatic attempt. Null while it works. */
export function localVmAutoAction(auto: LocalVmAutoState): "start" | "retry" | null {
  if (auto.phase === "stopped") return "start";
  if (auto.phase === "problem" || auto.phase === "waiting") return "retry";
  return null;
}

/** The automatic care's line in the state card: what it is doing, the
 * person's Start or Retry, and Reset. Nowhere (null) on a server where no
 * automatic care runs. */
export function LocalVmAutoStatus({ auto, perBot, busy, onEnsure, onReset }: {
  auto: LocalVmAutoState | null;
  perBot: boolean;
  /** A setup action, a policy save, or the ensure/reset itself is running. */
  busy: boolean;
  onEnsure: () => void;
  onReset: () => void;
}) {
  if (!auto) return null;
  const label = localVmAutoLabel(auto);
  const action = localVmAutoAction(auto);
  const working = auto.phase === "checking" || auto.phase === "starting";
  return (
    <div data-local-vm-auto className="mt-3 flex flex-wrap items-center gap-2">
      {label && (
        <span data-local-vm-auto-label className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-secondary">
          {working && <Loader2 size={12} className="shrink-0 animate-spin" />}
          {auto.phase === "problem" && <AlertTriangle size={12} className="shrink-0 text-warning" />}
          <span className="min-w-0">
            {label}
            {auto.detail && (auto.phase === "problem" || auto.phase === "waiting") ? ` · ${auto.detail}` : ""}
          </span>
        </span>
      )}
      {action && (
        <button
          type="button"
          data-local-vm-auto-action={action}
          aria-busy={busy}
          disabled={busy}
          onClick={onEnsure}
          className="ui-button ui-button-primary gap-1.5 font-medium disabled:opacity-50"
        >
          {action === "start" ? <Play size={12} /> : <RotateCcw size={12} />}
          {t(action === "start" ? "vm.auto.start" : "vm.auto.retry")}
        </button>
      )}
      <button
        type="button"
        data-local-vm-reset
        aria-busy={busy}
        disabled={busy}
        onClick={onReset}
        title={perBot ? t("vm.reset.confirmPerBot") : t("vm.reset.confirm")}
        className={DANGER_PILL}
      >
        <RefreshCw size={12} /> {t("vm.reset.action")}
      </button>
    </div>
  );
}

export function LocalComputerSection() {
  const { state: storeState } = useStore();
  // Installation inventories are admin routes. A member's own computer is
  // OrgComputerSettings; probing these every 5s only produces 403s.
  const manageComputers = canManageComputers(storeState.config);
  // Experimental (Settings > Experimental features): off hides the cards.
  const boatOn = manageComputers && boatComputerEnabled(storeState.config);
  const vpsOn = manageComputers && vpsComputerEnabled(storeState.config);
  // An organization server (a desktop bridge status exists): the Local VM is
  // the one on the person's own computer, set up through their desktop app,
  // and their server environment sits beside it (OrgComputerSettings).
  const orgBridge = useDesktopBridgeStatus();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Action | null>(null);
  const actionController = useRef<AbortController | null>(null);
  useEffect(() => () => actionController.current?.abort(), []);
  const [error, setError] = useState<string | null>(null);
  const [policyPending, setPolicyPending] = useState(false);
  const [autoPending, setAutoPending] = useState<"ensure" | "reset" | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [inventory, setInventory] = useState<LocalVmInventoryInstance[]>([]);
  const [inventoryMax, setInventoryMax] = useState(2);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryUnavailableReason, setInventoryUnavailableReason] = useState<string | null>(null);
  const [deletingBotId, setDeletingBotId] = useState<string | null>(null);
  const [inventoryRefreshKey, setInventoryRefreshKey] = useState(0);
  const [cloudInventory, setCloudInventory] = useState<CloudComputerInventoryInstance[]>([]);
  const [cloudConfigured, setCloudConfigured] = useState<boolean | null>(null);
  const [cloudLoading, setCloudLoading] = useState(true);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudUnavailableReason, setCloudUnavailableReason] = useState<string | null>(null);
  const [cloudPending, setCloudPending] = useState<PendingCloudAction>(null);
  const [cloudRefreshKey, setCloudRefreshKey] = useState(0);
  const cloudInventoryRef = useRef<CloudComputerInventoryInstance[]>([]);
  const cloudOverridesRef = useRef<CloudPostActionOverrides>({});
  const [vpsInventory, setVpsInventory] = useState<VpsComputerInventoryInstance[]>([]);
  const [vpsConfigured, setVpsConfigured] = useState<boolean | null>(null);
  const [vpsSshAlias, setVpsSshAlias] = useState<string | null>(null);
  const [vpsLoading, setVpsLoading] = useState(true);
  const [vpsError, setVpsError] = useState<string | null>(null);
  const [vpsUnavailableReason, setVpsUnavailableReason] = useState<string | null>(null);
  const [vpsRemovingName, setVpsRemovingName] = useState<string | null>(null);
  const [vpsRefreshKey, setVpsRefreshKey] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(...computerInventoryRequest("status", signal));
    const body = await response.json().catch(() => ({}));
    // The poll loop can be cleaned up mid-flight; a resolved-but-stale read
    // must never overwrite the state of whoever unmounted us.
    if (signal?.aborted) return;
    if (!response.ok) throw new Error(body.error ?? t("vm.err.status", { code: response.status }));
    setStatus(body as Status);
    setError(null);
    return body as Status;
  }, []);

  const refreshInventory = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(...computerInventoryRequest("local-vms", signal));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? t("vm.err.inventory", { code: response.status }));
    const payload = body as LocalVmInventoryPayload;
    setInventory(payload.instances);
    setInventoryMax(payload.maxInstances);
    setInventoryUnavailableReason(payload.available ? null : (payload.problem ?? t("vm.err.runtimeUnavailable")));
    setInventoryError(null);
  }, []);

  const refreshCloudInventory = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(...computerInventoryRequest("cloud", signal));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? t("vm.err.cloudInventory", { code: response.status }));
    const payload = body as CloudComputerInventoryPayload;
    const reconciled = reconcileCloudInventoryPayload(
      payload,
      cloudInventoryRef.current,
      cloudOverridesRef.current,
    );
    cloudOverridesRef.current = reconciled.overrides;
    cloudInventoryRef.current = reconciled.instances;
    setCloudInventory(reconciled.instances);
    setCloudConfigured(payload.configured === true);
    setCloudUnavailableReason(
      payload.available || !payload.configured
        ? null
        : (payload.problem ?? t("vm.err.cloudUnavailable")),
    );
    setCloudError(null);
  }, []);

  const refreshVpsInventory = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(...computerInventoryRequest("vps", signal));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? t("vm.err.vpsInventory", { code: response.status }));
    const payload = body as VpsComputerInventoryPayload;
    setVpsInventory(Array.isArray(payload.instances) ? payload.instances : []);
    setVpsConfigured(payload.configured === true);
    setVpsSshAlias(typeof payload.sshAlias === "string" ? payload.sshAlias : null);
    setVpsUnavailableReason(
      payload.available || !payload.configured
        ? null
        : (payload.problem ?? t("vm.err.vpsUnavailable")),
    );
    setVpsError(null);
  }, []);

  useEffect(() => {
    if (!manageComputers) return;
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController();
      try {
        await refresh(controller.signal);
      } catch (e) {
        if (active && !(e instanceof DOMException && e.name === "AbortError")) {
          setStatus(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (active) {
          setLoading(false);
          timer = window.setTimeout(() => void poll(), 5000);
        }
      }
    };
    void poll();
    return () => {
      active = false;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [manageComputers, refresh, refreshKey]);

  useEffect(() => {
    if (status?.mode !== "per-bot") {
      setInventory([]);
      setInventoryLoading(false);
      setInventoryError(null);
      setInventoryUnavailableReason(null);
      return;
    }
    const controller = new AbortController();
    setInventoryLoading(true);
    void refreshInventory(controller.signal)
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setInventoryError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setInventoryLoading(false);
      });
    return () => controller.abort();
  }, [inventoryRefreshKey, refreshInventory, status?.mode]);

  // Boat account listing is deliberately not polled. It can be expensive and
  // Settings must remain an observation-only surface until the person clicks
  // Sleep or Delete.
  useEffect(() => {
    if (!manageComputers) return;
    const controller = new AbortController();
    setCloudLoading(true);
    void refreshCloudInventory(controller.signal)
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setCloudUnavailableReason(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCloudLoading(false);
      });
    return () => controller.abort();
  }, [cloudRefreshKey, manageComputers, refreshCloudInventory]);

  // Docker-over-SSH inventory is also manual/mount-only. A Settings view
  // must never become a hidden remote poller or wake a stopped container.
  useEffect(() => {
    if (!manageComputers) return;
    const controller = new AbortController();
    setVpsLoading(true);
    void refreshVpsInventory(controller.signal)
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setVpsUnavailableReason(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setVpsLoading(false);
      });
    return () => controller.abort();
  }, [manageComputers, refreshVpsInventory, vpsRefreshKey]);

  const post = async (action: Exclude<Action, "recreate">, signal: AbortSignal) => {
    const response = await fetch(`/api/local-computer/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal,
    });
    const body = await response.json().catch(() => ({}));
    const errorKeys: Record<Exclude<Action, "recreate">, LocaleKey> = {
      pull: "vm.err.prepare",
      run: "vm.err.create",
      start: "vm.err.start",
      stop: "vm.err.stop",
      remove: "vm.deleteError",
    };
    if (!response.ok) throw new Error(body.error ?? t(errorKeys[action]));
    signal.throwIfAborted();
    setStatus(body as Status);
    return body as Status;
  };

  const confirmAction = (message: string) => window.ogb?.confirm ? window.ogb.confirm(message) : window.confirm(message);

  const act = async (action: Action) => {
    if (pending !== null || actionController.current) return;
    const controller = new AbortController();
    actionController.current = controller;
    setPending(action);
    setError(null);
    try {
      if (action === "remove" && !(await confirmAction(t("vm.confirm.deleteShared")))) return;
      if (action === "recreate" && !(await confirmAction(t("vm.confirm.recreate")))) return;
      let result: Status;
      if (action === "recreate") {
        await post("remove", controller.signal);
        result = await post("run", controller.signal);
      } else {
        result = await post(action, controller.signal);
      }
      if (action === "run" || action === "start" || action === "recreate") {
        result = await waitForLocalVmReady(
          result,
          async () => (await refresh(controller.signal)) ?? result,
          controller.signal,
        );
        if (!result.ready) throw new Error(result.problem ?? t("vm.err.start"));
      }
      await refresh();
      setAnnouncement(
        action === "remove"
          ? t("vm.announce.deleted")
          : action === "stop"
            ? t("vm.announce.stopped")
            : t("vm.announce.updated"),
      );
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      actionController.current = null;
      if (!controller.signal.aborted) setPending(null);
    }
  };

  const savePolicy = async (mode: Status["mode"], maxInstances: number) => {
    setPolicyPending(true);
    setError(null);
    try {
      const response = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ localVm: { mode, maxInstances } }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? t("vm.policyError"));
      setStatus((current) => current ? { ...current, mode, max_instances: maxInstances } : current);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPolicyPending(false);
    }
  };

  const saveIdleTimeout = async (idleTimeoutMinutes: number) => {
    const response = await fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ localVm: { idleTimeoutMinutes } }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? t("vm.idle.error"));
    setStatus((current) => current ? { ...current, idle_timeout_ms: idleTimeoutMinutes * 60_000 } : current);
  };

  const deletePerBotVm = async (instance: LocalVmInventoryInstance) => {
    if (!instance.managed) {
      setInventoryError(t("vm.unmanagedError"));
      return;
    }
    const request = confirmComputerAction(
      perBotLocalVmDeletePlan(instance),
      (message) => window.confirm(message),
    );
    if (!request) return;
    setDeletingBotId(instance.botId);
    setInventoryError(null);
    try {
      const response = await fetch(...request);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? t("vm.deleteError"));
      await refreshInventory();
      setAnnouncement(t("vm.announce.deletedBot", { name: instance.name }));
    } catch (e) {
      setInventoryError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingBotId(null);
    }
  };

  const autoBusy = pending !== null || autoPending !== null || policyPending;

  // The person's own Start or Retry: a fresh budget for the automatic care.
  // The answer says where the care is right now; the poll brings the rest.
  const ensureVm = async () => {
    if (autoBusy) return;
    setAutoPending("ensure");
    setError(null);
    try {
      const [url, init] = localVmEnsurePlan().request;
      const response = await fetch(url, init);
      const body = await response.json().catch(() => ({})) as { auto?: LocalVmAutoState | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? t("vm.auto.ensureError"));
      setStatus((current) => current ? { ...current, auto: body.auto ?? current.auto } : current);
      setAnnouncement(t("vm.auto.announce"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoPending(null);
    }
  };

  // Reset: delete this computer's Local VMs and let the automatic care
  // create the shared one again. A bot using one, or a setup action still
  // running, answers 409 and is said in the person's language.
  const resetVm = async () => {
    if (autoBusy) return;
    const perBotNow = status?.mode === "per-bot";
    const request = confirmComputerAction(localVmResetPlan(perBotNow), (message) => window.confirm(message));
    if (!request) return;
    setAutoPending("reset");
    setError(null);
    try {
      const response = await fetch(...request);
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
      if (!response.ok) throw new Error(body.code === "in_use" ? t("vm.reset.inUse") : (body.error ?? t("vm.reset.error")));
      setStatus(body as Status);
      if (perBotNow) setInventoryRefreshKey((key) => key + 1);
      setAnnouncement(t("vm.reset.announce"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoPending(null);
    }
  };

  const actOnCloudComputer = async (action: CloudAction, instance: CloudComputerInventoryInstance) => {
    const request = confirmComputerAction(
      cloudComputerActionPlan(action, instance),
      (message) => window.confirm(message),
    );
    if (!request) return;
    setCloudPending({ boxId: instance.boxId, action });
    setCloudError(null);
    setAnnouncement("");
    try {
      const response = await fetch(...request);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? t(action === "delete" ? "vm.cloud.deleteError" : "vm.cloud.sleepError"));
      const deletionPending = action === "delete" && body?.pending === true;
      cloudOverridesRef.current = {
        ...cloudOverridesRef.current,
        [instance.boxId]: action === "delete"
          ? deletionPending ? "deleting" : "deleted"
          : "sleeping",
      };
      const reconciled = reconcileCloudInventorySnapshot(
        cloudInventoryRef.current,
        cloudInventoryRef.current,
        cloudOverridesRef.current,
      );
      cloudOverridesRef.current = reconciled.overrides;
      cloudInventoryRef.current = reconciled.instances;
      setCloudInventory(reconciled.instances);
      const subject = instance.orphaned
        ? t("vm.announce.orphanCloud")
        : t("vm.confirm.ownedCloud", { name: instance.ownerName ?? "" });
      setAnnouncement(
        deletionPending
          ? `${subject}: ${t("vm.state.removing")}.`
          : t(action === "delete" ? "vm.announce.cloudDeleted" : "vm.announce.cloudSleeping", { subject }),
      );

      if (deletionPending) {
        // Boat may accept a background operation before the computer is gone.
        // Keep the row visible as Removing while we check, then drop the
        // optimistic state if the provider still lists it so the person can
        // refresh or retry instead of being shown a false success forever.
        for (const delayMs of PENDING_CLOUD_DELETE_REFRESH_DELAYS_MS) {
          await waitForCloudDeleteRefresh(delayMs);
          try {
            await refreshCloudInventory();
          } catch {
            // A later bounded attempt can still establish the final state.
          }
          if (cloudOverridesRef.current[instance.boxId] !== "deleting") {
            setAnnouncement(t("vm.announce.cloudDeleted", { subject }));
            return;
          }
        }

        const nextOverrides = { ...cloudOverridesRef.current };
        delete nextOverrides[instance.boxId];
        cloudOverridesRef.current = nextOverrides;
        const restored = cloudInventoryRef.current.map((current) =>
          current.boxId === instance.boxId ? { ...current, state: instance.state } : current
        );
        cloudInventoryRef.current = restored;
        setCloudInventory(restored);
        try {
          await refreshCloudInventory();
          if (!cloudInventoryRef.current.some((current) => current.boxId === instance.boxId)) {
            setAnnouncement(t("vm.announce.cloudDeleted", { subject }));
          }
        } catch (refreshError) {
          const detail = refreshError instanceof Error ? refreshError.message : String(refreshError);
          setCloudError(`${subject}: ${t("vm.state.removing")}. ${detail}`);
        }
        return;
      }

      try {
        await refreshCloudInventory();
      } catch (refreshError) {
        const detail = refreshError instanceof Error ? refreshError.message : String(refreshError);
        setCloudError(t(action === "delete" ? "vm.cloud.deletedRefreshError" : "vm.cloud.sleepRefreshError", { subject, detail }));
      }
    } catch (e) {
      setCloudError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloudPending(null);
    }
  };

  const removeVpsComputer = async (instance: VpsComputerInventoryInstance) => {
    const request = confirmComputerAction(
      vpsComputerRemovePlan(instance),
      (message) => window.confirm(message),
    );
    if (!request) return;
    setVpsRemovingName(instance.name);
    setVpsError(null);
    try {
      const response = await fetch(...request);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? t("vm.vpsRemoveError"));
      await refreshVpsInventory();
      setAnnouncement(
        t("vm.announce.vpsRemoved", {
          subject: instance.orphaned
            ? t("vm.vps.orphanUnnamed")
            : t("vm.confirm.ownedVps", { name: instance.ownerName ?? "" }),
        }),
      );
    } catch (e) {
      setVpsError(e instanceof Error ? e.message : String(e));
    } finally {
      setVpsRemovingName(null);
    }
  };

  const c = status?.commands;
  const ready = status?.ready === true;
  const existing = status?.container !== "missing";
  const needsRecreate = Boolean(
    existing &&
      (!status?.imageMatches ||
        !status?.managed ||
        status?.network === "unsafe" ||
        status?.security === "unsafe" ||
        status?.persistence === "unsafe"),
  );
  const unavailable = !loading && !status;
  const perBot = status?.mode === "per-bot";
  const perBotRuntimeUnsupported = perBot && status?.runtime === "container";
  const headerReady = perBot ? Boolean(status?.daemonUp && status?.image && !perBotRuntimeUnsupported) : ready;

  const statusText = loading
    ? t("common.checking")
    : unavailable
      ? t("vm.main.statusUnavailable")
      : perBot && headerReady
        ? t("vm.main.readyPerBot")
        : perBotRuntimeUnsupported
          ? t("vm.main.perBotUnsupported")
          : ready
            ? t("vm.main.ready")
            : (status?.problem ?? t("vm.main.notReady"));

  return (
    <>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
      {orgBridge && <OrgComputerSettings bridge={orgBridge} localVmAllowed={storeState.config?.managedPolicy?.computers?.localVm !== false} />}

      {boatOn && <CloudComputersCard
        instances={cloudInventory}
        configured={cloudConfigured}
        loading={cloudLoading}
        pending={cloudPending}
        error={cloudError}
        unavailableReason={cloudUnavailableReason}
        onRefresh={() => setCloudRefreshKey((key) => key + 1)}
        onSleep={(instance) => void actOnCloudComputer("sleep", instance)}
        onDelete={(instance) => void actOnCloudComputer("delete", instance)}
      />}

      {vpsOn && <VpsComputersCard
        instances={vpsInventory}
        configured={vpsConfigured}
        sshAlias={vpsSshAlias}
        loading={vpsLoading}
        removingName={vpsRemovingName}
        error={vpsError}
        unavailableReason={vpsUnavailableReason}
        onRefresh={() => setVpsRefreshKey((key) => key + 1)}
        onRemove={(instance) => void removeVpsComputer(instance)}
      />}

      <MacLocalControl />
      <MessagesSettings />

      {/* Scheduled update and disk saver: hidden by itself where this
          person has no computer to care for (403/409). */}
      <ComputerCareSettings />

      {!orgBridge && manageComputers && <>
      {/* 0.5.6 (JC): Grok Bot's "Bot's computer" group. One row: the
          Local VM's state in one short grey line, Recheck and Watch as
          pills; the automatic care and Reset under it. The setup,
          isolation and safety cards stay below, folded. */}
      <SettingsGroup title={t("computer.group.bots")} groupId="botsComputer">
        <div data-settings-card="computer.main">
          <DescribedRow
            label={t("vm.main.title")}
            rowId="localVm"
            description={(
              <span aria-live="polite" className="inline-flex items-center gap-1.5" data-local-vm-ready={headerReady ? "yes" : "no"}>
                {loading ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : headerReady ? <Check size={11} className="text-success" aria-hidden="true" /> : <Circle size={7} aria-hidden="true" />}
                {statusText}
              </span>
            )}
            below={(
              <>
                <LocalVmAutoStatus
                  auto={status?.auto ?? null}
                  perBot={perBot}
                  busy={autoBusy}
                  onEnsure={() => void ensureVm()}
                  onReset={() => void resetVm()}
                />
                {error && <div role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
              </>
            )}
          >
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setRefreshKey((key) => key + 1);
                setInventoryRefreshKey((key) => key + 1);
              }}
              disabled={loading || pending !== null}
              className="ui-button gap-1.5 disabled:opacity-40"
            >
              <RefreshCw size={12} aria-hidden="true" /> {t("vm.main.recheck")}
            </button>
            {ready && !perBot && (
              <a
                href={status?.viewer_url ?? c?.view}
                target="_blank"
                rel="noreferrer"
                className="ui-button gap-1.5"
              >
                <ExternalLink size={12} aria-hidden="true" /> {t("vm.main.watch")}
              </a>
            )}
          </DescribedRow>
        </div>
      </SettingsGroup>

      <Card
        collapsible
        cardId="computer.isolation"
        defaultOpen={false}
        title={t("vm.isolation.title")}
        subtitle={t("vm.isolation.subtitle")}
        summary={perBot
          ? t("settings.card.upTo", { label: t("vm.isolation.perBot"), count: status?.max_instances ?? 2 })
          : t("vm.isolation.shared")}
      >
        <div className="flex overflow-hidden rounded-lg border border-hairline/40">
          {(status?.organization ? ["shared"] as const : ["shared", "per-bot"] as const).map((mode, index) => (
            <button
              key={mode}
              type="button"
              disabled={!status || policyPending}
              onClick={() => void savePolicy(mode, status?.max_instances ?? 2)}
              className={cn(
                "flex-1 px-3 py-2 text-[13px] disabled:opacity-50",
                index > 0 && "border-l border-hairline/40",
                status?.mode === mode ? "bg-control text-ink" : "text-ink-secondary hover:text-ink",
              )}
            >
              {mode === "shared" ? t("vm.isolation.shared") : t("vm.isolation.perBot")}
            </button>
          ))}
        </div>
        {/* The cap only applies to per-bot VMs; shared mode runs exactly one. */}
        {perBot && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] text-ink">{t("vm.isolation.max")}</div>
              <div className="text-[11.5px] text-ink-secondary">{t("vm.isolation.maxDetail")}</div>
            </div>
            <select
              aria-label={t("vm.isolation.maxAria")}
              value={status?.max_instances ?? 2}
              disabled={!status || policyPending}
              onChange={(event) => void savePolicy(status?.mode ?? "shared", Number(event.target.value))}
              className="rounded-lg border border-hairline/40 bg-control px-2.5 py-1.5 text-[13px] text-ink disabled:opacity-50"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
        )}
        <LocalVmIdleTimeoutSetting
          minutes={status ? Math.round(status.idle_timeout_ms / 60_000) : DEFAULT_LOCAL_VM_IDLE_TIMEOUT_MINUTES}
          disabled={!status || policyPending}
          onSave={saveIdleTimeout}
        />
        {policyPending && <div className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-secondary"><Loader2 size={12} className="animate-spin" /> {t("vm.saving")}</div>}
      </Card>

      <Card
        collapsible
        cardId="computer.setup"
        defaultOpen={Boolean(status) && !(perBot ? headerReady : ready)}
        title={t("vm.setup.title")}
        subtitle={t("vm.setup.subtitle")}
        summary={!status
          ? t("common.checking")
          : (perBot ? headerReady : ready)
            ? t("settings.card.done")
            : t("settings.card.step", { step: setupStep(status), total: 4 })}
      >
        <div className="flex flex-col gap-4">
          <Step n={1} title={t("vm.setup.step1")} done={Boolean(status?.runtime)}>
            <div className="text-[13px] leading-relaxed text-ink-secondary">
              {t("vm.setup.step1Detail")}
            </div>
            {c?.install ? (
              <CommandLine command={c.install} />
            ) : (
              <a href="https://podman.io/docs/installation" target="_blank" rel="noreferrer" className="text-[13px] text-accent hover:underline">
                {t("vm.setup.podmanGuide")}
              </a>
            )}
          </Step>

          <Step
            n={2}
            title={
              status?.runtime && !status.daemonUp
                ? t("vm.setup.step2Open", { runtime: status.runtime })
                : t("vm.setup.step2")
            }
            done={Boolean(status?.daemonUp)}
          >
            {!status?.runtime ? null : c?.runtimeStart ? (
              <CommandLine command={c.runtimeStart} />
            ) : (
              <div className="text-[13px] text-ink-secondary">{t("vm.setup.step2Detail")}</div>
            )}
          </Step>

          <Step n={3} title={t("vm.setup.step3")} done={Boolean(status?.image)}>
            {status?.daemonUp && (
              <ActionButton action="pull" pending={pending} onClick={() => void act("pull")}>{t("vm.setup.prepare")}</ActionButton>
            )}
            {c?.pull && <details className="text-[12px] text-ink-secondary"><summary className="cursor-pointer">{t("vm.setup.showPull")}</summary><div className="mt-2"><CommandLine command={c.pull} /></div></details>}
          </Step>

          <Step
            n={4}
            title={
              perBot
                ? t("vm.setup.step4PerBot")
                : needsRecreate
                  ? t("vm.setup.step4Recreate")
                  : t("vm.setup.step4")
            }
            done={!perBot && ready}
          >
            {perBot ? (
              <div className="text-[13px] leading-relaxed text-ink-secondary">
                {perBotRuntimeUnsupported
                  ? t("vm.setup.applePort")
                  : t("vm.setup.perBotHint")}
              </div>
            ) : needsRecreate ? (
              <>
                <div className="flex gap-2 text-[13px] text-warning">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{status?.problem}</span>
                </div>
                {status?.image ? (
                  <ActionButton action="recreate" pending={pending} onClick={() => void act("recreate")} danger>
                    <RotateCcw size={13} /> {t("vm.setup.recreate")}
                  </ActionButton>
                ) : (
                  <div className="text-[13px] text-ink-secondary">{t("vm.setup.prepareFirst")}</div>
                )}
              </>
            ) : status?.container === "stopped" ? (
              <>
                <p className="text-[13px] text-ink-secondary">{t(status.stop_reason === "idle" ? "vm.stopped.idle" : "vm.stopped.detail")}</p>
                <ActionButton action="start" pending={pending} onClick={() => void act("start")}>{t("vm.setup.start")}</ActionButton>
              </>
            ) : status?.container === "running" ? (
              <div className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={13} className="animate-spin" /> {t("vm.setup.waiting")}</div>
            ) : status?.image ? (
              <>
                <ActionButton action="run" pending={pending} onClick={() => void act("run")}>{t("vm.setup.start")}</ActionButton>
                <p className="text-[13px] leading-relaxed text-ink-secondary">{t("vm.setup.idleHint")}</p>
              </>
            ) : null}
            {c?.run && <details className="text-[12px] text-ink-secondary"><summary className="cursor-pointer">{t("vm.setup.showCommand")}</summary><div className="mt-2"><CommandLine command={c.run} /></div></details>}
          </Step>
        </div>
      </Card>

      {perBot && (
        <LocalVmInventoryCard
          instances={inventory}
          maxInstances={inventoryMax || status?.max_instances || 2}
          loading={inventoryLoading}
          deletingBotId={deletingBotId}
          error={inventoryError}
          unavailableReason={inventoryUnavailableReason}
          onRefresh={() => setInventoryRefreshKey((key) => key + 1)}
          onDelete={(instance) => void deletePerBotVm(instance)}
        />
      )}

      {unavailable && (
        <div role="status" className="flex gap-2 rounded-[14px] border-[0.5px] border-border px-3.5 py-3 text-[13px] text-ink-secondary">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
          <span>{t("vm.inspectFailed")}</span>
        </div>
      )}

      <Card
        collapsible
        cardId="computer.safety"
        defaultOpen={false}
        title={t("vm.safety.title")}
        summary={t("settings.card.safety")}
        subtitle={
          perBot
            ? t("vm.safety.perBot", { path: status?.workspace_guest_path ?? "/home/cua/workspace" })
            : t("vm.safety.shared", { path: status?.workspace_guest_path ?? "/home/cua/workspace" })
        }
      >
        {existing && (
          <div className="flex flex-wrap gap-2">
            {status?.container === "running" && (
              <ActionButton action="stop" pending={pending} onClick={() => void act("stop")}>
                <Square size={12} /> {t("vm.safety.stop")}
              </ActionButton>
            )}
            <ActionButton action="remove" pending={pending} onClick={() => void act("remove")} danger>
              <Trash2 size={12} /> {perBot ? t("vm.safety.deleteLegacy") : t("vm.safety.deleteVm")}
            </ActionButton>
          </div>
        )}
        <div className="mt-3 break-all text-[11px] text-ink-secondary">
          {t("vm.safety.workspace", {
            path: status?.workspace_path ?? t("vm.safety.notCreated"),
            driver: status?.driver_version ?? "0.20.0",
            image: status?.image_ref ?? t("vm.safety.notPrepared"),
          })}
          {status?.base_image_ref ? <> · {t("vm.safety.baseImage", { image: status.base_image_ref })}</> : null}
        </div>
      </Card>
      </>}
    </>
  );
}
