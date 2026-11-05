import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import {
  PENDING_CLOUD_DELETE_REFRESH_DELAYS_MS,
  cloudComputerActionPlan,
  computerInventoryRequest,
  confirmComputerAction,
  perBotLocalVmDeletePlan,
  reconcileCloudInventoryPayload,
  reconcileCloudInventorySnapshot,
  vpsComputerRemovePlan,
  waitForCloudDeleteRefresh,
} from "./inventoryApi";
import type {
  CloudAction,
  CloudComputerInventoryInstance,
  CloudComputerInventoryPayload,
  CloudPostActionOverrides,
  LocalVmInventoryInstance,
  LocalVmInventoryPayload,
  PendingCloudAction,
  Status,
  VpsComputerInventoryInstance,
  VpsComputerInventoryPayload,
} from "./types";

export function useComputerInventories({
  manageComputers,
  statusMode,
  confirmDanger,
  setAnnouncement,
}: {
  manageComputers: boolean;
  statusMode: Status["mode"] | undefined;
  confirmDanger: (message: string) => Promise<boolean> | boolean;
  setAnnouncement: (message: string) => void;
}) {
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
    if (statusMode !== "per-bot") {
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
          setInventoryError(readableError(e));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setInventoryLoading(false);
      });
    return () => controller.abort();
  }, [inventoryRefreshKey, refreshInventory, statusMode]);

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
          setCloudUnavailableReason(readableError(e));
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
          setVpsUnavailableReason(readableError(e));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setVpsLoading(false);
      });
    return () => controller.abort();
  }, [manageComputers, refreshVpsInventory, vpsRefreshKey]);

  const deletePerBotVm = async (instance: LocalVmInventoryInstance) => {
    if (!instance.managed) {
      setInventoryError(t("vm.unmanagedError"));
      return;
    }
    const request = await confirmComputerAction(perBotLocalVmDeletePlan(instance), confirmDanger);
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
      setInventoryError(readableError(e));
    } finally {
      setDeletingBotId(null);
    }
  };

  const actOnCloudComputer = async (action: CloudAction, instance: CloudComputerInventoryInstance) => {
    const request = await confirmComputerAction(cloudComputerActionPlan(action, instance), confirmDanger);
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
          const detail = readableError(refreshError);
          setCloudError(`${subject}: ${t("vm.state.removing")}. ${detail}`);
        }
        return;
      }

      try {
        await refreshCloudInventory();
      } catch (refreshError) {
        const detail = readableError(refreshError);
        setCloudError(t(action === "delete" ? "vm.cloud.deletedRefreshError" : "vm.cloud.sleepRefreshError", { subject, detail }));
      }
    } catch (e) {
      setCloudError(readableError(e));
    } finally {
      setCloudPending(null);
    }
  };

  const removeVpsComputer = async (instance: VpsComputerInventoryInstance) => {
    const request = await confirmComputerAction(vpsComputerRemovePlan(instance), confirmDanger);
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
      setVpsError(readableError(e));
    } finally {
      setVpsRemovingName(null);
    }
  };

  return {
    inventory,
    inventoryMax,
    inventoryLoading,
    inventoryError,
    inventoryUnavailableReason,
    deletingBotId,
    bumpInventoryRefresh: () => setInventoryRefreshKey((key) => key + 1),
    cloudInventory,
    cloudConfigured,
    cloudLoading,
    cloudError,
    cloudUnavailableReason,
    cloudPending,
    bumpCloudRefresh: () => setCloudRefreshKey((key) => key + 1),
    vpsInventory,
    vpsConfigured,
    vpsSshAlias,
    vpsLoading,
    vpsError,
    vpsUnavailableReason,
    vpsRemovingName,
    bumpVpsRefresh: () => setVpsRefreshKey((key) => key + 1),
    deletePerBotVm,
    actOnCloudComputer,
    removeVpsComputer,
  };
}
