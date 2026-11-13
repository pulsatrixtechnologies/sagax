// The vault item form (Settings > Vault), in the Vault's centered window
// (#4094). A secret left blank on an edit keeps its saved value. Gallery and
// CredentialsSettings import ItemForm.
import { useId, useState } from "react";

import { createCredential, parseDomains, updateCredential, type VaultItemDraft, type VaultItemListing } from "@/lib/credential-vault";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { VAULT_INJECTION_MODES, type VaultApiInjection, type VaultInjectionMode, type VaultItemKind } from "../../../shared/credential-vault";
import { EditorField, EditorStack, FIELD, PillSelect, PRIMARY_PILL, Switch } from "../SettingsPrimitives";
import { VaultDialog } from "./VaultDialog";
import { PhoneCardScanButton, scannedCardFields } from "./PhoneCardScanButton";

const message = (error: unknown) => readableError(error);
const inputClass = FIELD;

export type Draft = {
  kind: VaultItemKind; name: string; domains: string; username: string; password: string; totpSeed: string; apiKey: string; notes: string;
  pan: string; cvv: string; expMonth: string; expYear: string; holder: string;
  recipient: string; line1: string; line2: string; city: string; region: string; postal: string; country: string; phone: string;
  fullName: string; email: string; company: string;
  /** apiKey: how Sagax sends it on a bot's request ("" : not sent). */
  injectionMode: VaultInjectionMode | ""; injectionHeader: string; injectionParam: string; basePath: string;
  /** apiKey: exposed to the allowed bots' commands under this name. */
  exposeCommand: boolean; commandVariable: string;
};

const EMPTY: Draft = {
  kind: "login", name: "", domains: "", username: "", password: "", totpSeed: "", apiKey: "", notes: "",
  pan: "", cvv: "", expMonth: "", expYear: "", holder: "",
  recipient: "", line1: "", line2: "", city: "", region: "", postal: "", country: "", phone: "",
  fullName: "", email: "", company: "",
  injectionMode: "", injectionHeader: "", injectionParam: "", basePath: "",
  exposeCommand: false, commandVariable: "",
};

/** The injection a draft asks for, or null when Sagax does not send the key. */
export function draftInjection(draft: Pick<Draft, "injectionMode" | "injectionHeader" | "injectionParam" | "basePath">): VaultApiInjection | null {
  if (!draft.injectionMode) return null;
  return {
    mode: draft.injectionMode,
    ...(draft.injectionMode === "header" ? { header: draft.injectionHeader.trim() } : {}),
    ...(draft.injectionMode === "query" ? { param: draft.injectionParam.trim() } : {}),
    ...(draft.basePath.trim() ? { basePath: draft.basePath.trim() } : {}),
  };
}

/** How the row says the key is sent: "Bearer", "header X-Api-Key"... */
export function injectionLabel(injection: VaultApiInjection): string {
  if (injection.mode === "header") return t("vault.api.as.header", { name: injection.header ?? "" });
  if (injection.mode === "query") return t("vault.api.as.query", { name: injection.param ?? "" });
  return t(`vault.api.as.${injection.mode}`);
}

/** Only the fields typed: on an edit, a secret left blank keeps its value. */
function draftBody(draft: Draft, editing: boolean): Partial<VaultItemDraft> {
  const body: Partial<VaultItemDraft> = { name: draft.name, domains: parseDomains(draft.domains) };
  if (!editing) body.kind = draft.kind;
  if (draft.kind === "login") {
    body.username = draft.username;
    if (draft.password || !editing) body.password = draft.password;
    if (draft.totpSeed || !editing) body.totpSeed = draft.totpSeed;
  }
  if (draft.kind === "apiKey" && (draft.apiKey || !editing)) body.apiKey = draft.apiKey;
  if (draft.kind === "apiKey") {
    body.injection = draftInjection(draft);
    body.commandVariable = draft.exposeCommand ? draft.commandVariable.trim() : "";
    if (draft.injectionMode === "basic" || draft.username || editing) body.username = draft.username;
  }
  if (draft.kind === "card" && (draft.pan || draft.cvv || draft.holder || !editing)) {
    body.card = {
      ...(draft.pan ? { pan: draft.pan } : {}),
      ...(draft.cvv ? { cvv: draft.cvv } : {}),
      ...(draft.holder ? { holder: draft.holder } : {}),
      ...(draft.expMonth ? { expMonth: Number(draft.expMonth) } : {}),
      ...(draft.expYear ? { expYear: Number(draft.expYear) } : {}),
    };
  }
  if (draft.kind === "address") {
    body.address = {
      recipient: draft.recipient, line1: draft.line1, city: draft.city, postal: draft.postal, country: draft.country,
      ...(draft.line2 ? { line2: draft.line2 } : {}),
      ...(draft.region ? { region: draft.region } : {}),
      ...(draft.phone ? { phone: draft.phone } : {}),
    };
  }
  if (draft.kind === "contact") {
    body.contact = {
      fullName: draft.fullName,
      ...(draft.email ? { email: draft.email } : {}),
      ...(draft.phone ? { phone: draft.phone } : {}),
      ...(draft.company ? { company: draft.company } : {}),
    };
  }
  if (draft.notes || !editing) body.notes = draft.notes;
  return body;
}

