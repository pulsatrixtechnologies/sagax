// Settings > Providers (#4329 lot 1, the owner 2026-11-14: "You select a
// provider, you log in, done"): one short list, one row per provider in the
// order and under the names of the shared providers (shared/model-provider.ts),
// its accounts as lines, one button each. A click on the row opens the
// provider's page (ProviderPage.tsx), where everything else lives. "Add a
// provider" is one list in two columns (the reference's Connect Apps grid),
// then one step. Other services and Advanced stay as they were.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, KeyRound, Plus, Search } from "lucide-react";

import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { providerGroupKey, providerGroups, type ProviderGroup, type ProviderRow } from "@/lib/provider-rows";
import { PERSONAL_PROVIDER_NAMES, type PersonalProvider } from "../../../shared/provider-accounts";
import { COMPUTER_PROVIDER_ID, vendorLabel, vendorOfEngineName } from "../../../shared/model-provider";
import { takeProviderRow, useProviderRowRequest } from "@/lib/provider-row-request";
import { PersonalProviderKey, PersonalProviderServerForm } from "./PersonalProviderAccount";
import { HarnessConnectorsSection } from "../HarnessConnectorsSection";
import { MAIN_KEY_ROWS, MORE_KEY_ROWS, ProviderKeyDialog, ProviderKeyEditor, keyRowName, keyRowSaved, useOpenProviderKey, type KeyRowId } from "./ProviderKeys";
import { CloudAgentProvidersSettings, useCloudAgentProviders } from "./CloudAgentProvidersSettings";
import { ImageGenerationSettings, imageProviderLabel } from "./ImageGenerationSettings";
import { MemesSettings } from "./MemesSettings";
import { WebSearchSettings } from "./WebSearchSettings";
import { SavedKeysResetNotice } from "../SavedKeysReset";
import { DescribedRow, HelpTip, InlineFold, PILL, SettingsFoldSection, SettingsGroup, Switch, peekRequestedSettingsCard } from "../SettingsPrimitives";
import { SettingsEmpty, StatusText } from "./SettingsPatterns";
import { PLUGINS } from "../plugins/plugins-style";
import { BOTS_LINK_SEARCH_WORDS, BotsLinkButton, botsLinkOnPage, botsLinkWords, useBotsLink } from "./LinkedGrokBotSettings";
import { PiServerForm } from "./PiModelServers";
import { useProviderList, type ProviderList } from "./useProviderList";
import { LineButton, ProviderLogo, XAI_PROVIDER_ID, groupName, lineAction, openProviderPage } from "./ProviderPage";
import { firstStepRow, providerSummary, type ProviderSummary } from "./provider-summary";
import { providerCardTarget } from "@/lib/settings-sections";

/** One row of the list (#4376, measured on the reference's row that opens a
 * detail page: one button the whole row wide, its hover the whole row, a
 * chevron at the right): the logo, the name and ONE line that sums the
 * provider up. A connected provider has no button here: signing out,
 * disconnecting, removing and turning off are on its page. A provider not
 * connected yet carries its first step ("Sign in"), the one control that
 * sits over the row, never overlapping another. */
export function ProviderListRow({ group, list, summary, onOpen, action, rowData }: {
  group: ProviderGroup;
  list: ProviderList;
  summary: ProviderSummary;
  onOpen: () => void;
  action?: ReactNode;
  rowData?: Record<string, string>;
}) {
  const name = groupName(group);
  return (
    <li data-provider={group.id} data-provider-kind={group.kind} {...rowData}
      className="group/provider relative min-w-0 rounded-2xl transition-colors hover:bg-ink/[0.05] has-[[data-provider-open]:focus-visible]:bg-ink/[0.05] motion-reduce:transition-none">
      {/* the row's one target: under the words, the whole row wide */}
      <button type="button" data-provider-open={group.id} onClick={onOpen} aria-label={`${name}, ${summary.text}`}
        className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70" />
      {/* at a narrow width the button goes under the words, never squeezing the name letter by letter */}
      <div data-provider-row-body="" className="pointer-events-none relative flex min-h-16 min-w-0 flex-wrap items-center gap-3 p-3">
        <ProviderLogo group={group} instances={list.instances} />
        <span className="min-w-[9rem] flex-1 basis-0">
          {/* a long server name wraps, never cut (#4329: no name cut at any width) */}
          <span className="block break-words text-[13px] font-medium leading-[18px] text-ink [overflow-wrap:anywhere]">{name}</span>
          <span className={cn(PLUGINS.rowSub, "[overflow-wrap:anywhere]")} data-provider-summary={group.id}>
            <StatusText tone={summary.tone}>{summary.text}</StatusText>
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {action && <span data-provider-row-action="" className="pointer-events-auto relative flex shrink-0">{action}</span>}
          <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary transition-colors group-hover/provider:text-ink motion-reduce:transition-none" />
        </span>
      </div>
    </li>
  );
}

