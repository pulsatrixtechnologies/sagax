// The Vault's centered window (#4094): New item, Manage, Edit, Import and
// Export open over the page the way the reference draws its vault dialogs
// (560 px, the title at the top left with the round close button, stacked
// fields, the pills at the bottom right). The app's own dialog layer and
// frame, and the shared modal keyboard (useModalDialog): Tab stays inside,
// Escape closes this window only (never a dropdown's Escape, never Settings
// behind it), focus goes back to what opened it.
import { useEffect, useId, useRef, type ReactNode } from "react";

import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { DialogFrame, DialogLayer, type DialogWidth } from "../SettingsPrimitives";

export function VaultDialog({ title, subtitle, onClose, footer, width = "lg", children, ...data }: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: DialogWidth;
  children?: ReactNode;
} & { [key: `data-${string}`]: string | undefined }) {
  const titleId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  useModalDialog(frameRef, onClose);
  // The first field takes the focus, as the reference's dialogs open.
  useEffect(() => {
    frameRef.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])")?.focus({ preventScroll: true });
  }, []);
  return (
    <DialogLayer onBackdropMouseDown={onClose}>
      <DialogFrame
        titleId={titleId}
        title={title}
        subtitle={subtitle}
        width={width}
        closeLabel={t("vault.transfer.close")}
        onClose={onClose}
        frameRef={frameRef}
        frameProps={{ "data-vault-dialog": "", ...data }}
        footer={footer}
      >
        {children}
      </DialogFrame>
    </DialogLayer>
  );
}
