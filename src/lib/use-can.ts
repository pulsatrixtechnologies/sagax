// The one client guard for a permission (shared/permissions.ts). Every UI
// gate asks the same question through viewerCan (src/lib/viewer.ts), which
// reads the viewer the server described in /api/config. The hook is the
// ergonomic form inside a component; <RequirePermission> hides a subtree the
// viewer may not see. The server enforces the same keys (server/request-auth.ts
// PERMISSION_ROUTES), so a hidden control can never be reached anyway: the UI
// gate is defense in depth and keeps a member from meeting a control that
// would only answer 403.
//
// Fail closed: a viewer without the key sees nothing extra. Prefer this to an
// ad-hoc role check (isAdmin, orgAdmin) so the whole app gates one way.
import type { ReactNode } from "react";
import { useStore } from "@/state/store";
import { viewerCan } from "@/lib/viewer";
import type { PermissionKey } from "../../shared/permissions";

/** Whether the signed-in viewer holds a permission. Reads the live config. */
export function useCan(key: PermissionKey): boolean {
  const { state } = useStore();
  return viewerCan(state.config, key);
}

/** Render `children` only when the viewer holds `permission`; otherwise
 * render `fallback` (nothing by default). The hidden path is the default:
 * pass a fallback only to show a short "ask an admin" notice in its place. */
export function RequirePermission({
  permission,
  children,
  fallback = null,
}: {
  permission: PermissionKey;
  children: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  return useCan(permission) ? children : fallback;
}
