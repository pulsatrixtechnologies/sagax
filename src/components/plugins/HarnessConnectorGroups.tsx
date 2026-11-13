// The connectors of the person's engine accounts, as plugin rows (#2306,
// 2026-11-06): Discover lists them under "From <provider>" (the provider's
// label: Claude, xAI, ChatGPT) in the very rows of "From Sagax", and
// Installed folds the connected ones into its list, the same row and "..."
// menu as a plugin. They come from GET /api/me/harness-connectors, which
// reads the person's connector registry (#3358): Claude's (the caller's own
// claude.ai account: a name and a status), Grok's (each of the person's own
// Grok sign-ins, with the real state of each connector) and the ChatGPT apps
// of their Codex sign-in. A server that lists no Grok sign-in (older, solo)
// leaves Grok on the xAI catalog, managed on grok.com (not verifiable: no
// status). Claude and Grok always have their section
// (2026-10-28): a section the server cannot fill says why, in a row with
// the way to connect, never vanishes. Each row names the service it reaches
// (CapabilityTags).
import type { ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { categoryFromTags, providerMark, type PluginCategory, type PluginFilter, type PluginItem, type PluginTypeFilter } from "@/lib/plugins-model";
import { GROK_CONNECTORS_URL } from "../../../shared/grok-cloud-connectors";
import { ClaudeMark, GrokMark, CodexMark } from "../ProviderIcons";
import { PluginIcon } from "./PluginParts";
import { CapabilityTags } from "./EngineCapabilities";
import { PLUGINS, pluginActionClass } from "./plugins-style";
import { claudeAiConnectorCapabilities, grokConnectorCapabilities, type ConnectorCapability } from "../../../shared/engine-connectors";

export type HarnessConnectorStatus = "connected" | "needs_auth" | "failed" | "unknown";

export type HarnessEngine = "claude" | "grok" | "codex";

/** Why the server lists no claude.ai connector for this person
 * (server/harness-connectors.ts ClaudeAiUnavailable). */
export type ClaudeUnavailable = "managed_policy" | "no_engine" | "not_signed_in" | "not_operator" | "key" | "unknown";

/** A section without its connectors: what the person reads instead, and
 * whether it offers to set the engine up or to read again. */
export type HarnessGroupNotice =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "unavailable"; reason: ClaudeUnavailable }
  | { kind: "no_account" };

/** #3358: one of the person's own Grok sign-ins, as the connector registry
 * knows it (server/harness-connectors.ts HarnessGrokAccount). */
export interface RegistryGrokAccount {
  /** "Grok", "Grok (personal account)" */
  label: string;
  slot: "primary" | "second";
  kind?: "personal" | "team";
  /** subscription: its connectors are listed; unknown: not read yet */
  auth: "subscription" | "key" | "none" | "unknown";
  connectors: Array<{ id?: string; name: string; status: HarnessConnectorStatus }>;
  at: number;
}

export interface HarnessConnectorGroup {
  id: HarnessEngine;
  /** the engine's name: "Manage on Grok", "connector (Grok account)" */
  name: string;
  /** the provider's label of its Discover section: "From xAI" */
  source: string;
  manageUrl: string;
  /** the engine account's line: an email or "Signed in" (absent: none) */
  account?: string;
  /** `id`: a Grok connector's id (its capabilities) */
  connectors: Array<{ name: string; id?: string; status?: HarnessConnectorStatus; tag?: string }>;
  /** no connector to list: why, in the section's place */
  notice?: HarnessGroupNotice;
}

const NOTICE_KEY = {
  loading: "connectApps.accounts.notice.loading",
  empty: "connectApps.accounts.notice.empty",
  no_account: "connectApps.accounts.notice.noAccount",
  managed_policy: "connectApps.accounts.notice.managedPolicy",
  no_engine: "connectApps.accounts.notice.noEngine",
  not_signed_in: "connectApps.accounts.notice.notSignedIn",
  not_operator: "connectApps.accounts.notice.notOperator",
  key: "connectApps.accounts.notice.key",
  unknown: "connectApps.accounts.notice.unknown",
} as const satisfies Record<string, LocaleKey>;

/** What a notice offers: set the engine up (Settings > Models and voice),
 * read again, add a connector on the engine's site, or nothing. */
