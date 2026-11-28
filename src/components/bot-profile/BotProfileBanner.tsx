// The bot page's top banner (M-20261127-183): default wash, preset, or
// own image, with optional effects. Share/Close sit over it; a soft veil
// keeps those controls and the mascot readable on any background.
import { useEffect, useState, type CSSProperties, type RefObject } from "react";

import { cn } from "@/lib/cn";
import { botBannerProfile } from "../../../shared/bot-banner";
import { bannerLayerStyle } from "@/lib/profile-banner-style";
import type { Bot } from "@/state/store";

export function BotProfileBanner({
  bot,
  wash,
  accent,
  palette,
  scrollRef,
  dragProps,
  reduceMotion,
}: {
  bot: Bot;
  wash: { from: string; to: string };
  /** Raw bot accent before the soft wash (mascot / mascot-deep presets). */
  accent: string;
  palette: string;
  scrollRef: RefObject<HTMLElement | null>;
  dragProps: { style?: CSSProperties; [key: string]: unknown };
  reduceMotion: boolean;
}) {
  const profile = botBannerProfile(bot);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    if (!profile.effects.parallax || reduceMotion) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => setScrollY(scroller.scrollTop);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [profile.effects.parallax, reduceMotion, scrollRef]);

  const layers = bannerLayerStyle({ profile, wash, accent, scrollY, reduceMotion });
  const { style: dragStyle, ...dragRest } = dragProps;

  return (
    <div
      aria-hidden="true"
      data-bot-profile-banner=""
      data-bot-profile-banner-palette={palette}
      data-bot-banner-preset={layers.showImage ? "image" : layers.pattern}
      data-bot-banner-veil={layers.veil ? "" : undefined}
      data-bot-banner-effect-blur={layers.effects.blur ? "" : undefined}
      data-bot-banner-effect-darken={layers.effects.darken ? "" : undefined}
      data-bot-banner-effect-grain={layers.effects.grain ? "" : undefined}
      data-bot-banner-effect-animated={layers.effects.animatedGradient && !reduceMotion ? "" : undefined}
      data-bot-banner-effect-parallax={layers.effects.parallax && !reduceMotion ? "" : undefined}
      {...dragRest}
      style={{ ...layers.root, ...dragStyle }}
      className={cn(
        "bot-profile-banner relative h-[124px] w-full shrink-0 overflow-hidden",
        layers.effects.animatedGradient && !reduceMotion && "bot-profile-banner-animated",
        layers.showPattern && `bot-profile-banner-pattern-${layers.pattern}`,
      )}
    >
      {layers.image && (
        <div
          data-bot-banner-image=""
          className="pointer-events-none absolute inset-[-12%] bg-cover bg-center"
          style={layers.image}
        />
      )}
      {layers.effects.grain && <div data-bot-banner-grain="" className="bot-profile-banner-grain pointer-events-none absolute inset-0" />}
      {/* Readability veil: soft darken at the top-right (Share/Close) and
          bottom-left (mascot), plus an optional full darken effect. */}
      {layers.veil && (
        <div
          data-bot-banner-veil-layer=""
          className={cn(
            "pointer-events-none absolute inset-0",
            layers.effects.darken ? "bot-profile-banner-veil-strong" : "bot-profile-banner-veil",
          )}
        />
      )}
    </div>
  );
}
