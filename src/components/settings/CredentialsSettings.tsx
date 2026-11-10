// Settings > Vault (Coffre). One page of SettingsGroup cards. A closed row
// is a label, a grey line and one action. Reveal, notes, bots, edit and
// delete live in the unfolded detail.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ellipsis, Plus } from "lucide-react";

import { allowBotAlways, deleteCredential, importOnePasswordItem, loadCredentials, loadOnePasswordItems, revealCredential, revealCredentialNotes, revokeBot, type CredentialVaultState, type OnePasswordItem, type VaultItemListing } from "@/lib/credential-vault";
import { copyText } from "@/lib/copy-text";
import { botLabel } from "@/lib/human-label";
import { activeLocale, t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { filterVaultItems, resolveVaultFilterTab, vaultTabCounts, type VaultFilterTab } from "@/lib/vault-filter";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import type { LocaleKey } from "@/locales";
import { useStore } from "@/state/store";
import { DANGER_PILL, DescribedRow, PILL, PillSelect, PRIMARY_PILL, SettingsGroup, SettingsNotice, SettingsTextRow, peekRequestedSettingsCard } from "../SettingsPrimitives";
import { DisclosurePill } from "./AppearanceSettings";
import { ExportPanel, ImportPanel, importOutcomeText } from "./CredentialsTransfer";
import { FilterChips, StatusText } from "./SettingsPatterns";
import { ItemForm, injectionLabel } from "./VaultItemForm";
import { PaymentsPanel } from "./VaultPayments";

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

export function CredentialsSettings() {
  const { state } = useStore();
  const [data, setData] = useState<CredentialVaultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);
  const [imported, setImported] = useState<string | null>(null);
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
  const showItems = tab !== "payments";
  const showPayments = tab === "all" || tab === "payments";
  const listed = (showPayments ? filterVaultItems(data.items, tab).filter((item) => item.kind !== "card") : filterVaultItems(data.items, tab));
  const add = () => {
    setImported(null);
    setTransfer(null);
    if (tab === "payments") {
      setAdding(false);
      setAddingCard(true);
      return;
    }
    setAddingCard(false);
    setAdding(true);
  };
  const renderItem = (item: VaultItemListing) => (editing === item.id
    ? <ItemForm item={item} onDone={async () => { setEditing(null); await refresh(); }} />
    : <ItemRow item={item} botName={botName} bots={state.bots} onEdit={() => setEditing(item.id)} onChanged={refresh} onError={setError} />);

  return (
    <div className="flex min-w-0 flex-col gap-3" data-credentials-settings data-vault-tab={tab}>
      {data.unavailable && <SettingsNotice tone="danger">{t("vault.settings.unavailable")}</SettingsNotice>}
      {error && <SettingsNotice tone="danger">{error}</SettingsNotice>}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        <FilterChips
          label={t("vault.payments.title")}
          value={tab}
          onChange={setTab}
          chips={(["all", "logins", "payments", "contacts"] as const).map((id) => ({ id, label: t(TAB_LABEL[id]), count: counts[id] }))}
        />
        <button type="button" className={`${PRIMARY_PILL} inline-flex items-center gap-1`} onClick={add} data-credentials-add="">
          <Plus size={14} aria-hidden="true" />
          {t("vault.settings.add")}
        </button>
        <VaultMenu
          unavailable={Boolean(data.unavailable)}
          exportBlocked={data.exportBlocked === true}
          empty={data.items.length === 0}
          onImport={() => { setImported(null); setTransfer("import"); }}
          onExport={() => { setImported(null); setTransfer("export"); }}
        />
      </div>
      {transfer === "import" && (
        <ImportPanel
          existing={data.items}
          onCancel={() => setTransfer(null)}
          onDone={async (outcome) => { setTransfer(null); setImported(importOutcomeText(outcome)); await refresh(); }}
        />
      )}
      {transfer === "export" && <ExportPanel onCancel={() => setTransfer(null)} />}
      {imported && !transfer && <SettingsTextRow live><span data-credential-import-result>{imported}</span></SettingsTextRow>}
      {showItems && (
        <div data-settings-card="credentials.items">
          <SettingsGroup title={t("vault.settings.itemsTitle")} groupId="credentials.items">
            <SettingsTextRow>{t("vault.settings.itemsSubtitle")}</SettingsTextRow>
            {listed.length === 0 && !adding && <SettingsTextRow>{t("vault.settings.empty")}</SettingsTextRow>}
            {listed.map((item) => <div key={item.id}>{renderItem(item)}</div>)}
            {adding && (
              <ItemForm
                onDone={async () => { setAdding(false); await refresh(); }}
                start={tab === "contacts" ? { kind: "address" } : tab === "logins" ? { kind: "login" } : undefined}
              />
            )}
          </SettingsGroup>
        </div>
      )}
      {showPayments && (
        <PaymentsPanel
          data={data}
          bots={state.bots}
          botName={botName}
          addingCard={addingCard}
          renderItem={renderItem}
          renderNewCard={() => <ItemForm start={{ kind: "card" }} onDone={async () => { setAddingCard(false); await refresh(); }} />}
          onAddCard={() => setAddingCard(true)}
          onChanged={refresh}
          onError={setError}
        />
      )}
      <OnePasswordCard data={data} onImported={refresh} />
    </div>
  );
}