export function noticeAction(notice: HarnessGroupNotice): "setup" | "retry" | "manage" | null {
  if (notice.kind === "loading") return null;
  if (notice.kind === "empty") return "manage";
  if (notice.kind === "no_account") return "setup";
  switch (notice.reason) {
    case "no_engine":
    case "not_signed_in":
    case "key": return "setup";
    case "unknown": return "retry";
    default: return null;
  }
}

export function noticeText(group: Pick<HarnessConnectorGroup, "name" | "notice">): string {
  const notice = group.notice;
  if (!notice) return "";
  const key = notice.kind === "unavailable" ? NOTICE_KEY[notice.reason] ?? NOTICE_KEY.unknown : NOTICE_KEY[notice.kind];
  return t(key, { provider: group.name });
}

const STATUS_KEY: Record<HarnessConnectorStatus, LocaleKey> = {
  connected: "harnessConnectors.status.connected",
  needs_auth: "harnessConnectors.status.needsAuth",
  failed: "harnessConnectors.status.failed",
  unknown: "harnessConnectors.status.unknown",
};

/** The sections to show: Claude and Grok always (their connectors, or why
 * there are none and how to connect), ChatGPT when the person has a
 * ChatGPT sign-in the server lists. */
export function connectorGroups(input: {
  claude?: { available: boolean; reason?: ClaudeUnavailable; connectors: Array<{ name: string; status: HarnessConnectorStatus }>; manageUrl?: string; account?: string } | null;
  /** the person's Claude connectors are still being read */
  claudeLoading?: boolean;
  /** `accounts`: the person's Grok sign-ins from the registry (#3358);
   * `connectors`: the xAI catalog, when the server lists no sign-in */
  grok?: { accounts: readonly RegistryGrokAccount[] } | { connectors: readonly { id: string; name: string; tag?: string }[]; account?: string } | null;
  /** ChatGPT apps of a Codex sign-in (the server says `available: false` today) */
  codex?: { available: boolean; connectors?: Array<{ name: string; status: HarnessConnectorStatus }>; manageUrl?: string } | null;
}): HarnessConnectorGroup[] {
  const groups: HarnessConnectorGroup[] = [];
  const claude = input.claude;
  const claudeUrl = claude?.manageUrl ?? "https://claude.ai/customize/connectors";
  const claudeConnectors = claude?.available ? claude.connectors.filter((connector) => connector.name.trim() !== "") : [];
  let claudeNotice: HarnessGroupNotice | undefined;
  if (claudeConnectors.length) claudeNotice = undefined;
  else if (!claude) claudeNotice = input.claudeLoading === false ? { kind: "unavailable", reason: "unknown" } : { kind: "loading" };
  else if (claude.available) claudeNotice = { kind: "empty" };
  else claudeNotice = { kind: "unavailable", reason: claude.reason ?? "unknown" };
  groups.push({ id: "claude", name: "Claude", source: "Claude", manageUrl: claudeUrl, ...(claude?.account ? { account: claude.account } : {}), connectors: claudeConnectors, ...(claudeNotice ? { notice: claudeNotice } : {}) });
  const grokBase = { id: "grok" as const, name: "Grok", source: t("providerKeys.xai"), manageUrl: GROK_CONNECTORS_URL };
  if (input.grok && "accounts" in input.grok) {
    groups.push({ ...grokBase, ...registryGrokGroup(input.grok.accounts) });
  } else if (input.grok && input.grok.connectors.length) {
    groups.push({ ...grokBase, ...(input.grok.account ? { account: input.grok.account } : {}), connectors: input.grok.connectors.map((connector) => ({ id: connector.id, name: connector.name, ...(connector.tag ? { tag: connector.tag } : {}) })) });
  } else {
    groups.push({ ...grokBase, connectors: [], notice: { kind: "no_account" } });
  }
  const codex = input.codex;
  if (codex?.available) {
    // a ChatGPT sign-in the registry lists: its apps, or that it has none yet
    const connectors = (codex.connectors ?? []).filter((connector) => connector.name.trim() !== "");
    groups.push({ id: "codex", name: "ChatGPT", source: "ChatGPT", manageUrl: codex.manageUrl ?? "https://chatgpt.com/#settings/Connectors", connectors, ...(connectors.length ? {} : { notice: { kind: "empty" } as const }) });
  }
  return groups;
}

const STATUS_RANK: Record<HarnessConnectorStatus, number> = { connected: 3, needs_auth: 2, failed: 1, unknown: 0 };

/** #3358: the Grok section from the person's own sign-ins: every connector
 * once (the same one on two sign-ins keeps its best state), with its real
 * state; with none, why (not read yet, a key, signed out, none added). */
