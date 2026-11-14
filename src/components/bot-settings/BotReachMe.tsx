// "Me joindre" on the bot's Overview (2026-10-26): how THIS bot reaches
// the person outside the app when a question or an approval waits on them.
// Each person chooses for themself, no admin. Channels: phone
// notifications, a text message (their Perspicax Voice line, to their own
// verified number), their own Teams chat, their own Telegram bot, their own
// WhatsApp Business number (./BotReachMeWhatsApp.tsx). No id on screen: the
// Telegram bot is named by its @username, the WhatsApp number by its
// display number.
// #4250 (S2): a bot keeps only its channels. When is the person's ONE
// quiet-hours setting (Settings > Notifications), with which channels each
// level may use; the hours a previous version saved here ride along unchanged.
import { useState } from "react";

import { normalizePhone, type ReachChannelId, type ReachMeSettings } from "../../../shared/reach-me";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { connectReachTelegram, disconnectReachTelegram, reachWhatsApp, saveReachMe, useReachMe, type ReachMeView } from "@/lib/reach-me";
import type { LocaleKey } from "@/locales";
import { SettingsGroup, Switch } from "../SettingsPrimitives";
import { ReachWhatsAppSetup, type ReachWhatsAppAction } from "./BotReachMeWhatsApp";

const CHANNELS: ReachChannelId[] = ["push", "sms", "teams", "telegram", "whatsapp"];

const inputCls = "min-h-8 min-w-0 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 text-[13px] text-ink focus:border-focus";
const buttonCls = "rounded-lg border border-hairline/50 px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-raised disabled:opacity-40";

export type ReachMeActions = {
  onSave: (settings: ReachMeSettings) => Promise<{ ok: true } | { ok: false; error: string }>;
  onTelegramConnect: (token: string) => Promise<{ ok: true; link?: string } | { ok: false; error: string }>;
  onTelegramDisconnect: () => Promise<unknown>;
  /** One step of the WhatsApp setup (absent: the fields show, nothing is sent). */
  onWhatsApp?: ReachWhatsAppAction;
};

function channelHelp(id: ReachChannelId, view: ReachMeView): string {
  const status = view.channels[id];
  if (id === "push" && status.devices === 1) return t("botPanel.reachMe.push.deviceOne");
  if (id === "push") return status.devices ? t("botPanel.reachMe.push.devices", { count: String(status.devices) }) : t("botPanel.reachMe.push.none");
  return t(`botPanel.reachMe.${id}.help` as LocaleKey);
}

