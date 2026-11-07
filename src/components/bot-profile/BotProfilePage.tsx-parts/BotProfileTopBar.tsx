// The page's top bar (#2313, split from BotProfilePage for #1383): the close
// button and who sees the bot stay put while the page scrolls, on an opaque
// bar, centred like the sidebar head's search and + circles.
import { type CSSProperties } from "react";
import { Lock, Users } from "lucide-react";

import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_LABEL } from "@/lib/circle-button";
import { useShowSidebarLogo } from "@/lib/sidebar-logo-preferences";
import { useCaptionChrome, useMacInsetChrome } from "../../DesktopCapabilities";
import { WindowCloseButton } from "../../WindowCloseButton";
import { ShareBotButton } from "../ShareBotButton";

export function BotProfileTopBar({ bot, onClose, privateBot, shareShown, shareOpen, onShareOpenChange, bannerStyle, bannerPalette }: {
  bot: Bot;
  onClose: () => void;
  privateBot: boolean;
  shareShown: boolean;
  shareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
  bannerStyle: CSSProperties;
  bannerPalette: string;
}) {
  const { noDragStyle, controlsShiftStyle, dragProps, dragStyle } = useCaptionChrome();
  // X and Private / Shared never scroll away, on the sidebar head's centre
  // line with its circles' size. The sidebar's head is one 48px row in the
  // title bar (macOS inset or the browser's dots, no logo, circles 24px
  // down), else a 56px row (28px down), under the 36px inset strip when the
  // logo shows on macOS or in a browser.
  const { macInset, browser } = useMacInsetChrome();
  const showLogo = useShowSidebarLogo();
  const titleBarHead = (macInset || browser) && !showLogo;
  const insetStrip = (macInset || browser) && showLogo;

  return (
    <>
      {insetStrip && <div aria-hidden="true" data-bot-profile-inset-strip="" className="content-topbar-strip h-9 shrink-0 bg-app" {...dragProps} />}
      <div
        data-bot-profile-topbar=""
        data-bot-profile-banner-palette={bannerPalette}
        {...dragProps}
        style={{ ...dragStyle, ...bannerStyle, minHeight: 0 }}
        className={cn("content-topbar bot-profile-banner-top relative z-10 flex shrink-0 items-center justify-between gap-2 px-3", titleBarHead ? "h-12" : "h-14")}
      >
        <WindowCloseButton onClose={onClose} place="relative max-sm:ml-11" />
        <div className="flex items-center gap-2" style={controlsShiftStyle ?? noDragStyle}>
          <span
            data-bot-profile-visibility={privateBot ? "private" : "shared"}
            className={CIRCLE_LABEL}
          >
            {privateBot ? <Lock size={14} strokeWidth={1.75} aria-hidden="true" /> : <Users size={14} strokeWidth={1.75} aria-hidden="true" />}
            {privateBot ? t("botProfile.private") : t("botProfile.shared")}
          </span>
          {/* Share (Grok Bot): the popover where the people and groups the
              bot is shared with are managed, the one place for it. */}
          {shareShown && <ShareBotButton bot={bot} open={shareOpen} onOpenChange={onShareOpenChange} />}
        </div>
      </div>
    </>
  );
}
