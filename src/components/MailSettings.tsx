// Settings > Email: how a solo server sends sign-in codes and invitations
// (server/mail/mail-routes.ts). Admin only. A secret is write-only here: the
// server says whether one is configured, and Replace opens an empty input.
// A value the server's environment provides is the default; a saved value
// wins, and "Revert to the server's value" removes the saved one. An
// organization server answers 403 identity_perspicax, and this section then
// shows a short note instead: Perspicax sends that server's mail.
import { useEffect, useState } from "react";
import { Check, Loader2, Mail, Send } from "lucide-react";

import { api, ApiError } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import {
  DEFAULT_MAIL_FROM_NAME,
  MAIL_PROVIDER_FIELDS,
  MAIL_PROVIDERS,
  MAIL_SECRET_FIELDS,
  type MailField,
  type MailProvider,
  type MailSettingsView,
} from "../../shared/mail-settings";
import { Card, PillSelect } from "./SettingsPrimitives";

/** The fields the person edited, as typed. */
export type MailDraft = Partial<Record<MailField, string>>;
export type MailPatch = Partial<Record<MailField, string | number | null>>;

const FIELD_LABEL: Record<MailField, LocaleKey> = {
  provider: "settings.mail.field.provider",
  from: "settings.mail.field.from",
  fromName: "settings.mail.field.fromName",
  "smtp.host": "settings.mail.field.smtpHost",
  "smtp.port": "settings.mail.field.smtpPort",
  "smtp.secure": "settings.mail.field.smtpSecure",
  "smtp.user": "settings.mail.field.smtpUser",
  "smtp.password": "settings.mail.field.smtpPassword",
  "sendgrid.apiKey": "settings.mail.field.sendgridApiKey",
  "twilio.apiKeySid": "settings.mail.field.twilioApiKeySid",
  "twilio.apiKeySecret": "settings.mail.field.twilioApiKeySecret",
};

const PROVIDER_LABEL: Record<MailProvider, string> = { twilio: "Twilio", sendgrid: "SendGrid", smtp: "SMTP" };

/** PUT /api/mail/settings for the edited fields: an emptied plain field is
 * null (back to the server's value), an empty secret is no change. */
export function mailSettingsPatch(draft: MailDraft): MailPatch {
  const patch: MailPatch = {};
  for (const [field, raw] of Object.entries(draft) as Array<[MailField, string | undefined]>) {
    if (raw === undefined) continue;
    const value = raw.trim();
    if (MAIL_SECRET_FIELDS.has(field)) {
      if (value) patch[field] = value;
      continue;
    }
    if (!value) patch[field] = null;
    else if (field === "smtp.port") patch[field] = Number(value);
    else patch[field] = value;
  }
  return patch;
}

const inputClass = "w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none disabled:opacity-50";
const quietButton = "rounded-lg bg-control px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50";

export interface MailSettingsFormProps {
  status: MailSettingsView;
  draft: MailDraft;
  /** Secrets whose Replace input is open. */
  replacing: MailField[];
  busy: "saving" | "testing" | "reverting" | null;
  notice?: string | null;
  error?: string | null;
  onChange(field: MailField, value: string): void;
  onRevert(field: MailField): void;
  onReplace(field: MailField, open: boolean): void;
  onSave(): void;
  onTest(): void;
}

function FieldNote({ field, status, busy, onRevert }: Pick<MailSettingsFormProps, "status" | "busy" | "onRevert"> & { field: MailField }) {
  const view = status.fields[field];
  if (view.source === "server") {
    return <p className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">{t("settings.mail.serverDefault")}</p>;
  }
  if (view.source !== "saved") return null;
  return (
    <button type="button" disabled={busy !== null} onClick={() => onRevert(field)} className="mt-1 text-[11.5px] text-accent hover:underline disabled:opacity-50">
      {view.serverDefault ? t("settings.mail.revert") : t("settings.mail.clear")}
    </button>
  );
}

