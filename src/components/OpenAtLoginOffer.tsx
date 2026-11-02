// Proposed once on a Mac: open Sagax when the person signs in. Nothing is
// turned on until they accept here. They can change it later in Settings.
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { DescribedRow, Switch } from "./SettingsPrimitives";

type Choice = "unset" | "on" | "off";

interface OpenAtLoginState {
  choice: Choice;
  platform: string;
}

function bridge() {
  return window.ogb?.openAtLogin;
}

export function OpenAtLoginOffer() {
  const [state, setState] = useState<OpenAtLoginState | null>(null);
  // Escape puts the banner away for this session; nothing is chosen, so it
  // is proposed again next time.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const api = bridge();
    if (!api) return;
    let gone = false;
    void api.get().then((next) => { if (!gone) setState(next); }).catch(() => {});
    return () => { gone = true; };
  }, []);
  const offered = Boolean(state && state.platform === "darwin" && state.choice === "unset") && !dismissed;
  useEffect(() => {
    if (!offered) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setDismissed(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey);
  }, [offered]);
  if (!offered) return null;
  const choose = (choice: "on" | "off") => {
    void bridge()?.set(choice).then(setState).catch(() => {});
  };
  return (
    <div
      role="region"
      aria-labelledby="open-at-login-title"
      data-open-at-login-offer=""
      className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-[min(440px,calc(100%-32px))] flex-col gap-3 rounded-2xl border border-hairline bg-elevated p-4 shadow-lg"
    >
      <h2 id="open-at-login-title" className="text-[15px] font-medium text-ink">{t("openAtLogin.title")}</h2>
      <p className="text-[13px] leading-5 text-ink-secondary">{t("openAtLogin.body")}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-full px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-hover" onClick={() => choose("off")}>{t("openAtLogin.notNow")}</button>
        <button type="button" className="rounded-full bg-accent px-3 py-1.5 text-[13px] text-white" onClick={() => choose("on")}>{t("openAtLogin.accept")}</button>
      </div>
    </div>
  );
}

/** The same choice in Settings, after the proposal or instead of it. */
export function OpenAtLoginRow() {
  const [state, setState] = useState<OpenAtLoginState | null>(null);
  useEffect(() => {
    const api = bridge();
    if (!api) return;
    let gone = false;
    void api.get().then((next) => { if (!gone) setState(next); }).catch(() => {});
    return () => { gone = true; };
  }, []);
  if (!state || state.platform !== "darwin") return null;
  const on = state.choice === "on";
  return (
    <DescribedRow label={t("openAtLogin.setting")} rowId="openAtLogin" description={t("openAtLogin.settingHelp")}>
      <Switch
        checked={on}
        aria-label={t("openAtLogin.setting")}
        onClick={() => {
          const choice = on ? "off" : "on";
          void bridge()?.set(choice).then(setState).catch(() => {});
        }}
      />
    </DescribedRow>
  );
}
