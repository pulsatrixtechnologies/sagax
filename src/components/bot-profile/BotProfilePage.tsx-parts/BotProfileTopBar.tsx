// The page's top bar (#2313, split from BotProfilePage for #1383): the close
// button and Share stay put while the page scrolls, centred like
// the sidebar head's search and + circles. Grok Bot (JC 2026-11-08): the bar
// floats over the banner, clear, so the banner and the mascot scroll away
// under it whole; once the name has scrolled under it, the bar turns into a
// blurred strip of the page's ground with the small mascot and the name.
// Nothing is ever cut by an opaque coloured band.
import type { Bot } from "@/state/store";
import type { BotProfileTab } from "@/lib/persona-sections";
import { cn } from "@/lib/cn";
import { useShowSidebarLogo } from "@/lib/sidebar-logo-preferences";
import { BotAvatar } from "@/components/Avatar";
import { splitBotNameTitle } from "../../bot-settings/bot-name-title";
import { useCaptionChrome, useMacInsetChrome } from "../../DesktopCapabilities";
import { WindowCloseButton } from "../../WindowCloseButton";
import { ShareBotButton } from "../ShareBotButton";
import { SubPageBack } from "./subpages";

/** The macOS inset strip above the page (the logo shows in the sidebar):
 * outside the scroll, the window's own top. */
export function BotProfileInsetStrip() {
  const { dragProps } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const showLogo = useShowSidebarLogo();
  if (!((macInset || browser) && showLogo)) return null;
  return <div aria-hidden="true" data-bot-profile-inset-strip="" className="content-topbar-strip h-9 shrink-0 bg-app" {...dragProps} />;
}

export function BotProfileTopBar({ bot, onClose, back, shareShown, shareOpen, onShareOpenChange, condensed }: {
  bot: Bot;
  onClose: () => void;
  /** On a sub-page: the link back to its tab, beside the close button (#4078). */
  back: { tab: BotProfileTab; onBack: () => void } | null;
  shareShown: boolean;
  shareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
  /** The name has scrolled under the bar: show the small mascot and the name on a blurred ground. */
  condensed: boolean;
}) {
  const { noDragStyle, controlsShiftStyle, dragProps, dragStyle } = useCaptionChrome();
  // On the sidebar head's centre line with its circles' size: one 48px row
  // in the title bar (macOS inset or the browser's dots, no logo), else a
  // 56px row.
  const { macInset, browser } = useMacInsetChrome();
  const showLogo = useShowSidebarLogo();
  const titleBarHead = (macInset || browser) && !showLogo;
  const name = splitBotNameTitle(bot.name, bot.title).name;

  return (
    <div
      data-bot-profile-topbar=""
      data-bot-profile-topbar-condensed={condensed ? "" : undefined}
      {...dragProps}
      style={dragStyle}
      className={cn(
        // sticky in the scroll, taking no room in the flow: the banner starts under it
        "sticky top-0 z-20 flex shrink-0 items-center justify-between gap-2 px-3 transition-[background-color,box-shadow] duration-150",
        titleBarHead ? "-mb-12 h-12" : "-mb-14 h-14",
        condensed ? "bg-app/85 shadow-[0_1px_0_var(--color-hairline-weak)] backdrop-blur-md" : "bg-transparent",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WindowCloseButton onClose={onClose} place="relative shrink-0 max-sm:ml-11" />
        {back && (
          <div className="flex shrink-0" style={noDragStyle}>
            <SubPageBack tab={back.tab} onBack={back.onBack} />
          </div>
        )}
        {/* the condensed header: the small mascot and the name, once the hero is gone */}
        <div
          data-bot-profile-condensed=""
          aria-hidden={condensed ? undefined : "true"}
          className={cn("flex min-w-0 items-center gap-2 transition-opacity duration-150", condensed ? "opacity-100" : "pointer-events-none opacity-0")}
        >
          <BotAvatar bot={bot} size={26} />
          <span className="min-w-0 truncate text-[14px] font-medium leading-5 text-ink">{name}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2" style={controlsShiftStyle ?? noDragStyle}>
        {/* Share (Grok Bot): the popover where the people and groups the
            bot is shared with are managed, the one place for it. */}
        {shareShown && <ShareBotButton bot={bot} open={shareOpen} onOpenChange={onShareOpenChange} />}
      </div>
    </div>
  );
}
