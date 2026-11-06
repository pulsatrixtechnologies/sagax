// Connect apps > Providers: the connectors of the person's engine accounts,
// grouped by engine, one row each with the app's real logo (providerMark,
// the sidebar foot's resolution since #1143), its name and its state.
// Claude's come from GET /api/me/harness-connectors (the caller's own
// claude.ai account: a name and a status); Grok's are the xAI account's
// cloud connectors, managed on grok.com; a ChatGPT (Codex) group shows the
// day the server lists that account's connectors. They read the same way.
// Claude and Grok always have their section (2026-10-28, the owner: "why do
// I only see Grok"): a section the server cannot fill says why (reading,
// not signed in, an API key, no Claude engine, the CLI did not answer, no
// connector yet) and offers the way to connect, never vanishes. A ChatGPT
// section shows only when the server lists its connectors. Each card names the service it
// reaches (CapabilityTags) and sits under its engine: the summary panel
// "What your engines reach" is gone (owner, 2026-10-27).
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { providerMark } from "@/lib/plugins-model";
import { GROK_CONNECTORS_URL } from "../../../shared/grok-cloud-connectors";
import { CATEGORY_MODAL } from "../category-modal";
import { ClaudeMark, GrokMark, CodexMark } from "../ProviderIcons";
import { PluginIcon } from "./PluginParts";
import { CapabilityTags } from "./EngineCapabilities";
import { claudeAiConnectorCapabilities, grokConnectorCapabilities } from "../../../shared/engine-connectors";

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
  name: string;
  manageUrl: string;
  /** the engine account's line: an email or "Signed in" (absent: none) */
  account?: string;
  /** `id`: a Grok connector's id (its capabilities) */
  connectors: Array<{ name: string; id?: string; status?: HarnessConnectorStatus }>;
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
  grok?: { connectors: readonly { id: string; name: string }[]; account?: string } | null;
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
  groups.push({ id: "claude", name: "Claude", manageUrl: claudeUrl, ...(claude?.account ? { account: claude.account } : {}), connectors: claudeConnectors, ...(claudeNotice ? { notice: claudeNotice } : {}) });
  if (input.grok && input.grok.connectors.length) {
    groups.push({ id: "grok", name: "Grok", manageUrl: GROK_CONNECTORS_URL, ...(input.grok.account ? { account: input.grok.account } : {}), connectors: input.grok.connectors.map((connector) => ({ id: connector.id, name: connector.name })) });
  } else {
    groups.push({ id: "grok", name: "Grok", manageUrl: GROK_CONNECTORS_URL, connectors: [], notice: { kind: "no_account" } });
  }
  const codex = input.codex;
  if (codex?.available) {
    const connectors = (codex.connectors ?? []).filter((connector) => connector.name.trim() !== "");
    if (connectors.length) groups.push({ id: "codex", name: "ChatGPT", manageUrl: codex.manageUrl ?? "https://chatgpt.com/#settings/Connectors", connectors });
  }
  return groups;
}

export function HarnessConnectorGroups({ groups, refreshing, onRefresh, onSetUp }: {
  groups: HarnessConnectorGroup[];
  refreshing?: boolean;
  /** the retry of a failed load (GroupNotice); the tab row holds the refresh */
  onRefresh?: () => void;
  /** set an engine up (Settings > Models and voice); absent: not offered */
  onSetUp?: (engine: HarnessEngine) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <>
      {groups.map((group) => (
        <section key={group.id} className="mt-6 first:mt-0" data-harness-group={group.id}>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center"><EngineMark id={group.id} /></span>
            <h3 className="min-w-0 truncate text-[13px] font-semibold text-ink">{t("connectApps.accounts.harness", { provider: group.name })}</h3>
            {group.account && <span className="min-w-0 truncate text-[11.5px] text-ink-secondary">{group.account}</span>}
            <span className="flex-1" />
            {/* the one way out per engine (#2104): the tab row's refresh
                reloads these too, and a connector to finish is finished on
                the same manage page, so no row button */}
            <button
              type="button"
              data-harness-manage={group.id}
              onClick={() => void openExternalLink(group.manageUrl).catch(() => undefined)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-control px-2.5 py-1 text-[11.5px] font-medium text-ink hover:bg-raised-hover"
            >
              <ExternalLink size={12} /> {t("connectApps.providers.manage", { provider: group.name })}
            </button>
          </div>
          {group.id === "grok" && !group.notice && <p className="mb-2 text-[11.5px] leading-relaxed text-ink-tertiary" data-harness-grok-note>{t("connectApps.capabilities.grokOrg")}</p>}
          {group.notice && <GroupNotice group={group} refreshing={refreshing} onRefresh={onRefresh} onSetUp={onSetUp} />}
          {group.connectors.length > 0 && <div className={CATEGORY_MODAL.grid}>
            {group.connectors.map((connector) => {
              const mark = providerMark(connector.name);
              const missing = connector.status === "needs_auth" || connector.status === "failed";
              return (
                <div key={connector.name} data-harness-connector={`${group.id}:${connector.name}`} className="flex items-center gap-3 rounded-2xl p-2.5 hover:bg-ink/5">
                  <PluginIcon item={{ kind: "app", name: connector.name, logo: mark.logo, domain: mark.site }} className="size-11" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium leading-[18px] text-ink">{connector.name}</span>
                      <CapabilityTags capabilities={group.id === "grok" ? grokConnectorCapabilities(connector.id ?? "") : claudeAiConnectorCapabilities(connector.name)} name={connector.name} />
                    </span>
                    <span
                      className={cn("block truncate text-[12px] leading-[18px]", connector.status === "connected" ? "text-success" : missing ? "text-warning" : "text-ink-secondary")}
                      data-harness-status={connector.status ?? "managed"}
                    >
                      {connector.status ? t(STATUS_KEY[connector.status] ?? STATUS_KEY.unknown) : t("connectApps.grok.description")}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>}
        </section>
      ))}
    </>
  );
}

/** The section's line when it has no connector to list, with its way out. */
function GroupNotice({ group, refreshing, onRefresh, onSetUp }: { group: HarnessConnectorGroup; refreshing?: boolean; onRefresh?: () => void; onSetUp?: (engine: HarnessEngine) => void }) {
  const notice = group.notice!;
  const action = noticeAction(notice);
  const button = "inline-flex shrink-0 items-center gap-1 rounded-full bg-control px-3 py-1 text-[12px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50";
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-inset px-4 py-3 text-[12.5px] leading-[18px] text-ink-secondary"
      data-harness-notice={notice.kind === "unavailable" ? notice.reason : notice.kind}
      role={notice.kind === "loading" ? "status" : undefined}
    >
      <span className="flex min-w-0 items-center gap-2">
        {notice.kind === "loading" && <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" />}
        <span>{noticeText(group)}</span>
      </span>
      {action === "setup" && onSetUp && (
        <button type="button" className={button} data-harness-setup={group.id} onClick={() => onSetUp(group.id)}>
          {t("connectApps.accounts.connect", { provider: group.name })}
        </button>
      )}
      {action === "retry" && onRefresh && (
        <button type="button" className={button} data-harness-retry={group.id} disabled={refreshing} onClick={onRefresh}>
          <RefreshCw size={12} className={cn(refreshing && "animate-spin")} /> {t("harnessConnectors.refresh")}
        </button>
      )}
    </div>
  );
}

function EngineMark({ id }: { id: HarnessEngine }) {
  if (id === "claude") return <ClaudeMark size={16} />;
  if (id === "grok") return <GrokMark size={16} />;
  return <CodexMark size={16} />;
}
