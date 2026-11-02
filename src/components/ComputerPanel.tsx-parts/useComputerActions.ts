import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { waitForLocalVmReady } from "@/lib/local-vm-readiness";
import { isActiveTurnRefusal } from "@/lib/remote-desktop";
import { api, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { LocalizedPanelError } from "./errors";
import type { ComputerPending, LocalVmStatus, Phase, VpsComputerStatus } from "./types";
import type { CloudBackend } from "../../../shared/wire";

export function useComputerActions(args: {
  bot: Pick<Bot, "id" | "name" | "threadId" | "computer">;
  cloudBackend: CloudBackend;
  canManageCloud: boolean;
  vmStatus: LocalVmStatus | null;
  threadPath: (suffix: string) => string;
  vmActionController: MutableRefObject<AbortController | null>;
  vmReadinessAttempts: MutableRefObject<number>;
  setPending: Dispatch<SetStateAction<ComputerPending>>;
  setError: Dispatch<SetStateAction<Error | string | null>>;
  setBoatState: Dispatch<SetStateAction<string | null>>;
  setResolvedComputerSelection: Dispatch<SetStateAction<{
    botId: string;
    threadId: string;
    computer: Bot["computer"];
    cloudBackend: CloudBackend;
  } | null>>;
  setPhase: Dispatch<SetStateAction<Phase>>;
  setVmStatus: Dispatch<SetStateAction<LocalVmStatus | null>>;
  setVpsStatus: Dispatch<SetStateAction<VpsComputerStatus | null>>;
  setRetry: Dispatch<SetStateAction<number>>;
}) {
  const {
    bot, cloudBackend, canManageCloud, vmStatus, threadPath,
    vmActionController, vmReadinessAttempts,
    setPending, setError, setBoatState, setResolvedComputerSelection, setPhase,
    setVmStatus, setVpsStatus, setRetry,
  } = args;

  const run = (kind: "sleep" | "provision") => {
    setPending(kind);
    setError(null);
    api(`/api/bots/${bot.id}/computer/${kind}`, { method: "POST" })
      .then((result) => {
        if (kind === "provision") {
          setBoatState(result.container ?? null);
          if (result.ready) {
            if (bot.computer === "cloud") {
              setResolvedComputerSelection({ botId: bot.id, threadId: bot.threadId, computer: bot.computer, cloudBackend });
            }
            setPhase("ready");
          }
          else {
            setError(result.problem ?? new LocalizedPanelError("computer.err.vpsNotReady"));
            setPhase("error");
          }
        }
        if (kind === "sleep") {
          setResolvedComputerSelection(null);
          setBoatState(cloudBackend === "vps" ? "stopped" : "archived");
          if (cloudBackend === "vps") setPhase("vps-stopped");
          else setPhase(canManageCloud ? "cloud-asleep" : "show-sleeping-boat");
        }
      })
      .catch((e) => {
        setError(e.message);
      })
      .finally(() => setPending(null));
  };

  /** The person's own Start it now / Wake it now: the only way the panel
   * starts a cloud computer. Choosing it or opening the panel never does. */
  const startCloudComputer = () => {
    setPending("provision");
    setError(null);
    setPhase("starting");
    api(`/api/bots/${bot.id}/computer/provision`, { method: "POST" })
      .then((result) => {
        setBoatState(result.state ?? null);
        setResolvedComputerSelection({ botId: bot.id, threadId: bot.threadId, computer: bot.computer, cloudBackend });
        setPhase("ready");
      })
      .catch((e) => {
        // A turn started meanwhile: it starts the computer it needs, and the
        // panel watches.
        if (isActiveTurnRefusal(e)) {
          setPhase("busy-boat");
          return;
        }
        setError(e.message);
        setPhase("error");
      })
      .finally(() => setPending(null));
  };

  const runVmAction = async (action: "vm-start" | "vm-create" | "vm-recreate" | "vm-delete") => {
    if (
      (action === "vm-recreate" || action === "vm-delete") &&
      !window.confirm(
        action === "vm-delete"
          ? t("computer.confirm.deleteVm", { name: bot.name })
          : t("computer.confirm.replaceVm", { name: bot.name }),
      )
    ) return;
    if (vmActionController.current) return;
    const controller = new AbortController();
    vmActionController.current = controller;
    setPending(action);
    setError(null);
    vmReadinessAttempts.current = 0;
    try {
      if (action === "vm-recreate" || action === "vm-delete") {
        await api(`/api/bots/${bot.id}/local-computer/remove`, {
          method: "POST",
          body: "{}",
          signal: controller.signal,
        });
      }
      if (action !== "vm-delete") {
        // Shared mode has one desktop, started from the same route as Settings.
        const lifecyclePath = action === "vm-start" && vmStatus?.mode !== "per-bot"
          ? "/api/local-computer/start"
          : `/api/bots/${bot.id}/local-computer/${action === "vm-start" ? "start" : "run"}`;
        const started: LocalVmStatus = await api(lifecyclePath, {
          method: "POST",
          body: "{}",
          signal: controller.signal,
        });
        const status = await waitForLocalVmReady(started, () => api(threadPath("local-computer"), { signal: controller.signal }), controller.signal);
        if (!status.ready) throw new Error(status.problem ?? t("computer.err.vmNotReady"));
        setVmStatus(status);
        setPhase("vm");
      } else {
        setVmStatus((current) => current ? { ...current, container: "missing", ready: false } : current);
        setPhase("vm-unavailable");
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(readableError(e));
      setPhase("vm-unavailable");
    } finally {
      if (vmActionController.current === controller && !controller.signal.aborted) {
        vmActionController.current = null;
        setPending(null);
        setRetry((n) => n + 1);
      }
    }
  };

  const replaceVpsComputer = async () => {
    if (!window.confirm(t("computer.confirm.replaceVps", { name: bot.name }))) return;
    setPending("vps-replace");
    setError(null);
    try {
      await api(`/api/bots/${bot.id}/computer/remove`, { method: "POST", body: "{}" });
      const result: VpsComputerStatus = await api(`/api/bots/${bot.id}/computer/provision`, {
        method: "POST",
        body: "{}",
      });
      setVpsStatus(result);
      setBoatState(result.container ?? null);
      if (result.ready && bot.computer === "cloud") {
        setResolvedComputerSelection({ botId: bot.id, threadId: bot.threadId, computer: bot.computer, cloudBackend });
      }
      setPhase(result.ready ? "ready" : "error");
      if (!result.ready) setError(result.problem ?? new LocalizedPanelError("computer.err.vpsReplaceNotReady"));
    } catch (e) {
      setError(readableError(e));
      setPhase("error");
    } finally {
      setPending(null);
      setRetry((n) => n + 1);
    }
  };

  return { run, startCloudComputer, runVmAction, replaceVpsComputer };
}
