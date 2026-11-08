// The one card row of the Remote Sessions device list (#2723): the person's
// own Sagax installs (MyDevicesList) and their enrolled unattended hosts
// (UnattendedHostsSection) share it, so both read the same way: icon, name,
// "Kind · Online now" or "Last seen ...", what bots may do with the computer
// (Always allow, Ask every time, Never allow) and a "⋯" menu. Extra detail
// sits below, behind the caller's own disclosure.
import { useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";

import { PAGE_POPOVER } from "@/components/content-page";
import { PillSelect } from "@/components/SettingsPrimitives";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export type DeviceCardAccess = "always" | "ask" | "never";

export const DEVICE_ICON_BUTTON = "flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline/50 text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-40";

/** `data-<kind>-access`, `data-<kind>-more`: the hooks tests and QA select on. */
function data(kind: string, part: string, value = ""): Record<string, string> {
  return { [`data-${kind}-${part}`]: value };
}

export function DeviceCardRow({ kind, icon: Icon, title, line, online, access, menu, rowData, children }: {
  /** "my-device" or "unattended-host". */
  kind: string;
  icon: LucideIcon;
  /** The name line (name, rename pencil, "This device"...). */
  title: ReactNode;
  /** "Computer · Online now", "Linux · Last seen 5 hr ago". */
  line: string;
  online: boolean;
  access?: { value: DeviceCardAccess; name: string; disabled?: boolean; onChange: (next: DeviceCardAccess) => void };
  /** The "⋯" menu: its items get a close function. */
  menu?: { name: string; items: (close: () => void) => ReactNode };
  rowData?: Record<string, string | undefined>;
  /** Below the main line: error, disclosure. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, menuRoot, () => setOpen(false));
  return (
    <li {...rowData} data-online={online ? "yes" : "no"}
      className="flex flex-col gap-1 rounded-xl border border-hairline/50 bg-panel p-3 transition-colors hover:border-hairline">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary"><Icon size={16} aria-hidden="true" /></span>
        <div className="min-w-[9rem] flex-1">
          {title}
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] leading-[18px] text-ink-secondary" {...data(kind, "line")}>
            <span className={cn("size-1.5 shrink-0 rounded-full", online ? "bg-success" : "bg-ink-secondary/50")} aria-hidden="true" />
            {line}
          </p>
        </div>
        {(access || menu) && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {access && (
              <div {...data(kind, "access", access.value)}>
                <PillSelect bordered value={access.value} disabled={access.disabled} ariaLabel={t("myDevices.access.aria", { name: access.name })} onChange={access.onChange}
                  options={[
                    { value: "always", label: t("myDevices.access.always") },
                    { value: "ask", label: t("myDevices.access.ask") },
                    { value: "never", label: t("myDevices.access.never") },
                  ]} />
              </div>
            )}
            {menu && (
              <div ref={menuRoot} className="relative">
                <button type="button" {...data(kind, "more")} aria-haspopup="menu" aria-expanded={open} aria-label={t("myDevices.more", { name: menu.name })}
                  onClick={() => setOpen((value) => !value)} className={DEVICE_ICON_BUTTON}>
                  <MoreHorizontal size={14} aria-hidden="true" />
                </button>
                {open && (
                  <div role="menu" className={cn(PAGE_POPOVER, "w-[220px] gap-0.5 p-1.5")}>
                    {menu.items(() => setOpen(false))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {children}
    </li>
  );
}
