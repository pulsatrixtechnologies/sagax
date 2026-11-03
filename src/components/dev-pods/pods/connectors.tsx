// Connectors: what the bot really reached on this conversation's last turn
// (task.connectors, recorded by the server when it built that turn:
// server/turns/turn-connectors.ts), grouped by where each comes from: the person's
// own Claude and Grok accounts, Perspicax, their own MCP servers, this
// server's MCP servers and the bot's plugins. Each row says Connected or
// To reconnect. Before the first recorded turn, the servers this bot is set
// to mount stand in, and the card says so.
import { useCallback, useState } from "react";
import { Plug } from "lucide-react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { dedupeConnectors, mcpServersForBot, useMcpServers } from "@/lib/mcp-servers";
import { normalizeTurnConnectors, type TurnConnector, type TurnConnectorSource } from "../../../../shared/turn-connectors";
import { Github, Slack } from "../../brand-icons";
import { ClaudeMark, GrokMark } from "../../ProviderIcons";
import { registerDevPod, type DevPodContext } from "../registry";

export const CONNECTORS_SHOWN = 6;

export interface ConnectorsData {
  connectors: TurnConnector[];
  /** The person's Claude account rode the turn; its list was not read yet. */
  claudeAccount: boolean;
  /** From the bot's settings, not from a turn (no turn recorded yet). */
  configured: boolean;
}

const SOURCE_LABEL: Record<TurnConnectorSource, LocaleKey> = {
  claude: "devPods.connectors.source.claude",
  grok: "devPods.connectors.source.grok",
  perspicax: "devPods.connectors.source.perspicax",
  personal: "devPods.connectors.source.personal",
  server: "devPods.connectors.source.server",
  plugin: "devPods.connectors.source.plugin",
};
const SOURCES: readonly TurnConnectorSource[] = ["claude", "grok", "perspicax", "personal", "server", "plugin"];

/** The card's rows: the turn's record when there is one, else the servers
 * the bot is set to mount (named as such). Null: nothing to show. */
export function connectorsData(ctx: Pick<DevPodContext, "task" | "bot">, servers: ReturnType<typeof useMcpServers>["servers"]): ConnectorsData | null {
  const record = normalizeTurnConnectors(ctx.task?.connectors);
  if (record) {
    if (!record.connectors.length && !record.claudeAccount) return null;
    return { connectors: record.connectors, claudeAccount: record.claudeAccount === true, configured: false };
  }
  if (!servers) return null;
  const mounted = dedupeConnectors(mcpServersForBot(servers, ctx.bot.mcpServers));
  if (!mounted.length) return null;
  return {
    connectors: mounted.map((server) => ({
      name: server.name,
      source: "server",
      state: server.auth && server.auth !== "connected" && server.auth !== "none" ? "reconnect" : "connected",
    })),
    claudeAccount: false,
    configured: true,
  };
}

/** Every connector the card counts, the account line included. */
export function connectorsCount(data: ConnectorsData): number {
  return data.connectors.length + (data.claudeAccount ? 1 : 0);
}

function ConnectorIcon({ connector }: { connector: TurnConnector }) {
  if (connector.source === "claude") return <ClaudeMark size={14} className="shrink-0" />;
  if (connector.source === "grok") return <GrokMark size={14} className="shrink-0 text-ink" />;
  const lower = connector.name.toLowerCase();
  if (lower.includes("github")) return <Github size={14} aria-hidden="true" className="shrink-0 text-ink" />;
  if (lower.includes("slack")) return <Slack size={14} aria-hidden="true" className="shrink-0 text-ink" />;
  return (
    <span aria-hidden="true" className="flex size-[16px] shrink-0 items-center justify-center rounded-[5px] bg-hover text-[10px] font-semibold uppercase text-ink-secondary">
      {connector.name.trim().charAt(0) || "?"}
    </span>
  );
}

function connectorName(connector: TurnConnector): string {
  return connector.source === "grok" ? t("devPods.connectors.grokAccount") : connector.name;
}