export function registryGrokGroup(accounts: readonly RegistryGrokAccount[]): Pick<HarnessConnectorGroup, "connectors" | "account" | "notice"> {
  if (!accounts.length) return { connectors: [], notice: { kind: "no_account" } };
  const byKey = new Map<string, HarnessConnectorGroup["connectors"][number]>();
  for (const account of accounts) {
    if (account.auth !== "subscription") continue;
    for (const connector of account.connectors) {
      if (connector.name.trim() === "") continue;
      const key = (connector.id ?? connector.name).trim().toLowerCase();
      const known = byKey.get(key);
      if (known && STATUS_RANK[known.status ?? "unknown"] >= STATUS_RANK[connector.status]) continue;
      byKey.set(key, { ...(connector.id ? { id: connector.id } : {}), name: connector.name, status: connector.status });
    }
  }
  const account = accounts.length > 1 ? { account: accounts.map((entry) => entry.label).join(", ") } : {};
  const connectors = [...byKey.values()];
  if (connectors.length) return { connectors, ...account };
  const auths = new Set(accounts.map((entry) => entry.auth));
  const notice: HarnessGroupNotice = auths.has("subscription") ? { kind: "empty" }
    : auths.has("unknown") ? { kind: "unavailable", reason: "unknown" }
      : auths.has("key") ? { kind: "unavailable", reason: "key" }
        : { kind: "unavailable", reason: "not_signed_in" };
  return { connectors: [], ...account, notice };
}

/** One connector of an engine account, read as a plugin row. */
export interface AccountConnectorRow {
  /** `${engine}:${name}`, unique across the account rows */
  key: string;
  engine: HarnessEngine;
  /** the engine's name ("Claude", "Grok", "ChatGPT") */
  provider: string;
  name: string;
  /** a Grok connector's id */
  id?: string;
  /** absent: not verifiable (Grok's catalog) */
  status?: HarnessConnectorStatus;
  manageUrl: string;
  category: PluginCategory;
  capabilities: ConnectorCapability[];
}

const CAPABILITY_TAG: Record<ConnectorCapability, string> = { mail: "email", calendar: "calendar", teams: "messaging", sharepoint: "files", files: "files" };

/** The rows of a group: each connector with its category (the catalog's
 * own row of the same name, else its tag, else what it reaches). */
export function accountConnectorRows(group: HarnessConnectorGroup, catalog: readonly Pick<PluginItem, "name" | "category">[] = []): AccountConnectorRow[] {
  return group.connectors.map((connector) => {
    const capabilities = group.id === "grok" ? grokConnectorCapabilities(connector.id ?? "") : claudeAiConnectorCapabilities(connector.name);
    const known = catalog.find((item) => item.name.trim().toLowerCase() === connector.name.trim().toLowerCase());
    const category = known?.category ?? categoryFromTags([connector.tag, ...capabilities.map((capability) => CAPABILITY_TAG[capability])]);
    return {
      key: `${group.id}:${connector.name}`,
      engine: group.id,
      provider: group.name,
      name: connector.name,
      ...(connector.id ? { id: connector.id } : {}),
      ...(connector.status ? { status: connector.status } : {}),
      manageUrl: group.manageUrl,
      category,
      capabilities,
    };
  });
}

/** An account row under a category pill or the type filter: apps only. */
export function accountRowMatches(row: Pick<AccountConnectorRow, "category">, filter: PluginFilter, type: PluginTypeFilter): boolean {
  if (type !== "any" && type !== "apps") return false;
  return filter === "all" || row.category === filter;
}

/** The connected rows: what "N connected" adds to the person's entries. */
export function connectedAccountRows(groups: readonly HarnessConnectorGroup[]): number {
  return groups.reduce((total, group) => total + group.connectors.filter((connector) => connector.status === "connected").length, 0);
}

/** The gray line under the name: "connector (Claude account)", then what
 * the right side does not say (not verifiable, unknown, unavailable). */
export function accountConnectorSub(row: Pick<AccountConnectorRow, "provider" | "status">): string {
  const head = t("connectApps.brings.accountConnector", { provider: row.provider });
  if (!row.status) return `${head} · ${t("connectApps.grok.description")}`;
  if (row.status === "unknown" || row.status === "failed") return `${head} · ${t(STATUS_KEY[row.status])}`;
  return head;
}

const openManage = (url: string) => void openExternalLink(url).catch(() => undefined);

