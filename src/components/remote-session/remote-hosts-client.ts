// Computers panel client (team canvas, 2026-11-06): the person's own
// enrolled unattended hosts, a one-time install code to add a computer
// ("Unattended Remote Control") and placing a host on a team.
import type { RemoteHostCard, UnattendedHostScope } from "../../../shared/remote-unattended-host";
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

export function placeRemoteHost(hostId: string, section: string | null): Promise<{ ok: true; section: string | null }> {
  return api(`/api/remote-hosts/${encodeURIComponent(hostId)}/team`, { method: "PUT", body: JSON.stringify({ section }) });
}