/** The vault's ... menu. #3294: an action that cannot apply here (the vault
 * unreachable, nothing to export, export turned off by the organization) is
 * left out, never shown greyed; with none left the menu itself is hidden. */
export function vaultMenuActions(input: { unavailable: boolean; exportBlocked: boolean; empty: boolean }): Array<"import" | "export"> {
  if (input.unavailable) return [];
  return input.empty || input.exportBlocked ? ["import"] : ["import", "export"];
}

function VaultMenu({ unavailable, exportBlocked, empty, onImport, onExport }: {
  unavailable: boolean;
  exportBlocked: boolean;
  empty: boolean;
  onImport: () => void;
  onExport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, rootRef, () => setOpen(false));
  const actions = vaultMenuActions({ unavailable, exportBlocked, empty });
  if (actions.length === 0) return null;
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={`${PILL} inline-flex items-center`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("pages.more")}
        data-vault-menu=""
        onClick={() => setOpen((current) => !current)}
      >
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute end-0 z-20 mt-1 flex min-w-40 flex-col rounded-lg border border-border bg-elevated py-1">
          <button type="button" role="menuitem" className="px-3 py-2 text-left text-[13px] text-ink hover:bg-hover" data-credentials-import="" onClick={() => choose(onImport)}>{t("vault.menu.import")}</button>
          {actions.includes("export") && (
            <button type="button" role="menuitem" className="px-3 py-2 text-left text-[13px] text-ink hover:bg-hover" data-credentials-export="" onClick={() => choose(onExport)}>{t("vault.menu.export")}</button>
          )}
        </div>
      )}
    </div>
  );
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

export function ItemRow({ item, botName, bots, onEdit, onChanged, onError }: {
  item: VaultItemListing;
  botName: (id: string) => string;
  bots: ReadonlyArray<{ id: string; name: string }>;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const used = item.lastUsedAt
    ? t("vault.settings.lastUsed", { when: when(item.lastUsedAt), bot: botName(item.lastUsedBy ?? "") })
    : t("vault.settings.neverUsed");
  const grey = itemGreyLine(item);
  return (
    <div data-credential-item={item.id}>
      <DescribedRow
        label={item.name}
        description={grey ? `${grey} · ${used}` : used}
        rowId={`credential-${item.id}`}
        below={open ? <VaultItemDetail item={item} botName={botName} bots={bots} onEdit={onEdit} onChanged={onChanged} onError={onError} /> : undefined}
      >
        <DisclosurePill open={open} onToggle={() => setOpen((current) => !current)} label={t("vault.item.manage")}>
          {t("vault.item.manage")}
        </DisclosurePill>
      </DescribedRow>
    </div>
  );
}

function VaultItemDetail({ item, botName, bots, onEdit, onChanged, onError }: {
  item: VaultItemListing;
  botName: (id: string) => string;
  bots: ReadonlyArray<{ id: string; name: string }>;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
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
    <div className="mt-2 flex flex-col gap-2" data-credential-detail="">
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
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={PILL} disabled={busy} onClick={onEdit}>{t("vault.settings.edit")}</button>
      </div>
      <div className="flex justify-end">
        {confirming
          ? <button type="button" className={DANGER_PILL} disabled={busy} onClick={() => void run(() => deleteCredential(item.id))}>{t("vault.settings.confirmDelete")}</button>
          : <button type="button" className={DANGER_PILL} disabled={busy} onClick={() => setConfirming(true)}>{t("vault.settings.delete")}</button>}
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
