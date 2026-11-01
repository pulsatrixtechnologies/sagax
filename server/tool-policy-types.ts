export type ToolTier = "read" | "write" | "admin";
export type PolicyMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ANY";
export type PolicyKind = "exact" | "prefix" | "pattern";

export interface ToolPolicy {
  method: PolicyMethod;
  kind: PolicyKind;
  /** The literal path, the prefix, or the regex source the handler matches. */
  route: string;
  tier: ToolTier;
  readOnly: boolean;
  /** `<area>:<read|write|admin>` */
  scope: string;
  /** Agent tools may reach it without a grant naming it. Never for admin. */
  defaultEnabled: boolean;
  destructive?: true;
  billing?: true;
  /** Admin because it deletes, but the resource belongs to one person: the
   * guard allows that person (server/tool-guard.ts). */
  ownerScoped?: true;
}
