// Visible roles (2026-11-05): the role a Perspicax tool step ran under, as a
// small chip after the step. The human name shows; the role id stays in the
// tooltip (never a GUID on screen). The chip takes the accent colour when the
// role differs from the previous step. A click opens "why this role": the
// chat default, the routine's role, the person's pick, the bot's switch, or a
// read refused (403) under the previous role and run once as "Moi".
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isOpaqueId, containsUuid } from "../../shared/human-id";
import type { ToolRole } from "../../shared/perspicax-roles";
import { stepToolName } from "@/lib/step-label";

const humanToolName = (name: string) => (name ? stepToolName({ name }) : "");

/** The role's name in words ("" slug is "Moi"). */
export function roleLabel(role: { slug: string; name: string }): string {
  if (!role.slug) return t("roles.me");
  const name = role.name?.trim();
  if (name && !isOpaqueId(name) && !containsUuid(name)) return name;
  return !isOpaqueId(role.slug) && !containsUuid(role.slug) ? role.slug : t("roles.chip.unnamed");
}

/** Whether the step's role differs from the one before it. */
export function roleChanged(role: ToolRole): boolean {
  return Boolean(role.previous && role.previous.slug !== role.slug);
}

/** "Why this role", in one sentence. */
export function roleWhy(role: ToolRole): string {
  const from = role.previous ? roleLabel(role.previous) : "";
  const person = role.person?.trim() || t("roles.me");
  switch (role.reason) {
    case "routine": return t("roles.why.routine");
    case "person": return t("roles.why.person");
    case "switch": return from ? t("roles.why.switch", { from }) : t("roles.why.routine");
    case "fallback": return t("roles.why.fallback", { from: from || t("roles.chip.unnamed"), tool: humanToolName(role.refusedTool ?? ""), person });
    case "rule": return t("roles.why.rule", { from: from || t("roles.chip.unnamed"), person });
    default: return t("roles.why.default");
  }
}

export function RoleChip({ role, className }: { role: ToolRole; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const label = roleLabel(role);
  const changed = roleChanged(role);
  const tooltip = role.slug
    ? (!isOpaqueId(role.slug) && !containsUuid(role.slug) ? t("roles.chip.idTooltip", { id: role.slug }) : undefined)
    : role.person ? t("roles.chip.meTooltip", { person: role.person }) : undefined;
  return (
    <span className={cn("inline-flex min-w-0 flex-col items-start", className)} data-role-chip="" data-role={role.slug || "me"} data-role-reason={role.reason} data-role-changed={changed ? "true" : undefined}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={t("roles.chip.aria", { role: label })}
        title={tooltip}
        className={cn(
          "inline-flex max-w-[14rem] items-center gap-1 rounded-full border px-1.5 text-[11px] leading-[18px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
          changed
            ? "border-accent/40 bg-accent/12 text-accent hover:bg-accent/18"
            : "border-hairline/60 bg-inset text-ink-secondary hover:text-ink",
          (role.reason === "fallback" || role.reason === "rule") && "border-warning/45 bg-warning/10 text-warning hover:bg-warning/15",
        )}
      >
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", changed ? "bg-accent" : role.reason === "fallback" || role.reason === "rule" ? "bg-warning" : "bg-ink-tertiary/60")} />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {open && (
        <span id={id} role="note" data-role-why="" className="mt-1 max-w-[30rem] rounded-lg border border-hairline/50 bg-raised px-2.5 py-1.5 text-[12px] leading-snug text-ink-secondary shadow-sm">
          <span className="block text-[11px] font-medium text-ink-tertiary">{t("roles.why.title")}</span>
          <span className="block text-ink">{roleWhy(role)}</span>
        </span>
      )}
    </span>
  );
}
