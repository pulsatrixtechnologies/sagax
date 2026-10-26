// What a signed-in person may change. The server enforces this in
// request-auth.ts (default deny, then MEMBER_BOT_FIELDS). The client hides
// the same controls so an organization member never sees a switch the
// server will answer with 403. Absent capabilities (an older server) keep
// the previous screen except for a viewer whose role is "member".

/** How a bot looks in the list. A client session may change these on any
 * bot it can see, and nothing else, unless it owns the bot. */
export const CLIENT_BOT_PATCH_FIELDS = [
  "unread", "pinned", "pinnedMessageId", "color", "mascotExpression", "mascotBody", "mascotSkin", "mascotLook",
  "avatarCrop", "avatarZoom", "avatarFocusX", "avatarFocusY",
] as const;

/** What an organization member may set on a bot they own: look, name,
 * instructions, notifications, avatar and model. Never where it runs, what
 * it may reach, or how much it may do unasked. */
export const MEMBER_BOT_FIELDS = [
  ...CLIENT_BOT_PATCH_FIELDS,
  "name", "title", "description", "soul", "notifications", "avatarUrl", "modelSelection", "requireAvailableModel",
] as const;

const MEMBER_BOT_FIELD_SET = new Set<string>(MEMBER_BOT_FIELDS);
const CLIENT_BOT_PATCH_SET = new Set<string>(CLIENT_BOT_PATCH_FIELDS);

export function isMemberBotField(field: string): boolean {
  return MEMBER_BOT_FIELD_SET.has(field);
}

export function isClientBotPatchField(field: string): boolean {
  return CLIENT_BOT_PATCH_SET.has(field);
}

/** First field a member may not send, or null when every field is allowed. */
export function memberBotFieldViolation(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body";
  for (const key of Object.keys(body)) if (!MEMBER_BOT_FIELD_SET.has(key)) return key;
  return null;
}

export function clientBotPatchViolation(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body";
  for (const key of Object.keys(body)) if (!CLIENT_BOT_PATCH_SET.has(key)) return key;
  return null;
}

/** Installation writes a viewer may perform. Each one is a group of
 * settings the server answers 403 to when it is false. */
export interface ViewerCapabilities {
  /** PUT/PATCH /api/config and the other installation writes. */
  editConfig: boolean;
  /** Provider and service API keys. */
  manageKeys: boolean;
  /** The installation's computers (Local VM inventory, Boat, VPS). */
  manageComputers: boolean;
  /** Plan usage, spend history, budgets and sell prices. */
  viewUsage: boolean;
  /** Workspace backup export and import. */
  manageBackups: boolean;
  /** Mint a pairing code. Admins always; an organization member when the
   * server's org pairing route is open. */
  pairDevices: boolean;
}

/** `admin` is the request scope (loopback owner or an admin session).
 * `pairDevices` defaults to that same scope. */
export function viewerCapabilities(input: { admin: boolean; pairDevices?: boolean; viewUsage?: boolean; editConfig?: boolean; manageComputers?: boolean; manageBackups?: boolean }): ViewerCapabilities {
  const admin = input.admin;
  return {
    // 2026-10-19 (JC): an organization member an admin gave server.settings,
    // host.shell or backup.workspace in Perspicax sees those screens too.
    editConfig: admin || input.editConfig === true,
    manageKeys: admin || input.editConfig === true,
    manageComputers: admin || input.manageComputers === true,
    // An organization member whose profile includes usage.view (2026-10-09).
    viewUsage: admin || input.viewUsage === true,
    manageBackups: admin || input.manageBackups === true,
    pairDevices: input.pairDevices ?? admin,
  };
}
