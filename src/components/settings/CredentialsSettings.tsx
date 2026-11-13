// Settings > Vault (Coffre), the reference's way (#4094): the New item menu,
// tabs with counts and the search, one list of items. A row is an icon, a
// label, a grey line and Manage; reveal, notes, bots, edit and delete live
// in the item's centered window.
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Contact, CreditCard, FileDown, FileUp, KeyRound, KeySquare, LockKeyhole, MapPin, StickyNote } from "lucide-react";

import { allowBotAlways, deleteCredential, importOnePasswordItem, loadCredentials, loadOnePasswordItems, revealCredential, revealCredentialNotes, revokeBot, type CredentialVaultState, type OnePasswordItem, type VaultItemListing } from "@/lib/credential-vault";
import { copyText } from "@/lib/copy-text";
import { botLabel } from "@/lib/human-label";
import { activeLocale, t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { filterVaultItems, resolveVaultFilterTab, vaultTabCounts, VAULT_FILTER_TABS, type VaultFilterTab } from "@/lib/vault-filter";
import type { LocaleKey } from "@/locales";
import { useStore } from "@/state/store";
import type { VaultItemKind } from "../../../shared/credential-vault";
import { PageSearch } from "../content-page";
import { AddMenu, type AddMenuItem } from "../bot-profile/BotProfilePage.tsx-parts/AddMenu";
import { DANGER_PILL, DescribedRow, PILL, PillSelect, PRIMARY_PILL, SettingsGroup, SettingsNotice, SettingsPageActions, SettingsTextRow, peekRequestedSettingsCard } from "../SettingsPrimitives";
import { DisclosurePill } from "./AppearanceSettings";
import { ExportPanel, ImportPanel, importOutcomeText } from "./CredentialsTransfer";
import { FilterChips, StatusText } from "./SettingsPatterns";
import { VaultDialog } from "./VaultDialog";
import { ItemForm, injectionLabel } from "./VaultItemForm";
import { PaymentsPanel } from "./VaultPayments";
import { SavedKeysResetButton, useSavedKeysUnreadable } from "../SavedKeysReset";

export { ItemForm, draftInjection, injectionLabel } from "./VaultItemForm";
export type { Draft } from "./VaultItemForm";

const message = (error: unknown) => readableError(error);

function when(at: number | undefined): string {
  if (!at) return t("vault.settings.never");
  return new Date(at).toLocaleString(activeLocale(), { dateStyle: "medium", timeStyle: "short" });
}

const TAB_LABEL: Record<VaultFilterTab, LocaleKey> = {
  all: "vault.tab.all",
  logins: "vault.tab.logins",
  payments: "vault.tab.payments",
  contacts: "vault.tab.contacts",
};

const NEW_KINDS: readonly VaultItemKind[] = ["login", "apiKey", "note", "card", "address", "contact"];
const KIND_ICON: Record<VaultItemKind, typeof KeyRound> = {
  login: KeyRound, apiKey: KeySquare, note: StickyNote, card: CreditCard, address: MapPin, contact: Contact,
};

/** The items a search keeps: their name, sites, user name, card or contact words. */
export function searchVaultItems(items: readonly VaultItemListing[], query: string): VaultItemListing[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...items];
  return items.filter((item) => [
    item.name, ...item.domains, item.username, item.card?.brand, item.card?.last4,
    item.contact?.fullName, item.contact?.email, item.address?.city, item.address?.recipient,
  ].some((word) => word?.toLocaleLowerCase().includes(q)));
}

const EMPTY_LINE: Record<VaultFilterTab, LocaleKey> = {
  all: "vault.settings.empty",
  logins: "vault.empty.logins",
  payments: "vault.empty.payments",
  contacts: "vault.empty.contacts",
};

/** Settings > Vault the reference's way (#4094): one New item menu at the
 * top right, the tabs with their counts and the search on one row, one list
 * of items (each with Manage), the grey sentence under it. New item, Manage,
 * Import and Export open centered windows. */
