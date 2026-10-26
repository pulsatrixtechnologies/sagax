// A person's effective permissions on an organization server (2026-10-09).
//
// Perspicax computes the union of its permission sets a person gets (the
// default set, their own sets, their teams' sets) and sends it in the
// directory (`permissions`). This file turns that list, or its
// absence, into the set every gate reads through `can` (shared/permissions.ts):
//
// - an organization admin (Perspicax role admin, or the operator at the
//   server's own computer) holds every key;
// - a list from Perspicax is taken as is, minus unknown and admin-only keys;
// - no list (an older Perspicax, a person it does not list yet, before the
//   first directory) means the member defaults, so nothing regresses;
// - the person sheet still narrows on top, whatever the sets grant:
//   `sagax_bots: use` takes every key about owning bots, `sagax_integrations:
//   off` takes apps.ownIntegrations.
//
// Pure: index.ts gathers the facts and asks here.
import {
  MEMBER_DEFAULT_PERMISSIONS,
  PERMISSION_KEYS,
  type PermissionKey,
  type PermissionPrincipal,
} from "../shared/permissions.ts";

/** Keys about owning bots, taken by `sagax_bots: use`. */
export const BOT_OWNER_PERMISSIONS: readonly PermissionKey[] = [
  "bots.create", "bots.approvalLevel", "bots.fullAccess", "bots.behaviour", "bots.computer", "bots.tools",
  "sharing.grants", "sharing.visibility", "folders.botWorkingFolder",
];

export type PermissionSource = "admin" | "perspicax" | "defaults";

export interface EffectivePermissions extends PermissionPrincipal {
  admin: boolean;
  permissions: ReadonlySet<PermissionKey>;
  /** Where the list came from. */
  source: PermissionSource;
  /** Person sheet narrowings applied on top (`sagax_bots`, `sagax_integrations`). */
  narrowedBy: Array<"sagax_bots" | "sagax_integrations">;
}

export function effectivePermissions(input: {
  admin: boolean;
  /** What Perspicax sent for this person (known keys), or null for none. */
  fromDirectory: readonly PermissionKey[] | null;
  /** The person sheet says `sagax_bots: use`. */
  botsUseOnly?: boolean;
  /** The person sheet says `sagax_integrations: off`. */
  integrationsOff?: boolean;
}): EffectivePermissions {
  if (input.admin) return { admin: true, permissions: new Set(PERMISSION_KEYS), source: "admin", narrowedBy: [] };
  const held = new Set<PermissionKey>(input.fromDirectory ?? MEMBER_DEFAULT_PERMISSIONS);
  // 2026-10-22 (JC): server.experimental is a separate, explicit right. It is
  // NOT implied by server.settings: a settings delegate who should also manage
  // the experiments is given both keys in Perspicax. (The config write accepts
  // either key, so a settings-only delegate still edits the full installation;
  // request-auth.ts PERMISSION_ROUTES, shared/permissions.ts.)
  const narrowedBy: EffectivePermissions["narrowedBy"] = [];
  if (input.botsUseOnly) {
    for (const key of BOT_OWNER_PERMISSIONS) held.delete(key);
    narrowedBy.push("sagax_bots");
  }
  if (input.integrationsOff) {
    held.delete("apps.ownIntegrations");
    narrowedBy.push("sagax_integrations");
  }
  return { admin: false, permissions: held, source: input.fromDirectory ? "perspicax" : "defaults", narrowedBy };
}

/** The list a client or the console reads: catalogue order. */
export function permissionList(effective: Pick<EffectivePermissions, "permissions">): PermissionKey[] {
  return PERMISSION_KEYS.filter((key) => effective.permissions.has(key));
}
