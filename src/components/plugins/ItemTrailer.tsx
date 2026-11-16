// Connect Apps (#4453, decided 2026-11-16): the right side of every row, the
// same on each kind: where the item is on ("All your bots", "2 bots", "No
// bot"), its switch (all of the person's bots at once, or the one bot the
// window was opened from), then "...". The same menu opens on a right click
// anywhere on the row: Turn on for all my bots, Choose the bots..., Turn off
// everywhere, See the detail, Uninstall. "Choose the bots" is a small
// checklist of the person's bots with Save, in the menu's own place. The
// scope is chosen here, on the item, never in the window's header.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, LoaderCircle, MoreHorizontal, RotateCw, Trash2, Users, Eye, Power, PowerOff } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { WhereLabel } from "@/lib/capability-kinds";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { MENU_ROW, MENU_ROW_DANGER, MENU_SURFACE } from "@/components/menu-look";
import { Switch } from "../SettingsPrimitives";

/** One of the person's bots in the checklist, and whether the item is on it. */
export interface BotChoice {
  id: string;
  name: string;
  on: boolean;
}

/** The checklist behind "Choose the bots...": the bots are read when it
 * opens (a plugin's state is per bot), Save writes only what changed. */
export interface ChooseBots {
  load: () => Promise<BotChoice[]> | BotChoice[];
  save: (next: Record<string, boolean>) => Promise<void> | void;
}

export interface ItemMenuActions {
  update?: () => void;
  allBots?: () => void;
  offEverywhere?: () => void;
  choose?: ChooseBots;
  detail?: () => void;
  /** more lines before Uninstall: Edit, Sign in, Manage on the account */
  links?: Array<{ id: string; label: string; icon: ReactNode; run: () => void }>;
  remove?: () => void;
  /** a dot on the "..." when an update waits */
  updateWaiting?: boolean;
}

/** The words of where an item is on. */
export function whereText(where: WhereLabel | "bot" | string): string {
  if (typeof where === "string") return where === "bot" ? t("connectApps.where.thisBot") : where;
  if (where.kind === "all") return t("connectApps.where.all");
  if (where.kind === "none") return t("connectApps.where.none");
  return where.count === 1 ? t("connectApps.where.one") : t("connectApps.where.many", { count: where.count });
}

/** Where a row is kept, at its right, before its switch: plain words. */
export function ScopePill({ label, title }: { label: string; title?: string }) {
  return <span data-row-scope="" title={title} className="shrink-0 whitespace-nowrap text-[12px] leading-4 text-ink-secondary">{label}</span>;
}

/** A row's switch, at its far right. Without `onChange` it is locked
 * (dimmed) and says why on hover. It never opens the row's page. */
export function RowSwitch({ name, on, onChange, lockedReason, busy = false }: { name: string; on: boolean; onChange?: (next: boolean) => void; lockedReason?: string; busy?: boolean }) {
  return (
    <Switch
      checked={on}
      disabled={!onChange || busy}
      title={onChange ? undefined : lockedReason}
      data-row-switch={onChange ? "" : "locked"}
      aria-label={t(on ? "connectApps.row.offAria" : "connectApps.row.onAria", { name })}
      onClick={(event) => { event.stopPropagation(); onChange?.(!on); }}
    />
  );
}

/** The row an item sits in: a right click on it opens the item's menu. */
export const ITEM_ROW_ATTR = "data-item-row";