/** What a new item needs before Save turns on (the reference's disabled
 * state): a name, or a site to name it after; the secret that makes the
 * item, on a new API key or card. The server keeps its own checks. */
export function draftReady(draft: Draft, editing: boolean): boolean {
  if (!draftName(draft)) return false;
  if (editing) return true;
  if (draft.kind === "apiKey") return draft.apiKey.trim().length > 0;
  if (draft.kind === "card") return draft.pan.trim().length > 0;
  return true;
}

/** The name saved: the one typed, else (a login, an API key) the first site. */
export function draftName(draft: Pick<Draft, "kind" | "name" | "domains">): string {
  const typed = draft.name.trim();
  if (typed) return typed;
  return draft.kind === "login" || draft.kind === "apiKey" ? (parseDomains(draft.domains)[0] ?? "") : "";
}

const SAVE_LABEL: Partial<Record<VaultItemKind, "vault.save.login">> = { login: "vault.save.login" };

/** New item or Edit, in the Vault's centered window: the fields stacked as
 * the reference's New login (Website first, with Add website for more
 * sites), the optional ones marked, Save at the bottom right, off until the
 * item can be saved. */
export function ItemForm({ item, onDone, start }: { item?: VaultItemListing; onDone: () => Promise<void>; /** a preset draft (the New item menu, the gallery) */ start?: Partial<Draft> }) {
  const [draft, setDraft] = useState<Draft>(() => start && !item ? { ...EMPTY, ...start } : item
    ? {
      ...EMPTY, kind: item.kind, name: item.name, domains: item.domains.join(", "), username: item.username ?? "",
      holder: item.card?.holder ?? "", expMonth: item.card ? String(item.card.expMonth) : "", expYear: item.card ? String(item.card.expYear) : "",
      recipient: item.address?.recipient ?? "", line1: item.address?.line1 ?? "", line2: item.address?.line2 ?? "",
      city: item.address?.city ?? "", region: item.address?.region ?? "", postal: item.address?.postal ?? "",
      country: item.address?.country ?? "", phone: item.address?.phone ?? item.contact?.phone ?? "",
      fullName: item.contact?.fullName ?? "", email: item.contact?.email ?? "", company: item.contact?.company ?? "",
      injectionMode: item.injection?.mode ?? "", injectionHeader: item.injection?.header ?? "", injectionParam: item.injection?.param ?? "",
      basePath: item.injection?.basePath ?? "", exposeCommand: Boolean(item.commandVariable), commandVariable: item.commandVariable ?? "",
    }
    : EMPTY);
  // one field per site, as the reference's Add website (saved as the item's list of sites)
  const [sites, setSites] = useState<string[]>(() => {
    const listed = parseDomains(draft.domains);
    return listed.length ? listed : [""];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const readOnly = item?.source === "1password";
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const setSite = (index: number, value: string) => {
    const next = sites.map((site, at) => (at === index ? value : site));
    setSites(next);
    setDraft((current) => ({ ...current, domains: next.map((site) => site.trim()).filter(Boolean).join(", ") }));
  };
  const ready = draftReady(draft, Boolean(item));
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const body = draftBody({ ...draft, name: draftName(draft) }, Boolean(item));
      if (item) await updateCredential(item.id, readOnly ? { name: body.name, domains: body.domains, ...(body.notes !== undefined ? { notes: body.notes } : {}), ...(item.kind === "apiKey" ? { injection: body.injection ?? null, commandVariable: body.commandVariable ?? "" } : {}) } : body);
      else await createCredential(body as VaultItemDraft);
      setDraft(EMPTY);
      await onDone();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  const keep = item ? t("vault.settings.keepBlank") : undefined;
  const optional = (label: string) => <>{label} <span className="font-normal text-ink-tertiary">{t("vault.field.optional")}</span></>;
  const named = draft.kind === "login" || draft.kind === "apiKey";
  const title = item ? t("vault.edit.title", { name: item.name }) : t(`vault.new.${draft.kind}`);
  return (
    <VaultDialog
      title={title}
      onClose={() => void onDone()}
      data-credential-dialog={item ? "edit" : "new"}
      footer={<button type="submit" form={formId} className={PRIMARY_PILL} disabled={busy || !ready} data-credential-save="">{t(SAVE_LABEL[draft.kind] ?? "vault.settings.save")}</button>}
    >
      <form id={formId} aria-label={title} data-credential-form="" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <EditorStack>
          {(draft.kind === "login" || draft.kind === "apiKey") && (
            <div className="flex min-w-0 flex-col items-start gap-1" data-credential-sites="">
              {sites.map((site, index) => (
                <label key={index} className="flex w-full min-w-0 flex-col gap-1">
                  {index === 0 && <span className="text-[13px] font-medium leading-[18px] text-ink">{t("vault.field.website")}</span>}
                  <input className={inputClass} dir="ltr" value={site} onChange={(event) => setSite(index, event.target.value)} placeholder="example.com" aria-label={index === 0 ? t("vault.field.website") : t("vault.field.websiteMore", { count: index + 1 })} />
                </label>
              ))}
              <span className="text-[12px] leading-4 text-ink-secondary">{t("vault.field.sitesHint")}</span>
              <button type="button" className="text-[13px] leading-[18px] text-accent hover:underline" data-credential-add-site="" onClick={() => setSites((current) => [...current, ""])}>{t("vault.field.addWebsite")}</button>
            </div>
          )}
          <EditorField label={named ? optional(t("vault.field.name")) : t("vault.field.name")} hint={named && !item ? t("vault.field.nameHint") : undefined}>
            <input className={inputClass} value={draft.name} onChange={set("name")} aria-label={t("vault.field.name")} />
          </EditorField>
          {draft.kind === "card" && !readOnly && (
            <>
              {!item && <div><PhoneCardScanButton onRead={(card) => setDraft((current) => ({ ...current, ...scannedCardFields(card) }))} /></div>}
              <EditorField label={t("vault.field.holder")}><input className={inputClass} value={draft.holder} onChange={set("holder")} aria-label={t("vault.field.holder")} autoComplete="off" /></EditorField>
              <EditorField label={t("vault.field.pan")}><input className={inputClass} dir="ltr" type="password" value={draft.pan} onChange={set("pan")} placeholder={keep} aria-label={t("vault.field.pan")} autoComplete="off" inputMode="numeric" /></EditorField>
              <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                <EditorField label={t("vault.field.expMonth")}><input className={inputClass} dir="ltr" value={draft.expMonth} onChange={set("expMonth")} aria-label={t("vault.field.expMonth")} inputMode="numeric" /></EditorField>
                <EditorField label={t("vault.field.expYear")}><input className={inputClass} dir="ltr" value={draft.expYear} onChange={set("expYear")} aria-label={t("vault.field.expYear")} inputMode="numeric" /></EditorField>
              </div>
              <EditorField label={t("vault.field.cvv")}><input className={inputClass} dir="ltr" type="password" value={draft.cvv} onChange={set("cvv")} placeholder={keep} aria-label={t("vault.field.cvv")} autoComplete="off" inputMode="numeric" /></EditorField>
            </>
          )}
          {draft.kind === "address" && (
            <>
              <EditorField label={t("vault.field.recipient")}><input className={inputClass} value={draft.recipient} onChange={set("recipient")} aria-label={t("vault.field.recipient")} /></EditorField>
              <EditorField label={t("vault.field.line1")}><input className={inputClass} value={draft.line1} onChange={set("line1")} aria-label={t("vault.field.line1")} /></EditorField>
              <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                <EditorField label={t("vault.field.city")}><input className={inputClass} value={draft.city} onChange={set("city")} aria-label={t("vault.field.city")} /></EditorField>
                <EditorField label={t("vault.field.region")}><input className={inputClass} value={draft.region} onChange={set("region")} aria-label={t("vault.field.region")} /></EditorField>
                <EditorField label={t("vault.field.postal")}><input className={inputClass} dir="ltr" value={draft.postal} onChange={set("postal")} aria-label={t("vault.field.postal")} /></EditorField>
                <EditorField label={t("vault.field.country")}><input className={inputClass} dir="ltr" value={draft.country} onChange={set("country")} aria-label={t("vault.field.country")} /></EditorField>
              </div>
            </>
          )}
          {draft.kind === "contact" && (
            <>
              <EditorField label={t("vault.field.fullName")}><input className={inputClass} value={draft.fullName} onChange={set("fullName")} aria-label={t("vault.field.fullName")} /></EditorField>
              <EditorField label={t("vault.field.email")}><input className={inputClass} dir="ltr" value={draft.email} onChange={set("email")} aria-label={t("vault.field.email")} /></EditorField>
              <EditorField label={t("vault.field.phone")}><input className={inputClass} dir="ltr" value={draft.phone} onChange={set("phone")} aria-label={t("vault.field.phone")} /></EditorField>
              <EditorField label={t("vault.field.company")}><input className={inputClass} value={draft.company} onChange={set("company")} aria-label={t("vault.field.company")} /></EditorField>
            </>
          )}
          {draft.kind === "login" && !readOnly && (
            <>
              <EditorField label={optional(t("vault.field.username"))}><input className={inputClass} dir="ltr" autoComplete="off" value={draft.username} onChange={set("username")} aria-label={t("vault.field.username")} /></EditorField>
              <EditorField label={t("vault.field.password")}><input className={inputClass} dir="ltr" type="password" autoComplete="new-password" value={draft.password} onChange={set("password")} placeholder={keep} aria-label={t("vault.field.password")} /></EditorField>
              <EditorField label={optional(t("vault.field.totp"))}><input className={inputClass} dir="ltr" type="password" autoComplete="off" value={draft.totpSeed} onChange={set("totpSeed")} placeholder={keep ?? t("vault.field.totpPlaceholder")} aria-label={t("vault.field.totp")} /></EditorField>
            </>
          )}
          {draft.kind === "apiKey" && !readOnly && (
            <EditorField label={t("vault.field.apiKey")}><input className={inputClass} dir="ltr" type="password" autoComplete="off" value={draft.apiKey} onChange={set("apiKey")} placeholder={keep} aria-label={t("vault.field.apiKey")} /></EditorField>
          )}
          {draft.kind === "apiKey" && <ApiKeyUseFields draft={draft} setDraft={setDraft} readOnly={readOnly} />}
          <EditorField label={draft.kind === "note" ? t("vault.field.notes") : optional(t("vault.field.notes"))} hint={t("vault.field.notesHint")}>
            <textarea className={inputClass} rows={draft.kind === "note" ? 5 : 3} value={draft.notes} onChange={set("notes")} placeholder={keep} aria-label={t("vault.field.notes")} />
          </EditorField>
          {draft.kind === "login" && <p className="text-[12px] leading-4 text-ink-secondary" data-credential-login-use="">{t("vault.login.canUse")}</p>}
          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        </EditorStack>
      </form>
    </VaultDialog>
  );
}

/** An API key's two uses: Sagax sends it on a bot's request to the key's
 * sites (the bot never sees it), and, if wanted, a command variable. */
function ApiKeyUseFields({ draft, setDraft, readOnly }: {
  draft: Draft;
  setDraft: (change: (current: Draft) => Draft) => void;
  readOnly: boolean;
}) {
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  return (
    <>
      <EditorField label={t("vault.api.how")} hint={t("vault.api.howHint")} menu>
        <PillSelect
          ariaLabel={t("vault.api.how")}
          value={draft.injectionMode}
          onChange={(mode) => setDraft((current) => ({ ...current, injectionMode: mode as Draft["injectionMode"] }))}
          options={[{ value: "", label: t("vault.api.as.none") }, ...VAULT_INJECTION_MODES.map((mode) => ({ value: mode, label: t(`vault.api.mode.${mode}`) }))]}
        />
      </EditorField>
      {draft.injectionMode === "header" && (
        <EditorField label={t("vault.api.headerName")}><input className={inputClass} dir="ltr" value={draft.injectionHeader} onChange={set("injectionHeader")} placeholder="X-Api-Key" aria-label={t("vault.api.headerName")} /></EditorField>
      )}
      {draft.injectionMode === "query" && (
        <EditorField label={t("vault.api.paramName")}><input className={inputClass} dir="ltr" value={draft.injectionParam} onChange={set("injectionParam")} placeholder="api_key" aria-label={t("vault.api.paramName")} /></EditorField>
      )}
      {draft.injectionMode === "basic" && !readOnly && (
        <EditorField label={t("vault.api.basicUser")}><input className={inputClass} dir="ltr" autoComplete="off" value={draft.username} onChange={set("username")} aria-label={t("vault.api.basicUser")} /></EditorField>
      )}
      {draft.injectionMode && (
        <EditorField label={t("vault.api.basePath")} hint={t("vault.api.basePathHint")}><input className={inputClass} dir="ltr" value={draft.basePath} onChange={set("basePath")} placeholder="/v1" aria-label={t("vault.api.basePath")} /></EditorField>
      )}
      <EditorField label={t("vault.api.command")} hint={draft.exposeCommand ? t("vault.api.commandRisk") : t("vault.api.commandHint")} menu>
        <Switch
          checked={draft.exposeCommand}
          aria-label={t("vault.api.command")}
          onClick={() => setDraft((current) => ({ ...current, exposeCommand: !current.exposeCommand }))}
          data-credential-expose-command=""
        />
      </EditorField>
      {draft.exposeCommand && (
        <EditorField label={t("vault.api.commandName")}><input className={inputClass} dir="ltr" value={draft.commandVariable} onChange={set("commandVariable")} placeholder="EXAMPLE_API_KEY" aria-label={t("vault.api.commandName")} /></EditorField>
      )}
    </>
  );
}
