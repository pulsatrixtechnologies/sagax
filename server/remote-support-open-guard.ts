// Direct Perspicax MCP relay for remote_support_open: the model must never
// choose host_id, nodekey or session. Sagax fills them from the bot's attached
// owned hosts and a key of its own (defense in depth beside Perspicax).
import { botHasRemoteHost } from "../shared/remote-bot-hosts.ts";
import { hostOwnedByPerson, parseUnattendedHostId } from "../shared/remote-unattended-host.ts";
import {
  handleRemoteSupportCall,
  openUnattendedSession,
  type RemoteSupportContext,
} from "./remote-support-local.ts";

export const REMOTE_SUPPORT_OPEN_REFUSED =
  "Refused by Sagax: that computer is not one of this bot's attached hosts (or not yours). Attach an enrolled host of yours in Computer, then open again without a nodekey or session id.";

export const REMOTE_SUPPORT_OPEN_NO_LOCAL =
  "Remote support runs on this computer, and this turn has no local directory for the technician key.";

/** Model-supplied host_id / nodekey / session / template are ignored. Sagax
 * generates the key and session; host_id is taken only from the bot's
 * attached, owned hosts when the model named one. */
export async function guardRemoteSupportOpen(input: {
  args: Record<string, unknown>;
  botId: string;
  principalId: string;
  /** Perspicax subject for ownership (installed_by). */
  ownerSub: string | null;
  /** The bot's attached host ids. */
  remoteHosts: string[] | null | undefined;
  /** True when hostId is enrolled and owned by this person. */
  ownsHost(hostId: string): Promise<boolean>;
  local: RemoteSupportContext | null;
  post: (tool: string, args: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;
}): Promise<{ text: string; isError?: boolean }> {
  if (!input.local?.dir) return { text: REMOTE_SUPPORT_OPEN_NO_LOCAL, isError: true };

  // Drop every model-supplied binding: Sagax owns host_id, nodekey, session.
  const safeArgs: Record<string, unknown> = { ...input.args };
  const modelHost = parseUnattendedHostId(safeArgs.host_id);
  delete safeArgs.host_id;
  delete safeArgs.nodekey;
  delete safeArgs.node_key;
  delete safeArgs.session;
  delete safeArgs.template;

  if (modelHost) {
    if (!botHasRemoteHost({ remoteHosts: input.remoteHosts }, modelHost)) {
      return { text: REMOTE_SUPPORT_OPEN_REFUSED, isError: true };
    }
    if (!(await input.ownsHost(modelHost))) {
      return { text: REMOTE_SUPPORT_OPEN_REFUSED, isError: true };
    }
    const out = await openUnattendedSession({
      hostId: modelHost,
      args: safeArgs,
      local: input.local,
      post: input.post,
    });
    if (!out.ok) return { text: out.error, isError: true };
    return { text: JSON.stringify({ code: out.code, state: "created", client: "app" }) };
  }

  return handleRemoteSupportCall({
    name: "remote_support_open",
    args: safeArgs,
    local: input.local,
    post: input.post,
  });
}

/** Ownership helper used by the MCP guard when the catalog is already known. */
export function attachedHostOwned(input: {
  hostId: string;
  remoteHosts: string[] | null | undefined;
  installedBy: string | null | undefined;
  ownerSub: string | null | undefined;
}): boolean {
  if (!botHasRemoteHost({ remoteHosts: input.remoteHosts }, input.hostId)) return false;
  return hostOwnedByPerson({ installedBy: input.installedBy ?? null }, input.ownerSub);
}
