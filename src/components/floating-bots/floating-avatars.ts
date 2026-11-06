// Labels, avatar loading and the desktop bridge helpers for FloatingBots.
import { useEffect, useRef, useState } from "react";
import { brand } from "@/lib/brand";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { botAvatarProfile } from "../../../shared/bot-avatar";
import type { FloatingLiveliness } from "@/lib/floating-bots";
import type { FloatingLabels } from "./brain";
import type { FloatingAvatar, FloatingBotsBridge, FloatingCallLevels } from "./protocol";

/** A picture bigger than this stays in the app; the window shows the owl instead. */
const AVATAR_BYTES_MAX = 280_000;

export function labelsFor(bot: Pick<Bot, "name">, liveliness: FloatingLiveliness = "normal"): FloatingLabels {
  const name = bot.name;
  const labels: FloatingLabels = {
    character: t("floatingBots.aria", { name }),
    inputLabel: t("floatingBots.input.label", { name }),
    placeholder: t("floatingBots.input.placeholder", { name }),
    send: t("floatingBots.send"),
    open: t("floatingBots.open", { app: brand().name }),
    close: t("floatingBots.menu.hide"),
    hello: t("floatingBots.hello"),
    thinking: t("floatingBots.thinking"),
    approvalTitle: t("floatingBots.approval.title"),
    approval: t("floatingBots.approval", { name }),
    errorTitle: t("floatingBots.error.title"),
    error: t("floatingBots.error"),
    // Open in <brand>: focuses the app on this bot (never "Open thread", #2086)
    menuOpen: t("floatingBots.menu.openIn", { app: brand().name }),
    menuHide: t("floatingBots.menu.hide"),
    menuShow: t("floatingBots.menu.show"),
    menuTop: t("floatingBots.menu.top"),
    menuDock: t("floatingBots.menu.dock"),
    menuFly: t("floatingBots.menu.fly"),
    moodLow: t("floatingBots.mood.low", { name }),
    moodOk: t("floatingBots.mood.ok", { name }),
    moodHappy: t("floatingBots.mood.happy", { name }),
    working: t("floatingBots.working", { name }),
    hoot: t("floatingBots.hoot"),
    pin: t("floatingBots.pin"),
    menuLively: t("floatingBots.menu.lively", { level: t(`floatingBots.lively.${liveliness}`) }),
    menuTalk: t("floatingBots.menu.talk"),
    menuCloseChat: t("floatingBots.menu.closeChat"),
    menuCall: t("floatingBots.menu.startCall"),
    menuHangUp: t("floatingBots.menu.hangUp"),
    menuSwitch: t("floatingBots.menu.switch"),
    menuMoves: t("floatingBots.menu.moves"),
    menuSnooze: t("floatingBots.menu.snooze"),
    menuHideMascot: t("floatingBots.menu.hideMascot"),
    menuOptions: t("floatingBots.menu.options"),
    menuSettings: t("floatingBots.menu.settings"),
    attach: t("composer.attach"),
  };
  return labels;
}

export function useReducedMotion(): boolean {
  const query = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const [reduced, setReduced] = useState(() => Boolean(query?.matches));
  useEffect(() => {
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [query]);
  return reduced;
}

/** The bot's own picture, when it has one: the app URL in the overlay, a data: URL for a desktop window. */
export function avatarBase(bot: Bot): Omit<FloatingAvatar, "src"> & { url: string } | null {
  const profile = botAvatarProfile(bot);
  if (!profile.avatarUrl || profile.avatarCrop === "mascot") return null;
  return {
    url: profile.avatarUrl,
    crop: profile.avatarCrop,
    zoom: bot.avatarZoom ?? 1,
    focusX: bot.avatarFocusX ?? 0.5,
    focusY: bot.avatarFocusY ?? 0.5,
  };
}

/** Reads each picture once, same-origin with the page's own session, into a bounded data: URL. */
export function useAvatarData(urls: string[], enabled: boolean): Record<string, string> {
  const [data, setData] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const key = urls.join("|");
  useEffect(() => {
    if (!enabled) return;
    for (const url of urls) {
      if (asked.current.has(url)) continue;
      asked.current.add(url);
      void fetch(url, { credentials: "same-origin" })
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (!blob || blob.size > AVATAR_BYTES_MAX || !/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) return null;
          return new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        })
        .then((src) => {
          if (src) setData((current) => ({ ...current, [url]: src }));
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return data;
}

/** The call's levels for a mascot drawn in this page (the browser overlay); a desktop window gets them through main. */
export const pageLevels = new Set<(levels: FloatingCallLevels) => void>();
export const onPageLevels = (listener: (levels: FloatingCallLevels) => void) => {
  pageLevels.add(listener);
  return () => void pageLevels.delete(listener);
};
/** How often the call's levels reach the mascot (its waveform and its bounce). */
export const LEVEL_MS = 50;

export function desktopBridge(): FloatingBotsBridge | null {
  if (typeof window === "undefined") return null;
  return (window.ogb?.floatingBots as FloatingBotsBridge | undefined) ?? null;
}
