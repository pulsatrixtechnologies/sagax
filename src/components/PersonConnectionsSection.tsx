// Connexions on a person's panel (an organization admin only): the MCP
// servers, GitHub account and plugins saved for that person, and a remove
// that asks first. The server never sends a token (server/org/org-person-connections.ts).
import { useCallback, useEffect, useRef, useState } from "react";

import { t, activeLocale } from "@/lib/i18n";
import { api } from "@/state/store";
import { ConfirmDialog } from "./ConfirmDialog";

export type OrgConnection =
  | { kind: "github"; state: "connected" | "pending" | "error"; login?: string; name?: string; via?: "device" | "token"; scopes?: string[]; createdAt?: number }
  | { kind: "mcp"; name: string; mcpKind: "remote" | "stdio"; detail: string; createdAt: number; enabled: boolean; auth?: string; lastUsedAt?: number }
  | { kind: "plugin"; botId: string; botName: string; key: string; name: string; marketplace: string; createdAt: number; enabled: boolean };

export interface OrgPersonConnections {
  principalId: string;
  connections: OrgConnection[];
}

export type RevokeTarget =
  | { all: true; label: string }
  | { kind: "mcp"; name: string; label: string }
  | { kind: "github"; label: string }
  | { kind: "plugin"; botId: string; key: string; label: string };

export function revokeBody(target: RevokeTarget): { all: true } | { kind: "mcp"; name: string } | { kind: "github" } | { kind: "plugin"; botId: string; key: string } {
  if ("all" in target) return { all: true };
  if (target.kind === "mcp") return { kind: "mcp", name: target.name };
  if (target.kind === "github") return { kind: "github" };
  return { kind: "plugin", botId: target.botId, key: target.key };
}

export function connectionConfirmCopy(target: RevokeTarget): { title: string; body: string; confirmLabel: string } {
  const all = "all" in target && target.all;
  return {
    title: all ? t("personPanel.connections.confirm.allTitle") : t("personPanel.connections.confirm.title"),
    body: all ? t("personPanel.connections.confirm.allBody") : t("personPanel.connections.confirm.body", { name: target.label }),
    confirmLabel: t("personPanel.connections.confirm.action"),
  };
}

function connectionId(connection: OrgConnection): string {
  if (connection.kind === "github") return "github";
  if (connection.kind === "mcp") return connection.name;
  return `${connection.botId}:${connection.key}`;
}

function connectionLabel(connection: OrgConnection): string {
  if (connection.kind === "github") return connection.login || connection.name || t("personPanel.connections.kind.github");
  if (connection.kind === "plugin") return `${connection.name} (${connection.botName})`;
  return connection.name;
}

function connectionKind(connection: OrgConnection): string {
  if (connection.kind === "github") return t("personPanel.connections.kind.github");
  if (connection.kind === "plugin") return t("personPanel.connections.kind.plugin");
  return t("personPanel.connections.kind.mcp");
}

function formatWhen(ms: number): string {
  try {
    return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(ms);
  } catch {
    return new Date(ms).toISOString();
  }
}

function targetFor(connection: OrgConnection): RevokeTarget {
  const label = connectionLabel(connection);
  if (connection.kind === "github") return { kind: "github", label };
  if (connection.kind === "mcp") return { kind: "mcp", name: connection.name, label };
  return { kind: "plugin", botId: connection.botId, key: connection.key, label };
}

export function loadPersonConnections(principalId: string): Promise<OrgPersonConnections> {
  return api<OrgPersonConnections>(`/api/org/people/${encodeURIComponent(principalId)}/connections`);
}

export function revokePersonConnections(principalId: string, target: RevokeTarget): Promise<{ removed: unknown[] }> {
  return api(`/api/org/people/${encodeURIComponent(principalId)}/connections/revoke`, { method: "POST", body: JSON.stringify(revokeBody(target)) });
}

export function PersonConnectionsSection({ principalId, initial }: { principalId: string; initial?: OrgPersonConnections }) {
  const preloaded = useRef(initial !== undefined);
  const [data, setData] = useState<OrgPersonConnections | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initial === undefined);
  const [pending, setPending] = useState<RevokeTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await loadPersonConnections(principalId));
      setError(null);
    } catch {
      setError(t("personPanel.connections.error"));
    } finally {
      setLoading(false);
    }
  }, [principalId]);

  useEffect(() => {
    if (preloaded.current) { preloaded.current = false; return; }
    void refresh();
  }, [refresh]);

  const confirm = pending ? connectionConfirmCopy(pending) : null;
  const connections = data?.connections ?? [];

  return (
    <section className="flex flex-col gap-2" data-person-section="connections">
      <h3 className="text-[13px] text-ink-secondary">{t("personPanel.connections.title")}</h3>
      {loading && <p className="text-[12.5px] text-ink-secondary">{t("personPanel.connections.loading")}</p>}
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      {!loading && !error && connections.length === 0 && <p className="text-[12.5px] text-ink-secondary">{t("personPanel.connections.empty")}</p>}
      {connections.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-hairline-weak">
          {connections.map((connection) => {
            const id = connectionId(connection);
            const created = connection.createdAt;
            return (
              <li key={id} data-connection={id} className="flex items-center gap-2 border-b border-hairline-weak px-3 py-2 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{connectionLabel(connection)}</div>
                  <div className="truncate text-[12px] text-ink-secondary">
                    {connectionKind(connection)}
                    {connection.kind === "mcp" && connection.detail ? ` · ${connection.detail}` : ""}
                    {connection.kind === "plugin" ? ` · ${connection.marketplace}` : ""}
                    {connection.kind === "github" && connection.state === "pending" ? ` · ${t("personPanel.connections.pending")}` : ""}
                    {connection.kind === "github" && connection.state === "error" ? ` · ${t("myConnections.github.reconnect")}` : ""}
                  </div>
                  {created !== undefined && <div className="truncate text-[12px] text-ink-secondary">{t("personPanel.connections.created", { date: formatWhen(created) })}</div>}
                  {connection.kind === "mcp" && connection.lastUsedAt !== undefined && (
                    <div className="truncate text-[12px] text-ink-secondary">{t("personPanel.connections.lastUsed", { date: formatWhen(connection.lastUsedAt) })}</div>
                  )}
                </div>
                <button type="button" data-connection-remove={id} onClick={() => setPending(targetFor(connection))} className="ui-button shrink-0">
                  {t("personPanel.connections.remove")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {connections.length > 0 && (
        <button type="button" data-connection-remove-all onClick={() => setPending({ all: true, label: t("personPanel.connections.removeAll") })} className="ui-button self-start">
          {t("personPanel.connections.removeAll")}
        </button>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        confirmLabel={confirm?.confirmLabel ?? ""}
        tone="danger"
        pending={busy}
        onCancel={() => { if (!busy) setPending(null); }}
        onConfirm={() => {
          if (!pending || busy) return;
          setBusy(true);
          void revokePersonConnections(principalId, pending)
            .then(() => refresh())
            .then(() => { setPending(null); })
            .catch(() => { setError(t("personPanel.connections.removeError")); })
            .finally(() => { setBusy(false); });
        }}
      />
    </section>
  );
}
