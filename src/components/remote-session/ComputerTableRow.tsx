// The one table row of the Remote sessions Computers tab (#2723, redesigned
// 2026-11-17): the person's own Sagax installs (MyDevicesList) and their
// enrolled unattended hosts (UnattendedHostsSection) share it, so both read
// the same way. Columns: name (icon, name, a facts line), type and OS, status
// (online now or last seen), who can use it (chips), access (Always allow,
// Ask every time, Never allow) and a "..." menu. Under 44rem of page width the
// row is two lines: name, access and menu, then one muted line with the type,
// the status and the chips' words. A computer not seen for 14 days is dimmed.
import { useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";

import { PAGE_MENU } from "@/components/content-page";
import { MENU_FIT_ROW } from "@/components/menu-look";
import { PillSelect } from "@/components/SettingsPrimitives";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export type DeviceCardAccess = "always" | "ask" | "never";

export const DEVICE_ICON_BUTTON = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40";

/** `data-<kind>-access`, `data-<kind>-more`: the hooks tests and QA select on. */
function data(kind: string, part: string, value = ""): Record<string, string> {
  return { [`data-${kind}-${part}`]: value };
}

/** A small chip in the "who can use it" cell: "All bots", "Shared with 2", "Bot computer". */
export const DEVICE_CHIP = "inline-flex h-5 min-w-0 shrink items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border border-hairline/50 px-1.5 text-[11px] leading-4 text-ink-secondary";

const PHONE = "grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1";
/** The columns, shared by the head and every row. */
export const COMPUTER_COLUMNS = `${PHONE} @[44rem]/remote:grid-cols-[minmax(0,1.4fr)_minmax(0,0.55fr)_minmax(0,1.25fr)_minmax(0,1.2fr)_10.5rem_28px] @[44rem]/remote:gap-x-4`;
const HEAD_CELL = "text-[12px] leading-4 text-ink-secondary";
const WIDE = "hidden @[44rem]/remote:block";

/** The table's column titles, once at the top. */
export function ComputerTableHead() {
  return (
    <div role="row" className={cn("hidden items-center border-b border-hairline/40 pb-2 @[44rem]/remote:grid", COMPUTER_COLUMNS)}>
      <span role="columnheader" className={HEAD_CELL}>{t("remoteComputers.col.name")}</span>
      <span role="columnheader" className={HEAD_CELL}>{t("remoteComputers.col.type")}</span>
      <span role="columnheader" className={HEAD_CELL}>{t("remoteComputers.col.status")}</span>
      <span role="columnheader" className={HEAD_CELL}>{t("remoteComputers.col.who")}</span>
      <span role="columnheader" className={HEAD_CELL}>{t("remoteComputers.col.access")}</span>
      <span role="columnheader" className="sr-only">{t("remoteComputers.col.actions")}</span>
    </div>
  );
}

/** The "..." button of a row and its menu: the items get a close function. */
export function RowMenu({ kind, menu }: { kind: string; menu: { name: string; items: (close: () => void) => ReactNode } }) {
  const [open, setOpen] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, menuRoot, () => setOpen(false));
  return (
    <div ref={menuRoot} className="relative">
      <button type="button" {...data(kind, "more")} aria-haspopup="menu" aria-expanded={open} aria-label={t("myDevices.more", { name: menu.name })}
        onClick={() => setOpen((value) => !value)} className={DEVICE_ICON_BUTTON}>
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className={cn(PAGE_MENU, MENU_FIT_ROW)}>
          {menu.items(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function ComputerTableRow({ kind, icon: Icon, title, sub, type, presence, folded, foldedTitle, meta, online, dim, access, menu, rowData, children }: {
  /** "my-device" or "unattended-host". */
  kind: string;
  icon: LucideIcon;
  /** The name line (name, rename pencil, "This device"...). */
  title: ReactNode;
  /** The muted facts line under the name (organization, scope, aliases...). */
  sub?: ReactNode;
  /** "Linux", "iPadOS", "Computer". */
  type: string;
  /** "Online now", "Last seen 5 hr ago". */
  presence: string;
  /** The one muted line of the two-line (phone) row; `foldedTitle` is its full text. */
  folded: string;
  foldedTitle?: string;
  /** Chips in the "who can use it" cell. */
  meta?: ReactNode;
  online: boolean;
  /** Not seen for 14 days: dimmed. */
  dim?: boolean;
  access?: { value: DeviceCardAccess; name: string; disabled?: boolean; onChange: (next: DeviceCardAccess) => void };
  /** The "..." menu: its items get a close function. */
  menu?: { name: string; items: (close: () => void) => ReactNode };
  rowData?: Record<string, string | undefined>;
  /** Below the main line: error, tags, dialogs. */
  children?: ReactNode;
}) {
  const reset = "@[44rem]/remote:[grid-area:auto]";
  return (
    <div role="row" {...rowData} data-online={online ? "yes" : "no"} data-dim={dim ? "" : undefined} className="border-b border-hairline/40 hover:bg-hover">
      <div className={cn("grid items-center py-2.5", COMPUTER_COLUMNS, dim && "opacity-60")}>
        <div role="cell" className={cn("flex min-w-0 items-center gap-2.5 [grid-area:1/1]", reset)}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary"><Icon size={15} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            {title}
            {sub && <div className="mt-0.5 @max-[44rem]/remote:hidden min-w-0 text-[12px] leading-4 text-ink-secondary" {...data(kind, "sub")}>{sub}</div>}
          </div>
        </div>
        <div role="cell" data-computer-folded="" title={foldedTitle ?? folded} className="min-w-0 truncate pl-[2.625rem] text-[12px] leading-4 text-ink-secondary [grid-area:2/1] @[44rem]/remote:hidden" {...data(kind, "line")}>{folded}</div>
        <div role="cell" data-computer-type="" className={cn(WIDE, "min-w-0 truncate text-[12px] leading-4 text-ink-secondary")}>{type}</div>
        <div role="cell" data-computer-status="" className={cn(WIDE, "min-w-0 text-[12px] leading-4 text-ink-secondary")}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("size-1.5 shrink-0 rounded-full", online ? "bg-success" : "bg-ink-secondary/50")} aria-hidden="true" />
            <span className={cn("truncate", online && "text-success")} title={presence}>{presence}</span>
          </span>
        </div>
        <div role="cell" className={cn(WIDE, "min-w-0")}>
          {meta && <span className="flex min-w-0 flex-wrap items-center gap-1" {...data(kind, "meta")}>{meta}</span>}
        </div>
        <div role="cell" className={cn("flex min-w-0 [grid-area:2/2]", reset)}>
          {access && (
            <div className="flex min-w-0 [&>div]:min-w-0 [&_button]:max-w-full" {...data(kind, "access", access.value)}>
              <PillSelect bordered value={access.value} disabled={access.disabled} ariaLabel={t("myDevices.access.aria", { name: access.name })} onChange={access.onChange}
                options={[
                  { value: "always", label: t("myDevices.access.always") },
                  { value: "ask", label: t("myDevices.access.ask") },
                  { value: "never", label: t("myDevices.access.never") },
                ]} />
            </div>
          )}
        </div>
        <div role="cell" className={cn("flex justify-end [grid-area:1/2]", reset)}>
          {menu && <RowMenu kind={kind} menu={menu} />}
        </div>
      </div>
      {children && <div className="flex flex-col gap-1 pb-2.5 pl-[2.625rem]">{children}</div>}
    </div>
  );
}