export function CredentialsSettings() {
  const { state } = useStore();
  // Unreadable saved keys hold the vault key: restarting never opens it, "Reset saved keys" starts it empty.
  const keysUnreadable = useSavedKeysUnreadable();
  const [data, setData] = useState<CredentialVaultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<VaultItemKind | null>(null);
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const listId = useId();
  const [tab, setTab] = useState<VaultFilterTab>(() => resolveVaultFilterTab({
    search: typeof location !== "undefined" ? location.search : "",
    hash: typeof location !== "undefined" ? location.hash : "",
    requestedCard: peekRequestedSettingsCard(),
  }));
  const refresh = useCallback(async () => {
    try {
      setData(await loadCredentials());
      setError(null);
    } catch (failure) {
      setError(message(failure));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const next = resolveVaultFilterTab({
      search: typeof location !== "undefined" ? location.search : "",
      hash: typeof location !== "undefined" ? location.hash : "",
      requestedCard: peekRequestedSettingsCard(),
    });
    if (next !== "all") setTab(next);
  }, []);
  const botName = useCallback((id: string) => botLabel(state.bots.find((bot) => bot.id === id)?.name, id), [state.bots]);

  if (!data) {
    return error
      ? <SettingsNotice tone="danger">{error}</SettingsNotice>
      : <p role="status" className="px-1 text-[13px] leading-[18px] text-ink-secondary">{t("vault.settings.loading")}</p>;
  }

  const counts = vaultTabCounts({
    items: data.items,
    purchases: data.purchases,
    history: data.history,
    wallets: data.wallets,
    methods: data.methods,
  });
  const listed = searchVaultItems(filterVaultItems(data.items, tab), query);
  const transfers = vaultMenuActions({ unavailable: Boolean(data.unavailable), exportBlocked: data.exportBlocked === true, empty: data.items.length === 0 });
  const menu: AddMenuItem[] = [
    ...NEW_KINDS.map((kind) => {
      const Icon = KIND_ICON[kind];
      return { id: kind, icon: <Icon />, title: t(`vault.kind.${kind}`), onChoose: () => { setImported(null); setAdding(kind); } };
    }),
    ...transfers.map((action, index) => ({
      id: action,
      icon: action === "import" ? <FileUp /> : <FileDown />,
      title: t(action === "import" ? "vault.menu.import" : "vault.menu.export"),
      separatorBefore: index === 0,
      onChoose: () => { setImported(null); setTransfer(action); },
    })),
  ];
  const renderItem = (item: VaultItemListing) => <ItemRow item={item} botName={botName} bots={state.bots} onChanged={refresh} />;
  const searching = query.trim().length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-6" data-credentials-settings data-vault-tab={tab}>
      <SettingsPageActions>
        <div data-vault-new="">
          <AddMenu items={menu} label={t("vault.new")} primary />
        </div>
      </SettingsPageActions>
      {data.unavailable && (keysUnreadable
        ? <SettingsNotice tone="danger" action={<SavedKeysResetButton />}>{t("savedKeys.unreadable")}</SettingsNotice>
        : <SettingsNotice tone="danger">{t("vault.settings.unavailable")}</SettingsNotice>)}
      {error && <SettingsNotice tone="danger">{error}</SettingsNotice>}
      {imported && <SettingsTextRow live><span data-credential-import-result>{imported}</span></SettingsTextRow>}
      <div className="flex min-w-0 flex-wrap items-center gap-3" data-vault-toolbar="">
        <div className="min-w-0 flex-[1_1_260px]">
          <FilterChips
            tabs
            controls={listId}
            label={t("vault.payments.title")}
            value={tab}
            onChange={setTab}
            chips={VAULT_FILTER_TABS.map((id) => ({ id, label: t(TAB_LABEL[id]), count: counts[id] }))}
          />
        </div>
        <PageSearch compact value={query} onChange={setQuery} placeholder={t("vault.search")} label={t("vault.search")} data-vault-search="" />
      </div>
      <div id={listId} role="tabpanel" className="flex min-w-0 flex-col gap-1.5">
        {tab === "payments"
          ? (
            <PaymentsPanel
              data={data}
              cards={listed}
              bots={state.bots}
              botName={botName}
              renderItem={renderItem}
              onChanged={refresh}
              onError={setError}
            />
          )
          : listed.length > 0
            ? (
              <div data-settings-card="credentials.items">
                <SettingsGroup groupId="credentials.items">
                  {listed.map((item) => <div key={item.id}>{renderItem(item)}</div>)}
                </SettingsGroup>
              </div>
            )
            : (
              <p data-vault-empty="" className="flex min-h-[110px] items-center justify-center px-4 text-center text-[13px] leading-[18px] text-ink-secondary">
                {searching ? t("vault.search.none", { query: query.trim() }) : t(EMPTY_LINE[tab])}
              </p>
            )}
        {/* Payments says it in its own sentence above its cards; the
            encryption is the page's intro: each once (#4094). */}
        {tab !== "payments" && (
          <p data-vault-footer="" className="ps-2 pe-1 text-[12px] leading-4 text-ink-tertiary">{t("vault.footer")}</p>
        )}
      </div>
      <OnePasswordCard data={data} onImported={refresh} />
      {adding && (
        <ItemForm
          key={adding}
          start={{ kind: adding }}
          onDone={async () => { setAdding(null); await refresh(); }}
        />
      )}
      {transfer === "import" && (
        <ImportPanel
          existing={data.items}
          onCancel={() => setTransfer(null)}
          onDone={async (outcome) => { setTransfer(null); setImported(importOutcomeText(outcome)); await refresh(); }}
        />
      )}
      {transfer === "export" && <ExportPanel onCancel={() => setTransfer(null)} />}
    </div>
  );
}

