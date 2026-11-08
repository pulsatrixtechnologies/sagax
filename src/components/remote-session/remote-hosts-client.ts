// Computers panel client (team canvas, 2026-11-06): the person's own
// enrolled unattended hosts, a one-time install code to add a computer
// ("Unattended Remote Control") and placing a host on a team.
import type { RemoteHostCard, UnattendedHostAccess, UnattendedHostScope, UnattendedHostShare } from "../../../shared/remote-unattended-host";
import { api } from "@/state/store";

export type { RemoteHostCard };

export interface RemoteHostsAnswer {
  available: boolean;
  hosts: RemoteHostCard[];
  reason?: string;
}

export interface HostInstallCode {
  code: string;
  enrollUrl: string | null;
  org: string;
  scope: UnattendedHostScope;
  expiresAt: string | null;
  installCommand: string;
  /** The exact line per OS (sudo on macOS and Linux, PowerShell on Windows). */
  installCommands?: { macos: string; linux: string; windows: string };
}

export function fetchRemoteHosts(signal?: AbortSignal): Promise<RemoteHostsAnswer> {
  return api<RemoteHostsAnswer>("/api/remote-hosts", signal ? { signal } : undefined).then((body) => ({
    available: body.available === true,
    hosts: Array.isArray(body.hosts) ? body.hosts : [],
    ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
  }));
}

export function createHostInstallCode(options: { scope: UnattendedHostScope; consentRef?: string }): Promise<HostInstallCode> {
  const consentRef = options.consentRef?.trim();
  return api<HostInstallCode>("/api/remote-hosts/code", {
    method: "POST",
    body: JSON.stringify({ scope: options.scope, ...(consentRef ? { consentRef } : {}) }),
  });
}

/** What bots may do with one of the person's enrolled hosts (#2723). */
export function setRemoteHostAccess(hostId: string, access: UnattendedHostAccess): Promise<{ ok: true; access: UnattendedHostAccess }> {
  return api(`/api/remote-hosts/${encodeURIComponent(hostId)}/access`, { method: "PUT", body: JSON.stringify({ access }) });
}

export function placeRemoteHost(hostId: string, section: string | null): Promise<{ ok: true; section: string | null }> {
  return api(`/api/remote-hosts/${encodeURIComponent(hostId)}/team`, { method: "PUT", body: JSON.stringify({ section }) });
}

// ---- #2957: which bots may use a host, and who it is shared with ---------

export type { UnattendedHostShare };
export type HostShareTarget = { kind: "person" | "team"; id: string };

/** The bots allowed on one of the person's hosts: null = every bot (the default). */
export function setRemoteHostBots(hostId: string, botIds: string[] | null): Promise<{ bots: string[] | null }> {
  return api(`/api/admin/remote-sessions/hosts/${encodeURIComponent(hostId)}/bots`, { method: "PUT", body: JSON.stringify({ botIds }) });
}

/** Share a host with a person or a group of the organization (idempotent). */
export function shareRemoteHost(hostId: string, target: HostShareTarget): Promise<{ shares: UnattendedHostShare[] }> {
  return api(`/api/admin/remote-sessions/hosts/${encodeURIComponent(hostId)}/shares`, { method: "PUT", body: JSON.stringify(target) });
}

export function unshareRemoteHost(hostId: string, target: HostShareTarget): Promise<{ shares: UnattendedHostShare[] }> {
  return api(`/api/admin/remote-sessions/hosts/${encodeURIComponent(hostId)}/shares/${target.kind}/${encodeURIComponent(target.id)}`, { method: "DELETE" });
}