function SecretField(props: MailSettingsFormProps & { field: MailField }) {
  const { field, status, draft, replacing, busy, onChange, onReplace } = props;
  const view = status.fields[field];
  const id = `mail-${field.replace(".", "-")}`;
  const open = replacing.includes(field) || !view.configured;
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">{t(FIELD_LABEL[field])}</label>
      {open ? (
        <div className="mt-1 flex gap-2">
          <input id={id} type="password" autoComplete="new-password" value={draft[field] ?? ""} disabled={busy !== null}
            onChange={(event) => onChange(field, event.target.value)} placeholder={t("settings.mail.secretPlaceholder")}
            spellCheck={false} className={inputClass} />
          {view.configured && (
            <button type="button" disabled={busy !== null} onClick={() => onReplace(field, false)} className={cn(quietButton, "shrink-0")}>{t("settings.mail.keep")}</button>
          )}
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <span id={id} className="inline-flex items-center gap-1 text-[12.5px] text-success"><Check size={13} aria-hidden="true" />{t("settings.mail.configured")}</span>
          <button type="button" disabled={busy !== null} onClick={() => onReplace(field, true)} className={quietButton}>{t("settings.mail.replace")}</button>
        </div>
      )}
      <FieldNote field={field} status={status} busy={busy} onRevert={props.onRevert} />
    </div>
  );
}

function TextField(props: MailSettingsFormProps & { field: MailField; type?: string; placeholder?: string; hint?: string }) {
  const { field, status, draft, busy, onChange } = props;
  const id = `mail-${field.replace(".", "-")}`;
  const current = status.fields[field].value;
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">{t(FIELD_LABEL[field])}</label>
      <input id={id} type={props.type ?? "text"} value={draft[field] ?? (current === undefined ? "" : String(current))} disabled={busy !== null}
        onChange={(event) => onChange(field, event.target.value)} placeholder={props.placeholder}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} className={cn(inputClass, "mt-1")} />
      {props.hint && <p className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">{props.hint}</p>}
      <FieldNote field={field} status={status} busy={busy} onRevert={props.onRevert} />
    </div>
  );
}

function SelectField(props: MailSettingsFormProps & { field: MailField; options: Array<{ value: string; label: string }>; empty: string }) {
  const { field, status, draft, busy, onChange } = props;
  const id = `mail-${field.replace(".", "-")}`;
  const current = status.fields[field].value;
  return (
    <div>
      <span id={id} className="block text-[13px] font-medium text-ink">{t(FIELD_LABEL[field])}</span>
      <div className="mt-1">
        <PillSelect value={draft[field] ?? (current === undefined ? "" : String(current))} disabled={busy !== null}
          ariaLabel={t(FIELD_LABEL[field])} onChange={(next) => onChange(field, next)}
          options={[{ value: "", label: props.empty }, ...props.options]} />
      </div>
      <FieldNote field={field} status={status} busy={busy} onRevert={props.onRevert} />
    </div>
  );
}