export function BotReachMeCard({ view, actions, initialTelegramLink }: { view: ReachMeView | null; actions: ReachMeActions; initialTelegramLink?: string }) {
  const [draft, setDraft] = useState<ReachMeSettings | null>(null);
  const [number, setNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [telegramLink, setTelegramLink] = useState<string | undefined>(initialTelegramLink);
  const [telegramError, setTelegramError] = useState<string | undefined>();
  if (!view) return null;
  const current = draft ?? view.settings;
  const phone = number ?? current.smsNumber ?? "";
  const dirty = draft !== null || (number !== null && number !== (view.settings.smsNumber ?? ""));
  const change = (next: ReachMeSettings) => { setDraft(next); setError(undefined); };
  const toggle = (id: ReachChannelId, on: boolean) => change({ ...current, channels: on ? [...current.channels.filter((c) => c !== id), id] : current.channels.filter((c) => c !== id) });
  const save = async () => {
    const smsNumber = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !smsNumber) { setError(t("botPanel.reachMe.sms.invalid")); return; }
    const next: ReachMeSettings = { ...current, ...(smsNumber ? { smsNumber } : {}) };
    if (!smsNumber) delete next.smsNumber;
    setBusy(true);
    const result = await actions.onSave(next);
    setBusy(false);
    if (result.ok) { setDraft(null); setNumber(null); } else setError(result.error);
  };
  const connect = async () => {
    setBusy(true);
    setTelegramError(undefined);
    const result = await actions.onTelegramConnect(token);
    setBusy(false);
    if (result.ok) { setToken(""); setTelegramLink(result.link); } else setTelegramError(result.error);
  };
  const telegram = view.channels.telegram;
  return (
    <div data-bot-reach-me="">
      <SettingsGroup title={t("botPanel.reachMe.label")} groupId="botReachMe">
        <p className="px-3.5 pb-1 pt-0.5 text-[12px] leading-4 text-ink-secondary">{t("botPanel.reachMe.help")}</p>
        {CHANNELS.map((id) => {
          const on = current.channels.includes(id);
          const status = view.channels[id];
          return (
            <div key={id} data-reach-channel={id} className="flex flex-col gap-1.5 px-3.5 py-2">
              <label className="flex min-w-0 cursor-pointer items-center justify-between gap-4 text-[13px] text-ink">
                <span className="min-w-0">
                  <span className="block leading-[18px]">{t(`botPanel.reachMe.${id}.label` as LocaleKey)}</span>
                  <span className="mt-0.5 block text-[12px] leading-4 text-ink-secondary">{channelHelp(id, view)}</span>
                </span>
                <Switch checked={on} disabled={busy} onClick={() => toggle(id, !on)} aria-label={t(`botPanel.reachMe.${id}.label` as LocaleKey)} />
              </label>
              {on && !status.ready && status.reason && id !== "telegram" && (id !== "whatsapp" || (status.connected && (!status.templateCheck || status.templateCheck.state === "approved"))) && (
                <p data-reach-not-ready="" title={status.reason} className="text-[12px] leading-4 text-warning">{t(`botPanel.reachMe.${id}.notReady` as LocaleKey)}</p>
              )}
              {on && id === "whatsapp" && <ReachWhatsAppSetup status={status} busy={busy} {...(actions.onWhatsApp ? { act: actions.onWhatsApp } : {})} />}
              {on && id === "sms" && (
                <input className={inputCls} value={phone} inputMode="tel" autoComplete="tel" placeholder="+1 514 555 0123" aria-label={t("botPanel.reachMe.sms.number")} onChange={(event) => { setNumber(event.target.value); setError(undefined); }} />
              )}
              {on && id === "telegram" && (
                telegram.connected ? (
                  <div className="flex items-center justify-between gap-2 text-[12px] text-ink-secondary">
                    <span data-reach-telegram-connected="">{t("botPanel.reachMe.telegram.connected", { name: `@${telegram.username ?? ""}` })}</span>
                    <button type="button" className={buttonCls} disabled={busy} onClick={() => void actions.onTelegramDisconnect()}>{t("botPanel.reachMe.telegram.disconnect")}</button>
                  </div>
                ) : telegramLink || telegram.linking ? (
                  <p data-reach-telegram-linking="" className="text-[12px] leading-4 text-ink-secondary">
                    {t("botPanel.reachMe.telegram.finish", { name: `@${telegram.username ?? ""}` })}{" "}
                    {telegramLink && <a className="text-accent-text underline" href={telegramLink} target="_blank" rel="noreferrer">{t("botPanel.reachMe.telegram.open")}</a>}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex gap-2">
                      <input className={cn(inputCls, "flex-1")} value={token} type="password" autoComplete="off" spellCheck={false} placeholder={t("botPanel.reachMe.telegram.tokenPlaceholder")} aria-label={t("botPanel.reachMe.telegram.token")} onChange={(event) => setToken(event.target.value)} />
                      <button type="button" className={buttonCls} disabled={busy || !token.trim()} onClick={() => void connect()}>{t("botPanel.reachMe.telegram.connect")}</button>
                    </div>
                    {telegramError && <p role="alert" className="text-[12px] leading-4 text-danger">{telegramError}</p>}
                  </div>
                )
              )}
            </div>
          );
        })}
        <p data-reach-hours-one="" className="border-t-[0.5px] border-border px-3.5 py-2 text-[12px] leading-4 text-ink-secondary">{t("botPanel.reachMe.hours.oneSetting")}</p>
        {error && <p role="alert" className="px-3.5 pb-1 text-[12px] leading-4 text-danger">{error}</p>}
        {dirty && (
          <div className="flex gap-2 px-3.5 py-2">
            <button type="button" data-reach-save="" disabled={busy} onClick={() => void save()} className={cn(buttonCls, "border-transparent bg-accent text-accent-ink hover:brightness-110")}>{t("botPanel.reachMe.save")}</button>
            <button type="button" disabled={busy} onClick={() => { setDraft(null); setNumber(null); setError(undefined); }} className={buttonCls}>{t("botPanel.reachMe.cancel")}</button>
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}

export function BotReachMe({ botId }: { botId: string }) {
  const [view, setView] = useReachMe(botId);
  const actions: ReachMeActions = {
    onSave: async (settings) => {
      const result = await saveReachMe(botId, settings);
      if (!result.ok) return { ok: false, error: result.error };
      setView(result.view);
      return { ok: true };
    },
    onTelegramConnect: async (token) => {
      const result = await connectReachTelegram(botId, token);
      if (!result.ok) return { ok: false, error: result.error };
      setView(result.view);
      return { ok: true, ...(result.link ? { link: result.link } : {}) };
    },
    onTelegramDisconnect: async () => {
      const result = await disconnectReachTelegram(botId);
      if (result.ok) setView(result.view);
    },
    onWhatsApp: async (step) => {
      const result = await reachWhatsApp(botId, step);
      if (!result.ok) return { ok: false, error: result.error };
      setView(result.view);
      return { ok: true };
    },
  };
  return <BotReachMeCard view={view} actions={actions} />;
}
