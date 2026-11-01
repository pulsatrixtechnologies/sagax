// Computer tab client for enrolled hosts attached to a bot (2026-11-01).
import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";
import { api } from "@/state/store";

export interface BotRemoteHostsAnswer {
  available: boolean;
  hosts: UnattendedHostRow[];
  catalog: UnattendedHostRow[];
  attached: string[];
  reason?: string;
}

export function fetchBotRemoteHosts(botId: string): Promise<BotRemoteHostsAnswer> {
  return api<BotRemoteHostsAnswer>(`/api/bots/${encodeURIComponent(botId)}/remote-hosts`)
    .then((body) => ({
      available: body.available === true,
      hosts: Array.isArray(body.hosts) ? body.hosts : [],
      catalog: Array.isArray(body.catalog) ? body.catalog : [],
      attached: Array.isArray(body.attached) ? body.attached : [],
      ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
    }));
}

export function attachBotRemoteHost(botId: string, hostId: string): Promise<{ ok: true; remoteHosts: string[] } | { ok: false; error: string }> {
  return api<{ remoteHosts?: string[] }>(`/api/bots/${encodeURIComponent(botId)}/remote-hosts`, {
    method: "POST",
    body: JSON.stringify({ hostId }),
  })
    .then((body) => ({ ok: true as const, remoteHosts: Array.isArray(body.remoteHosts) ? body.remoteHosts : [] }))
    .catch((error: unknown) => {
      const message = (error as { body?: { error?: string } } | null)?.body?.error;
      return { ok: false as const, error: typeof message === "string" ? message : "refused" };
    });
}

export function detachBotRemoteHost(botId: string, hostId: string): Promise<{ ok: true; remoteHosts: string[] } | { ok: false; error: string }> {
  return api<{ remoteHosts?: string[] }>(`/api/bots/${encodeURIComponent(botId)}/remote-hosts/${encodeURIComponent(hostId)}`, { method: "DELETE" })
    .then((body) => ({ ok: true as const, remoteHosts: Array.isArray(body.remoteHosts) ? body.remoteHosts : [] }))
    .catch((error: unknown) => {
      const message = (error as { body?: { error?: string } } | null)?.body?.error;
      return { ok: false as const, error: typeof message === "string" ? message : "refused" };
    });
}

export function openBotRemoteHost(botId: string, hostId: string): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  return api<{ code?: string }>(`/api/bots/${encodeURIComponent(botId)}/remote-hosts/${encodeURIComponent(hostId)}/open`, {
    method: "POST",
    body: JSON.stringify({}),
  })
    .then((body) => ({ ok: true as const, code: String(body.code ?? "") }))
    .catch((error: unknown) => {
      const message = (error as { body?: { error?: string } } | null)?.body?.error;
      return { ok: false as const, error: typeof message === "string" ? message : "refused" };
    });
}
