// The bot's own email address on its profile (B21, 2026-10-21): the
// address the Perspicax relay gave it, a Copy button, the one rule (mail
// only wakes a routine), and, while the administrator has not turned it on
// (off by default, JC decision 1), the address greyed with a waiting line.
// The bot's owner may change the part before the @ (JC decision 4).
// Nothing at all when no address is available (solo server, older
// Perspicax, inbound mail off). The address is not an id: shown as is.
import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { BOT_MAIL_LOCAL_PART, changeBotLocalPart, useBotInboundMailState, type BotInboundMail } from "@/lib/bot-inbound-mail";
import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { SettingsGroup } from "../SettingsPrimitives";

const ERRORS = ["invalid", "taken", "not_owner", "no_bot", "rate_limited", "unavailable"] as const;

/** A refusal's code in words; an unknown code reads as "try later". */
export function localPartError(code: string): string {
  const known = (ERRORS as readonly string[]).includes(code) ? code : "unavailable";
  return t(`botPanel.email.error.${known}` as LocaleKey);
}

const inputCls = "min-h-8 min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 text-[13px] text-ink focus:border-focus";
const buttonCls = "rounded-lg border border-hairline/50 px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-raised disabled:opacity-40";

export function BotEmailAddressForm({ domain, value, error, busy, onValue, onSave, onCancel }: {
  domain: string;
  value: string;
  error?: string;
  busy: boolean;
  onValue: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const valid = BOT_MAIL_LOCAL_PART.test(value);
  return (
    <div data-bot-email-form="" className="flex flex-col gap-2 px-3.5 py-2">
      <label className="flex min-w-0 items-center gap-1.5">
        <span className="sr-only">{t("botPanel.email.localPart")}</span>
        <input
          className={inputCls}
          value={value}
          maxLength={40}
          autoFocus
          spellCheck={false}
          autoCapitalize="none"
          aria-label={t("botPanel.email.localPart")}
          onChange={(event) => onValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && valid && !busy) onSave();
            if (event.key === "Escape") onCancel();
          }}
        />
        <span className="shrink-0 truncate text-[13px] text-ink-secondary">@{domain}</span>
      </label>
      <p className="text-[12px] leading-4 text-ink-secondary">{t("botPanel.email.formatHelp")}</p>
      {error && <p role="alert" className="text-[12px] leading-4 text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" data-bot-email-save="" disabled={!valid || busy} onClick={onSave} className={cn(buttonCls, "bg-accent text-accent-ink border-transparent hover:brightness-110")}>{t("botPanel.email.save")}</button>
        <button type="button" onClick={onCancel} className={buttonCls}>{t("botPanel.email.cancel")}</button>
      </div>
    </div>
  );
}

export function BotEmailAddressCard({ mail, onChange }: {
  mail: BotInboundMail | null;
  /** The owner's change; absent: no Change button. */
  onChange?: (localPart: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const address = mail?.available ? mail.address : null;
  const { state, copy } = useCopyFeedback(address ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!mail || !address) return null;
  const copyLabel = t("botPanel.email.copy");
  const at = address.lastIndexOf("@");
  const pending = !mail.enabled;
  const save = async () => {
    if (!onChange) return;
    setBusy(true);
    setError(undefined);
    const result = await onChange(draft);
    setBusy(false);
    if (result.ok) setEditing(false);
    else setError(localPartError(result.error));
  };
  return (
    <div data-bot-email-address="">
      <SettingsGroup title={t("botPanel.email.label")} groupId="botEmail">
        {editing ? (
          <BotEmailAddressForm domain={address.slice(at + 1)} value={draft} error={error} busy={busy} onValue={setDraft} onSave={() => void save()} onCancel={() => { setEditing(false); setError(undefined); }} />
        ) : (
          <div className="flex min-w-0 items-center gap-2 px-3.5 py-2">
            <span
              className={cn("min-w-0 flex-1 truncate text-[13px] leading-[18px]", pending ? "text-ink-tertiary" : "text-ink")}
              data-bot-email-value=""
              {...(pending ? { "data-bot-email-pending": "" } : {})}
            >{address}</span>
            {mail.canChange && onChange && (
              <button type="button" onClick={() => { setDraft(address.slice(0, at)); setEditing(true); }} className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-accent-text hover:bg-accent/10">{t("botPanel.email.change")}</button>
            )}
            <button
              type="button"
              onClick={copy}
              aria-label={copyLabel}
              title={copyLabel}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
            >
              {state === "copied" ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            </button>
          </div>
        )}
        <p className="px-3.5 pb-2 text-[12px] leading-4 text-ink-secondary">{t("botPanel.email.help")}</p>
        {pending && <p data-bot-email-off="" className="px-3.5 pb-2 text-[12px] leading-4 text-ink-secondary">{t("botPanel.email.pending")}</p>}
      </SettingsGroup>
    </div>
  );
}

export function BotEmailAddress({ botId }: { botId: string }) {
  const [mail, setMail] = useBotInboundMailState(botId);
  const onChange = async (localPart: string) => {
    const result = await changeBotLocalPart(botId, localPart);
    if (!result.ok) return result;
    setMail(result.mail);
    return { ok: true as const };
  };
  return <BotEmailAddressCard mail={mail} onChange={onChange} />;
}
