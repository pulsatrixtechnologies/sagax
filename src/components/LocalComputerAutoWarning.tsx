import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

import { t } from "@/lib/i18n";
import { localAutoAcknowledged, rememberLocalAutoAck } from "@/lib/local-auto-ack";
import { ConfirmDialog } from "./ConfirmDialog";

export const LOCAL_COMPUTER_AUTO_WARNING =
  "Auto mode will let this bot click, type, and run tools on this computer without asking first. Destructive and sensitive actions still stop. Continue only if you are watching.";

export function LocalComputerAutoWarning({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // 2026-10-26 (owner): read once per computer. Once confirmed, the next
  // switch to Auto here goes through without the card (src/lib/local-auto-ack.ts).
  const acknowledged = open && localAutoAcknowledged();
  const autoConfirmed = useRef(false);
  useEffect(() => {
    if (!open) {
      autoConfirmed.current = false;
      return;
    }
    if (!acknowledged || autoConfirmed.current) return;
    autoConfirmed.current = true;
    onConfirm();
  }, [open, acknowledged, onConfirm]);

  if (!open || acknowledged) return null;

  return (
    <ConfirmDialog
      open
      tone="neutral"
      icon={<AlertTriangle size={18} />}
      title={t("localAuto.title")}
      body={t("localAuto.body")}
      confirmLabel={t("localAuto.ok")}
      onCancel={onCancel}
      onConfirm={() => {
        rememberLocalAutoAck();
        onConfirm();
      }}
    />
  );
}