function ConnectorsSummary({ data }: { data: ConnectorsData }) {
  const reconnect = data.connectors.filter((connector) => connector.state === "reconnect").length;
  return (
    <span data-connectors-count="" className="shrink-0 text-[12px] tabular-nums text-ink-secondary">
      {reconnect ? <span className="text-warning">{t("devPods.connectors.reconnectCount", { count: String(reconnect) })}</span> : connectorsCount(data)}
    </span>
  );
}

function ConnectorsBody({ data, ctx }: { data: ConnectorsData; ctx: DevPodContext }) {
  const [all, setAll] = useState(false);
  const manage = useCallback(() => ctx.dispatch({ type: "togglePlugins", open: true, botId: ctx.bot.id }), [ctx]);
  const rows: Array<TurnConnector & { account?: true }> = [
    ...(data.claudeAccount ? [{ name: t("devPods.connectors.claudeAccount"), source: "claude" as const, state: "connected" as const, account: true as const }] : []),
    ...data.connectors,
  ];
  // the ones to reconnect first, so a long list never hides them
  const ordered = [...rows].sort((a, b) => Number(b.state === "reconnect") - Number(a.state === "reconnect"));
  const shown = new Set((all ? ordered : ordered.slice(0, CONNECTORS_SHOWN)).map((row) => `${row.source}:${row.name}`));
  return (
    <div className="flex flex-col gap-2">
      {data.configured && <p data-connectors-configured="1" className="text-[12px] text-ink-secondary">{t("devPods.connectors.configured")}</p>}
      {SOURCES.map((source) => {
        const group = rows.filter((row) => row.source === source && shown.has(`${row.source}:${row.name}`));
        if (!group.length) return null;
        return (
          <section key={source} data-connector-source={source} className="flex flex-col">
            <h4 className="pb-0.5 text-[11px] font-medium uppercase tracking-[0.04em] text-ink-tertiary">{t(SOURCE_LABEL[source])}</h4>
            <ul className="flex flex-col">
              {group.map((connector) => (
                <li key={`${connector.source}:${connector.name}`} data-connector={connector.name} data-connector-state={connector.state} className="flex min-h-[28px] items-center gap-2">
                  <ConnectorIcon connector={connector} />
                  <span className="min-w-0 flex-1 break-words text-ink [overflow-wrap:anywhere]">{connectorName(connector)}</span>
                  {connector.state === "reconnect" ? (
                    <button type="button" data-connector-reconnect="" onClick={manage} className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-warning hover:bg-hover">
                      {t("devPods.connectors.reconnect")}
                    </button>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-secondary">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
                      {t("devPods.connectors.connected")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <div className="-mx-1 flex flex-col items-start">
        {rows.length > CONNECTORS_SHOWN && (
          <button type="button" data-connectors-more="" onClick={() => setAll((value) => !value)} className="rounded-md px-1 py-0.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink">
            {all ? t("devPods.connectors.less") : t("devPods.connectors.moreCount", { count: String(rows.length - CONNECTORS_SHOWN) })}
          </button>
        )}
        <button type="button" data-connectors-manage="" onClick={manage} className="rounded-md px-1 py-0.5 text-left text-[12px] font-medium text-accent-text hover:bg-hover">
          {t("devPods.connectors.manage")}
        </button>
      </div>
    </div>
  );
}

registerDevPod<ConnectorsData>({
  id: "connectors",
  order: 30,
  title: () => t("devPods.connectors.title"),
  icon: Plug,
  collapsible: true,
  useData: (ctx) => {
    const { servers, error, refresh } = useMcpServers();
    const data = connectorsData(ctx, servers);
    if (data) return { status: "ready", data };
    if (!ctx.task?.connectors && servers === null) return error ? { status: "error", retry: () => void refresh() } : { status: "loading" };
    return { status: "empty" };
  },
  Summary: ConnectorsSummary,
  Body: ConnectorsBody,
});
