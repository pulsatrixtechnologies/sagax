// One row of Settings > Computer > Manage devices (2026-11-19, the owner's
// reference): a tight row of the group's card. Icon, the name line (the
// rename pencil shows on hover, right after the name), and under it a small
// grey line, a status dot then "Computer · Online now". At the right, for
// another computer only, what bots may do with it as plain text with a
// chevron (the Execution row's control) and the "..." menu. The Computers
// table (ComputerTableRow) keeps its own columns for the Remote sessions page.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { PillSelect } from "@/components/SettingsPrimitives";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { RowMenu, type DeviceCardAccess } from "./ComputerTableRow";

export function DeviceCardRow({ kind, icon: Icon, title, sub, line, online, dim, aside, access, menu, rowData, children }: {
  kind: string;
  icon: LucideIcon;
  /** The name line: name and pencil, or the rename field. */
  title: ReactNode;
  /** A muted line under the status: the other names of this machine. */
  sub?: ReactNode;
  /** "Computer · Online now". */
  line: string;
  online: boolean;
  dim?: boolean;
  /** Muted words at the right ("This device"). */
  aside?: ReactNode;
  access?: { value: DeviceCardAccess; name: string; disabled?: boolean; onChange: (next: DeviceCardAccess) => void };
  menu?: { name: string; items: (close: () => void) => ReactNode };
  rowData?: Record<string, string | undefined>;
  children?: ReactNode;
}) {
  return (
    <div role="row" {...rowData} data-online={online ? "yes" : "no"} data-dim={dim ? "" : undefined}
      className="group/device border-b border-hairline/40 py-2 last:border-b-0">
      <div className={cn("flex items-center gap-3", dim && "opacity-60")}>
        <span role="cell" className="flex size-5 shrink-0 items-center justify-center text-ink-secondary"><Icon size={16} aria-hidden="true" /></span>
        <div role="cell" className="min-w-0 flex-1">
          <div className="flex h-6 min-w-0 items-center">{title}</div>
          <div data-computer-folded="" data-my-device-line="" title={line} className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", online ? "bg-success" : "bg-ink-secondary/50")} />
            <span className="min-w-0 truncate">{line}</span>
          </div>
          {sub && <div data-my-device-sub="" className="mt-0.5 min-w-0 text-[12px] leading-4 text-ink-secondary">{sub}</div>}
        </div>
        {aside && <span role="cell" className="shrink-0 text-[12px] text-ink-secondary">{aside}</span>}
        {access && (
          <div role="cell" className="flex min-w-0 shrink-0" {...{ [`data-${kind}-access`]: access.value }}>
            <PillSelect value={access.value} disabled={access.disabled} ariaLabel={t("myDevices.access.aria", { name: access.name })} onChange={access.onChange}
              options={[
                { value: "always", label: t("myDevices.access.always") },
                { value: "ask", label: t("myDevices.access.ask") },
                { value: "never", label: t("myDevices.access.never") },
              ]} />
          </div>
        )}
        {menu && <div role="cell" className="flex shrink-0"><RowMenu kind={kind} menu={menu} /></div>}
      </div>
      {children && <div className="flex flex-col gap-1 pl-8">{children}</div>}
    </div>
  );
}