export function ItemTrailer({ name, where, whereKind, on, onToggle, lockedReason, busy = false, actions = {} }: {
  name: string;
  /** the label at the right: a WhereLabel, or the words themselves */
  where?: WhereLabel | string;
  /** how many bots it reaches, to offer only the menu lines that change something */
  whereKind?: WhereLabel["kind"];
  on?: boolean;
  onToggle?: (next: boolean) => void;
  lockedReason?: string;
  busy?: boolean;
  actions?: ItemMenuActions;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<{ side: "left" | "right"; x: number; y: number } | null>(null);
  const [panel, setPanel] = useState<"menu" | "choose">("menu");
  usePopoverDismiss(open !== null, rootRef, () => { setOpen(null); setPanel("menu"); });
  const hasMenu = Object.entries(actions).some(([key, value]) => key !== "updateWaiting" && (Array.isArray(value) ? value.length > 0 : Boolean(value)));

  // a right click anywhere on the row opens this menu at the pointer
  useEffect(() => {
    const row = rootRef.current?.closest(`[${ITEM_ROW_ATTR}]`);
    if (!row || !hasMenu) return;
    const onContext = (event: Event) => {
      const pointer = event as MouseEvent;
      const target = pointer.target as Element | null;
      // a field or a link keeps the browser's own menu
      if (target?.closest("input, textarea, a[href]")) return;
      pointer.preventDefault();
      const box = rootRef.current?.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      if (!box) return;
      // the menu opens at the pointer, toward the room the row has left
      const leftHalf = pointer.clientX - rowBox.left < rowBox.width / 2;
      setPanel("menu");
      setOpen({ side: leftHalf ? "left" : "right", x: leftHalf ? pointer.clientX - box.left : box.right - pointer.clientX, y: pointer.clientY - box.bottom + 4 });
    };
    row.addEventListener("contextmenu", onContext);
    return () => row.removeEventListener("contextmenu", onContext);
  }, [hasMenu]);

  const close = () => { setOpen(null); setPanel("menu"); };
  const all = whereKind === "all";
  const none = whereKind === "none";
  const lines: Array<{ id: string; label: string; icon: ReactNode; run: () => void; danger?: boolean }> = [];
  if (actions.update) lines.push({ id: "update", label: t("connectApps.plugin.update"), icon: <RotateCw size={14} />, run: actions.update });
  if (actions.allBots && !all) lines.push({ id: "all", label: t("connectApps.menu.allBots"), icon: <Power size={14} />, run: actions.allBots });
  if (actions.choose) lines.push({ id: "choose", label: t("connectApps.menu.chooseBots"), icon: <Users size={14} />, run: () => setPanel("choose") });
  if (actions.offEverywhere && !none) lines.push({ id: "off", label: t("connectApps.menu.offEverywhere"), icon: <PowerOff size={14} />, run: actions.offEverywhere });
  if (actions.detail) lines.push({ id: "detail", label: t("connectApps.menu.detail"), icon: <Eye size={14} />, run: actions.detail });
  for (const link of actions.links ?? []) lines.push(link);
  if (actions.remove) lines.push({ id: "remove", label: t("connectApps.menu.uninstall"), icon: <Trash2 size={14} />, run: actions.remove, danger: true });

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center gap-2" data-item-trailer="">
      {where !== undefined && <ScopePill label={whereText(where)} />}
      {on !== undefined && <RowSwitch name={name} on={on} onChange={onToggle} lockedReason={lockedReason} busy={busy} />}
      {hasMenu ? (
        <button type="button" data-entry-menu="" aria-haspopup="menu" aria-expanded={open !== null} aria-label={t("connectApps.entry.menuAria", { name })}
          onClick={() => { setPanel("menu"); setOpen((value) => value ? null : { side: "right", x: 0, y: 4 }); }}
          className="ui-icon-button relative text-ink-tertiary hover:text-ink">
          <MoreHorizontal size={16} />
          {actions.updateWaiting && actions.update && <span data-entry-update-dot="" className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" aria-hidden="true" />}
        </button>
      ) : <span className="size-7 shrink-0" aria-hidden="true" />}
      {open && (
        <div role="menu" data-item-menu={panel} style={{ [open.side]: open.x, top: `calc(100% + ${open.y}px)` }}
          className={cn(MENU_SURFACE, "absolute z-30 w-max min-w-[228px] max-w-[min(320px,calc(100vw-16px))]")}>
          {panel === "menu" ? lines.map((line) => (
            <button key={line.id} type="button" role="menuitem" data-entry-action={line.id}
              onClick={() => { if (line.id === "choose") { line.run(); return; } close(); line.run(); }}
              className={line.danger ? MENU_ROW_DANGER : MENU_ROW}>
              {line.icon}
              <span className="min-w-0 flex-1 truncate">{line.label}</span>
              {line.id === "choose" && <ChevronRight size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />}
            </button>
          )) : actions.choose && <ChooseBotsPanel choose={actions.choose} onDone={close} />}
        </div>
      )}
    </div>
  );
}

/** "Choose the bots": the person's bots, a check on each, Save. */
export function ChooseBotsPanel({ choose, onDone }: { choose: ChooseBots; onDone: () => void }) {
  const [bots, setBots] = useState<BotChoice[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(choose.load()).then((list) => {
      if (!alive) return;
      setBots(list);
      setPicked(Object.fromEntries(list.map((bot) => [bot.id, bot.on])));
    });
    return () => { alive = false; };
    // the list is read once, when the panel opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changed = bots ? bots.filter((bot) => picked[bot.id] !== bot.on) : [];
  const save = async () => {
    setSaving(true);
    try {
      await choose.save(Object.fromEntries(changed.map((bot) => [bot.id, picked[bot.id] === true])));
    } finally {
      setSaving(false);
      onDone();
    }
  };
  return (
    <div data-choose-bots="" role="group" aria-label={t("connectApps.choose.title")} className="flex flex-col gap-0.5">
      <div className="px-2 pb-1 pt-0.5 text-[13px] font-medium leading-[18px] text-ink">{t("connectApps.choose.title")}</div>
      {bots === null ? (
        <div role="status" className="flex items-center gap-2 px-2 py-2 text-[13px] text-ink-secondary">
          <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("connectApps.choose.loading")}
        </div>
      ) : bots.length === 0 ? (
        <div className="px-2 py-2 text-[13px] text-ink-secondary">{t("connectApps.choose.none")}</div>
      ) : bots.map((bot) => (
        <button key={bot.id} type="button" role="menuitemcheckbox" aria-checked={picked[bot.id] === true} data-choose-bot={bot.id}
          onClick={() => setPicked((current) => ({ ...current, [bot.id]: !current[bot.id] }))} className={MENU_ROW}>
          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-[5px] border", picked[bot.id] ? "border-transparent bg-ink text-app" : "border-ink/30")}>
            {picked[bot.id] && <Check size={12} aria-hidden="true" />}
          </span>
          <span className="min-w-0 flex-1 truncate">{bot.name}</span>
        </button>
      ))}
      <div className="mt-1 flex items-center justify-end gap-2 px-1 pb-0.5">
        <button type="button" onClick={onDone} className="inline-flex h-7 items-center rounded-full px-3 text-[13px] text-ink-secondary hover:bg-hover hover:text-ink">{t("common.cancel")}</button>
        <button type="button" data-choose-save="" disabled={saving || bots === null || changed.length === 0} onClick={() => void save()}
          className="inline-flex h-7 items-center rounded-full bg-ink px-3 text-[13px] font-medium text-app transition-opacity hover:opacity-90 disabled:opacity-30">
          {t("connectApps.choose.save")}
        </button>
      </div>
    </div>
  );
}