export function MailSettingsForm(props: MailSettingsFormProps) {
  const { status, draft, busy, notice, error, onSave, onTest } = props;
  const chosen = (draft.provider ?? status.fields.provider.value) as MailProvider | "" | undefined;
  const provider = chosen && MAIL_PROVIDERS.includes(chosen) ? chosen : undefined;
  const edited = Object.keys(mailSettingsPatch(draft)).length > 0;
  const missing = status.missing.map((field) => t(FIELD_LABEL[field])).join(", ");
  return (
    <form className="space-y-3" data-mail-settings onSubmit={(event) => { event.preventDefault(); if (edited && busy === null) onSave(); }}>
      <p role="status" className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-medium", status.ready ? "text-success" : "text-warning")}>
        {status.ready ? <Check size={14} aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />}
        {status.ready ? t("settings.mail.status.ready") : t("settings.mail.status.incomplete")}
      </p>
      {!status.ready && missing && <p className="text-[11.5px] text-ink-secondary">{t("settings.mail.missing", { fields: missing })}</p>}

      <SelectField {...props} field="provider" empty={t("settings.mail.provider.choose")}
        options={MAIL_PROVIDERS.map((value) => ({ value, label: PROVIDER_LABEL[value] }))} />
      <TextField {...props} field="from" type="email" placeholder="bot@yourcompany.com" />
      <TextField {...props} field="fromName" placeholder={status.defaultFromName || DEFAULT_MAIL_FROM_NAME}
        hint={t("settings.mail.fromNameHint", { name: status.defaultFromName || DEFAULT_MAIL_FROM_NAME })} />

      {provider && MAIL_PROVIDER_FIELDS[provider].map((field) => {
        if (MAIL_SECRET_FIELDS.has(field)) return <SecretField key={field} {...props} field={field} />;
        if (field === "smtp.secure") {
          return <SelectField key={field} {...props} field={field} empty={t("settings.mail.secure.auto")}
            options={[{ value: "tls", label: "TLS" }, { value: "starttls", label: "STARTTLS" }, { value: "none", label: t("settings.mail.secure.none") }]} />;
        }
        return <TextField key={field} {...props} field={field} type={field === "smtp.port" ? "number" : "text"}
          placeholder={field === "smtp.port" ? "587" : field === "twilio.apiKeySid" ? "SK..." : undefined} />;
      })}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="submit" disabled={!edited || busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-ink hover:brightness-110 disabled:opacity-50">
          {busy === "saving" && <Loader2 size={14} className="animate-spin" />}
          {busy === "saving" ? t("settings.mail.saving") : t("settings.mail.save")}
        </button>
        <button type="button" onClick={onTest} disabled={!status.ready || edited || !status.testAddress || busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-control px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50">
          {busy === "testing" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {busy === "testing" ? t("settings.mail.testing") : t("settings.mail.test")}
        </button>
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-secondary">
        {edited ? t("settings.mail.testSaveFirst") : status.testAddress ? t("settings.mail.testTo", { address: status.testAddress }) : t("settings.mail.testNoAddress")}
      </p>
      {notice && <p role="status" className="flex items-start gap-1.5 text-[12px] leading-relaxed text-success"><Check size={14} className="mt-0.5 shrink-0" />{notice}</p>}
      {error && <p role="alert" className="text-[12px] leading-relaxed text-danger">{error}</p>}
    </form>
  );
}

export function MailOrganizationNote() {
  return <p className="text-[13px] leading-relaxed text-ink-secondary">{t("settings.mail.organization")}</p>;
}

export function MailSettings() {
  const [status, setStatus] = useState<MailSettingsView | null>(null);
  const [organization, setOrganization] = useState(false);
  const [draft, setDraft] = useState<MailDraft>({});
  const [replacing, setReplacing] = useState<MailField[]>([]);
  const [busy, setBusy] = useState<MailSettingsFormProps["busy"]>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void api<MailSettingsView>("/api/mail/settings", { signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setStatus(next); })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.body?.code === "identity_perspicax") setOrganization(true);
        else setError(cause instanceof Error ? cause.message : t("settings.mail.failed"));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const put = async (patch: MailPatch, kind: "saving" | "reverting") => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const next = await api<MailSettingsView>("/api/mail/settings", { method: "PUT", body: JSON.stringify(patch) });
      setStatus(next);
      // Drop the edits just saved; keep any other field still being typed.
      setDraft((current) => Object.fromEntries(Object.entries(current).filter(([field]) => !(field in patch))) as MailDraft);
      setReplacing((current) => current.filter((field) => !(field in patch)));
      if (kind === "saving") setNotice(t("settings.mail.saved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.mail.failed"));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("testing");
    setError(null);
    setNotice(null);
    try {
      const sent = await api<{ sentTo: string }>("/api/mail/test", { method: "POST", body: "{}" });
      setNotice(t("settings.mail.testSent", { address: sent.sentTo }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.mail.failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    // A card of Settings > People since 2026-10-14 (it was its own page).
    <Card collapsible cardId="people.mail" title={t("settings.mail.title")} subtitle={t("settings.mail.subtitle")}>
      {loading && <p role="status" className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={14} className="animate-spin" />{t("settings.mail.loading")}</p>}
      {organization && <MailOrganizationNote />}
      {status && (
        <MailSettingsForm
          status={status}
          draft={draft}
          replacing={replacing}
          busy={busy}
          notice={notice}
          error={error}
          onChange={(field, value) => { setDraft((current) => ({ ...current, [field]: value })); setNotice(null); setError(null); }}
          onRevert={(field) => void put({ [field]: null }, "reverting")}
          onReplace={(field, open) => {
            setReplacing((current) => (open ? [...current, field] : current.filter((entry) => entry !== field)));
            if (!open) setDraft((current) => { const next = { ...current }; delete next[field]; return next; });
          }}
          onSave={() => void put(mailSettingsPatch(draft), "saving")}
          onTest={() => void test()}
        />
      )}
      {!status && error && <p role="alert" className="text-[12px] leading-relaxed text-danger">{error}</p>}
    </Card>
  );
}
