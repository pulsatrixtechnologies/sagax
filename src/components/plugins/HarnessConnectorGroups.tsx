// The connectors of the person's engine accounts, as plugin rows (#2306,
// 2026-11-06): Discover lists them under "From <provider>" (the provider's
// label: Claude, xAI, ChatGPT) in the very rows of "From Sagax", and
// Installed folds the connected ones into its list, the same row and "..."
// menu as a plugin. They come from GET /api/me/harness-connectors, which
// reads the person's connector registry (#3358), through its one providers
// list (#4408, shared/account-connectors.ts, the list Providers > Advanced
// reads too): Claude's (the caller's own claude.ai account), Grok's (each of
// the person's own Grok sign-ins, with the real state of each connector) and
// the ChatGPT apps of their Codex sign-in. A server that lists no Grok sign-in (older, solo)
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
import { GROK_CLOUD_CONNECTORS, GROK_CONNECTORS_URL } from "../../../shared/grok-cloud-connectors";
import { CLAUDE_AI_CONNECTORS_URL } from "../../../shared/connector-setup";
import { ClaudeMark, GrokMark, CodexMark } from "../ProviderIcons";
import { PluginIcon } from "./PluginParts";
import { CapabilityTags } from "./EngineCapabilities";
import { CARD_FRAME, CARD_ICON, PLUGINS, pluginActionClass } from "./plugins-style";
import type { ConnectorCapability } from "../../../shared/engine-connectors";
import {
  accountConnectorCapabilities, accountConnectorProviders,
  type AccountConnectorProvider, type AccountConnectorProviderId, type AccountConnectorsUnavailable,
} from "../../../shared/account-connectors";

export type HarnessConnectorStatus = "connected" | "needs_auth" | "failed" | "unknown";

export type HarnessEngine = "claude" | "grok" | "codex";

/** Why the server lists no connector of an account
 * (shared/account-connectors.ts). */
export type ClaudeUnavailable = AccountConnectorsUnavailable;

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

/** Each registry provider's group id and name in Connect Apps. */
const GROUP_OF: Readonly<Record<AccountConnectorProviderId, { id: HarnessEngine; name: string; source: () => string }>> = {
  "claude-ai": { id: "claude", name: "Claude", source: () => "Claude" },
  "chatgpt-apps": { id: "codex", name: "ChatGPT", source: () => "ChatGPT" },
  "grok-com": { id: "grok", name: "Grok", source: () => t("providerKeys.xai") },
};

/** One provider's entry (#4408, the answer's one providers list) as its
 * group: its connectors, that it has none yet, or why there are none. */
function providerGroup(entry: AccountConnectorProvider): HarnessConnectorGroup {
  const head = GROUP_OF[entry.provider];
  const connectors = entry.available ? entry.connectors.filter((connector) => connector.name.trim() !== "")
    .map((connector) => ({ ...(connector.id ? { id: connector.id } : {}), name: connector.name, status: connector.status })) : [];
  const notice: HarnessGroupNotice | undefined = connectors.length ? undefined
    : entry.available ? { kind: "empty" } : { kind: "unavailable", reason: entry.reason ?? "unknown" };
  return { id: head.id, name: head.name, source: head.source(), manageUrl: entry.manageUrl, connectors, ...(notice ? { notice } : {}) };
}

/** The sections to show, from the answer's one providers list (#4408;
 * `accountConnectorProviders` builds it from an older server's fields):
 * Claude and Grok always (their connectors, or why there are none and how to
 * connect), ChatGPT when the person has a ChatGPT sign-in. A server that
 * lists no Grok sign-in (older, solo) leaves Grok on the xAI catalog when a
 * Grok engine is set up (`grokConfigured`). */
export function connectorGroups(answer: Parameters<typeof accountConnectorProviders>[0], options: { loading?: boolean; grokConfigured?: boolean } = {}): HarnessConnectorGroup[] {
  const providers = accountConnectorProviders(answer);
  const entryOf = (provider: AccountConnectorProviderId) => providers.find((entry) => entry.provider === provider);
  const groups: HarnessConnectorGroup[] = [];
  const claude = entryOf("claude-ai");
  groups.push(claude ? providerGroup(claude) : {
    id: "claude", name: "Claude", source: "Claude", manageUrl: CLAUDE_AI_CONNECTORS_URL, connectors: [],
    notice: options.loading && !answer ? { kind: "loading" } : { kind: "unavailable", reason: "unknown" },
  });
  const grok = entryOf("grok-com");
  const grokBase = { id: "grok" as const, name: "Grok", source: t("providerKeys.xai"), manageUrl: GROK_CONNECTORS_URL };
  if (grok) groups.push(providerGroup(grok));
  else if (options.grokConfigured) groups.push({ ...grokBase, connectors: GROK_CLOUD_CONNECTORS.map((connector) => ({ id: connector.id, name: connector.name, ...(connector.tag ? { tag: connector.tag } : {}) })) });
  else groups.push({ ...grokBase, connectors: [], notice: { kind: "no_account" } });
  // a ChatGPT sign-in the registry lists: its apps, or that it has none yet
  const codex = entryOf("chatgpt-apps");
  if (codex?.available) groups.push(providerGroup(codex));
  return groups;
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
    const capabilities = accountConnectorCapabilities(group.id === "grok" ? "grok-com" : "claude-ai", connector);
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
      <PluginIcon item={{ kind: "app", name: row.name, logo: mark.logo, domain: mark.site }} className={CARD_ICON} />
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
    <div className={cn("col-span-full flex flex-wrap items-center gap-x-3 gap-y-2 p-3", CARD_FRAME, className)} data-harness-notice={notice.kind === "unavailable" ? notice.reason : notice.kind}
      role={notice.kind === "loading" ? "status" : undefined}>
      <span className={cn("flex shrink-0 items-center justify-center bg-card text-ink-secondary", CARD_ICON)}>
        {notice.kind === "loading" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <EngineMark id={group.id} />}
      </span>
      <span className="min-w-[min(100%,12rem)] flex-1">
        <span className={PLUGINS.rowName}>{group.name}</span>
        <span className="block text-[13px] leading-5 text-ink-secondary">{text}</span>
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