/** The xAI provider's row when none of its accounts is listed but the bots
 * link is there (#4329 lot 2): its name and what the link says. */
const BOTS_LINK_GROUP: ProviderGroup = { id: XAI_PROVIDER_ID, name: vendorLabel(XAI_PROVIDER_ID), kind: "account", rows: [], state: "available" };
/** The row a settings search finds the bots link by (its old names included). */
const BOTS_LINK_ROW = { "data-bots-link-row": "", "data-settings-row": "providers.botsLink", "data-settings-keywords": BOTS_LINK_SEARCH_WORDS };

/** One choice of Add a provider. */
type AddChoice =
  | { kind: "signIn"; id: string; name: string; group: ProviderGroup; row: ProviderRow }
  | { kind: "personalKey"; id: string; name: string; provider: PersonalProvider }
  | { kind: "serverKey"; id: string; name: string; key: KeyRowId }
  | { kind: "engineKey"; id: string; name: string; group: ProviderGroup; row: ProviderRow }
  | { kind: "server"; id: string; name: string }
  | { kind: "piServer"; id: string; name: string }
  | { kind: "computer"; id: string; name: string };

/** The keys of the server's list Add offers on a solo server (the person's
 * own keys cover the vendors): images. A server by its address (the
 * server's own address, an Azure resource) is added one way only, through
 * "Another server", whose Advanced holds those two (#4329 C). */
const SOLO_SERVER_KEYS: readonly KeyRowId[] = ["openaiImage", "customImage"];
const SOLO_SERVER_ADDRESS_KEYS: readonly KeyRowId[] = ["openaiCompat", "azureFoundry"];

/** "Another server" on a solo server: the person's server form, and in its
 * Advanced the server's own address and its Azure resource, one at a time. */
function AnotherServerStep({ list, onClose }: { list: ProviderList; onClose: () => void }) {
  const { state } = useStore();
  const [key, setKey] = useState<KeyRowId | null>(null);
  const keys = list.organization ? [] : SOLO_SERVER_ADDRESS_KEYS.filter((id) => !keyRowSaved(id, state.config));
  if (key) return <ProviderKeyEditor id={key} onClose={onClose} />;
  return (
    <>
      <PersonalProviderServerForm onDone={onClose} />
      {keys.length > 0 && (
        <div data-add-server-advanced="" className="border-t border-hairline/40 pt-1">
          <InlineFold label={t("providers.advanced.title")}>
            <div className="flex flex-col items-start gap-1 pt-1">
              {keys.map((id) => (
                <button key={id} type="button" data-add-server-key={id} className={PILL} onClick={() => setKey(id)}>{keyRowName(id)}</button>
              ))}
            </div>
          </InlineFold>
        </div>
      )}
    </>
  );
}

/** What Add a provider lists (#4329 B2): a provider already connected is
 * not in it. Sign-ins first, keys, then another server and this computer.
 * A vendor offered as a sign-in gets its key from "Use a key instead". */
export function addChoices(list: ProviderList, config: Parameters<typeof keyRowSaved>[1]): { signIn: AddChoice[]; keys: AddChoice[]; other: AddChoice[] } {
  const waiting = providerGroups(list.toConnect.filter((row) => row.payer !== "org"), list.instances);
  const connected = new Set(list.groups.map((group) => group.id));
  const signIn: AddChoice[] = waiting
    .filter((group) => group.kind === "account" && !connected.has(group.id))
    .map((group) => ({ kind: "signIn", id: group.id, name: group.name, group, row: group.rows.find((row) => row.kind === "account") ?? group.rows[0]! }));
  const taken = new Set([...connected, ...signIn.map((choice) => choice.id)]);
  const keys: AddChoice[] = [];
  const savedPersonal = new Set(list.accounts.view?.keys.map((key) => key.provider) ?? []);
  for (const provider of Object.keys(PERSONAL_PROVIDER_NAMES) as PersonalProvider[]) {
    const vendor = vendorOfEngineName(provider) ?? provider;
    if (taken.has(vendor) || savedPersonal.has(provider)) continue;
    taken.add(vendor);
    keys.push({ kind: "personalKey", id: vendor, name: vendorLabel(vendor), provider });
  }
  for (const group of waiting) {
    if (taken.has(group.id) || group.kind !== "key") continue;
    const row = group.rows[0]!;
    taken.add(group.id);
    keys.push({ kind: "engineKey", id: group.id, name: group.name, group, row });
  }
  if (!list.organization) {
    for (const key of SOLO_SERVER_KEYS) {
      if (keyRowSaved(key, config)) continue;
      keys.push({ kind: "serverKey", id: `key:${key}`, name: keyRowName(key), key });
    }
  }
  const other: AddChoice[] = [{ kind: "server", id: "server", name: t("providers.add.anotherServer") }];
  if (list.piServers.servers !== null && (list.instances.some((instance) => instance.driverKind === "piAgent"))) other.push({ kind: "piServer", id: "piServer", name: t("providers.add.piServer") });
  if (list.local && !list.local.expose) other.push({ kind: "computer", id: COMPUTER_PROVIDER_ID, name: t("model.computerProvider") });
  return { signIn, keys, other };
}

