import type { ReactNode } from "react";
import { ChevronRight, Loader2 } from "lucide-react";

import { confirmAsync } from "@/components/ConfirmProvider";
import { t } from "@/lib/i18n";
import { readableOr } from "../../../shared/human-id";
import { isWhopServer } from "@/lib/whop-integration";
import { isGrokConnector, type PluginItem } from "@/lib/plugins-model";
import { pluginShareLink } from "@/lib/plugin-link";
import {
  isRemoteMcpListing,
  McpAuthLine,
  McpClientForm,
  McpMessages,
  McpServerEditor,
} from "../McpServersPanel";
import { PluginStatusLabel } from "../plugins/PluginParts";
import { AddAccountButton, SignInButton, type DetailAccount, type DetailTool } from "../plugins/PluginDetailView";
import { grokConnectorDetail } from "./GrokConnectors";
import { pluginSourceLabel, safeHost } from "./helpers";
import type { DetailBase, DetailContext } from "./types";

export function detailProps(item: PluginItem, context: DetailContext): DetailBase {
  if (isGrokConnector(item)) return grokConnectorDetail(item);
  if (item.kind === "plugin") {
    const marketplace = item.id.split("@")[1];
    const source = context.marketplaces?.find((entry) => entry.name === marketplace)?.source;
    return { ...pluginDetail(item, context), link: pluginShareLink({ kind: "plugin", marketplaceSource: source }) };
  }
  const server = context.mcp.servers?.find((candidate) => candidate.name === item.id);
  return { ...mcpDetail(item, context), link: pluginShareLink({ kind: "mcp", serverUrl: server && "url" in server ? server.url : undefined }) };
}

