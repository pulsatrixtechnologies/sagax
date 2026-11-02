import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { api, type Bot } from "@/state/store";
import { transitionComputerControlLease, type ComputerControlAction } from "@/lib/computer-control";
import { withTeachBot } from "@/lib/computer-teach-client";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { LocalizedPanelError } from "./errors";
import { computerControlSnapshotSchema, type ComputerPending } from "./types";

type DispatchStore = (action: {
  type: "computerControl";
  botId: string;
  held: boolean;
  helpReason: string | null;
}) => void;

export function useComputerControl(args: {
  bot: Pick<Bot, "id" | "name">;
  control: { held: boolean; helpReason: string | null };
  cloudPreviewReady: boolean;
  cloudBackend: string;
  vmViewerUrl: string | null;
  viewerConnection: MutableRefObject<string>;
  viewerConnectionKey: string;
  desktopJoin: MutableRefObject<AbortController | null>;
  threadPath: (suffix: string) => string;
  dispatch: DispatchStore;
  setPending: Dispatch<SetStateAction<ComputerPending>>;
  setControlPending: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<Error | string | null>>;
}) {
  const {
    bot, control, cloudPreviewReady, cloudBackend, vmViewerUrl,
    viewerConnection, viewerConnectionKey, desktopJoin, threadPath, dispatch,
    setPending, setControlPending, setError,
  } = args;

  // who-is-driving: SSE keeps this fresh; the mount fetch covers a panel
  // opened after the last frame (e.g. an app reload mid-hold)
  useEffect(() => {
    let alive = true;
    api(`/api/bots/${bot.id}/computer/control`)
      .then((raw) => {
        if (!alive) return;
        const snap = computerControlSnapshotSchema.parse(raw);
        dispatch({
          type: "computerControl",
          botId: bot.id,
          held: snap.held === true,
          helpReason: snap.helpReason,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);

  const requestControl = useCallback(async (action: ComputerControlAction) => {
    const snap = computerControlSnapshotSchema.parse(await api(`/api/bots/${bot.id}/computer/control`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }));
    dispatch({
      type: "computerControl",
      botId: bot.id,
      held: snap.held === true,
      helpReason: snap.helpReason,
    });
    return snap;
  }, [bot.id, dispatch]);

  // The engine owns its browser; there is no native surface to hold.
  const setNativeBrowserControl = useCallback(async (): Promise<boolean> => true, []);

  const transitionControl = useCallback(async (action: ComputerControlAction) => {
    // BrowserPanel performs the same two-phase transition itself. Every
    // other computer surface must also gate Electron's direct browser host:
    // the server hold is bot-wide, and a shell-capable agent can otherwise
    // bypass the server proxy while the person drives Local VM/Box/VPS.
    return transitionComputerControlLease({
      action,
      syncNativeBrowser: true,
      requestControl,
      setNativeBrowserControl,
    });
  }, [requestControl, setNativeBrowserControl]);

  const controlAction = useCallback(async (action: ComputerControlAction): Promise<boolean> => {
    setControlPending(true);
    setError(null);
    try {
      await transitionControl(action);
      return true;
    } catch (cause) {
      setError(readableError(cause));
      return false;
    } finally {
      setControlPending(false);
    }
  }, [transitionControl, setControlPending, setError]);

  const openDesktop = async () => {
    const controller = new AbortController();
    desktopJoin.current = controller;
    const ownsConnection = () => !controller.signal.aborted && viewerConnection.current === viewerConnectionKey;
    setPending("join");
    setControlPending(true);
    setError(null);
    let tookControl = false;
    // A plain-web development session still needs a synchronous blank tab;
    // the packaged app uses the reliable Electron viewer window below.
    let fallbackTab: Window | null = null;
    if (!window.ogb?.desktopViewer && !window.ogb?.openExternal) {
      fallbackTab = window.open("", "_blank");
      if (fallbackTab) fallbackTab.opener = null;
    }
    try {
      if (!control.held) {
        await transitionControl("take");
        tookControl = true;
      }
      if (!ownsConnection()) throw new DOMException("The selected conversation changed", "AbortError");

      let viewerUrl = vmViewerUrl;
      if (cloudPreviewReady) {
        const result = await api(threadPath("computer/join"), { method: "POST", signal: controller.signal });
        viewerUrl = result.joinUrl?.constructor === String ? String(result.joinUrl) : null;
      }
      if (!ownsConnection()) throw new DOMException("The selected conversation changed", "AbortError");
      if (!viewerUrl) throw new LocalizedPanelError("computer.err.noDesktopLink");

      if (window.ogb?.desktopViewer) {
        // the app's own viewer offers Teach on this bot's computer (parity R7)
        const opened = await window.ogb.desktopViewer.open(withTeachBot(viewerUrl, bot), t("computer.viewerTitle", { name: bot.name }), bot.id);
        if (!opened) throw new LocalizedPanelError("computer.err.openDesktop");
      } else if (fallbackTab) {
        fallbackTab.location.replace(viewerUrl);
      } else if (window.ogb?.openExternal) {
        const opened = await window.ogb.openExternal(viewerUrl);
        if (!opened) throw new LocalizedPanelError("computer.err.openDesktopLink");
      } else if (!window.open(viewerUrl, "_blank", "noopener")) {
        throw new LocalizedPanelError("computer.err.popupBlocked");
      }
    } catch (e) {
      fallbackTab?.close();
      // Release the bot before waiting on best-effort tunnel cleanup. A sick
      // SSH process must never leave the agent paused indefinitely.
      if (tookControl) await transitionControl("release").catch(() => {});
      if (cloudPreviewReady && cloudBackend === "vps") {
        await api(threadPath("computer/viewer-close"), { method: "POST", body: "{}" }).catch(() => {});
      }
      if (ownsConnection()) setError(e instanceof Error ? e : String(e));
    } finally {
      if (desktopJoin.current === controller) {
        desktopJoin.current = null;
        setPending(null);
        setControlPending(false);
      }
    }
  };

  return { controlAction, openDesktop, transitionControl };
}