const CHOICE_LINE: Record<AddChoice["kind"], LocaleKey> = {
  signIn: "providers.add.accountLine",
  personalKey: "providers.add.keyLine",
  serverKey: "providers.add.keyLine",
  engineKey: "providers.add.keyLine",
  server: "providers.add.serverLine",
  piServer: "providers.add.serverLine",
  computer: "providers.add.computerLine",
};

/** A choice's mark: the provider's own tile (ProviderLogo), drawn for a
 * choice with no group yet as the provider it adds. */
function ChoiceLogo({ choice, list }: { choice: AddChoice; list: ProviderList }) {
  const group: ProviderGroup = choice.kind === "signIn" || choice.kind === "engineKey" ? choice.group
    : { id: choice.id, name: choice.name, rows: [], state: "available",
        kind: choice.kind === "computer" ? "computer" : choice.kind === "server" || choice.kind === "piServer" ? "server" : "key" };
  return <ProviderLogo group={group} instances={list.instances} />;
}

/** "Add a provider" (#4329 B2): one list, two columns, a search; pick, then one step. */
function AddProvider({ list, onClose }: { list: ProviderList; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<AddChoice | null>(null);
  const [forOrg, setForOrg] = useState(false);
  const choices = addChoices(list, state.config);
  const match = (choice: AddChoice) => !query.trim() || choice.name.toLowerCase().includes(query.trim().toLowerCase());
  const pick = (choice: AddChoice) => {
    if (choice.kind === "signIn" || choice.kind === "engineKey") { onClose(); openProviderPage(dispatch, choice.group.id, choice.row.id); return; }
    if (choice.kind === "computer") { list.setLocal({ expose: true }); onClose(); openProviderPage(dispatch, COMPUTER_PROVIDER_ID); return; }
    setPicked(choice);
  };
  const section = (titleKey: LocaleKey, items: AddChoice[], sectionId: string) => {
    const shown = items.filter(match);
    if (!shown.length) return null;
    return (
      <section key={sectionId} data-add-provider-section={sectionId} className="flex min-w-0 flex-col">
        <h3 className={PLUGINS.sectionTitle}>{t(titleKey)}</h3>
        <ul className={PLUGINS.grid}>
          {shown.map((choice) => (
            <li key={`${choice.kind}:${choice.id}`}>
              <button type="button" data-add-provider-choice={choice.id} data-add-provider-kind={choice.kind} onClick={() => pick(choice)}
                className="flex min-h-16 w-full min-w-0 items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
                <ChoiceLogo choice={choice} list={list} />
                <span className="min-w-0 flex-1">
                  <span className={PLUGINS.rowName}>{choice.name}</span>
                  <span className={PLUGINS.rowSub}>{t(CHOICE_LINE[choice.kind])}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  };
  if (picked) {
    const vendorKey = picked.kind === "personalKey" ? ([...MAIN_KEY_ROWS, ...MORE_KEY_ROWS] as KeyRowId[]).find((id) => id === picked.provider || (picked.provider === "fish" && id === "fishAudio") || (picked.provider === "opencode" && id === "opencodeGo")) : undefined;
    return (
      <div data-add-provider="" data-step={picked.kind} className="flex flex-col gap-3 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => setPicked(null)} aria-label={t("providers.add.back")} title={t("providers.add.back")}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
          <span className="truncate text-[13px] font-medium text-ink">{picked.name}</span>
        </div>
        {picked.kind === "personalKey" && list.organization && list.manageKeys && vendorKey && (
          <label className="flex items-center justify-between gap-3 text-[12.5px] text-ink">
            <span>{t("providers.add.forOrg")}</span>
            <Switch checked={forOrg} onClick={() => setForOrg(!forOrg)} aria-label={t("providers.add.forOrg")} />
          </label>
        )}
        {picked.kind === "personalKey" && list.organization && !forOrg && <p className="text-[12px] leading-relaxed text-ink-secondary">{t("providers.add.ownKeyHint")}</p>}
        {picked.kind === "personalKey" && (forOrg && vendorKey
          ? <ProviderKeyEditor id={vendorKey} onClose={onClose} />
          : <PersonalProviderKey key={picked.provider} provider={picked.provider} name={picked.name} onDone={onClose} />)}
        {picked.kind === "serverKey" && <ProviderKeyEditor id={picked.key} onClose={onClose} />}
        {picked.kind === "server" && <AnotherServerStep list={list} onClose={onClose} />}
        {picked.kind === "piServer" && <PiServerForm onDone={(answer) => { list.piServers.changed(answer); onClose(); }} />}
      </div>
    );
  }
  const sections = [
    section("providers.add.signIn", choices.signIn, "signIn"),
    section("providers.add.key", choices.keys, "keys"),
    section("providers.add.else", choices.other, "other"),
  ].filter(Boolean);
  return (
    <div data-add-provider="" data-step="choose" className="flex flex-col gap-2 px-1.5 py-2">
      <div className="flex items-center gap-2 px-1.5">
        <label className={PLUGINS.search}>
          <Search size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("providers.add.search")} aria-label={t("providers.add.search")}
            data-add-provider-search="" className={PLUGINS.searchInput} />
        </label>
        <button type="button" className={PILL} onClick={onClose}>{t("common.cancel")}</button>
      </div>
      {sections.length ? sections : <p className="px-3 py-2 text-[12.5px] text-ink-secondary">{t("providers.add.none")}</p>}
    </div>
  );
}

export function ProvidersSettings() {
  const { state, dispatch } = useStore();
  const list = useProviderList();
  const [adding, setAdding] = useState(false);
  const editingKey = useOpenProviderKey();
  const rowRequest = useProviderRowRequest();
  const botsLink = useBotsLink();
  const open = (group: ProviderGroup, row?: ProviderRow) => openProviderPage(dispatch, group.id, row?.id);
  const openRow = (row: ProviderRow) => openProviderPage(dispatch, row.kind === "local" ? COMPUTER_PROVIDER_ID : providerGroupKey(row, list.instances), row.id);

  // Another page's "Add the key" (openProviderKeyDialog) opens that key's line.
  useEffect(() => {
    if (!editingKey) return;
    const match = list.rows.find((row) => row.keyRow === editingKey && row.payer !== "org");
    if (match) openRow(match);
  }, [editingKey, list.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // A claude.ai card's "Reconnect the account" opens the Claude account's line.
  useEffect(() => {
    if (rowRequest !== "claude") return;
    const match = list.rows.find((row) => row.claude);
    if (!match) return;
    takeProviderRow();
    openRow(match);
  }, [rowRequest, list.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // An old link to a row's card (Advanced of an engine, this computer's
  // models) opens the provider's page that holds it now (settings-sections.ts).
  const target = useMemo(() => providerCardTarget(peekRequestedSettingsCard()), []);
  useEffect(() => {
    if (!target) return;
    if (target.kind === "computer") { if (list.local) openProviderPage(dispatch, COMPUTER_PROVIDER_ID); return; }
    if (target.kind !== "row") return;
    const match = list.rows.find((row) => row.instanceIds.includes(target.id) || row.id === target.id || row.compatServerId === target.id);
    if (match) openRow(match);
  }, [target, list.rows, list.local]); // eslint-disable-line react-hooks/exhaustive-deps

  // #4329 lot 2: the link to the person's bots in the xAI provider's bot
  // app is a line of that provider's row (alone, the provider's own row when
  // none of its accounts is listed); its block is on that provider's page.
  const xaiListed = list.groups.some((group) => group.id === XAI_PROVIDER_ID);
  // Shown once linked, or wherever the organization allows it: with no xAI
  // account here, the provider's own row carries it, so Connect is reachable.
  const showBotsLink = botsLinkOnPage(botsLink);
  const openBotsLink = () => openProviderPage(dispatch, XAI_PROVIDER_ID);
  // An old link to the bots link (it was under Advanced) opens that page.
  useEffect(() => {
    if (target?.kind === "botsLink" && showBotsLink) openBotsLink();
  }, [target, showBotsLink]); // eslint-disable-line react-hooks/exhaustive-deps

  const imageGen = state.config?.imageGen;

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2" data-providers-page="">
      <SavedKeysResetNotice />
      {list.accounts.unavailable && <p data-needs-server-update="" className="text-[12px] text-ink-secondary">{list.accounts.unavailable}</p>}
      {list.accounts.error && <p role="alert" className="text-[12px] text-danger">{list.accounts.error}</p>}
      {list.piServers.loadError && <p role="alert" className="text-[12px] text-danger">{list.piServers.loadError}</p>}
      <div data-settings-card="providers.list">
        <SettingsGroup
          title={t("providers.listTitle")}
          groupId="providers"
          accessory={<HelpTip label={t("settings.moreAbout", { title: t("providers.title") })}>{t("providers.help")}</HelpTip>}
        >
          {adding
            ? <AddProvider list={list} onClose={() => setAdding(false)} />
            : (
              <>
                {list.groups.length > 0 || showBotsLink
                  ? <ul className="flex flex-col gap-0.5 px-1.5 py-1" data-providers-active="">
                      {list.groups.map((group) => {
                        const xai = group.id === XAI_PROVIDER_ID && showBotsLink;
                        const step = firstStepRow(group, (row) => lineAction(row, list));
                        return (
                          <ProviderListRow key={group.id} group={group} list={list} onOpen={() => open(group)}
                            summary={providerSummary(group, xai && botsLink.view?.linked === true && botsLink.state === "connected")}
                            action={step ? <LineButton row={step} group={group} list={list} onOpen={(row) => open(group, row)} /> : undefined}
                            rowData={xai ? BOTS_LINK_ROW : undefined} />
                        );
                      })}
                      {showBotsLink && !xaiListed && (
                        <ProviderListRow group={BOTS_LINK_GROUP} list={list} onOpen={openBotsLink} rowData={BOTS_LINK_ROW}
                          summary={{ text: botsLinkWords(botsLink) ?? "", tone: "neutral" }}
                          action={<BotsLinkButton link={botsLink} onOpen={openBotsLink} />} />
                      )}
                    </ul>
                  : <div data-providers-empty=""><SettingsEmpty icon={KeyRound}>{t("providers.empty")}</SettingsEmpty></div>}
                {/* #4376 ("the add provider is looking weird at this spot"): the
                    list's last row, drawn as its rows are (the reference's
                    "+ Add an account" row), never a button of another kind */}
                <div data-add-provider-row="" className="px-1.5 pb-1">
                  <button type="button" data-add-provider-open="" onClick={() => setAdding(true)}
                    className="group/add flex min-h-16 w-full min-w-0 items-center gap-3 rounded-2xl p-3 text-left outline-none transition-colors hover:bg-ink/[0.05] focus-visible:bg-ink/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 motion-reduce:transition-none">
                    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-ink/[0.06] text-ink-secondary group-hover/add:text-ink">
                      <Plus size={20} />
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] font-medium leading-[18px] text-ink">{t("providers.add.title")}</span>
                    <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary transition-colors group-hover/add:text-ink motion-reduce:transition-none" />
                  </button>
                </div>
              </>
            )}
        </SettingsGroup>
      </div>
      {/* Other services (from Models, 2026-11-05): web search (the person's own key) and image generation */}
      <div data-settings-card="providers.services">
        <SettingsGroup title={t("providers.services.title")} groupId="providers-services">
          <WebSearchSettings bare />
          <MemesSettings bare />
          {list.installation
            ? <div data-settings-card="connections.image"><ImageGenerationSettings keysLink={list.manageKeys} /></div>
            : (
              <DescribedRow label={t("imageGen.title")} description={imageProviderLabel(imageGen?.provider)} rowId="providers.imageGen" />
            )}
        </SettingsGroup>
      </div>
      {/* Advanced (#2295): the person's cloud agent keys and their claude.ai
          connectors. Never a card in a card. The link to the person's bots in
          the xAI provider's bot app is a line of that provider (#4329). */}
      <SettingsFoldSection cardId="providers.advanced" groupId="providers-advanced" title={t("providers.advanced.title")} description={t("providers.advanced.help")}>
        <div className="flex flex-col gap-6" data-providers-advanced="">
          {list.manageKeys && (
            <SettingsGroup groupId="providers-cloud-agents">
              <CloudAgentKeys />
            </SettingsGroup>
          )}
          <HarnessConnectorsSection placement="settings" />
        </div>
      </SettingsFoldSection>
      {/* a key asked for from another page with no line here yet */}
      <ProviderKeyDialog hidden={Boolean(editingKey && list.rows.some((row) => row.keyRow === editingKey && row.payer !== "org"))} />
    </div>
  );
}

function CloudAgentKeys() {
  const cloud = useCloudAgentProviders();
  return <CloudAgentProvidersSettings state={cloud} />;
}
