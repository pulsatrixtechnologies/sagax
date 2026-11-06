// The connectors of the person's engine accounts, as plugin rows (#2306,
// 2026-11-06): Discover lists them under "From <provider>" (the provider's
// label: Claude, xAI, ChatGPT) in the very rows of "From Sagax", and
// Installed folds the connected ones into its list, the same row and "..."
// menu as a plugin. Claude's come from GET /api/me/harness-connectors (the
// caller's own claude.ai account: a name and a status); Grok's are the xAI
// account's cloud connectors, managed on grok.com (not verifiable: no
// status); a ChatGPT (Codex) group shows the day the server lists that
// account's connectors. Claude and Grok always have their section
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
 * there are none and how to connect), ChatGPT when the server lists its
 * connectors. */
export function connectorGroups(input: {
  claude?: { available: boolean; reason?: ClaudeUnavailable; connectors: Array<{ name: string; status: HarnessConnectorStatus }>; manageUrl?: string; account?: string } | null;
  /** the person's Claude connectors are still being read */
  claudeLoading?: boolean;
  grok?: { connectors: readonly { id: string; name: string; tag?: string }[]; account?: string } | null;
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
  if (input.grok && input.grok.connectors.length) {
    groups.push({ id: "grok", name: "Grok", source: t("providerKeys.xai"), manageUrl: GROK_CONNECTORS_URL, ...(input.grok.account ? { account: input.grok.account } : {}), connectors: input.grok.connectors.map((connector) => ({ id: connector.id, name: connector.name, ...(connector.tag ? { tag: connector.tag } : {}) })) });
  } else {
    groups.push({ id: "grok", name: "Grok", source: t("providerKeys.xai"), manageUrl: GROK_CONNECTORS_URL, connectors: [], notice: { kind: "no_account" } });
  }
  const codex = input.codex;
  if (codex?.available) {
    const connectors = (codex.connectors ?? []).filter((connector) => connector.name.trim() !== "");
    if (connectors.length) groups.push({ id: "codex", name: "ChatGPT", source: "ChatGPT", manageUrl: codex.manageUrl ?? "https://chatgpt.com/#settings/Connectors", connectors });
  }
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
export function AccountNoticeRow({ group, refreshing, onRefresh, onSetUp }: { group: HarnessConnectorGroup; refreshing?: boolean; onRefresh?: () => void; onSetUp?: (engine: HarnessEngine) => void }) {
  const notice = group.notice!;
  const action = noticeAction(notice);
  const text = noticeText(group);
  return (
    <div className="flex items-center gap-3 py-[13px]" data-harness-notice={notice.kind === "unavailable" ? notice.reason : notice.kind}
      role={notice.kind === "loading" ? "status" : undefined}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-card text-ink-secondary">
        {notice.kind === "loading" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <EngineMark id={group.id} />}
      </span>
      <span className="min-w-0 flex-1">
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
      {action === "manage" && (
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
