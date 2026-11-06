// The X of a window Sagax opens over the chat (#2149, JC 2026-11-06): the same
// icon, size and place as the X of a page Sagax opens (the bot's profile
// page). It brings the person back to the chat.
import type { HTMLAttributes } from "react";
import { X } from "lucide-react";

import { t } from "@/lib/i18n";
import { useCaptionChrome } from "./DesktopCapabilities";

type DataAttributes = { [key: `data-${string}`]: string | boolean | undefined };

export function WindowCloseButton({ onClose, ...data }: { onClose: () => void } & DataAttributes & Pick<HTMLAttributes<HTMLButtonElement>, "id">) {
  const { noDragStyle } = useCaptionChrome();
  return (
    <button
      type="button"
      {...data}
      data-window-close=""
      onClick={onClose}
      aria-label={t("common.close")}
      title={t("common.close")}
      style={noDragStyle}
      className="absolute left-3 top-3 flex size-8 items-center justify-center rounded-full bg-black/85 text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 max-sm:left-14"
    >
      <X size={16} aria-hidden="true" />
    </button>
  );
}