export function mcpDetail(item: PluginItem, { mcp, mcpAccountDraft, setMcpAccountDraft, openGithub }: DetailContext): DetailBase {
  const server = mcp.servers?.find((entry) => entry.name === item.id);
  if (!server) return { item, subtitle: "", busy: true, details: [] };
  const name = server.name;
  const remote = isRemoteMcpListing(server);
  const disabled = new Set(server.disabledTools ?? []);
  const probe = mcp.probe[name];
  // A tool Grok registers under another name, or cannot register, says so
  // on its row: a connector tool is never lost without a word.
  const grokNames = probe?.ok ? probe.engineNames?.grok : undefined;
  const engineNote = (tool: string) => {
    const renamed = grokNames?.renamed.find((entry) => entry.upstream === tool);
    if (renamed) return t("mcp.engineName.renamed", { name: renamed.registered });
    const failed = grokNames?.unregistrable.find((entry) => entry.upstream === tool);
    return failed ? t("mcp.engineName.unregistrable", { reason: failed.reason }) : undefined;
  };
  const toolList = probe?.ok ? (probe.tools ?? []).map((tool) => {
    const note = engineNote(tool.name);
    return { name: tool.name, description: note ? [note, tool.description].filter(Boolean).join(" ") : tool.description, enabled: !disabled.has(tool.name) };
  }) : null;
  const signingIn = mcp.busy === `oauth:${name}` || Boolean(mcp.waiting[name]);
  const issuer = remote ? (server.authIssuer ?? safeHost(server.url)) : "";
  const others = remote ? (server.accounts ?? []).filter((entry) => entry.id !== "default") : [];
  // An account the person names, after the first one (MAX_MCP_ACCOUNTS).
  const canAddAccount = remote && server.auth === "connected" && !server.managedBy && others.length < 9;
  let account: DetailAccount;
  let accountAction: ReactNode = null;
  if (server.github) {
    // the GitHub plugin's server reads the person's GitHub account: its
    // account is that one, connected on the GitHub plugin's page
    account = {
      id: "github", label: t("connectApps.detail.githubAccount"),
      detail: server.github === "connected" ? t("connectApps.detail.githubConnected") : t("connectApps.detail.githubMissing"),
      status: server.github === "connected" ? "connected" : "needs_auth",
    };
    accountAction = <button type="button" className="ui-button text-[12px]" data-mcp-open-github onClick={openGithub}>{t("connectApps.detail.openGithub")}</button>;
  } else if (remote && server.auth === "connected") {
    account = {
      id: "oauth", label: others.length ? t("mcp.accounts.first", { issuer }) : issuer, detail: t("connectApps.detail.signedIn"), status: "connected",
      onRemove: () => void mcp.signOut(server), removeLabel: t("mcp.oauth.disconnectAria", { name }),
    };
    accountAction = canAddAccount && mcpAccountDraft?.server !== name
      ? <AddAccountButton label={t("connectApps.detail.addAccount")} disabled={mcp.busy !== null} onClick={() => setMcpAccountDraft({ server: name, label: "" })} />
      : null;
  } else if (remote && (server.auth === "required" || server.auth === "expired" || server.auth === "error")) {
    account = { id: "oauth", label: issuer, detail: server.authError, status: "needs_auth" };
    accountAction = <SignInButton label={t(server.auth === "expired" ? "mcp.oauth.signInAgain" : "mcp.oauth.signIn")} busy={signingIn} disabled={mcp.busy !== null || Boolean(server.managedBy)} onClick={() => void mcp.signIn(server)} />;
  } else {
    const keys = remote ? server.headerKeys : server.envKeys;
    account = {
      id: "default",
      label: t("connectApps.detail.defaultAccount"),
      detail: keys.length ? t(remote ? "mcp.headersSaved" : "mcp.secretsSaved", { keys: keys.join(", ") }) : t("connectApps.detail.noSignIn"),
      status: server.enabled ? "connected" : "off",
    };
  }
  const oauthError = mcp.oauthError[name];
  const count = toolList ? t("connectApps.detail.toolsEnabled", { enabled: toolList.filter((tool) => tool.enabled).length, total: toolList.length })
    : disabled.size ? t("connectApps.detail.toolsOff", { count: disabled.size }) : t("connectApps.detail.toolsAll");
  return {
    item,
    subtitle: remote ? server.url : [server.command, ...server.args].join(" "),
    busy: mcp.busy !== null,
    onUninstall: () => void mcp.remove(server),
    onEdit: () => mcp.startEdit(server),
    onTest: () => void mcp.test(server),
    testing: mcp.busy === `test:${name}`,
    enabled: { value: server.enabled, onToggle: () => void mcp.toggle(server), label: t("mcp.toggleAria", { name, state: t(server.enabled ? "mcp.state.off" : "mcp.state.on") }) },
    accounts: [account, ...others.map((other, index): DetailAccount => {
      const label = readableOr(other.label ?? other.id, t("ids.accountN", { n: index + 2 }));
      return {
        id: other.id,
        label,
        detail: other.auth === "connected" ? t("connectApps.detail.signedIn") : other.authError ?? t("mcp.accounts.notSignedIn"),
        status: other.auth === "connected" ? "connected" : other.authPending ? "pending" : "needs_auth",
        action: other.auth === "connected" ? undefined : (
          <button type="button" disabled={mcp.busy !== null} onClick={() => void mcp.signIn(server, { id: other.id })} className="ui-button text-[12px] disabled:opacity-40">
            {t("mcp.oauth.signInAgain")}
          </button>
        ),
        onRemove: () => {
          void (async () => {
            if (!(await confirmAsync({
              title: t("mcp.accounts.removeConfirm", { account: label, name }),
              confirmLabel: t("common.confirmRemove"),
              tone: "danger",
            }))) return;
            void mcp.signOut(server, other.id);
          })();
        },
        removeLabel: t("mcp.accounts.removeAria", { account: label, name }),
      };
    })],
    accountAction,
    accountExtra: (
      <>
        {mcpAccountDraft?.server === name && (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const label = mcpAccountDraft.label.trim();
              if (!label) return;
              void mcp.signIn(server, { label }).then(() => setMcpAccountDraft(null));
            }}
          >
            <input
              autoFocus
              value={mcpAccountDraft.label}
              maxLength={60}
              onChange={(event) => setMcpAccountDraft({ server: name, label: event.target.value })}
              onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setMcpAccountDraft(null); } }}
              placeholder={t("mcp.accounts.labelPlaceholder")}
              aria-label={t("mcp.accounts.labelAria", { name })}
              className="min-w-0 flex-1 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none"
            />
            <button type="submit" disabled={mcp.busy !== null || !mcpAccountDraft.label.trim()} className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-accent-ink disabled:opacity-40">
              {t("mcp.oauth.signIn")}
            </button>
            <button type="button" onClick={() => setMcpAccountDraft(null)} className="ui-button text-[12px]">{t("common.cancel")}</button>
          </form>
        )}
        {remote && server.auth && server.auth !== "none" && server.auth !== "connected" && <McpAuthLine server={server} />}
        {mcp.waiting[name] && (
          <div role="status" className="mt-2 flex items-center gap-2 rounded-lg bg-raised/60 px-3 py-2 text-[12px] text-ink-secondary">
            <Loader2 size={13} className="shrink-0 animate-spin" /> {t("mcp.oauth.waiting")}
          </div>
        )}
        {mcp.clientDraft[name] && (
          <McpClientForm
            draft={mcp.clientDraft[name]!}
            disabled={mcp.busy !== null}
            onChange={(next) => mcp.setClientDraft((current) => ({ ...current, [name]: next }))}
            onCancel={() => mcp.forgetClientDraft(name)}
            onSubmit={() => void mcp.signIn(server)}
          />
        )}
        {oauthError && (
          <div role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {typeof oauthError === "string" ? oauthError : t(oauthError.key, oauthError.params)}
          </div>
        )}
        {server.managedBy && <p className="mt-2 text-[11.5px] text-ink-secondary">{t("policy.mcpBlocked", { organization: server.managedBy })}</p>}
      </>
    ),
    tools: {
      list: toolList,
      loading: mcp.busy === `test:${name}`,
      error: probe && !probe.ok ? probe.error : undefined,
      note: t("connectApps.detail.toolsNote"),
      onToggle: (tool, enabled) => {
        const next = new Set(disabled);
        if (enabled) next.delete(tool);
        else next.add(tool);
        void mcp.setDisabledTools(server, [...next].sort());
      },
      onLoad: () => void mcp.test(server),
    },
    details: [
      { label: t("connectApps.detail.source"), value: pluginSourceLabel(item.source) },
      { label: t("connectApps.detail.transport"), value: remote ? (server.type === "sse" ? "SSE" : "HTTP") : "stdio" },
      { label: remote ? t("connectApps.detail.url") : t("connectApps.detail.command"), value: remote ? server.url : [server.command, ...server.args].join(" "), mono: true },
      { label: t("connectApps.detail.tools"), value: count },
    ],
    children: (
      <>
        {remote && isWhopServer(server) && <p className="rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] px-4 py-3 text-[12px] leading-relaxed text-ink-secondary sm:px-5">{t("whop.notice")}</p>}
        <McpMessages mcp={mcp} />
        {mcp.editing === name && <McpServerEditor mcp={mcp} />}
      </>
    ),
  };
}

