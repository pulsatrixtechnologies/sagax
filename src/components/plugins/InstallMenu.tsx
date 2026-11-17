// Connect Apps > Discover (#4453, decided 2026-11-16): a row's button is
// "Install" with a small menu: For all my bots, For one bot... (a short list
// of the person's bots; one press installs it there). The scope is chosen on
// the item, never in the window's header. Opened from a bot's page the
// button is a plain Install for that bot (no menu).
import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, Loader2, Plus } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { MENU_ROW, MENU_SURFACE } from "@/components/menu-look";
import { pluginActionClass } from "./plugins-style";

export function InstallMenu({ label, busy = false, disabled = false, onAll, bots, onBot, name, iconOnly = false }: {
  /** the square "+" of a Discover card, in place of the labelled pill */
  iconOnly?: boolean;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  /** For all my bots */
  onAll: (anchor: HTMLElement) => void;
  /** the bots "For one bot..." lists; absent or empty: the line is not offered */
  bots?: ReadonlyArray<{ id: string; name: string }>;
  onBot?: (botId: string, anchor: HTMLElement) => void;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  usePopoverDismiss(open, ref, () => { setOpen(false); setList(false); });
  const oneBot = Boolean(onBot && bots && bots.length > 0);
  const face = (extra: string) => iconOnly
    ? cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink/[0.08] text-ink transition-colors hover:bg-ink/[0.14] disabled:opacity-50 motion-reduce:transition-none", extra)
    : cn(pluginActionClass(), extra);
  const close = () => { setOpen(false); setList(false); };
  // one line only (no bot to choose): no menu to open, the button installs
  if (!oneBot) {
    return (
      <div className="relative shrink-0" data-install-menu="">
        <button type="button" disabled={disabled || busy} aria-label={t("connectApps.install.aria", { name })} data-install-button="" data-install-all=""
          onClick={(event) => onAll(event.currentTarget)} className={face("")}>
          {busy ? <Loader2 size={13} className="mx-auto animate-spin" /> : iconOnly ? <Plus size={16} aria-hidden="true" /> : label}
        </button>
      </div>
    );
  }
  const rows: ReactNode = list ? (
    <>
      <button type="button" onClick={() => setList(false)} className={cn(MENU_ROW, "text-ink-secondary")} data-install-back="">
        <ChevronLeft size={14} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{t("connectApps.install.oneBot")}</span>
      </button>
      {bots?.map((bot) => (
        <button key={bot.id} type="button" role="menuitem" data-install-bot={bot.id} onClick={() => { close(); if (ref.current) onBot?.(bot.id, ref.current); }} className={MENU_ROW}>
          <span className="min-w-0 flex-1 truncate">{bot.name}</span>
        </button>
      ))}
    </>
  ) : (
    <>
      <button type="button" role="menuitem" data-install-all="" onClick={() => { close(); if (ref.current) onAll(ref.current); }} className={MENU_ROW}>
        <span className="min-w-0 flex-1 truncate">{t("connectApps.install.allBots")}</span>
      </button>
      {(
        <button type="button" role="menuitem" data-install-one="" onClick={() => setList(true)} className={MENU_ROW}>
          <span className="min-w-0 flex-1 truncate">{t("connectApps.install.oneBot")}</span>
        </button>
      )}
    </>
  );
  return (
    <div ref={ref} className="relative shrink-0" data-install-menu="">
      <button type="button" disabled={disabled || busy} aria-haspopup="menu" aria-expanded={open} aria-label={t("connectApps.install.aria", { name })}
        data-install-button="" onClick={() => setOpen((value) => !value)} className={iconOnly ? face("") : face("gap-1 pr-2.5")}>
        {busy ? <Loader2 size={13} className="mx-auto animate-spin" /> : iconOnly ? <Plus size={16} aria-hidden="true" /> : <>{label}<ChevronDown size={13} aria-hidden="true" /></>}
      </button>
      {open && (
        <div role="menu" className={cn(MENU_SURFACE, "absolute right-0 top-8 z-30 w-max min-w-[200px] max-w-[min(300px,calc(100vw-16px))]")}>
          {rows}
        </div>
      )}
    </div>
  );
}
