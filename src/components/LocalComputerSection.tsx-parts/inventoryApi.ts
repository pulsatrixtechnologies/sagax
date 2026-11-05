import { t } from "@/lib/i18n";
import type {
  CloudAction,
  CloudComputerInventoryInstance,
  CloudComputerInventoryPayload,
  CloudPostActionOverrides,
  ComputerActionPlan,
  ComputerApiRequest,
  ComputerInventoryRequest,
  LocalVmInventoryInstance,
  VpsComputerInventoryInstance,
} from "./types";

export const PENDING_CLOUD_DELETE_REFRESH_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export function waitForCloudDeleteRefresh(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
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

export async function confirmComputerAction(
  plan: ComputerActionPlan,
  confirm: (message: string) => Promise<boolean> | boolean,
): Promise<ComputerApiRequest | null> {
  if (plan.confirmation !== null && !(await confirm(plan.confirmation))) return null;
  return plan.request;
}
