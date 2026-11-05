// Visible roles, batch 3 (2026-11-05): the composer's role picker, drawn like
// the model picker (a quiet chip that opens a popover list above it). It
// shows only when this bot's turn mounts the Perspicax account connection for
// the signed-in person; the rows come from a live identity_switch of THAT
// person, asked again each time the menu opens (never a list kept from
// another turn or person). The pick fixes the role of the NEXT turn of this
// thread: it rides the next message (lib/role-pick), then resets.
//
// Rows: "Moi" first (the person's own access, the default), then each held
// role with "peut : …" from its abilities. An explicit-only role is greyed
// with "sur demande seulement" and stays pickable: an explicit pick is the
// only way to use it. No id on screen; the slug rides the tooltip.
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, UserRound } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { pickRole, useRolePick } from "@/lib/role-pick";
import { useMenuMotion } from "./MenuMotion";
import { roleLabel } from "./RoleChip";
import { isOpaqueId, containsUuid } from "../../shared/human-id";
import { roleAbilities, type RoleCan } from "../../shared/perspicax-roles";

/** One row of GET /api/bots/:id/roles/held (server/routes/perspicax-held-roles.ts). */
export interface PickerRole {
  slug: string;
  name: string;
  readOnly: boolean;
  explicitOnly: boolean;
  reachable: boolean;
  can?: RoleCan;
}

export interface HeldRolesAnswer {
  available: boolean;
  roles: PickerRole[];
  current?: string;
}

type Ability = ReturnType<typeof roleAbilities>[number];
const ABILITY_KEY: Record<Ability, LocaleKey> = {
  read: "roles.picker.ability.read",
  write: "roles.picker.ability.write",
  routines_run: "roles.picker.ability.routinesRun",
  approvals_answer: "roles.picker.ability.approvalsAnswer",
  flow: "roles.picker.ability.flow",
  sagax: "roles.picker.ability.sagax",
};

/** "peut : lire, écrire, lancer des routines". */
export function roleCanLine(can: RoleCan | undefined): string {
  return t("roles.picker.can", { abilities: roleAbilities(can).map((key) => t(ABILITY_KEY[key])).join(", ") });
}

const slugTooltip = (slug: string) => (!isOpaqueId(slug) && !containsUuid(slug) ? t("roles.chip.idTooltip", { id: slug }) : undefined);

/** The open list: "Moi", then the held roles. */
export function RolePickerMenu({ roles, selected, current, loading = false, failed = false, onPick, className }: {
  roles: readonly PickerRole[];
  /** The pick for the next turn ("" = Moi). */
  selected: string;
  /** The role the live connection acts as now, when there is one. */
  current?: string;
  loading?: boolean;
  failed?: boolean;
  onPick: (slug: string) => void;
  className?: string;
}) {
  const row = (slug: string, label: string, sub: string, extra: { muted?: boolean; note?: string; title?: string } = {}) => {
    const chosen = selected === slug;
    return (
      <button
        key={slug || "me"}
        type="button"
        role="menuitemradio"
        aria-checked={chosen}
        data-role-picker-row={slug || "me"}
        data-role-explicit-only={extra.muted ? "true" : undefined}
        title={extra.title}
        onClick={() => onPick(slug)}
        className="group flex min-h-8 w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-popover-ink outline-none hover:bg-popover-hover focus-visible:bg-popover-hover"
      >
        <span className={cn("flex min-w-0 flex-col", extra.muted && "opacity-55")}>
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate">{label}</span>
            {extra.note && <span data-role-picker-note="" className="shrink-0 text-[11.5px] text-popover-ink-secondary">{extra.note}</span>}
          </span>
          <span data-role-picker-can="" className="min-w-0 break-words text-[11.5px] text-popover-ink-secondary">{sub}</span>
        </span>
        <Check size={14} aria-hidden="true" className={cn("shrink-0 text-popover-accent", !chosen && "invisible")} />
      </button>
    );
  };
  return (
    <div
      role="menu"
      aria-label={t("roles.picker.menu")}
      data-role-picker-menu=""
      className={cn("flex w-[300px] max-w-[calc(100vw-16px)] flex-col rounded-xl border border-popover-hairline popover-surface bg-popover py-1 text-popover-ink shadow-2xl shadow-black/50", className)}
    >
      <div className="px-3.5 pb-1 pt-2 text-[11.5px] text-popover-ink-secondary">{t("roles.picker.menu")}</div>
      <div className="max-h-[min(360px,50dvh)] overflow-y-auto overscroll-contain px-1.5 pb-1">
        {row("", t("roles.me"), t("roles.picker.meDetail"))}
        {roles.map((role) => {
          const notes = [
            role.explicitOnly ? t("roles.picker.explicitOnly") : "",
            !role.reachable ? t("roles.picker.unreachable") : "",
            current && current === role.slug ? t("roles.picker.current") : "",
          ].filter(Boolean);
          return row(role.slug, roleLabel(role), roleCanLine(role.can), {
            muted: role.explicitOnly,
            ...(notes.length ? { note: notes.join(" · ") } : {}),
            ...(slugTooltip(role.slug) ? { title: slugTooltip(role.slug) } : {}),
          });
        })}
        {loading && !roles.length && <div className="px-2 py-1.5 text-[12px] text-popover-ink-secondary" data-role-picker-loading="">{t("roles.picker.loading")}</div>}
        {failed && <div className="px-2 py-1.5 text-[12px] text-warning" data-role-picker-failed="">{t("roles.picker.failed")}</div>}
      </div>
      <div className="border-t border-popover-hairline px-3.5 pb-1 pt-1.5 text-[11.5px] text-popover-ink-secondary">{t("roles.picker.hint")}</div>
    </div>
  );
}

