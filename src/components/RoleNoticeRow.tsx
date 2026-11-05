// Visible roles (2026-11-05): a banner row for a role fact the person must
// see: a role that lapsed and stopped the call, a write refused (403, the
// bot stopped) or a read refused with no fallback, with the ConnectWise
// permission an administrator would grant (module › function, path, level)
// and the security role of the member behind the role.
import { ShieldAlert, Clock } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { RoleNotice } from "../../shared/wire";
import { roleLabel } from "./RoleChip";
import { permissionText } from "@/lib/role-permission";

export function RoleNoticeRow({ notice, botName }: { notice: RoleNotice; botName?: string }) {
  const role = roleLabel(notice.role);
  const permission = notice.permission ? permissionText(notice.permission) : "";
  const text = notice.kind === "lapsed"
    ? t("roles.notice.lapsed", { role })
    : notice.kind === "write_refused"
      ? t("roles.notice.writeRefusedShort", { role, bot: botName?.trim() || t("ids.deletedBot") })
      : t("roles.notice.readRefusedShort", { role });
  const member = notice.target?.startsWith("cw_member:") ? notice.target.slice("cw_member:".length) : "";
  return (
    <div
      role="status"
      data-role-notice={notice.kind}
      className={cn(
        "flex w-[min(38rem,100%)] items-start gap-2 rounded-xl border px-3 py-2 text-[12.5px] leading-snug",
        notice.kind === "lapsed" ? "border-warning/40 bg-warning/10 text-ink" : "border-danger/35 bg-danger/[0.07] text-ink",
      )}
    >
      {notice.kind === "lapsed"
        ? <Clock size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
        : <ShieldAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />}
      <span className="min-w-0">
        <span className="block">{text}</span>
        {permission && (
          <span className="mt-0.5 block text-[11.5px] text-ink-secondary">
            {t("roles.notice.missingLine", { permission })}
            {member && <> · {t("roles.notice.target", { member })}</>}
          </span>
        )}
      </span>
    </div>
  );
}
