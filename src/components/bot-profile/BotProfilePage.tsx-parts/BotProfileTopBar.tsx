// The top of the bot page (#2313, split from BotProfilePage for #1383): no
// bar. Share and the round close button float together at the top right, as
// the reference's stage header (#4420), and nothing else is drawn there: no
// mascot, no name, no section, no ground and no rule, at the top of the page
// or once it has scrolled (owner, 2026-11-25, #5371; this replaces the
// blurred strip with the small mascot and the name of 2026-11-08). A
// sub-page is a modal over the page (#4470), so there is no link back. The
// row is clear, takes no room in the flow and no click: the banner and the
// page scroll under the two buttons, whole, and stay clickable there.
// Edit banner (M-20261127-183) joins them on hover of the banner group.
import { useRef, type RefObject } from "react";
import { Images } from "lucide-react";

import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_CLOSE_BUTTON, CIRCLE_ICON } from "@/lib/circle-button";
import { useShowSidebarLogo } from "@/lib/sidebar-logo-preferences";
import { useCaptionChrome, useMacInsetChrome } from "../../DesktopCapabilities";
import { WindowCloseButton } from "../../WindowCloseButton";
import { ShareBotButton } from "../ShareBotButton";
import { BotBannerEditPanel } from "../BotBannerEditPanel";
import type { BotPatch } from "../../bot-settings/useBotSettingsDerived";

/** The macOS inset strip above the page (the logo shows in the sidebar):
 * outside the scroll, the window's own top. */
export function BotProfileInsetStrip() {
  const { dragProps } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const showLogo = useShowSidebarLogo();
  if (!((macInset || browser) && showLogo)) return null;
  return <div aria-hidden="true" data-bot-profile-inset-strip="" className="content-topbar-strip h-9 shrink-0 bg-app" {...dragProps} />;
}

export function BotProfileTopBar({
  bot,
  onClose,
  shareShown,
  shareGrants,
  shareVisibility,
  shareOpen,
  onShareOpenChange,
  bannerEditShown,
  bannerEditOpen,
  onBannerEditOpenChange,
  onBannerPatch,
  imageGenConfigured,
}: {
  bot: Bot;
  onClose: () => void;
  shareShown: boolean;
  /** the people and groups part of the popover (an organization server) */
  shareGrants: boolean;
  /** Who can see it, in the popover */
  shareVisibility: boolean;
  shareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
  /** Owner may edit the banner (M-20261127-183). */
  bannerEditShown: boolean;
  bannerEditOpen: boolean;
  onBannerEditOpenChange: (open: boolean) => void;
  onBannerPatch: (patch: BotPatch) => void;
  imageGenConfigured: boolean;
}) {
  const { noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const editRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      data-bot-profile-topbar=""
      // Sticky in the scroll, after the banner and pulled back up over it,
      // taking no room in the flow. Its height is the frame's shared header
      // height, so the two circles sit as far under the window's top edge as
      // every other round control of the top row (owner, 2026-11-25, #5379).
      // The row itself is nothing: it takes no click (the rows that scroll
      // under it answer theirs) and it is not the window's drag handle (a
      // drag region swallows the clicks of whatever is under it). The banner
      // is the handle, and scrolls away (review of PR #5381, #5371).
      className="pointer-events-none sticky top-0 z-20 -mt-[124px] mb-[calc(124px-var(--app-topbar-height))] h-(--app-topbar-height) flex shrink-0 items-center justify-end gap-2 bg-transparent px-3"
    >
      {/* Only the buttons take the pointer. Cut out of the banner's drag
          region here: this group comes after the banner, and a later no-drag
          cuts into an earlier drag (styles.css, window drag regions). */}
      <div data-bot-profile-topbar-actions="" className="pointer-events-auto flex shrink-0 items-center gap-2" style={controlsShiftStyle ?? noDragStyle}>
        {bannerEditShown && (
          <>
            <button
              ref={editRef}
              type="button"
              data-bot-profile-banner-edit=""
              aria-haspopup="dialog"
              aria-expanded={bannerEditOpen}
              aria-label={t("botProfile.banner.edit")}
              title={t("botProfile.banner.edit")}
              onClick={() => onBannerEditOpenChange(!bannerEditOpen)}
              className={cn(
                CIRCLE_CLOSE_BUTTON,
                // Visible on banner hover (group-hover on the scroll area) or
                // while the panel is open; always reachable by keyboard focus.
                !bannerEditOpen && "opacity-0 group-hover/banner:opacity-100 focus-visible:opacity-100 touch:opacity-100",
              )}
            >
              <Images {...CIRCLE_ICON} aria-hidden="true" />
            </button>
            <BotBannerEditPanel
              bot={bot}
              open={bannerEditOpen}
              onOpenChange={onBannerEditOpenChange}
              anchorRef={editRef as RefObject<HTMLElement | null>}
              onPatch={onBannerPatch}
              imageGenConfigured={imageGenConfigured}
            />
          </>
        )}
        {/* Share (Grok Bot): the popover where the people and groups the
            bot is shared with are managed, the one place for it, a round
            icon button, never the word; then the round close button, the
            last control (#4420). */}
        {shareShown && <ShareBotButton bot={bot} open={shareOpen} onOpenChange={onShareOpenChange} grants={shareGrants} visibility={shareVisibility} />}
        <WindowCloseButton onClose={onClose} place="relative shrink-0" />
      </div>
    </div>
  );
}
