// #2080 L3: Mac control as one Computer row (status + Open → Computer panel).
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { macCuaPermissionMessage, missingMacCuaPermissions } from "@/lib/mac-cua-permissions";
import { MacCuaRecoveryActions } from "../MacCuaRecoveryActions";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { useStore } from "@/state/store";
import { DescribedRow, PILL } from "../SettingsPrimitives";

/** Settings > Computer > Your computer: Mac screen/accessibility row. */
export function ComputerMacControlRow() {
  const { dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const reason = capabilities.localComputer.available ? null : capabilities.localComputer.message;
  const permissionMessage = macCuaPermissionMessage(missingMacCuaPermissions(reason));
  const granted = capabilities.localComputer.available;
  const [pending, setPending] = useState(false);
  const [awaitingGrant, setAwaitingGrant] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const retry = async () => {
    setPending(true);
    setError(null);
    try {
      await window.ogb?.localControl?.retry();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setPending(false);
    }
  };

  const openSettings = async () => {
    setError(null);
    setAwaitingGrant(true);
    try {
      await window.ogb?.permOpenSettings?.("accessibility");
      await window.ogb?.permOpenSettings?.("screen");
    } catch (cause) {
      setAwaitingGrant(false);
      setError(readableError(cause));
    }
  };

  useEffect(() => {
    if (!awaitingGrant) return;
    let used = false;
    const onFocus = () => {
      if (used) return;
      if (document.visibilityState !== "visible") return;
      used = true;
      setAwaitingGrant(false);
      void retry();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [awaitingGrant]);

  if (capabilities.host.platform !== "darwin" || capabilities.localComputer.reasonCode === "remote-server") return null;

  const openPanel = () => {
    dispatch({ type: "toggleAppSettings", open: false });
    dispatch({ type: "toggleComputer", open: true });
  };

  return (
    <div data-settings-card="computer.macControl">
      <DescribedRow
        label={t("settings.mac.allow")}
        rowId="macControl"
        description={granted ? t("computer.macControl.granted") : t("computer.macControl.needed")}
        below={!granted && open && (
          <div className="mt-2 flex flex-col gap-2 text-[12.5px] text-ink-secondary">
            <p>{permissionMessage ?? t("computer.mac.permission.generic")}</p>
            {reason && (
              <details>
                <summary className="cursor-pointer">{t("computer.mac.permission.driverDetail")}</summary>
                <p className="mt-1 break-words">{reason}</p>
              </details>
            )}
            {error && (
              <div className="flex gap-1.5 text-danger">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {permissionMessage && reason && <MacCuaRecoveryActions reason={reason} />}
              {!permissionMessage && (
                <button type="button" onClick={() => void openSettings()} disabled={pending} className={PILL}>
                  {t("settings.mac.open")}
                </button>
              )}
              <button type="button" onClick={() => void retry()} disabled={pending} className={`${PILL} gap-1.5`}>
                {pending && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
                {t("connectors.action.retry")}
              </button>
            </div>
          </div>
        )}
      >
        {granted ? (
          <button type="button" onClick={openPanel} className={PILL}>{t("computer.macControl.open")}</button>
        ) : (
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={PILL}>
            {t("computer.macControl.open")}
          </button>
        )}
      </DescribedRow>
    </div>
  );
}