/** The right side of an account row: Installed when connected, a Sign in
 * button (the Add format) when it waits for a sign-in, Reconnect when it
 * failed; nothing when it cannot be verified (the gray line says so). */
export function AccountConnectorStatus({ row, installedMark }: { row: AccountConnectorRow; installedMark: ReactNode }) {
  if (row.status === "connected") return <>{installedMark}</>;
  if (row.status === "needs_auth" || row.status === "failed") {
    return (
      <button type="button" className={pluginActionClass("fill")} data-harness-signin={row.key} data-harness-status={row.status}
        title={t(STATUS_KEY[row.status])}
        onClick={(event) => { event.stopPropagation(); openManage(row.manageUrl); }}>
        {row.status === "needs_auth" ? t("connectApps.accounts.signIn") : t("connectApps.accounts.reconnect")}
      </button>
    );
  }
  return null;
}

/** An account row's mark, name, what it reaches and its gray line. */
export function AccountConnectorBody({ row }: { row: AccountConnectorRow }) {
  const mark = providerMark(row.name);
  const sub = accountConnectorSub(row);
  // Grok's reach rule stays on the row (once a line under its section)
  const tip = row.engine === "grok" ? `${sub}\n${t("connectApps.capabilities.grokOrg")}` : sub;
  return (
    <>
      <PluginIcon item={{ kind: "app", name: row.name, logo: mark.logo, domain: mark.site }} className="size-10 rounded-[10px]" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={cn(PLUGINS.rowName, "min-w-0")}>{row.name}</span>
          <CapabilityTags capabilities={row.capabilities} name={row.name} />
        </span>
        <span className={PLUGINS.rowSub} title={tip} data-harness-status={row.status ?? "managed"}>{sub}</span>
      </span>
    </>
  );
}

/** A section with no connector to list: the engine's mark, why, and its
 * way out on the right, in the place of a row. */
/** One provider's account notice (not signed in, no connector yet, loading).
 * In a connector grid it takes the whole row (`col-span-full`, #3040): one
 * 264px cell left its text a word per line beside the action. When the cell
 * is still narrow (a phone), the action drops under the text instead of
 * squeezing it. `manageInHead`: the section head right above already links
 * to the provider's page, so the row does not repeat that same link. */
export function AccountNoticeRow({ group, refreshing, onRefresh, onSetUp, manageInHead = false, className }: { group: HarnessConnectorGroup; refreshing?: boolean; onRefresh?: () => void; onSetUp?: (engine: HarnessEngine) => void; manageInHead?: boolean; className?: string }) {
  const notice = group.notice!;
  const action = noticeAction(notice);
  const text = noticeText(group);
  return (
    <div className={cn("col-span-full flex flex-wrap items-center gap-x-3 gap-y-2 py-3", className)} data-harness-notice={notice.kind === "unavailable" ? notice.reason : notice.kind}
      role={notice.kind === "loading" ? "status" : undefined}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-card text-ink-secondary">
        {notice.kind === "loading" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <EngineMark id={group.id} />}
      </span>
      <span className="min-w-[min(100%,12rem)] flex-1">
        <span className={PLUGINS.rowName}>{group.name}</span>
        <span className="block text-[12.5px] leading-5 text-ink-secondary">{text}</span>
      </span>
      {action === "setup" && onSetUp && (
        <button type="button" className={pluginActionClass("fill")} data-harness-setup={group.id} onClick={() => onSetUp(group.id)}>
          {t("connectApps.accounts.connect", { provider: group.name })}
        </button>
      )}
      {action === "retry" && onRefresh && (
        <button type="button" className={pluginActionClass("fill")} data-harness-retry={group.id} disabled={refreshing} onClick={onRefresh}>
          <RefreshCw size={12} className={cn(refreshing && "animate-spin")} /> {t("harnessConnectors.refresh")}
        </button>
      )}
      {action === "manage" && !manageInHead && (
        <button type="button" className={pluginActionClass("fill")} data-harness-add={group.id} onClick={() => openManage(group.manageUrl)}>
          {t("connectApps.providers.manage", { provider: group.name })}
        </button>
      )}
    </div>
  );
}

export function EngineMark({ id, size = 16 }: { id: HarnessEngine; size?: number }) {
  if (id === "claude") return <ClaudeMark size={size} />;
  if (id === "grok") return <GrokMark size={size} />;
  return <CodexMark size={size} />;
}

export { openManage as openAccountManage };