/** A marketplace plugin: what it brought, each one a link to its own page. */
export function pluginDetail(item: PluginItem, { items, marketplaces, installing, openItem, uninstallPlugin, updatePlugin, scope, botCard, openGithub, githubKey, githubSection }: DetailContext): DetailBase {
  const [plugin, marketplace] = item.id.split("@") as [string, string];
  const market = marketplaces?.find((entry) => entry.name === marketplace);
  const entry = market?.plugins.find((candidate) => candidate.name === plugin);
  const children = items.filter((candidate) => candidate.parent === item.key);
  // the GitHub plugin's page holds the GitHub connection, first (2026-10-29)
  const github = item.key === githubKey && githubSection ? githubSection : null;
  const installedVersion = item.installedVersion ?? item.version;
  const subtitle = `${market?.source ?? marketplace}${installedVersion ? ` · ${installedVersion}` : ""}`;
  const versionDetails = [
    ...(installedVersion ? [{ label: t("connectApps.detail.version"), value: installedVersion }] : []),
    ...(item.updateAvailable ? [{
      label: t("connectApps.plugin.available"),
      value: item.installedVersion && item.version ? item.version : t("connectApps.plugin.newerFiles"),
    }] : []),
  ];
  // The technical id and the repository: secondary, in Details (the header
  // shows the name people read).
  const sourceDetails = [
    { label: t("connectApps.detail.id"), value: item.id, mono: true },
    ...(market?.source && market.source !== marketplace ? [{ label: t("connectApps.detail.repository"), value: market.source, mono: true }] : []),
  ];
  // Grok Bot's plugin page: Accounts, then Tools, first (2026-11-06, #2146).
  // Accounts: the connectors it brought, each with its sign-in state (the
  // GitHub plugin holds the GitHub connection there). Tools: everything it
  // brought, each row opening its own page. The rest (the bot's install,
  // what it adds, the notes) stays lower, behind a disclosure.
  const connectors = children.filter((child) => child.kind !== "skill");
  const accounts: DetailAccount[] = connectors.map((child) => ({
    id: child.key,
    label: child.name,
    status: child.status === "available" ? "off" : child.status,
    detail: t("connectApps.filter.mcp"),
    action: (
      <button type="button" onClick={() => openItem(child)} aria-label={child.name} title={child.name} className="rounded-md p-1.5 text-ink-secondary hover:bg-hover hover:text-ink">
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    ),
  }));
  const githubAccount = !github && children.some((child) => child.githubAccount) ? (
    <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-inset px-3 py-2" data-plugin-github-account={children.some((child) => child.githubAccount === "missing") ? "missing" : "connected"}>
      <span className="min-w-0 flex-1 text-[12px] text-ink-secondary">
        {children.some((child) => child.githubAccount === "missing") ? t("connectApps.detail.githubMissing") : t("connectApps.detail.githubConnected")}
      </span>
      <button type="button" className="ui-button text-[12px]" onClick={openGithub}>{t("connectApps.detail.openGithub")}</button>
    </div>
  ) : null;
  const toolRows: DetailTool[] = children.map((child) => ({
    name: child.name,
    description: child.description,
    detail: child.kind === "skill" ? t("connectApps.filter.skills") : t("connectApps.filter.mcp"),
    enabled: child.status === "connected",
    status: child.status,
    onOpen: () => openItem(child),
  }));
  const shared = {
    item,
    subtitle,
    busy: installing !== null,
    accounts,
    accountsEmpty: github || githubAccount ? undefined : t("connectApps.detail.noAccounts"),
    accountExtra: <>{github}{githubAccount}</>,
    tools: { list: toolRows, loading: false, note: children.length === 0 ? t("connectApps.plugin.bringsNothing") : undefined },
  };
  // For a bot the page is that bot's install: the card says what it brings,
  // and its Update installs the marketplace's files again in place.
  if (scope !== "workspace") {
    return {
      ...shared,
      details: [
        { label: t("connectApps.detail.source"), value: marketplace },
        ...sourceDetails,
        ...versionDetails,
      ],
      more: (
        <>
          {item.description && <p className="px-1 text-[12.5px] leading-relaxed text-ink-secondary">{item.description}</p>}
          {botCard}
        </>
      ),
    };
  }
  return {
    ...shared,
    onUninstall: () => uninstallPlugin(item),
    ...(item.installed && item.updateAvailable ? { onUpdate: () => updatePlugin(item), updating: installing === item.id } : {}),
    details: [
      { label: t("connectApps.detail.source"), value: marketplace },
      ...sourceDetails,
      ...versionDetails,
      { label: t("connectApps.plugin.connectors"), value: String(entry?.servers.length ?? 0) },
      { label: t("connectApps.filter.skills"), value: String(entry?.skills.length ?? 0) },
    ],
    more: (
      <>
        {botCard}
        <section>
          <h3 className="mb-1 text-[13px] font-semibold text-ink">{t("connectApps.plugin.brings")}</h3>
          {item.description && <p className="mb-2 text-[12.5px] leading-relaxed text-ink-secondary">{item.description}</p>}
          {children.length === 0 ? (
            <p className="text-[12px] text-ink-secondary">{t("connectApps.plugin.bringsNothing")}</p>
          ) : (
            <ul className="divide-y divide-hairline/60">
              {children.map((child) => (
                <li key={child.key}>
                  <button type="button" onClick={() => openItem(child)} className="flex w-full items-center gap-3 py-2 text-left hover:text-ink">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{child.name}</span>
                      <span className="block truncate text-[11px] text-ink-secondary">{child.kind === "skill" ? t("connectApps.filter.skills") : t("connectApps.filter.mcp")}</span>
                    </span>
                    <PluginStatusLabel status={child.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11.5px] text-ink-secondary">{t("connectApps.plugin.note")}</p>
        </section>
      </>
    ),
  };
}
