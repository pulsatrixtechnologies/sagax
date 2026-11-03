import { INVITE_TTL_MS, type OrgInvite } from "./org-directory.ts";
import { isPrincipalId } from "../auth/principals.ts";

export interface OrgRecord {
  name: string;
  host: { kind: "this-computer" } | { kind: "server"; url: string };
  ownerUserId: string;
}

export function serverAddressOk(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    // Tailscale names, or a local Docker server whose exposure the operator manages.
    return parsed.hostname.endsWith(".ts.net") || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function createOrg(input: { name: string; ownerUserId: string; host: OrgRecord["host"] }): OrgRecord {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  // Org mode needs a coordination server everyone signs in to. This
  // computer can be it, through its tunnel, Tailscale or domain address.
  if (input.host.kind !== "server" || !serverAddressOk(input.host.url)) throw new Error("a server address is required");
  // The owner is a person by principal id, never an email or "local-owner".
  const owner = input.ownerUserId.trim();
  if (!isPrincipalId(owner)) throw new Error("an organization owner must be a principal");
  return { name, ownerUserId: owner, host: { kind: "server", url: input.host.url.trim() } };
}

export function issueInvite(input: { email: string; now: number; token: string }): OrgInvite {
  return {
    token: input.token,
    email: input.email.trim().toLowerCase(),
    createdAt: input.now,
    expiresAt: input.now + INVITE_TTL_MS,
  };
}

export function memberListsAfterAccept(input: { members: string[]; email: string }) {
  const email = input.email.trim().toLowerCase();
  const members = input.members.map((id) => id.trim().toLowerCase()).filter(Boolean);
  if (members.includes(email)) return { members, alreadyMember: true };
  return { members: [...members, email], alreadyMember: false };
}
