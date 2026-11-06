// The X of a window Sagax opens over the chat (#2149, JC 2026-11-06): the same
// icon, size and place as the X of a page Sagax opens (the bot's profile
// page). It brings the person back to the chat. It is the app's round header
// control (CIRCLE_BUTTON), like the X of the bot panel and the side thread.
import type { HTMLAttributes } from "react";
import { X } from "lucide-react";

import { CIRCLE_CLOSE_BUTTON, CIRCLE_ICON } from "@/lib/circle-button";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useCaptionChrome } from "./DesktopCapabilities";

type DataAttributes = { [key: `data-${string}`]: string | boolean | undefined };

/** `place` replaces the default corner (absolute, top left) when the X sits in
 * a row of its own (the bot's profile page pins it in a top bar, #2313). */
export function WindowCloseButton({ onClose, place, ...data }: { onClose: () => void; place?: string } & DataAttributes & Pick<HTMLAttributes<HTMLButtonElement>, "id">) {
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
      className={cn(CIRCLE_CLOSE_BUTTON, place ?? "absolute left-3 top-3 max-sm:left-14")}
    >
      <X {...CIRCLE_ICON} aria-hidden="true" />
    </button>
  );
}
