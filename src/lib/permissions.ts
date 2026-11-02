// The permissions of an organization server in the app (2026-10-09). The
// server enforces them (shared/permissions.ts, server/org/org-permissions.ts);
// the app hides or disables what the viewer's profile does not include and
// words a refusal the same way everywhere.
import { activeLocale, t } from "@/lib/i18n";
import { isPermissionKey, permissionLabel, type PermissionKey } from "../../shared/permissions";

/** The only config field this notice reads. The full status stays in the
 * store, so this module does not import it (#1381). */
type BotsReadOnlyConfig = {
  viewer?: { botsReadOnlyReason?: "permission" } | null;
};

/** "Your profile does not include <label>. Ask an admin to add it in Perspicax." */
export function permissionMissingText(key: PermissionKey): string {
  return t("permissions.missing", { label: permissionLabel(key, activeLocale()) });
}

/** The sentence for a refusal body that names a permission
 * (`{ error: "forbidden", permission }`), or null for any other body. */
export function permissionMissingMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const permission = (body as { permission?: unknown }).permission;
  return isPermissionKey(permission) ? permissionMissingText(permission) : null;
}

/** The notice of a person who may use shared bots only: the person sheet's
 * words, or the missing permission when their profile lacks bots.create. */
export function botsReadOnlyText(config: BotsReadOnlyConfig | null | undefined): string {
  return config?.viewer?.botsReadOnlyReason === "permission" ? permissionMissingText("bots.create") : t("bots.readOnly.notice");
}