const loadHeld = (botId: string, threadId: string) =>
  api<HeldRolesAnswer>(`/api/bots/${encodeURIComponent(botId)}/roles/held?threadId=${encodeURIComponent(threadId)}`);

/** The chip and its menu. Nothing at all unless Perspicax is mounted. */
export function RolePicker({ botId, threadId, initialOpen = false, load = loadHeld, organization }: {
  botId: string;
  threadId: string;
  /** Tests and the gallery: render with the menu open. */
  initialOpen?: boolean;
  /** Tests and the gallery: the held roles without a server. */
  load?: (botId: string, threadId: string) => Promise<HeldRolesAnswer>;
  /** Tests and the gallery: the organization is known (else /api/org says). */
  organization?: boolean;
}) {
  const org = usePerspicaxOrg();
  const onOrg = organization ?? Boolean(org);
  const [answer, setAnswer] = useState<HeldRolesAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(initialOpen);
  const picked = useRolePick(botId, threadId);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const motion = useMenuMotion(open);
  const menuId = useId();
  const loadRef = useRef(load);
  loadRef.current = load;

  // a fresh live listing for this person and thread: on mount, and each time the menu opens
  useEffect(() => {
    if (!onOrg) { setAnswer(null); return; }
    if (answer && !open) return;
    let alive = true;
    setLoading(true);
    setFailed(false);
    loadRef.current(botId, threadId).then(
      (value) => { if (alive) setAnswer(value); },
      () => { if (alive) setFailed(true); },
    ).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOrg, botId, threadId, open]);
  // another bot or thread: its own listing
  useEffect(() => { setAnswer(null); }, [botId, threadId]);

  useEffect(() => {
    if (!open || initialOpen) return;
    const outside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, initialOpen]);

  if (!onOrg || !answer?.available) return null;
  const selected = picked ?? "";
  const chosen = selected ? answer.roles.find((role) => role.slug === selected) : undefined;
  const label = selected ? roleLabel(chosen ?? { slug: selected, name: "" }) : t("roles.me");
  return (
    <div ref={wrapperRef} className="relative flex items-center" data-role-picker="" data-role-picked={picked === undefined ? undefined : picked || "me"}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("roles.picker.aria", { role: label })}
        title={selected ? slugTooltip(selected) ?? t("roles.picker.hint") : t("roles.picker.hint")}
        data-role-picker-trigger=""
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-8 max-w-[180px] items-center gap-1 rounded-lg px-1.5 text-[13px] hover:bg-raised hover:text-ink",
          picked !== undefined && selected ? "text-accent" : "text-ink-secondary",
        )}
      >
        <UserRound size={14} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {motion.shown && (
        <div id={menuId} className={cn("absolute bottom-full left-0 z-50 mb-1.5", motion.className)} {...motion.exitProps}>
          <RolePickerMenu
            roles={answer.roles}
            selected={selected}
            {...(answer.current !== undefined ? { current: answer.current } : {})}
            loading={loading}
            failed={failed}
            onPick={(slug) => {
              pickRole(botId, threadId, slug);
              setOpen(false);
              triggerRef.current?.focus();
            }}
          />
        </div>
      )}
    </div>
  );
}