/** The New item menu's Import and Export. #3294: an action that cannot
 * apply here (the vault unreachable, nothing to export, export turned off by
 * the organization) is left out, never shown greyed. */
export function vaultMenuActions(input: { unavailable: boolean; exportBlocked: boolean; empty: boolean }): Array<"import" | "export"> {
  if (input.unavailable) return [];
  return input.empty || input.exportBlocked ? ["import"] : ["import", "export"];
}

function itemGreyLine(item: VaultItemListing): string {
  if (item.card) {
    const month = String(item.card.expMonth).padStart(2, "0");
    const year = String(item.card.expYear).slice(-2);
    return `${item.card.brand} ···· ${item.card.last4} · ${month}/${year}`;
  }
  const site = item.domains[0] ?? item.address?.city ?? item.contact?.email ?? "";
  const who = item.username ?? item.contact?.fullName ?? "";
  return [site, who].filter(Boolean).join(" · ");
}

/** One row of the list: the kind's icon, the name, the account line and
 * Manage, which opens the item in the Vault's window (reveal, note, bots,
 * Edit, Delete); Edit turns that window into the item's form. */
export function ItemRow({ item, botName, bots, onChanged }: {
  item: VaultItemListing;
  botName: (id: string) => string;
  bots: ReadonlyArray<{ id: string; name: string }>;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState<"detail" | "edit" | null>(null);
  const used = item.lastUsedAt
    ? t("vault.settings.lastUsed", { when: when(item.lastUsedAt), bot: botName(item.lastUsedBy ?? "") })
    : t("vault.settings.neverUsed");
  const grey = itemGreyLine(item);
  const Icon = KIND_ICON[item.kind];
  return (
    <div data-credential-item={item.id}>
      <DescribedRow label={item.name} description={grey ? `${grey} · ${used}` : used} icon={<Icon size={15} />} rowId={`credential-${item.id}`}>
        <button type="button" className={PILL} data-vault-manage="" aria-label={t("vault.manage.label", { name: item.name })} onClick={() => setOpen("detail")}>
          {t("vault.item.manage")}
        </button>
      </DescribedRow>
      {open === "detail" && (
        <VaultDialog
          title={item.name}
          subtitle={grey || t(`vault.kind.${item.kind}`)}
          onClose={() => setOpen(null)}
          data-credential-manage={item.id}
        >
          <VaultItemDetail item={item} botName={botName} bots={bots} onEdit={() => setOpen("edit")} onDone={() => setOpen(null)} onChanged={onChanged} />
        </VaultDialog>
      )}
      {open === "edit" && <ItemForm item={item} onDone={async () => { setOpen(null); await onChanged(); }} />}
    </div>
  );
}

function VaultItemDetail({ item, botName, bots, onEdit, onDone, onChanged }: {
  item: VaultItemListing;
  botName: (id: string) => string;
  bots: ReadonlyArray<{ id: string; name: string }>;
  onEdit: () => void;
  onDone: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // said once, in the window where the person is looking, never also as
  // the page's notice behind it (#4094)
  const [failed, onError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [pan, setPan] = useState<string | null>(null);
  const [secretValue, setSecretValue] = useState<string | null>(null);
  const [allow, setAllow] = useState("");
  const allowed = new Set(item.grants.map((grant) => grant.botId));
  const local = item.source === "local";
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    try {
      await work();
      await onChanged();
    } catch (failure) {
      onError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  const reveal = async (field: "password" | "apiKey" | "pan", current: string | null, set: (value: string | null) => void) => {
    if (current !== null) { set(null); return; }
    setBusy(true);
    onError(null);
    try { set((await revealCredential(item.id, field)).value); }
    catch (failure) { onError(message(failure)); }
    finally { setBusy(false); }
  };
  const saved = [
    item.username ? t("vault.settings.savedUsername", { username: item.username }) : "",
    item.hasPassword ? t("vault.field.password") : "",
    item.hasTotp ? t("vault.settings.savedTotp") : "",
    item.hasApiKey ? t("vault.field.apiKey") : "",
    item.hasNotes ? t("vault.field.notes") : "",
    item.card ? t("vault.card.ending", { last4: item.card.last4, brand: item.card.brand }) : "",
    item.address ? `${item.address.city}, ${item.address.country}` : "",
    item.contact?.email ?? "",
  ].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-3" data-credential-detail="">
      <p className="text-[12px] text-ink-secondary">{t(`vault.kind.${item.kind}`)}{item.source === "1password" ? " · 1Password" : ""}{saved ? ` · ${saved}` : ""}</p>
      {local && item.hasPassword && (
        <SecretField label={t("vault.field.password")} value={secretValue} busy={busy} reveal onToggle={() => void reveal("password", secretValue, setSecretValue)} showLabel={t("vault.settings.showPassword")} hideLabel={t("vault.settings.hideSecret")} />
      )}
      {local && item.hasApiKey && !item.hasPassword && (
        <SecretField label={t("vault.field.apiKey")} value={secretValue} busy={busy} reveal onToggle={() => void reveal("apiKey", secretValue, setSecretValue)} showLabel={t("vault.settings.showKey")} hideLabel={t("vault.settings.hideSecret")} />
      )}
      {local && item.card && (
        <SecretField label={t("vault.field.pan")} value={pan} busy={busy} reveal onToggle={() => void reveal("pan", pan, setPan)} showLabel={t("vault.settings.showNumber")} hideLabel={t("vault.settings.hideNumber")} />
      )}
      {item.hasNotes && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={PILL} disabled={busy} onClick={() => void (notes === null ? revealCredentialNotes(item.id).then((answer) => setNotes(answer.notes)).catch((failure) => onError(message(failure))) : Promise.resolve(setNotes(null)))}>
            {notes === null ? t("vault.settings.showNote") : t("vault.settings.hideNote")}
          </button>
        </div>
      )}
      {notes !== null && <pre className="whitespace-pre-wrap rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink">{notes}</pre>}
      {item.kind === "apiKey" && item.injection && (
        <div className="text-[12px] leading-4 text-ink-secondary" data-credential-injection="">
          {t("vault.api.sentBy", { how: injectionLabel(item.injection), sites: item.domains.map((domain) => `${domain}${item.injection?.basePath ?? ""}`).join(", ") })}
        </div>
      )}
      {item.kind === "apiKey" && item.commandVariable && (
        <div className="text-[12px] leading-4 text-ink-secondary" data-credential-command-variable="">
          {t("vault.api.commandLine", { name: item.commandVariable })}
        </div>
      )}
      {(item.kind === "login" || item.kind === "apiKey") && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-ink-secondary">{t("vault.settings.allowedBots")}</span>
          {item.grants.length === 0 && <span className="text-ink-tertiary">{t("vault.settings.noBots")}</span>}
          {item.grants.map((grant) => (
            <span key={`${grant.botId}:${grant.threadId ?? ""}`} className="inline-flex items-center gap-1 rounded-full bg-ink/[0.07] px-2 py-0.5 text-ink">
              {botName(grant.botId)}{grant.mode === "once" ? ` (${t("vault.settings.onceShort")})` : ""}
              <button type="button" aria-label={t("vault.settings.revoke", { bot: botName(grant.botId) })} disabled={busy} className="text-ink-tertiary hover:text-ink" onClick={() => void run(() => revokeBot(item.id, grant.botId))}>×</button>
            </span>
          ))}
          <PillSelect
            ariaLabel={t("vault.settings.allowBot")}
            value={allow}
            disabled={busy}
            onChange={setAllow}
            options={[
              { value: "", label: t("vault.settings.allowBot"), disabled: true },
              ...bots.filter((bot) => !allowed.has(bot.id)).map((bot) => ({ value: bot.id, label: bot.name })),
            ]}
          />
          {allow && <button type="button" className={PILL} disabled={busy} onClick={() => void run(async () => { await allowBotAlways(item.id, allow); setAllow(""); })}>{t("vault.settings.allow")}</button>}
        </div>
      )}
      {failed && <p role="alert" className="text-[12px] text-danger">{failed}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2" data-credential-detail-actions="">
        <span className="me-auto">
          {confirming
            ? <button type="button" className={DANGER_PILL} disabled={busy} onClick={() => void run(async () => { await deleteCredential(item.id); onDone(); })}>{t("vault.settings.confirmDelete")}</button>
            : <button type="button" className={`${PILL} text-danger`} disabled={busy} onClick={() => setConfirming(true)}>{t("vault.settings.delete")}</button>}
        </span>
        <button type="button" className={PILL} disabled={busy} data-vault-edit="" onClick={onEdit}>{t("vault.settings.edit")}</button>
        <button type="button" className={PRIMARY_PILL} disabled={busy} onClick={onDone}>{t("vault.done")}</button>
      </div>
    </div>
  );
}

function SecretField({ label, value, busy, reveal, onToggle, showLabel, hideLabel }: {
  label: string;
  value: string | null;
  busy: boolean;
  reveal?: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[12px] text-ink-secondary">{label}</span>
      {value !== null && <span className="select-all break-all font-mono text-[12.5px] text-ink" dir="ltr" data-credential-secret="">{value}</span>}
      <span className="ml-auto flex gap-2">
        <button type="button" className={PILL} disabled={busy} data-credential-reveal={reveal ? "" : undefined} onClick={onToggle}>{value === null ? showLabel : hideLabel}</button>
        {value !== null && (
          <button type="button" className={PILL} onClick={() => void copyText(value)}>{t("approval.details.copy")}</button>
        )}
      </span>
    </div>
  );
}

function OnePasswordCard({ data, onImported }: { data: CredentialVaultState; onImported: () => Promise<void> }) {
  const status = data.onePassword;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OnePasswordItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((item) => !q || item.title.toLowerCase().includes(q) || item.domains.some((domain) => domain.includes(q))).slice(0, 50);
  }, [items, query]);
  if (status.reason === "organization") return null;
  const connected = status.available;
  const reason = status.available
    ? t(status.via === "connect" ? "vault.onePassword.connect" : "vault.onePassword.cli")
    : t(status.reason === "signed_out" ? "vault.onePassword.signedOut" : "vault.onePassword.absent");
  const recheck = async () => {
    setBusy(true);
    setError(null);
    try {
      await loadOnePasswordItems().catch(() => undefined);
      await onImported();
    } finally {
      setBusy(false);
    }
  };
  const pick = async (item: OnePasswordItem) => {
    setBusy(true);
    setError(null);
    try {
      await importOnePasswordItem(item);
      await onImported();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    setBusy(true);
    setError(null);
    try { setItems((await loadOnePasswordItems()).items); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  };
  return (
    <div data-settings-card="credentials.onePassword">
      <SettingsGroup groupId="credentials.onePassword">
        <DescribedRow
          label="1Password"
          icon={<LockKeyhole size={15} />}
          description={<StatusText tone={connected ? "success" : "neutral"}>{t(connected ? "settings.card.connected" : "settings.card.notConnected")}</StatusText>}
          rowId="onepassword"
          below={open ? (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-[12px] leading-4 text-ink-secondary">{reason}</p>
              {!status.available && (
                <div className="flex flex-col gap-2 text-[13px]" data-onepassword-steps>
                  <span className="text-[12.5px] font-medium text-ink-secondary">{t("vault.onePassword.stepsTitle")}</span>
                  <ol className="ms-4 list-decimal text-[12.5px] leading-5 text-ink-secondary">
                    <li>{t("vault.onePassword.step1")}</li>
                    <li>{t("vault.onePassword.step2")}</li>
                    <li>{t("vault.onePassword.step3")}</li>
                  </ol>
                  <div className="flex justify-end"><button type="button" className={PILL} disabled={busy} onClick={() => void recheck()}>{t("vault.onePassword.recheck")}</button></div>
                </div>
              )}
              {status.available && <p className="text-[12px] leading-4 text-ink-secondary">{t("vault.onePassword.perRequest")}</p>}
              {status.available && (items === null
                ? <div className="flex justify-end"><button type="button" className={PILL} disabled={busy} onClick={() => void load()}>{t("vault.onePassword.pick")}</button></div>
                : (
                  <>
                    <input className="ui-input w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("vault.onePassword.search")} aria-label={t("vault.onePassword.search")} />
                    <ul className="flex max-h-64 flex-col gap-1 overflow-auto">
                      {shown.map((item) => (
                        <li key={`${item.vaultId}:${item.id}`} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">{item.title} <span className="text-[12px] text-ink-tertiary">{item.vaultName}{item.domains.length ? ` · ${item.domains.join(", ")}` : ""}</span></span>
                          <button type="button" className={PILL} disabled={busy || item.domains.length === 0} title={item.domains.length === 0 ? t("vault.onePassword.noSite") : undefined} onClick={() => void pick(item)}>{t("vault.onePassword.add")}</button>
                        </li>
                      ))}
                      {shown.length === 0 && <li className="text-[12.5px] text-ink-secondary">{t("vault.onePassword.none")}</li>}
                    </ul>
                    <p className="text-[12px] leading-4 text-ink-tertiary">{t("vault.onePassword.readOnly")}</p>
                  </>
                ))}
              {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
            </div>
          ) : undefined}
        >
          <DisclosurePill open={open} onToggle={() => setOpen((current) => !current)} label={t(connected ? "vault.item.manage" : "vault.onePassword.connectAction")}>
            {t(connected ? "vault.item.manage" : "vault.onePassword.connectAction")}
          </DisclosurePill>
        </DescribedRow>
      </SettingsGroup>
    </div>
  );
}
